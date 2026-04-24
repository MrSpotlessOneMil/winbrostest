/**
 * Payroll Engine for WinBros
 *
 * Weekly payroll calculation with frozen rate snapshots.
 *
 * Technicians/Team Leads:
 * - pay_mode is 'hourly' XOR 'percentage' (Round 2 — never both).
 *   - 'hourly': total = (hours * rate) + (OT_hours * rate * 1.5)
 *   - 'percentage': total = revenue * pay_percentage
 * - Revenue completed comes from visit_line_items (sold + upsell).
 *
 * Salesmen:
 * - Commission per plan type (1-time, triannual, quarterly).
 * - pay_mode is inert for salesmen — commission path always runs.
 * - Only credited for original_quote revenue.
 *
 * CRITICAL: Changing current pay rates NEVER affects past payroll weeks.
 * Each week's rates are frozen at generation time.
 */

import { SupabaseClient } from '@supabase/supabase-js'

type PayMode = 'hourly' | 'percentage'

interface PayRate {
  cleaner_id: number
  role: string
  pay_mode: PayMode | null
  hourly_rate: number | null
  pay_percentage: number | null
  commission_1time_pct: number | null
  commission_triannual_pct: number | null
  commission_quarterly_pct: number | null
  commission_monthly_pct: number | null
}

interface TechPayrollEntry {
  cleaner_id: number
  role: 'technician' | 'team_lead'
  revenue_completed: number
  revenue_sold: number
  revenue_upsell: number
  pay_percentage: number
  hours_worked: number
  overtime_hours: number
  overtime_rate: number
  hourly_rate: number
  total_pay: number
}

interface SalesmanPayrollEntry {
  cleaner_id: number
  role: 'salesman'
  revenue_1time: number
  revenue_triannual: number
  revenue_quarterly: number
  commission_1time_pct: number
  commission_triannual_pct: number
  commission_quarterly_pct: number
  total_pay: number
}

/**
 * Calculate technician pay for a week.
 *
 * Strictly exclusive: pay_mode='hourly' pays ONLY hours * rate + OT.
 * pay_mode='percentage' pays ONLY revenue * percentage.
 * Round 2 — never both. `null` pay_mode defaults to 'hourly' as the safe floor.
 */
export function calculateTechPay(
  revenueCompleted: number,
  payMode: PayMode | null,
  payPercentage: number | null,
  hoursWorked: number,
  overtimeHours: number,
  hourlyRate: number | null,
  overtimeRate: number = 1.5
): number {
  const mode: PayMode = payMode ?? 'hourly'

  if (mode === 'percentage') {
    const pct = payPercentage ?? 0
    return Math.round(revenueCompleted * (pct / 100) * 100) / 100
  }

  // mode === 'hourly'
  const rate = hourlyRate ?? 0
  if (rate <= 0) return 0

  const regularHours = Math.max(0, hoursWorked - overtimeHours)
  const total = regularHours * rate + overtimeHours * rate * overtimeRate
  return Math.round(total * 100) / 100
}

/**
 * Calculate salesman commission for a week.
 * Different % for each plan type, applied to original_quote revenue only.
 */
export function calculateSalesmanPay(
  revenue1time: number,
  revenueTriannual: number,
  revenueQuarterly: number,
  commission1timePct: number,
  commissionTriannualPct: number,
  commissionQuarterlyPct: number
): number {
  const total =
    revenue1time * (commission1timePct / 100) +
    revenueTriannual * (commissionTriannualPct / 100) +
    revenueQuarterly * (commissionQuarterlyPct / 100)

  return Math.round(total * 100) / 100
}

/**
 * Shape of a visit row as fetched by generatePayrollWeek. Exported so unit
 * tests can pin the revenue-attribution logic without a Supabase mock.
 */
export interface VisitForPayroll {
  technicians?: number[] | null
  jobs?: { crew_salesman_id?: number | null; cleaner_id?: number | null } | null
  visit_line_items?: Array<{
    price: number
    revenue_type?: 'original_quote' | 'technician_upsell' | null
    added_by_cleaner_id?: number | null
  }> | null
}

/**
 * Plan type bucket for salesman commission attribution (Wave 3e).
 * Derived from service_plans.recurrence.interval_months — 1=monthly,
 * 3=quarterly, 4=triannual. Anything else (or a non-plan visit) is
 * classified as one-time.
 */
export type SalesmanPlanType = 'onetime' | 'triannual' | 'quarterly'

