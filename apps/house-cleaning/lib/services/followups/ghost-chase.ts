/**
 * Ghost-Chase Follow-up Service (HC Build 2).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/04_FOLLOW_UPS.md
 *
 * Same 6-step cadence runs at two ghost points:
 *   - pre-quote ghost  → entity_type='lead'  (we asked qualifying Q, no reply)
 *   - post-quote ghost → entity_type='quote' (we sent quote link, no card on file)
 *
 * Step 6 = silent handoff to retargeting (no message, just enroll).
 *
 * Cadence (offsets from ghost start, NOT from previous step):
 *   step 1: +7 minutes
 *   step 2: +1 hour
 *   step 3: +24 hours
 *   step 4: +48 hours
 *   step 5: +96 hours (4 days)
 *   step 6: +120 hours (5 days) — handoff
 *
 * Cancellation triggers (handled by callers — we just expose cancelGhostChase):
 *   - lead.qualified / quote.card_on_file → all chase tasks cancelled
 *   - any inbound reply (mid-chase) → all chase tasks cancelled
 *   - customer.unsubscribed → global cancel handles it
 *   - job.created → cancel
 */

import { getSupabaseServiceClient } from '@/lib/supabase'
import { scheduleTask } from '@/lib/scheduler'
import { sendSMS } from '@/lib/openphone'
import { getTenantById } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import { renderTemplate, type TemplateContext, type TemplateKey } from './templates'

// ─────────────────────────────────────────────────────────────────────────────
// Cadence config
// ─────────────────────────────────────────────────────────────────────────────

export interface GhostChaseStep {
  step: number
  offset_minutes: number
  template: TemplateKey | null // null for step 6 (handoff, no message)
  action?: 'handoff_to_retargeting'
}

export const DEFAULT_GHOST_CHASE_CADENCE: GhostChaseStep[] = [
  { step: 1, offset_minutes: 7, template: 'still_there' },
  { step: 2, offset_minutes: 60, template: 'small_followup' },
  { step: 3, offset_minutes: 1440, template: 'followup_with_offer' },
  { step: 4, offset_minutes: 2880, template: 'soft_poke' },
  { step: 5, offset_minutes: 5760, template: 'last_chance_offer' },
  { step: 6, offset_minutes: 7200, template: null, action: 'handoff_to_retargeting' },
]

export type GhostEntityType = 'lead' | 'quote'

