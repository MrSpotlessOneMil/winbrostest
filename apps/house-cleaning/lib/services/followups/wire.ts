/**
 * v2 Follow-up wiring — call after a successful AI outbound to a customer.
 *
 * Decides whether to schedule a ghost chase (and which entity_type) based on
 * the AI response and customer state. Idempotent — safe to call after every
 * AI response. Internally checks:
 *   - tenant has v2 enabled (otherwise no-op, legacy path stays in charge)
 *   - this is a fresh outbound (not a duplicate / retry)
 *   - no ghost chase already pending for this entity (task_key dedup)
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/04_FOLLOW_UPS.md
 */

import { getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { scheduleGhostChase, cancelGhostChase } from './ghost-chase'
import { enrollInRetargeting } from './retargeting-service'

interface MinimalTenant {
  id: string
  slug?: string
  workflow_config?: Record<string, unknown> | unknown
}

interface MinimalCustomer {
  id: number
  phone_number: string | null
}

export interface WireFollowupsInput {
  tenant: MinimalTenant
  customer: MinimalCustomer
  /** True if the AI response embedded a quote URL / fired BOOKING_COMPLETE */
  quoteJustSent: boolean
  /** Lead ID the customer is currently in, if any (status: new/contacted/qualifying) */
  activeLeadId?: number | null
  /** Quote ID just sent, if known */
  quoteId?: number | null
  /** Source label for logging */
  source: string
}

export function isV2Enabled(tenant: MinimalTenant): boolean {
  const cfg = tenant.workflow_config
  if (!cfg || typeof cfg !== 'object') return false
  return (cfg as Record<string, unknown>).followup_rebuild_v2_enabled === true
}

/**
 * Schedule the right ghost chase if eligible. Returns the side effects taken.
 *
 * Decision tree:
 *   1. tenant v2 disabled        → no-op
 *   2. quoteJustSent + quoteId   → schedule quote-ghost-chase (cancel any pending lead chase first)
 *   3. quoteJustSent (no quoteId)→ no-op (we don't know what entity to chase)
 *   4. activeLeadId provided     → schedule lead-ghost-chase
 *   5. neither                   → no-op
 */
export async function wireFollowupsAfterOutbound(
  input: WireFollowupsInput,
): Promise<{ scheduled: boolean; reason: string; entity_type?: 'lead' | 'quote' }> {
  const { tenant, customer, quoteJustSent, activeLeadId, quoteId, source } = input

  if (!isV2Enabled(tenant)) {
    return { scheduled: false, reason: 'v2_disabled' }
  }
  if (!customer?.id) {
    return { scheduled: false, reason: 'no_customer' }
  }
  const phone = customer.phone_number || undefined

  // Quote just went out → quote ghost chase wins. Also cancel any pending
  // lead chase for the same customer (lead became a quote, lead chase obsolete).
  if (quoteJustSent && quoteId) {
    await cancelGhostChase(tenant.id, customer.id, 'other')
    const res = await scheduleGhostChase({
      tenantId: tenant.id,
      customerId: customer.id,
      entityType: 'quote',
      entityId: quoteId,
      phone,
    })
    await logSystemEvent({
      source: 'ghost-chase',
      event_type: 'GHOST_CHASE_WIRED',
      tenant_id: tenant.id,
      message: `Wired quote ghost chase for customer ${customer.id} (quote ${quoteId})`,
      metadata: { customer_id: customer.id, quote_id: quoteId, source, scheduled: res.scheduled, errors: res.errors },
    })
    return { scheduled: res.scheduled > 0, reason: 'quote_chase_scheduled', entity_type: 'quote' }
  }

  // First AI outbound to a fresh lead → lead ghost chase
  if (activeLeadId) {
    const res = await scheduleGhostChase({
      tenantId: tenant.id,
      customerId: customer.id,
      entityType: 'lead',
      entityId: activeLeadId,
      phone,
    })
    await logSystemEvent({
      source: 'ghost-chase',
      event_type: 'GHOST_CHASE_WIRED',
      tenant_id: tenant.id,
      message: `Wired lead ghost chase for customer ${customer.id} (lead ${activeLeadId})`,
      metadata: { customer_id: customer.id, lead_id: activeLeadId, source, scheduled: res.scheduled, errors: res.errors },
    })
    return { scheduled: res.scheduled > 0, reason: 'lead_chase_scheduled', entity_type: 'lead' }
  }

  return { scheduled: false, reason: 'no_eligible_entity' }
}

/**
 * Job-completion hook — when a one_time job closes, enroll the customer in
 * retargeting (next-task-on-fire pattern).
 *
 * Idempotent — `enrollInRetargeting` checks `retargeting_active` and the
 * partial unique index on scheduled_tasks prevents double-scheduling.
 */
export async function wireRetargetingOnJobComplete(input: {
  tenant: MinimalTenant
  customerId: number
  /** Customer's lifecycle status — only one_time customers get enrolled */
  lifecycleStatus?: string | null
  source: string
}): Promise<{ enrolled: boolean; reason: string }> {
  const { tenant, customerId, lifecycleStatus, source } = input

  if (!isV2Enabled(tenant)) {
    return { enrolled: false, reason: 'v2_disabled' }
  }
  // Recurring/membership customers don't get retargeted — they're already engaged
  if (lifecycleStatus && lifecycleStatus !== 'one_time' && lifecycleStatus !== 'lapsed') {
    return { enrolled: false, reason: `lifecycle_${lifecycleStatus}_skip` }
  }
  if (!customerId) {
    return { enrolled: false, reason: 'no_customer' }
  }

  const res = await enrollInRetargeting({
    tenantId: tenant.id,
    customerId,
    entryReason: 'one_time_job_complete',
  })
  await logSystemEvent({
    source: 'retargeting',
    event_type: 'RETARGETING_ENROLLED_FROM_JOB',
    tenant_id: tenant.id,
    message: `Enrolled customer ${customerId} in retargeting after job completion`,
    metadata: { customer_id: customerId, source, enrolled: res.enrolled, reason: res.reason },
  })

  return { enrolled: res.enrolled, reason: res.reason }
}

/**
 * Pull the most recent active lead for a customer/tenant.
 * Used by callers that have a customer but not a leadId in scope.
 */
export async function getActiveLeadIdForCustomer(
  tenantId: string,
  customerId: number,
): Promise<number | null> {
  const supabase = getSupabaseServiceClient()
  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .in('status', ['new', 'contacted', 'qualifying'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/**
 * Pull the most recent active quote for a customer/tenant.
 */
export async function getActiveQuoteIdForCustomer(
  tenantId: string,
  customerId: number,
): Promise<number | null> {
  const supabase = getSupabaseServiceClient()
  const { data } = await supabase
    .from('quotes')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .in('status', ['sent', 'viewed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}