export interface VisitForSalesmanPayroll {
  jobs?: {
    id?: number
    salesman_id?: number | null
    credited_salesman_id?: number | null
    service_plan_jobs?: Array<{
      service_plans?: {
        recurrence?: Record<string, unknown> | null
      } | null
    }> | null
  } | null
  visit_line_items?: Array<{
    price: number
    revenue_type?: 'original_quote' | 'technician_upsell' | null
  }> | null
}

/**
 * Map a service_plans.recurrence JSONB to a salesman-commission bucket.
 * Admins store recurrences flexibly (per Max's "don't hardcode plan names"
 * rule), so we only trust `interval_months` when it's a known value.
 */
export function classifyPlanBucket(
  recurrence: Record<string, unknown> | null | undefined
): SalesmanPlanType {
  if (!recurrence) return 'onetime'
  const months = Number((recurrence as { interval_months?: unknown }).interval_months)
  if (months === 3) return 'quarterly'
  if (months === 4) return 'triannual'
  return 'onetime'
}

/**
 * Mutates `salesmanRevenue` with the original_quote revenue from one visit,
 * routed to the admin-override `credited_salesman_id` if set, else the
 * quote's `salesman_id`.
 *
 * Pure — tests can call this directly without a Supabase stub.
 */
export function accumulateSalesmanRevenue(
  visit: VisitForSalesmanPayroll,
  salesmanRevenue: Record<number, { onetime: number; triannual: number; quarterly: number }>
): void {
  const job = visit.jobs
  if (!job) return
  const attributedTo = job.credited_salesman_id ?? job.salesman_id
  if (!attributedTo) return

  const bucket = classifyPlanBucket(
    job.service_plan_jobs?.[0]?.service_plans?.recurrence ?? null
  )

  let originalQuoteTotal = 0
  for (const item of visit.visit_line_items ?? []) {
    if (item.revenue_type === 'original_quote') {
      originalQuoteTotal += Number(item.price) || 0
    }
  }
  if (originalQuoteTotal === 0) return

  const existing =
    salesmanRevenue[attributedTo] ||
    (salesmanRevenue[attributedTo] = { onetime: 0, triannual: 0, quarterly: 0 })
  existing[bucket] += originalQuoteTotal
}

/**
 * Mutates `techSold` and `techUpsell` aggregates with revenue from one visit.
 *
 * Round 2 attribution rules:
 *   - original_quote lines → split evenly across visit.technicians (base pay)
 *   - technician_upsell lines → credit to added_by_cleaner_id; if that's null
 *     (quote-level is_upsell set in the builder), fall back to the visit's
 *     team-lead id: job.crew_salesman_id → job.cleaner_id → visit.technicians[0].
 *
 * Pulled out of generatePayrollWeek so unit tests can exercise it without a
 * Supabase stub.
 */
export function accumulateVisitRevenue(
  visit: VisitForPayroll,
  techSold: Record<number, number>,
  techUpsell: Record<number, number>
): void {
  const techs = visit.technicians ?? []
  const visitTeamLeadId: number | null =
    (visit.jobs?.crew_salesman_id ?? null) ||
    (visit.jobs?.cleaner_id ?? null) ||
    techs[0] ||
    null

  for (const item of visit.visit_line_items ?? []) {
    if (item.revenue_type === 'original_quote') {
      const count = techs.length || 1
      for (const techId of techs) {
        techSold[techId] = (techSold[techId] || 0) + Number(item.price) / count
      }
    }
    if (item.revenue_type === 'technician_upsell') {
      const attributedTo = item.added_by_cleaner_id ?? visitTeamLeadId
      if (attributedTo) {
        techUpsell[attributedTo] =
          (techUpsell[attributedTo] || 0) + Number(item.price)
      }
    }
  }
}

/**
 * Generate a payroll week snapshot.
 * Fetches all completed visits in the date range, current pay rates,
 * and freezes them into payroll_entries.
 */
