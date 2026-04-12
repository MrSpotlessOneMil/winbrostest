/**
 * Quote → Job Conversion for WinBros
 *
 * When a quote is approved (by customer or salesman), it auto-converts to a Job + Visit.
 * Original quote line items are tagged as "original_quote" revenue (salesman credited).
 * Any upsells added later during the visit are "technician_upsell" (technician credited).
 */

import { SupabaseClient } from '@supabase/supabase-js'

interface QuoteLineItem {
  id: number
  service_name: string
  description: string | null
  price: number
  quantity: number
}

interface Quote {
  id: number
  tenant_id: string
  customer_id: number | null
  customer_name: string | null
  phone_number: string | null
  address: string | null
  total_price: number
  salesman_id: number | null
  status: string
}

interface ConversionResult {
  success: boolean
  job_id?: number
  visit_id?: number
  error?: string
}

/**
 * Approve a quote and auto-convert it to a Job + Visit.
 * This is the main entry point for quote→job conversion.
 */
export async function approveAndConvertQuote(
  client: SupabaseClient,
  quoteId: number,
  approvedBy: 'customer' | 'salesman'
): Promise<ConversionResult> {
  // 1. Fetch quote + line items
  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .single()

  if (quoteError || !quote) {
    return { success: false, error: `Quote not found: ${quoteError?.message}` }
  }

  // Guard: only draft or sent quotes can be approved
  if (!['draft', 'sent'].includes(quote.status)) {
    return { success: false, error: `Quote already ${quote.status}, cannot approve` }
  }

  const { data: lineItems, error: lineError } = await client
    .from('quote_line_items')
    .select('*')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true })

  if (lineError) {
    return { success: false, error: `Failed to fetch line items: ${lineError.message}` }
  }

  // 2. Create Job from quote
  const { data: job, error: jobError } = await client
    .from('jobs')
    .insert({
      tenant_id: quote.tenant_id,
      customer_id: quote.customer_id,
      phone_number: quote.phone_number,
      address: quote.address,
      price: quote.total_price,
      status: 'pending',
      source: 'quote',
      quote_id: quote.id,
      salesman_id: quote.salesman_id,
      notes: `Converted from Quote #${quote.id}`,
    })
    .select('id')
    .single()

  if (jobError || !job) {
    return { success: false, error: `Failed to create job: ${jobError?.message}` }
  }

  // 3. Create Visit (not_started, no date yet — will be scheduled later)
  const { data: visit, error: visitError } = await client
    .from('visits')
    .insert({
      job_id: job.id,
      tenant_id: quote.tenant_id,
      visit_date: new Date().toISOString().split('T')[0], // placeholder, admin will schedule
      status: 'not_started',
      visit_number: 1,
    })
    .select('id')
    .single()

  if (visitError || !visit) {
    return { success: false, error: `Failed to create visit: ${visitError?.message}` }
  }

  // 4. Copy quote line items to visit line items (all as original_quote revenue)
  if (lineItems && lineItems.length > 0) {
    const visitLineItems = lineItems.map((item: QuoteLineItem) => ({
      visit_id: visit.id,
      job_id: job.id,
      tenant_id: quote.tenant_id,
      service_name: item.service_name,
      description: item.description,
      price: item.price * item.quantity,
      revenue_type: 'original_quote' as const,
      added_by_cleaner_id: null,
    }))

    const { error: lineInsertError } = await client
      .from('visit_line_items')
      .insert(visitLineItems)

    if (lineInsertError) {
      return { success: false, error: `Failed to copy line items: ${lineInsertError.message}` }
    }
  }

  // 5. Update quote status to approved → converted
  const { error: updateError } = await client
    .from('quotes')
    .update({
      status: 'converted',
      approved_by: approvedBy,
      approved_at: new Date().toISOString(),
      converted_job_id: job.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteId)

  if (updateError) {
    return { success: false, error: `Failed to update quote: ${updateError.message}` }
  }

  return { success: true, job_id: job.id, visit_id: visit.id }
}

/**
 * Create a new quote with line items.
 */
export async function createQuote(
  client: SupabaseClient,
  data: {
    tenant_id: string
    customer_id?: number
    customer_name?: string
    phone_number?: string
    address?: string
    salesman_id?: number
    notes?: string
    valid_until?: string
    line_items: Array<{
      service_name: string
      description?: string
      price: number
      quantity?: number
    }>
  }
): Promise<{ success: boolean; quote_id?: number; error?: string }> {
  const totalPrice = data.line_items.reduce(
    (sum, item) => sum + item.price * (item.quantity || 1),
    0
  )

  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .insert({
      tenant_id: data.tenant_id,
      customer_id: data.customer_id || null,
      customer_name: data.customer_name || null,
      phone_number: data.phone_number || null,
      address: data.address || null,
      salesman_id: data.salesman_id || null,
      total_price: totalPrice,
      notes: data.notes || null,
      valid_until: data.valid_until || null,
      status: 'draft',
    })
    .select('id')
    .single()

  if (quoteError || !quote) {
    return { success: false, error: `Failed to create quote: ${quoteError?.message}` }
  }

  // Insert line items
  const lineItems = data.line_items.map((item, index) => ({
    quote_id: quote.id,
    tenant_id: data.tenant_id,
    service_name: item.service_name,
    description: item.description || null,
    price: item.price,
    quantity: item.quantity || 1,
    sort_order: index,
  }))

  const { error: lineError } = await client
    .from('quote_line_items')
    .insert(lineItems)

  if (lineError) {
    return { success: false, error: `Failed to create line items: ${lineError.message}` }
  }

  return { success: true, quote_id: quote.id }
}
