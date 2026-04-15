/**
 * Payroll Engine for WinBros
 *
 * Weekly payroll calculation with frozen rate snapshots.
 *
 * Technicians/Team Leads:
 * - Revenue completed (from visit_line_items)
 * - Pay percentage of revenue
 * - Hourly rate * hours worked
 * - OT = 1.5x for overtime hours
 *
 * Salesmen:
 * - Commission per plan type (1-time, triannual, quarterly)
 * - Different % for each plan type
 * - Only credited for original_quote revenue
 *
 * CRITICAL: Changing current pay rates NEVER affects past payroll weeks.
 * Each week's rates are frozen at generation time.
 */

import { SupabaseClient } from '@supabase/supabase-js'

interface PayRate {
  cleaner_id: number
  role: string
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
 * If pay_percentage is set: total = revenue * percentage
 * If hourly: total = (hours * rate) + (OT_hours * rate * 1.5)
 * Can be both (percentage of revenue + hourly for non-revenue work)
 */
export function calculateTechPay(
  revenueCompleted: number,
  payPercentage: number | null,
  hoursWorked: number,
  overtimeHours: number,
  hourlyRate: number | null,
  overtimeRate: number = 1.5
): number {
  let total = 0

  // Revenue-based pay
  if (payPercentage && payPercentage > 0) {
    total += revenueCompleted * (payPercentage / 100)
  }

  // Hourly pay (regular hours only — OT hours tracked separately)
  if (hourlyRate && hourlyRate > 0) {
    const regularHours = Math.max(0, hoursWorked - overtimeHours)
    total += regularHours * hourlyRate
    total += overtimeHours * hourlyRate * overtimeRate
  }

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

  // Fetch completed visits in the date range
  const { data: visits } = await client
    .from('visits')
    .select(`
      id, technicians, started_at, stopped_at,
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

    // Aggregate revenue by type — sold vs upsell tracked separately
    for (const item of (visit as any).visit_line_items || []) {
      if (item.revenue_type === 'original_quote') {
        // Credit to assigned technicians (split evenly if multiple)
        const techCount = ((visit.technicians as number[]) || []).length || 1
        for (const techId of (visit.technicians as number[]) || []) {
          techSold[techId] = (techSold[techId] || 0) + Number(item.price) / techCount
        }
      }
      // Upsells credited to the tech who added them
      if (item.revenue_type === 'technician_upsell' && item.added_by_cleaner_id) {
        techUpsell[item.added_by_cleaner_id] = (techUpsell[item.added_by_cleaner_id] || 0) + Number(item.price)
      }
    }
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
