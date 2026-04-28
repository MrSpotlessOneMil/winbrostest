/**
 * Global Unsubscribe / STOP Handler.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/07_RETARGETING.md §10
 *
 * When a customer texts STOP / UNSUBSCRIBE / etc:
 *   1. Set customers.unsubscribed_at = now() (and via trigger, sms_opt_out_at)
 *   2. Set customers.retargeting_active = false
 *   3. Cancel ALL pending scheduled_tasks for that customer (system-wide,
 *      not just retargeting — also reminders, ghost chase, etc.)
 *   4. Send ONE TCPA-safe confirmation
 *
 * Re-opt-in via "BACK" / "START" / "SUBSCRIBE":
 *   - Clears unsubscribed_at, but does NOT auto-resume retargeting
 *   - Customer must take an explicit action (book) to re-enter
 */

import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { getTenantById } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import { renderTemplate } from './templates'

const STOP_PATTERNS = [
  /^stop$/i,
  /^unsubscribe$/i,
  /^quit$/i,
  /^cancel$/i,
  /^end$/i,
  /^opt[\s-]?out$/i,
  /^remove me$/i,
  /^stop messaging$/i,
]

const REOPTIN_PATTERNS = [/^back$/i, /^start$/i, /^subscribe$/i, /^opt[\s-]?in$/i]

/**
 * Returns true if the message is exactly a STOP-like keyword.
 * Safer than substring match (avoids false positives on "don't stop calling me").
 */
export function isStopMessage(rawMessage: string): boolean {
  const trimmed = rawMessage.trim()
  return STOP_PATTERNS.some(re => re.test(trimmed))
}

export function isReoptInMessage(rawMessage: string): boolean {
  const trimmed = rawMessage.trim()
  return REOPTIN_PATTERNS.some(re => re.test(trimmed))
}

export interface HandleUnsubscribeInput {
  tenantId: string
  customerId: number
  inboundMessageId?: string
}

export interface UnsubscribeResult {
  unsubscribed: boolean
  cancelledTasks: number
  confirmationSent: boolean
  reason: string
}

/**
 * Handle a STOP. Idempotent — calling on an already-unsubscribed customer
 * is a no-op (no second confirmation sent).
 */
export async function handleUnsubscribe(input: HandleUnsubscribeInput): Promise<UnsubscribeResult> {
  const supabase = getSupabaseServiceClient()
  const now = new Date().toISOString()

  // Idempotency check
  const { data: cust } = await supabase
    .from('customers')
    .select('id, first_name, phone_number, unsubscribed_at')
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()

  if (!cust) return { unsubscribed: false, cancelledTasks: 0, confirmationSent: false, reason: 'customer_not_found' }
  if (cust.unsubscribed_at) {
    return { unsubscribed: true, cancelledTasks: 0, confirmationSent: false, reason: 'already_unsubscribed' }
  }

  // 1. Mark unsubscribed (trigger syncs sms_opt_out_at)
  await supabase
    .from('customers')
    .update({ unsubscribed_at: now, retargeting_active: false })
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)

  // 2. Cancel ALL pending tasks for this customer (system-wide)
  const { data: cancelled } = await supabase
    .from('scheduled_tasks')
    .update({
      status: 'cancelled',
      last_error: 'cancelled: customer_unsubscribed',
      updated_at: now,
    })
    .eq('tenant_id', input.tenantId)
    .eq('status', 'pending')
    .filter('payload->>customer_id', 'eq', String(input.customerId))
    .select('id')

  const cancelledCount = cancelled?.length || 0

  // 3. Send single TCPA-safe confirmation
  const tenant = await getTenantById(input.tenantId)
  let confirmationSent = false
  if (tenant && cust.phone_number) {
    const confirmMsg = renderTemplate('unsubscribe_confirmation', {
      customerFirstName: cust.first_name,
      tenantName: tenant.business_name_short || tenant.business_name || tenant.name || 'us',
    })
    if (confirmMsg) {
      const result = await sendSMS(tenant, cust.phone_number, confirmMsg)
      confirmationSent = !!result.success
    }
  }

  await logSystemEvent({
    source: 'unsubscribe',
    event_type: 'CUSTOMER_UNSUBSCRIBED',
    tenant_id: input.tenantId,
    message: `Customer ${input.customerId} unsubscribed (cancelled ${cancelledCount} pending tasks)`,
    metadata: {
      customer_id: input.customerId,
      cancelled_tasks: cancelledCount,
      confirmation_sent: confirmationSent,
      inbound_message_id: input.inboundMessageId,
    },
  })

  return { unsubscribed: true, cancelledTasks: cancelledCount, confirmationSent, reason: 'unsubscribed' }
}

/**
 * Re-opt-in (BACK / START / SUBSCRIBE).
 * Clears unsubscribed_at. Does NOT auto-resume retargeting — customer must
 * take an explicit action.
 */
export async function handleReoptIn(input: HandleUnsubscribeInput): Promise<{ reactivated: boolean; reason: string }> {
  const supabase = getSupabaseServiceClient()

  const { data: cust } = await supabase
    .from('customers')
    .select('id, unsubscribed_at')
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()

  if (!cust) return { reactivated: false, reason: 'customer_not_found' }
  if (!cust.unsubscribed_at) return { reactivated: false, reason: 'not_currently_unsubscribed' }

  await supabase
    .from('customers')
    .update({ unsubscribed_at: null, sms_opt_out: false, sms_opt_out_at: null })
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)

  await logSystemEvent({
    source: 'unsubscribe',
    event_type: 'CUSTOMER_REOPT_IN',
    tenant_id: input.tenantId,
    message: `Customer ${input.customerId} re-opted in`,
    metadata: { customer_id: input.customerId, inbound_message_id: input.inboundMessageId },
  })

  return { reactivated: true, reason: 'reactivated' }
}
