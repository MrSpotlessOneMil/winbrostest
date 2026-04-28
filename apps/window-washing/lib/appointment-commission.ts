/**
 * Appointment-Set Commission Helpers
 *
 * Phase F (Dominic 2026-04-27): salesmen get 12.5% of an appointment's
 * quoted price the moment crew_salesman_id is set with price > 0. The
 * credit lives in `salesman_appointment_credits` as `pending`, flips to
 * `earned` when the appointment converts into a quoted job (linked via
 * quotes.appointment_job_id), and voids if it never converts.
 *
 * These helpers are pure-ish — they take a SupabaseClient so payroll
 * tests can stub them and so cron + dashboard callers share one path.
 */

import { SupabaseClient } from '@supabase/supabase-js'

export type AppointmentCreditStatus = 'pending' | 'earned' | 'voided'

interface UpsertPendingResult {
  success: boolean
  credit_id?: number
  amount_pending?: number
  skipped_reason?: string
  error?: string
}

/**
 * Upsert a pending credit for an appointment. Idempotent: the unique
 * constraint on (appointment_job_id) ensures one credit per appointment.
 *
 * Skips silently when:
 *   - appointment has no salesman assigned (crew_salesman_id null)
 *   - appointment has no price (price null or 0)
 *   - the credit already exists in 'earned' or 'voided' state (we never
 *     overwrite a settled credit just because the appointment got edited)
 */
export async function upsertPendingAppointmentCredit(
  client: SupabaseClient,
  args: {
    tenantId: string
    appointmentJobId: number
    salesmanId: number
    appointmentPrice: number
    commissionPct?: number  // optional — fetched from pay_rates if omitted
  }
): Promise<UpsertPendingResult> {
  if (!args.salesmanId) {
    return { success: true, skipped_reason: 'no salesman assigned' }
  }
  if (!args.appointmentPrice || args.appointmentPrice <= 0) {
    return { success: true, skipped_reason: 'no price set' }
  }

  // If a credit already exists and isn't pending, leave it alone — the
  // appointment is already past the "log" stage. Same for an existing
  // pending credit assigned to the same salesman (no churn).
  const { data: existing } = await client
    .from('salesman_appointment_credits')
    .select('id, status, salesman_id, amount_pending, frozen_pct')
    .eq('appointment_job_id', args.appointmentJobId)
    .maybeSingle()

  if (existing && (existing.status === 'earned' || existing.status === 'voided')) {
    return {
      success: true,
      credit_id: existing.id,
      skipped_reason: `credit already ${existing.status}`,
    }
  }

  // Look up the frozen rate for this salesman if not provided. Fall back
  // to 12.5 (Dominic's policy default) if pay_rates row doesn't exist yet.
  let pct = args.commissionPct
  if (pct == null) {
    const { data: rate } = await client
      .from('pay_rates')
      .select('commission_appointment_pct')
      .eq('cleaner_id', args.salesmanId)
      .eq('tenant_id', args.tenantId)
      .maybeSingle()
    pct = Number(rate?.commission_appointment_pct ?? 12.5)
  }

  const amountPending = Math.round(args.appointmentPrice * (pct / 100) * 100) / 100

  // Upsert: if a pending row exists but the salesman/price changed (admin
  // re-assigned the appointment), refresh the pending amount + salesman.
  const upsertRow = {
    tenant_id: args.tenantId,
    appointment_job_id: args.appointmentJobId,
    salesman_id: args.salesmanId,
    appointment_price: args.appointmentPrice,
    frozen_pct: pct,
    amount_pending: amountPending,
    status: 'pending' as AppointmentCreditStatus,
  }

  const { data, error } = await client
    .from('salesman_appointment_credits')
    .upsert(upsertRow, { onConflict: 'appointment_job_id' })
    .select('id, amount_pending')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, credit_id: data.id, amount_pending: data.amount_pending }
}

interface FlipResult {
  success: boolean
  credit_id?: number
  amount_earned?: number
  skipped_reason?: string
  error?: string
}