export interface GhostChasePayload extends Record<string, unknown> {
  entity_type: GhostEntityType
  entity_id: number | string
  customer_id: number
  step_index: number
  ghost_started_at: string // ISO timestamp
  /** Phone for active-conversation bypass in process-scheduled-tasks */
  phone?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleGhostChaseInput {
  tenantId: string
  customerId: number
  entityType: GhostEntityType
  entityId: number | string
  phone?: string
  /** Override ghost-start time (defaults to now). Useful for test fixtures. */
  ghostStartedAt?: Date
  /** Override cadence (defaults to DEFAULT_GHOST_CHASE_CADENCE). Per-tenant config goes here. */
  cadence?: GhostChaseStep[]
}

/**
 * Schedule the full 6-step ghost chase. Idempotent via task_key uniqueness:
 * re-scheduling for the same (entity_type, entity_id, step) updates the row
 * rather than creating duplicates.
 */
export async function scheduleGhostChase(
  input: ScheduleGhostChaseInput,
): Promise<{ scheduled: number; errors: string[] }> {
  const cadence = input.cadence || DEFAULT_GHOST_CHASE_CADENCE
  const ghostStartedAt = input.ghostStartedAt || new Date()
  const errors: string[] = []
  let scheduled = 0

  for (const step of cadence) {
    const runAt = new Date(ghostStartedAt.getTime() + step.offset_minutes * 60_000)
    const taskKey = `gc:${input.entityType}:${input.entityId}:${step.step}`

    const result = await scheduleTask({
      tenantId: input.tenantId,
      taskType: 'followup.ghost_chase',
      taskKey,
      scheduledFor: runAt,
      payload: {
        entity_type: input.entityType,
        entity_id: input.entityId,
        customer_id: input.customerId,
        step_index: step.step,
        ghost_started_at: ghostStartedAt.toISOString(),
        phone: input.phone,
      } satisfies GhostChasePayload,
      maxAttempts: 2,
    })

    if (result.success) {
      scheduled++
    } else {
      errors.push(`step ${step.step}: ${result.error || 'unknown'}`)
    }
  }

  await logSystemEvent({
    source: 'ghost-chase',
    event_type: 'GHOST_CHASE_SCHEDULED',
    tenant_id: input.tenantId,
    message: `Ghost chase scheduled (${input.entityType}#${input.entityId}, customer ${input.customerId})`,
    metadata: { scheduled, total: cadence.length, errors, ghost_started_at: ghostStartedAt.toISOString() },
  })

  return { scheduled, errors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel
// ─────────────────────────────────────────────────────────────────────────────

export type CancelReason =
  | 'lead_qualified'
  | 'quote_card_on_file'
  | 'customer_replied'
  | 'job_created'
  | 'customer_unsubscribed'
  | 'admin_disabled'
  | 'other'

/**
 * Cancel all pending ghost-chase tasks for a customer (atomic UPDATE).
 *
 * Use this on any cancellation event. Idempotent — safe to call repeatedly.
 */
export async function cancelGhostChase(
  tenantId: string,
  customerId: number,
  reason: CancelReason,
): Promise<{ cancelled: number }> {
  const supabase = getSupabaseServiceClient()

  const { data, error } = await supabase
    .from('scheduled_tasks')
    .update({
      status: 'cancelled',
      last_error: `cancelled: ${reason}`,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('task_type', 'followup.ghost_chase')
    .eq('status', 'pending')
    .filter('payload->>customer_id', 'eq', String(customerId))
    .select('id')

  if (error) {
    await logSystemEvent({
      source: 'ghost-chase',
      event_type: 'GHOST_CHASE_CANCEL_ERROR',
      tenant_id: tenantId,
      message: `Cancel ghost chase failed for customer ${customerId}: ${error.message}`,
      metadata: { reason, customer_id: customerId },
    })
    return { cancelled: 0 }
  }

  const cancelled = data?.length || 0
  if (cancelled > 0) {
    await logSystemEvent({
      source: 'ghost-chase',
      event_type: 'GHOST_CHASE_CANCELLED',
      tenant_id: tenantId,
      message: `Cancelled ${cancelled} pending ghost-chase tasks for customer ${customerId} (${reason})`,
      metadata: { reason, customer_id: customerId, cancelled },
    })
  }

  return { cancelled }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a single step (called from process-scheduled-tasks handler)
// ─────────────────────────────────────────────────────────────────────────────

export interface RunGhostStepInput {
  taskId: string
  payload: GhostChasePayload
  tenantId: string
}

/**
 * Execute one ghost-chase step.
 *
 * Re-checks ghost status before sending; if entity converted between scheduling
 * and firing, this step cancels the rest and exits silently.
 *
 * Step 6 (handoff) calls retargetingService.enroll instead of sending SMS.
 */
export async function runGhostChaseStep(input: RunGhostStepInput): Promise<{ sent: boolean; reason: string }> {
  const supabase = getSupabaseServiceClient()
  const { payload, tenantId } = input

  // 1. Hard-gate: is the customer unsubscribed or paused?
  const { data: cust } = await supabase
    .from('customers')
    .select('id, first_name, phone_number, unsubscribed_at, sms_opt_out, auto_response_disabled, human_takeover_until, auto_response_paused, manual_takeover_at')
    .eq('id', payload.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!cust) {
    await cancelGhostChase(tenantId, payload.customer_id, 'other')
    return { sent: false, reason: 'customer_not_found' }
  }
  if (cust.unsubscribed_at || cust.sms_opt_out) {
    await cancelGhostChase(tenantId, payload.customer_id, 'customer_unsubscribed')
    return { sent: false, reason: 'unsubscribed' }
  }
  if (cust.auto_response_disabled) {
    return { sent: false, reason: 'auto_response_disabled' }
  }
  if (cust.human_takeover_until && new Date(cust.human_takeover_until).getTime() > Date.now()) {
    // Human is in this thread right now — don't fire follow-up.
    // We don't cancel; the next pending step will re-check.
    return { sent: false, reason: 'human_takeover_active' }
  }
  // Defense-in-depth: even if the webhook missed setting human_takeover_until,
  // auto_response_paused + recent manual_takeover_at means an owner is in the
  // thread. Treat the same way: skip without cancelling.
  if (cust.auto_response_paused === true) {
    const recentManualMs = cust.manual_takeover_at ? Date.now() - new Date(cust.manual_takeover_at).getTime() : Infinity
    if (recentManualMs < 30 * 60 * 1000) {
      return { sent: false, reason: 'human_takeover_active_paused' }
    }
  }

  // 2. Re-check ghost status of the entity
  const stillGhosted = await checkStillGhosted(tenantId, payload)
  if (!stillGhosted) {
    await cancelGhostChase(tenantId, payload.customer_id, 'customer_replied')
    return { sent: false, reason: 'no_longer_ghosted' }
  }

  // 3. Look up the cadence step we're firing
  const step = DEFAULT_GHOST_CHASE_CADENCE.find(s => s.step === payload.step_index)
  if (!step) {
    return { sent: false, reason: 'unknown_step' }
  }

  // 4. Step 6 = silent handoff to retargeting (no SMS)
  if (step.action === 'handoff_to_retargeting') {
    const { enrollInRetargeting } = await import('./retargeting-service')
    await enrollInRetargeting({
      tenantId,
      customerId: payload.customer_id,
      entryReason: payload.entity_type === 'lead' ? 'lead_ghosted' : 'quote_ghosted',
    })
    return { sent: false, reason: 'handed_off_to_retargeting' }
  }

  // 5. Render template and send SMS
  if (!step.template) {
    return { sent: false, reason: 'no_template' }
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return { sent: false, reason: 'tenant_not_found' }
  }

  const phone = cust.phone_number || payload.phone || ''
  if (!phone) {
    return { sent: false, reason: 'no_phone' }
  }

  const tplCtx: TemplateContext = {
    customerFirstName: cust.first_name,
    tenantName: tenant.business_name_short || tenant.business_name || tenant.name || 'us',
  }
  const message = renderTemplate(step.template, tplCtx)
  if (!message) {
    return { sent: false, reason: 'template_render_failed' }
  }

  const sendResult = await sendSMS(tenant, phone, message)
  if (!sendResult.success) {
    return { sent: false, reason: `sms_failed: ${sendResult.error || 'unknown'}` }
  }

  await logSystemEvent({
    source: 'ghost-chase',
    event_type: 'GHOST_CHASE_MESSAGE_SENT',
    tenant_id: tenantId,
    message: `Sent ghost-chase step ${payload.step_index} to customer ${payload.customer_id}`,
    metadata: {
      customer_id: payload.customer_id,
      step_index: payload.step_index,
      template_key: step.template,
      entity_type: payload.entity_type,
      entity_id: payload.entity_id,
    },
  })

  return { sent: true, reason: `step_${payload.step_index}_sent` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ghost-status re-check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-read entity status from DB to confirm the customer is still ghosted.
 * Caller cancels remaining steps if this returns false.
 */
async function checkStillGhosted(tenantId: string, payload: GhostChasePayload): Promise<boolean> {
  const supabase = getSupabaseServiceClient()

  if (payload.entity_type === 'lead') {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('id', payload.entity_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!lead) return false
    return ['new', 'contacted', 'qualifying'].includes(lead.status as string)
  }

  if (payload.entity_type === 'quote') {
    const { data: quote } = await supabase
      .from('quotes')
      .select('id, status')
      .eq('id', payload.entity_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!quote) return false
    return ['sent', 'viewed', 'approved'].includes(quote.status as string)
  }

  return false
}