export async function generatePayrollWeek(
  client: SupabaseClient,
  tenantId: string,
  weekStart: string,
  weekEnd: string
): Promise<{ success: boolean; week_id?: number; entries: number; error?: string }> {
  // Check for existing payroll week (prevent duplicates)
  const { data: existing } = await client
    .from('payroll_weeks')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('week_start', weekStart)
    .single()

  if (existing) {
    return { success: false, entries: 0, error: 'Payroll week already exists' }
  }

  // Create payroll week
  const { data: week, error: weekError } = await client
    .from('payroll_weeks')
    .insert({
      tenant_id: tenantId,
      week_start: weekStart,
      week_end: weekEnd,
      status: 'draft',
    })
    .select('id')
    .single()

  if (weekError || !week) {
    return { success: false, entries: 0, error: `Failed to create payroll week: ${weekError?.message}` }
  }

  // Fetch all current pay rates for this tenant
  const { data: payRates } = await client
    .from('pay_rates')
    .select('*')
    .eq('tenant_id', tenantId)

  if (!payRates || payRates.length === 0) {
    return { success: true, week_id: week.id, entries: 0 }
  }

  // Fetch completed visits in the date range. We also pull:
  //  - job.crew_salesman_id + job.cleaner_id for team-lead upsell fallback
  //  - job.salesman_id + job.credited_salesman_id for salesman commission
  //    (Wave 3e — was declared but never filled)
  //  - service_plans.recurrence for plan-type bucket classification
  const { data: visits } = await client
    .from('visits')
    .select(`
      id, technicians, started_at, stopped_at,
      jobs(
        id, crew_salesman_id, cleaner_id, salesman_id, credited_salesman_id,
        service_plan_jobs(service_plans(recurrence))
      ),
      visit_line_items(price, revenue_type, added_by_cleaner_id)
    `)
    .eq('tenant_id', tenantId)
    .gte('visit_date', weekStart)
    .lte('visit_date', weekEnd)
    .in('status', ['closed', 'payment_collected', 'checklist_done', 'completed'])

  // Build per-person revenue (sold vs upsell) and hours
  const techSold: Record<number, number> = {}
  const techUpsell: Record<number, number> = {}
  const techHours: Record<number, number> = {}
  const salesmanRevenue: Record<number, { onetime: number; triannual: number; quarterly: number }> = {}

  for (const visit of visits || []) {
    // Calculate hours worked from timer
    if (visit.started_at && visit.stopped_at) {
      const hours = (new Date(visit.stopped_at).getTime() - new Date(visit.started_at).getTime()) / 3600000
      for (const techId of (visit.technicians as number[]) || []) {
        techSold[techId] = techSold[techId] || 0
        techUpsell[techId] = techUpsell[techId] || 0
        techHours[techId] = (techHours[techId] || 0) + hours
      }
    }

    accumulateVisitRevenue(visit as VisitForPayroll, techSold, techUpsell)
    accumulateSalesmanRevenue(
      visit as unknown as VisitForSalesmanPayroll,
      salesmanRevenue
    )
  }

  // Create payroll entries with FROZEN rates
  const entries: Array<Record<string, unknown>> = []

  for (const rate of payRates) {
    if (rate.role === 'technician' || rate.role === 'team_lead') {
      const sold = techSold[rate.cleaner_id] || 0
      const upsell = techUpsell[rate.cleaner_id] || 0
      const revenue = sold + upsell
      const hours = techHours[rate.cleaner_id] || 0
      const otHours = Math.max(0, hours - 40) // 40hr work week
      const totalPay = calculateTechPay(
        revenue,
        rate.pay_mode,
        rate.pay_percentage,
        hours,
        otHours,
        rate.hourly_rate
      )

      entries.push({
        payroll_week_id: week.id,
        tenant_id: tenantId,
        cleaner_id: rate.cleaner_id,
        role: rate.role,
        revenue_completed: revenue,
        revenue_sold: sold,
        revenue_upsell: upsell,
        pay_mode: rate.pay_mode ?? 'hourly',
        pay_percentage: rate.pay_percentage,
        hours_worked: hours,
        overtime_hours: otHours,
        overtime_rate: 1.5,
        hourly_rate: rate.hourly_rate,
        review_count: 0,
        total_pay: totalPay,
      })
    } else if (rate.role === 'salesman') {
      const rev = salesmanRevenue[rate.cleaner_id] || { onetime: 0, triannual: 0, quarterly: 0 }
      const totalPay = calculateSalesmanPay(
        rev.onetime,
        rev.triannual,
        rev.quarterly,
        rate.commission_1time_pct || 0,
        rate.commission_triannual_pct || 0,
        rate.commission_quarterly_pct || 0
      )

      entries.push({
        payroll_week_id: week.id,
        tenant_id: tenantId,
        cleaner_id: rate.cleaner_id,
        role: 'salesman',
        revenue_1time: rev.onetime,
        revenue_triannual: rev.triannual,
        revenue_quarterly: rev.quarterly,
        commission_1time_pct: rate.commission_1time_pct,
        commission_triannual_pct: rate.commission_triannual_pct,
        commission_quarterly_pct: rate.commission_quarterly_pct,
        total_pay: totalPay,
      })
    }
  }

  if (entries.length > 0) {
    const { error: entryError } = await client
      .from('payroll_entries')
      .insert(entries)

    if (entryError) {
      return { success: false, week_id: week.id, entries: 0, error: `Failed to create entries: ${entryError.message}` }
    }
  }

  return { success: true, week_id: week.id, entries: entries.length }
}
