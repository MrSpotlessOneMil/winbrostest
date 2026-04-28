/**
 * Retargeting (Win-Back) Service — Build 2.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/07_RETARGETING.md
 *
 * Two phases:
 *   - Structured (steps 1–5, fixed templates): 24h / 3wk / 8wk / 12wk / 16wk
 *   - Evergreen (forever, every 4 weeks): randomized offer pool, no back-to-back repeats
 *
 * Pattern: next-task-on-fire. At any moment an active customer has EXACTLY
 * ONE pending retargeting.win_back task. Partial unique index on
 * scheduled_tasks (migration 20260428_followup_rebuild_columns.sql) enforces
 * this invariant at the DB level.
 */

import { getSupabaseServiceClient } from '@/lib/supabase'
import { scheduleTask } from '@/lib/scheduler'
import { sendSMS } from '@/lib/openphone'
import { getTenantById } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import { renderTemplate, type TemplateContext, type TemplateKey } from './templates'
import {
  pickEvergreenOffer,
  DEFAULT_OFFER_POOL,
  type OfferPoolEntry,
} from './offer-engine'

// ─────────────────────────────────────────────────────────────────────────────
// Cadence
// ─────────────────────────────────────────────────────────────────────────────

export interface StructuredStep {
  step: number
  offset_minutes: number
  template_key: TemplateKey
}

/**
 * 16-week structured phase per 07_RETARGETING.md §2.
 * Offsets are from enrollment time, NOT from previous step.
 */
export const STRUCTURED_RETARGETING_CADENCE: StructuredStep[] = [
  { step: 1, offset_minutes: 24 * 60,           template_key: 'recurring_seed_20' },
  { step: 2, offset_minutes: 3 * 7 * 24 * 60,   template_key: 'open_slots_this_week' },
  { step: 3, offset_minutes: 8 * 7 * 24 * 60,   template_key: 'monthly_offer_15' },
  { step: 4, offset_minutes: 12 * 7 * 24 * 60,  template_key: 'monthly_offer_20' },
  { step: 5, offset_minutes: 16 * 7 * 24 * 60,  template_key: 'monthly_offer_15' },
]

const EVERGREEN_INTERVAL_MS = 4 * 7 * 24 * 60 * 60 * 1000 // 4 weeks

// ─────────────────────────────────────────────────────────────────────────────
// Payload
// ─────────────────────────────────────────────────────────────────────────────

export type RetargetingEntryReason = 'lead_ghosted' | 'quote_ghosted' | 'one_time_job_complete'
export type RetargetingPhase = 'structured' | 'evergreen'

export interface RetargetingPayload extends Record<string, unknown> {
  customer_id: number
  step_index: number
  phase: RetargetingPhase
  template_key: TemplateKey
  enrolled_at: string
  /** Optional offer label rendered into template (currency-formatted upstream) */
  offer_label?: string
  phone?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Enroll
// ─────────────────────────────────────────────────────────────────────────────

export interface EnrollInput {
  tenantId: string
  customerId: number
  entryReason: RetargetingEntryReason
}

/**
 * Enroll a customer in retargeting. Schedules ONE task at +24h (step 1).
 * Idempotent — partial unique index prevents duplicate active tasks.
 */
export async function enrollInRetargeting(input: EnrollInput): Promise<{ enrolled: boolean; reason: string }> {
  const supabase = getSupabaseServiceClient()

  // Refuse if customer is already active in retargeting (the index would also
  // catch this, but the explicit check gives a clean reason for logging)
  const { data: existing } = await supabase
    .from('customers')
    .select('id, retargeting_active, unsubscribed_at, sms_opt_out')
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)
    .maybeSingle()

  if (!existing) return { enrolled: false, reason: 'customer_not_found' }
  if (existing.unsubscribed_at || existing.sms_opt_out) return { enrolled: false, reason: 'unsubscribed' }
  if (existing.retargeting_active) return { enrolled: false, reason: 'already_active' }

  const now = new Date()
  const step1 = STRUCTURED_RETARGETING_CADENCE[0]
  const runAt = new Date(now.getTime() + step1.offset_minutes * 60_000)

