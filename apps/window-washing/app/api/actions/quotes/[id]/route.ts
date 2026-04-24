import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Quote detail — hydrates a quote plus its line items and service plans in
 * one round-trip for the Round 2 builder page.
 *
 * GET   /api/actions/quotes/:id — returns { quote, line_items, plans }
 * PATCH /api/actions/quotes/:id — replaces line_items + plans atomically.
 *       Also accepts top-level quote fields (total_price, original_price,
 *       notes, customer_name, customer_phone, customer_email,
 *       customer_address, description).
 *
 * Cross-tenant guard: quote.tenant_id must match authTenant.id on every op.
 */

interface BodyLineItem {
  service_name: string
  description?: string | null
  price: number
  quantity?: number
  optionality?: 'required' | 'recommended' | 'optional'
  is_upsell?: boolean
  sort_order?: number
}

interface BodyPlan {
  name: string
  discount_label?: string | null
  recurring_price: number
  first_visit_keeps_original_price?: boolean
  offered_to_customer?: boolean
  recurrence?: Record<string, unknown> | null
  commission_rule?: Record<string, unknown> | null
  sort_order?: number
}

function ensureWriter(authResult: { user: { id: number } }): NextResponse | null {
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/salesman access required' }, { status: 403 })
  }
  return null
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const client = getSupabaseServiceClient()

  const { data: quote, error: quoteErr } = await client
    .from('quotes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (quoteErr) return NextResponse.json({ error: quoteErr.message }, { status: 500 })
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (quote.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const [{ data: lineItems, error: liErr }, { data: plans, error: planErr }] = await Promise.all([
    client
      .from('quote_line_items')
      .select(
        'id, service_name, description, price, quantity, optionality, is_upsell, sort_order'
      )
      .eq('quote_id', id)
      .order('sort_order', { ascending: true }),
    client
      .from('quote_service_plans')
      .select(
        'id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, commission_rule, sort_order'
      )
      .eq('quote_id', id)
      .order('sort_order', { ascending: true }),
  ])

  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 })
  if (planErr) return NextResponse.json({ error: planErr.message }, { status: 500 })

  return NextResponse.json({
    quote,
    line_items: lineItems ?? [],
    plans: plans ?? [],
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const gate = ensureWriter(authResult)
  if (gate) return gate

  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: {
    customer_id?: number | null
    customer_name?: string
    customer_phone?: string | null
    customer_email?: string | null
    customer_address?: string | null
    description?: string | null
    notes?: string | null
    total_price?: number
    original_price?: number | null
    line_items?: BodyLineItem[]
    plans?: BodyPlan[]
    status?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { data: existing, error: getErr } = await client
    .from('quotes')
    .select('id, tenant_id, status')
    .eq('id', id)
    .maybeSingle()

  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (existing.status === 'converted') {
    return NextResponse.json(
      { error: 'Quote is already converted and cannot be edited' },
      { status: 409 }
    )
  }

  // Update top-level quote fields if provided.
  const quoteUpdates: Record<string, unknown> = {}
  if (typeof body.customer_id === 'number') quoteUpdates.customer_id = body.customer_id
  if (body.customer_id === null) quoteUpdates.customer_id = null
  if (typeof body.customer_name === 'string') quoteUpdates.customer_name = body.customer_name
  if (typeof body.customer_phone === 'string') quoteUpdates.customer_phone = body.customer_phone
  if (body.customer_phone === null) quoteUpdates.customer_phone = null
  if (typeof body.customer_email === 'string') quoteUpdates.customer_email = body.customer_email
  if (typeof body.customer_address === 'string')
    quoteUpdates.customer_address = body.customer_address
  if (typeof body.description === 'string') quoteUpdates.description = body.description
  if (typeof body.notes === 'string') quoteUpdates.notes = body.notes
  if (typeof body.total_price === 'number' && body.total_price >= 0)
    quoteUpdates.total_price = body.total_price
  if (typeof body.original_price === 'number' && body.original_price >= 0)
    quoteUpdates.original_price = body.original_price
  if (body.original_price === null) quoteUpdates.original_price = null
  if (typeof body.status === 'string') quoteUpdates.status = body.status

  if (Object.keys(quoteUpdates).length > 0) {
    quoteUpdates.updated_at = new Date().toISOString()
    const { error: updErr } = await client
      .from('quotes')
      .update(quoteUpdates)
      .eq('id', id)
      .eq('tenant_id', authResult.tenant.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  // Replace line_items if supplied.
  if (Array.isArray(body.line_items)) {
    const { error: delErr } = await client
      .from('quote_line_items')
      .delete()
      .eq('quote_id', id)
      .eq('tenant_id', authResult.tenant.id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    const rows = body.line_items
      .filter(item => item && typeof item.service_name === 'string' && item.service_name.trim())
      .map((item, index) => ({
        quote_id: id,
        tenant_id: authResult.tenant.id,
        service_name: String(item.service_name).trim(),
        description: item.description ?? null,
        price: Number(item.price) || 0,
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1,
        optionality:
          item.optionality === 'recommended' || item.optionality === 'optional'
            ? item.optionality
            : 'required',
        is_upsell: item.is_upsell === true,
        sort_order: typeof item.sort_order === 'number' ? item.sort_order : index,
      }))

    if (rows.length > 0) {
      const { error: insErr } = await client.from('quote_line_items').insert(rows)
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  // Replace plans if supplied.
  if (Array.isArray(body.plans)) {
    const { error: delErr } = await client
      .from('quote_service_plans')
      .delete()
      .eq('quote_id', id)
      .eq('tenant_id', authResult.tenant.id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    const rows = body.plans
      .filter(p => p && typeof p.name === 'string' && p.name.trim())
      .map((p, index) => ({
        quote_id: id,
        tenant_id: authResult.tenant.id,
        name: String(p.name).trim(),
        discount_label: p.discount_label ?? null,
        recurring_price: Number(p.recurring_price) || 0,
        first_visit_keeps_original_price: p.first_visit_keeps_original_price === true,
        offered_to_customer: p.offered_to_customer === true,
        recurrence: p.recurrence ?? null,
        commission_rule:
          p.commission_rule ?? {
            salesman_first_visit: true,
            salesman_recurring: false,
            salesman_residual_months: 0,
          },
        sort_order: typeof p.sort_order === 'number' ? p.sort_order : index,
      }))

    if (rows.length > 0) {
      const { error: insErr } = await client.from('quote_service_plans').insert(rows)
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  // Return the refreshed payload.
  const [{ data: quote }, { data: lineItems }, { data: plans }] = await Promise.all([
    client.from('quotes').select('*').eq('id', id).single(),
    client
      .from('quote_line_items')
      .select(
        'id, service_name, description, price, quantity, optionality, is_upsell, sort_order'
      )
      .eq('quote_id', id)
      .order('sort_order', { ascending: true }),
    client
      .from('quote_service_plans')
      .select(
        'id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, commission_rule, sort_order'
      )
      .eq('quote_id', id)
      .order('sort_order', { ascending: true }),
  ])

  return NextResponse.json({ quote, line_items: lineItems ?? [], plans: plans ?? [] })
}
