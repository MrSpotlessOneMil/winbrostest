/**
 * Close Job Automation for WinBros
 *
 * When a job is closed, automatically send:
 * 1. Receipt SMS (services performed, price breakdown, payment method)
 * 2. Google Review Request SMS
 * 3. Thank You + Tip Encouragement SMS
 */

import { SupabaseClient } from '@supabase/supabase-js'

interface VisitWithDetails {
  id: number
  job_id: number
  tenant_id: string
  visit_date: string
  payment_type: string
  payment_amount: number
  tip_amount: number
  line_items: Array<{
    service_name: string
    price: number
    revenue_type: string
  }>
  customer: {
    first_name: string | null
    last_name: string | null
    phone_number: string
  }
}

interface CloseJobResult {
  success: boolean
  messages_sent: string[]
  error?: string
}

/**
 * Build receipt message from visit data.
 */
export function buildReceiptMessage(visit: VisitWithDetails): string {
  const customerName = [visit.customer.first_name, visit.customer.last_name]
    .filter(Boolean)
    .join(' ') || 'Valued Customer'

  const serviceLines = visit.line_items
    .map(item => `  ${item.service_name}: $${Number(item.price).toFixed(2)}`)
    .join('\n')

  const total = visit.line_items.reduce((sum, item) => sum + Number(item.price), 0)
  const paymentMethod = visit.payment_type === 'card' ? 'Credit Card' :
    visit.payment_type === 'cash' ? 'Cash' : 'Check'

  const tipLine = visit.tip_amount > 0
    ? `\nTip: $${Number(visit.tip_amount).toFixed(2)}`
    : ''

  return [
    `Hi ${customerName}! Here's your receipt from WinBros:`,
    '',
    'Services:',
    serviceLines,
    '',
    `Total: $${total.toFixed(2)}${tipLine}`,
    `Payment: ${paymentMethod}`,
    '',
    'Thank you for choosing WinBros!',
  ].join('\n')
}

/**
 * Build Google review request message.
 */
export function buildReviewMessage(
  customerName: string,
  reviewLink: string
): string {
  return [
    `Hi ${customerName}! We hope you're happy with your clean windows!`,
    '',
    `If you have a moment, we'd really appreciate a Google review:`,
    reviewLink,
    '',
    'Your feedback helps us grow. Thank you!',
  ].join('\n')
}

/**
 * Build thank-you + tip encouragement message.
 */
export function buildThankYouMessage(customerName: string): string {
  return [
    `Thanks again ${customerName}! Our crew really appreciates your business.`,
    '',
    'If you were happy with the service, tips are always appreciated by our technicians.',
    '',
    'See you next time!',
  ].join('\n')
}

/**
 * Execute the full close-job automation.
 * Sends receipt, review request, and thank-you messages.
 */
export async function executeCloseJobAutomation(
  client: SupabaseClient,
  visitId: number,
  sendSms: (tenantId: string, to: string, message: string) => Promise<void>,
  googleReviewLink?: string
): Promise<CloseJobResult> {
  // Fetch visit with line items and customer
  const { data: visit, error: visitError } = await client
    .from('visits')
    .select(`
      id, job_id, tenant_id, visit_date, payment_type, payment_amount, tip_amount,
      jobs!inner(customer_id, customers!inner(first_name, last_name, phone_number))
    `)
    .eq('id', visitId)
    .single()

  if (visitError || !visit) {
    return { success: false, messages_sent: [], error: `Visit not found: ${visitError?.message}` }
  }

  const { data: lineItems } = await client
    .from('visit_line_items')
    .select('service_name, price, revenue_type')
    .eq('visit_id', visitId)

  const customer = (visit as any).jobs?.customers
  if (!customer?.phone_number) {
    return { success: false, messages_sent: [], error: 'Customer phone number not found' }
  }

  const customerName = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(' ') || 'Valued Customer'

  const visitData: VisitWithDetails = {
    id: visit.id,
    job_id: visit.job_id,
    tenant_id: visit.tenant_id,
    visit_date: visit.visit_date,
    payment_type: visit.payment_type,
    payment_amount: Number(visit.payment_amount),
    tip_amount: Number(visit.tip_amount),
    line_items: lineItems || [],
    customer: {
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone_number: customer.phone_number,
    },
  }

  const messagesSent: string[] = []

  // 1. Send receipt
  const receiptMsg = buildReceiptMessage(visitData)
  await sendSms(visit.tenant_id, customer.phone_number, receiptMsg)
  messagesSent.push('receipt')

  // 2. Send review request (if review link configured)
  if (googleReviewLink) {
    const reviewMsg = buildReviewMessage(customerName, googleReviewLink)
    await sendSms(visit.tenant_id, customer.phone_number, reviewMsg)
    messagesSent.push('review_request')
  }

  // 3. Send thank you + tip message
  const thankYouMsg = buildThankYouMessage(customerName)
  await sendSms(visit.tenant_id, customer.phone_number, thankYouMsg)
  messagesSent.push('thank_you_tip')

  // Update job review_requested_at
  await client
    .from('jobs')
    .update({ review_requested_at: new Date().toISOString() })
    .eq('id', visit.job_id)

  return { success: true, messages_sent: messagesSent }
}