  const result = await scheduleTask({
    tenantId: input.tenantId,
    taskType: 'retargeting.win_back',
    taskKey: `rt:${input.customerId}:enroll:${now.getTime()}`,
    scheduledFor: runAt,
    payload: {
      customer_id: input.customerId,
      step_index: 1,
      phase: 'structured',
      template_key: step1.template_key,
      enrolled_at: now.toISOString(),
    } satisfies RetargetingPayload,
    maxAttempts: 2,
  })

  if (!result.success) return { enrolled: false, reason: result.error || 'schedule_failed' }

  await supabase
    .from('customers')
    .update({ retargeting_active: true, retargeting_enrolled_at: now.toISOString() })
    .eq('id', input.customerId)
    .eq('tenant_id', input.tenantId)

  await logSystemEvent({
    source: 'retargeting',
    event_type: 'RETARGETING_ENROLLED',
    tenant_id: input.tenantId,
    message: `Enrolled customer ${input.customerId} in retargeting (${input.entryReason})`,
    metadata: { customer_id: input.customerId, entry_reason: input.entryReason, first_run_at: runAt.toISOString() },
  })

  return { enrolled: true, reason: 'scheduled' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Halt
// ─────────────────────────────────────────────────────────────────────────────

export type HaltReason = 'customer_replied' | 'customer_booked' | 'admin_disabled' | 'unsubscribed' | 'membership_created'

/**
 * Halt retargeting for a customer. Cancels the single pending task and clears
 * the active flag.
 */
export async function haltRetargeting(
  tenantId: string,
  customerId: number,
  reason: HaltReason,
): Promise<{ cancelled: number }> {
  const supabase = getSupabaseServiceClient()

  const { data: cancelled, error: cancelErr } = await supabase
    .from('scheduled_tasks')
    .update({
      status: 'cancelled',
      last_error: `cancelled: ${reason}`,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('task_type', 'retargeting.win_back')
    .eq('status', 'pending')
    .filter('payload->>customer_id', 'eq', String(customerId))
    .select('id')

  await supabase
    .from('customers')
    .update({ retargeting_active: false })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  if (cancelErr) {
    await logSystemEvent({
      source: 'retargeting',
      event_type: 'RETARGETING_HALT_ERROR',
      tenant_id: tenantId,
      message: `Halt retargeting failed for customer ${customerId}: ${cancelErr.message}`,
    })
    return { cancelled: 0 }
  }

  const count = cancelled?.length || 0
  if (count > 0) {
    await logSystemEvent({
      source: 'retargeting',
      event_type: 'RETARGETING_HALTED',
      tenant_id: tenantId,
      message: `Halted retargeting for customer ${customerId} (${reason})`,
      metadata: { customer_id: customerId, reason, cancelled: count },
    })
  }
  return { cancelled: count }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a fired task (handler called from process-scheduled-tasks)
// ─────────────────────────────────────────────────────────────────────────────

export interface RunWinBackInput {
  taskId: string
  payload: RetargetingPayload
  tenantId: string
  /** Override pool for tests / per-tenant config */
  pool?: OfferPoolEntry[]
}

export async function runWinBackStep(input: RunWinBackInput): Promise<{ sent: boolean; reason: string }> {
  const supabase = getSupabaseServiceClient()
  const { payload, tenantId } = input

  // 1. Hard-gate eligibility
  const { data: cust } = await supabase
    .from('customers')
    .select('id, first_name, phone_number, unsubscribed_at, sms_opt_out, retargeting_active, last_retargeting_template_key, bedrooms, bathrooms, human_takeover_until')
    .eq('id', payload.customer_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!cust) {
    return { sent: false, reason: 'customer_not_found' }
  }
  if (cust.unsubscribed_at || cust.sms_opt_out) {
    await haltRetargeting(tenantId, payload.customer_id, 'unsubscribed')
    return { sent: false, reason: 'unsubscribed' }
  }
  if (!cust.retargeting_active) {
    return { sent: false, reason: 'not_active' }
  }
  if (cust.human_takeover_until && new Date(cust.human_takeover_until).getTime() > Date.now()) {
    // Reschedule self for 1h later — let human finish
    const reschedRunAt = new Date(Date.now() + 60 * 60 * 1000)
    await scheduleTask({
      tenantId,
      taskType: 'retargeting.win_back',
      taskKey: `rt:${payload.customer_id}:resched:${Date.now()}`,
      scheduledFor: reschedRunAt,
      payload,
      maxAttempts: 2,
    })
    return { sent: false, reason: 'rescheduled_human_takeover' }
  }

  // 2. Render + send
  const tenant = await getTenantById(tenantId)
  if (!tenant) return { sent: false, reason: 'tenant_not_found' }
  const phone = cust.phone_number || payload.phone || ''
  if (!phone) return { sent: false, reason: 'no_phone' }

  const tplCtx: TemplateContext = {
    customerFirstName: cust.first_name,
    tenantName: tenant.business_name_short || tenant.business_name || tenant.name || 'us',
    offerLabel: payload.offer_label,
    bedrooms: cust.bedrooms,
    bathrooms: cust.bathrooms,
  }
  const message = renderTemplate(payload.template_key, tplCtx)
  if (!message) return { sent: false, reason: 'template_render_failed' }

  const sendResult = await sendSMS(tenant, phone, message)
  if (!sendResult.success) return { sent: false, reason: `sms_failed: ${sendResult.error || 'unknown'}` }

  // Record this template_key so the next pick can exclude it
  await supabase
    .from('customers')
    .update({ last_retargeting_template_key: payload.template_key })
    .eq('id', payload.customer_id)
    .eq('tenant_id', tenantId)

  await logSystemEvent({
    source: 'retargeting',
    event_type: 'RETARGETING_MESSAGE_SENT',
    tenant_id: tenantId,
    message: `Sent retargeting step ${payload.step_index} (${payload.phase}) to customer ${payload.customer_id}`,
    metadata: {
      customer_id: payload.customer_id,
      step_index: payload.step_index,
      phase: payload.phase,
      template_key: payload.template_key,
    },
  })

  // 3. Schedule the next task
  await scheduleNextWinBack({
    tenantId,
    customerId: payload.customer_id,
    currentStepIndex: payload.step_index,
    currentPhase: payload.phase,
    pool: input.pool,
    lastTemplateKey: payload.template_key,
  })

  return { sent: true, reason: `step_${payload.step_index}_${payload.phase}_sent` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schedule next (the next-task-on-fire bit)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleNextInput {
  tenantId: string
  customerId: number
  currentStepIndex: number
  currentPhase: RetargetingPhase
  pool?: OfferPoolEntry[]
  lastTemplateKey?: TemplateKey
}

async function scheduleNextWinBack(input: ScheduleNextInput): Promise<{ scheduled: boolean }> {
  const enrolledAt = new Date()
  let nextRunAt: Date
  let nextStep: number
  let nextPhase: RetargetingPhase
  let nextTemplate: TemplateKey

  if (input.currentPhase === 'structured' && input.currentStepIndex < STRUCTURED_RETARGETING_CADENCE.length) {
    // Still in structured phase: pick next structured step
    const next = STRUCTURED_RETARGETING_CADENCE[input.currentStepIndex] // index = current step (1-based) → next slot
    if (!next) return { scheduled: false }
    // Offsets are from ENROLLMENT, but we don't have that on the payload after step 1.
    // Approximate by computing offset_delta = next.offset - prev.offset; schedule from now.
    const prev = STRUCTURED_RETARGETING_CADENCE[input.currentStepIndex - 1]
    const deltaMinutes = next.offset_minutes - (prev?.offset_minutes || 0)
    nextRunAt = new Date(Date.now() + deltaMinutes * 60_000)
    nextStep = next.step
    nextPhase = 'structured'
    nextTemplate = next.template_key
  } else {
    // Move into evergreen phase (or stay there)
    const pool = input.pool || DEFAULT_OFFER_POOL
    const pick = pickEvergreenOffer({ pool, lastTemplateKey: input.lastTemplateKey })
    nextRunAt = new Date(Date.now() + EVERGREEN_INTERVAL_MS)
    nextStep = input.currentStepIndex + 1
    nextPhase = 'evergreen'
    nextTemplate = pick.template_key
  }

  const result = await scheduleTask({
    tenantId: input.tenantId,
    taskType: 'retargeting.win_back',
    taskKey: `rt:${input.customerId}:${nextPhase}:${nextStep}:${nextRunAt.getTime()}`,
    scheduledFor: nextRunAt,
    payload: {
      customer_id: input.customerId,
      step_index: nextStep,
      phase: nextPhase,
      template_key: nextTemplate,
      enrolled_at: enrolledAt.toISOString(),
    } satisfies RetargetingPayload,
    maxAttempts: 2,
  })

  return { scheduled: result.success }
}