/**
 * Flip a pending credit to earned when a quote with appointment_job_id
 * converts. The earned amount is recomputed from the (possibly updated)
 * appointment_price × frozen_pct so a price-edit before conversion still
 * pays the right number.
 */
export async function settleAppointmentCreditOnConversion(
  client: SupabaseClient,
  args: {
    tenantId: string
    appointmentJobId: number
    convertedQuoteId: string
  }
): Promise<FlipResult> {
  const { data: credit } = await client
    .from('salesman_appointment_credits')
    .select('id, status, appointment_price, frozen_pct')
    .eq('appointment_job_id', args.appointmentJobId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle()

  if (!credit) {
    // The appointment didn't have a salesman or price when it was set —
    // nothing to settle, not an error.
    return { success: true, skipped_reason: 'no credit logged for this appointment' }
  }
  if (credit.status === 'earned') {
    return { success: true, credit_id: credit.id, skipped_reason: 'already earned' }
  }
  if (credit.status === 'voided') {
    return { success: true, credit_id: credit.id, skipped_reason: 'voided — cannot earn' }
  }

  const amountEarned =
    Math.round(Number(credit.appointment_price) * (Number(credit.frozen_pct) / 100) * 100) / 100

  const { data, error } = await client
    .from('salesman_appointment_credits')
    .update({
      status: 'earned' as AppointmentCreditStatus,
      amount_earned: amountEarned,
      converted_quote_id: args.convertedQuoteId,
      earned_at: new Date().toISOString(),
    })
    .eq('id', credit.id)
    .select('id, amount_earned')
    .single()

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, credit_id: data.id, amount_earned: Number(data.amount_earned) }
}

/**
 * Void a pending credit (e.g. cron sweep at 30+ days stale, or admin
 * manually cancels an appointment). Earned credits are immune.
 */
export async function voidAppointmentCredit(
  client: SupabaseClient,
  args: {
    creditId: number
    reason: string
  }
): Promise<{ success: boolean; error?: string }> {
  const { error } = await client
    .from('salesman_appointment_credits')
    .update({
      status: 'voided' as AppointmentCreditStatus,
      voided_at: new Date().toISOString(),
      void_reason: args.reason,
    })
    .eq('id', args.creditId)
    .eq('status', 'pending') // never void an earned credit

  if (error) {
    return { success: false, error: error.message }
  }
  return { success: true }
}

/**
 * Pure helper used by payroll: given a list of earned-and-unsettled
 * credits, sum amounts grouped by salesman_id. Exported so unit tests
 * can pin the math without a Supabase stub.
 */
export interface EarnedCreditRow {
  id: number
  salesman_id: number
  amount_earned: number | string | null
  appointment_price: number | string | null
  frozen_pct: number | string | null
}

export interface SalesmanAppointmentTotals {
  amount: number
  revenueSet: number
  frozenPct: number | null
  creditIds: number[]
}

export function aggregateEarnedCreditsBySalesman(
  rows: EarnedCreditRow[]
): Record<number, SalesmanAppointmentTotals> {
  const out: Record<number, SalesmanAppointmentTotals> = {}
  for (const r of rows) {
    const sid = r.salesman_id
    if (!sid) continue
    const amount = Number(r.amount_earned ?? 0) || 0
    const price = Number(r.appointment_price ?? 0) || 0
    const pct = r.frozen_pct == null ? null : Number(r.frozen_pct)
    if (!out[sid]) {
      out[sid] = { amount: 0, revenueSet: 0, frozenPct: pct, creditIds: [] }
    }
    out[sid].amount = Math.round((out[sid].amount + amount) * 100) / 100
    out[sid].revenueSet = Math.round((out[sid].revenueSet + price) * 100) / 100
    out[sid].creditIds.push(r.id)
    if (out[sid].frozenPct == null && pct != null) out[sid].frozenPct = pct
  }
  return out
}
