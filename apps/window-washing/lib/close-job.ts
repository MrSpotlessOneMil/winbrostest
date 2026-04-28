/**
 * Close Job Automation for WinBros
 *
 * When a job is closed, automatically send:
 * 1. Receipt SMS (services performed, price breakdown, payment method)
 * 2. Google Review Request SMS
 * 3. Thank You + Tip Encouragement SMS
 *
 * Phase G slice 2 (2026-04-28): each message body is now resolved through
 * `automated_messages` (admin can edit per-tenant via Control Center).
 * The hardcoded strings below remain as the fallback so existing tenants
 * see no behavior change until they save a custom template.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { renderTemplate, resolveAutomatedMessage } from './automated-messages'

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
 * Build receipt vars (services block, total, tip line, payment method).
 *
 * The receipt body is templatized so admins can change the wording
 * without losing the auto-built breakdown.
 */
function buildReceiptVars(visit: VisitWithDetails): Record<string, string> {
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
    ? `Tip: $${Number(visit.tip_amount).toFixed(2)}`
    : ''

  return {
    customer_name: customerName,
    services_block: serviceLines,
    total: `$${total.toFixed(2)}`,
    tip_line: tipLine,
    payment_method: paymentMethod,
  }
}

const RECEIPT_FALLBACK_BODY = [
  `Hi {{customer_name}}! Here's your receipt from WinBros:`,
  '',
  'Services:',
  '{{services_block}}',
  '',
  'Total: {{total}}',
  '{{tip_line}}',
  'Payment: {{payment_method}}',
  '',
  'Thank you for choosing WinBros!',
].join('\n')

/**
 * Build receipt message from visit data — preserved for backwards
 * compatibility / tests. Pass a custom body to use the editable template.
 */
export function buildReceiptMessage(
  visit: VisitWithDetails,
  body: string = RECEIPT_FALLBACK_BODY,
): string {
  const vars = buildReceiptVars(visit)
  return renderTemplate(body, vars).replace(/\n{3,}/g, '\n\n')
}

const REVIEW_FALLBACK_BODY = [
  `Hi {{customer_name}}! We hope you're happy with your clean windows!`,
  '',
  `If you have a moment, we'd really appreciate a Google review:`,
  '{{review_link}}',
  '',
  'Your feedback helps us grow. Thank you!',
].join('\n')

/**
 * Build Google review request message.
 */
export function buildReviewMessage(
  customerName: string,
  reviewLink: string,
  body: string = REVIEW_FALLBACK_BODY,
): string {
  return renderTemplate(body, { customer_name: customerName, review_link: reviewLink })
}

const THANK_YOU_FALLBACK_BODY = [
  `Thanks again {{customer_name}}! Our crew really appreciates your business.`,
  '',
  'If you were happy with the service, tips are always appreciated by our technicians.',
  '',
  'See you next time!',
].join('\n')

/**
 * Build thank-you + tip encouragement message.
 */
export function buildThankYouMessage(
  customerName: string,
  body: string = THANK_YOU_FALLBACK_BODY,
): string {
  return renderTemplate(body, { customer_name: customerName })
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

  // 1. Send receipt — admin-editable template, falls back to default
  const receiptResolved = await resolveAutomatedMessage(client, {
    tenantId: visit.tenant_id,
    trigger: 'receipt',
    fallbackBody: RECEIPT_FALLBACK_BODY,
  })
  if (receiptResolved.isActive) {
    const receiptMsg = buildReceiptMessage(visitData, receiptResolved.body)
    await sendSms(visit.tenant_id, customer.phone_number, receiptMsg)
    messagesSent.push('receipt')
  }

  // 2. Send review request (if review link configured)
  if (googleReviewLink) {
    const reviewResolved = await resolveAutomatedMessage(client, {
      tenantId: visit.tenant_id,
      trigger: 'review_request',
      fallbackBody: REVIEW_FALLBACK_BODY,
    })
    if (reviewResolved.isActive) {
      const reviewMsg = buildReviewMessage(customerName, googleReviewLink, reviewResolved.body)
      await sendSms(visit.tenant_id, customer.phone_number, reviewMsg)
      messagesSent.push('review_request')
    }
  }

  // 3. Send thank you + tip message
  const thankYouResolved = await resolveAutomatedMessage(client, {
    tenantId: visit.tenant_id,
    trigger: 'thank_you_tip',
    fallbackBody: THANK_YOU_FALLBACK_BODY,
  })
  if (thankYouResolved.isActive) {
    const thankYouMsg = buildThankYouMessage(customerName, thankYouResolved.body)
    await sendSms(visit.tenant_id, customer.phone_number, thankYouMsg)
    messagesSent.push('thank_you_tip')
  }

  // Update job review_requested_at
  await client
    .from('jobs')
    .update({ review_requested_at: new Date().toISOString() })
    .eq('id', visit.job_id)

  return { success: true, messages_sent: messagesSent }
}
