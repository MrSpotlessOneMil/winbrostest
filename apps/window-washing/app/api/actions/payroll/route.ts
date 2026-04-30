/**
 * Payroll API
 * GET  /api/actions/payroll?weekStart=2026-04-07&weekEnd=2026-04-13
 *       Returns payroll data for a given week — technicians + salesmen + status.
 *
 * POST /api/actions/payroll
 *       Update pay rates for a cleaner.
 *       Body: { cleaner_id, hourly_rate?, pay_percentage?, commission_1time_pct?,
 *               commission_triannual_pct?, commission_quarterly_pct?, review_count?, weekStart? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const url = new URL(request.url)
  const weekStart = url.searchParams.get('weekStart')
  const weekEnd = url.searchParams.get('weekEnd')

  if (!weekStart || !weekEnd) {
    return NextResponse.json({ error: 'weekStart and weekEnd required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  // Check if payroll week exists
  const { data: week } = await client
    .from('payroll_weeks')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('week_start', weekStart)
    .single()

  if (!week) {
    // No payroll generated yet — return empty with pay rates for display
    const { data: rates } = await client
      .from('pay_rates')
      .select('cleaner_id, role, pay_mode, hourly_rate, pay_percentage, commission_1time_pct, commission_triannual_pct, commission_quarterly_pct, commission_appointment_pct, cleaners!inner(name)')
      .eq('tenant_id', tenantId)

    // Phase F — fetch pending + earned-but-unsettled appointment credits so
    // admin can see what's in flight even before the week is generated.
    const { data: liveCredits } = await client
      .from('salesman_appointment_credits')
      .select('salesman_id, status, amount_pending, amount_earned, appointment_price')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'earned'])
      .is('payroll_week_id', null)
    const apptStatsBySalesman = new Map<number, { pending: number; earned: number; pendingCount: number; revenueSet: number }>()
    for (const c of liveCredits || []) {
      const sid = c.salesman_id as number
      const cur = apptStatsBySalesman.get(sid) ?? { pending: 0, earned: 0, pendingCount: 0, revenueSet: 0 }
      if (c.status === 'pending') {
        cur.pending = Math.round((cur.pending + Number(c.amount_pending ?? 0)) * 100) / 100
        cur.pendingCount += 1
      } else if (c.status === 'earned') {
        cur.earned = Math.round((cur.earned + Number(c.amount_earned ?? 0)) * 100) / 100
        cur.revenueSet = Math.round((cur.revenueSet + Number(c.appointment_price ?? 0)) * 100) / 100
      }
      apptStatsBySalesman.set(sid, cur)
    }

    const technicians = (rates || [])
      .filter(r => r.role === 'technician' || r.role === 'team_lead')
      .map(r => ({
        cleaner_id: r.cleaner_id,
        name: (r as any).cleaners?.name || 'Unknown',
        role: r.role,
        revenue_completed: 0,
        revenue_sold: 0,
        revenue_upsell: 0,
        pay_mode: ((r as any).pay_mode || 'hourly') as 'hourly' | 'percentage',
        pay_percentage: Number(r.pay_percentage || 0),
        hours_worked: 0,
        overtime_hours: 0,
        hourly_rate: Number(r.hourly_rate || 0),
        review_count: 0,
        total_pay: 0,
      }))

    const salesmen = (rates || [])
      .filter(r => r.role === 'salesman')
      .map(r => {
        const stats = apptStatsBySalesman.get(r.cleaner_id) ?? { pending: 0, earned: 0, pendingCount: 0, revenueSet: 0 }
        return {
          cleaner_id: r.cleaner_id,
          name: (r as any).cleaners?.name || 'Unknown',
          revenue_1time: 0,
          revenue_triannual: 0,
          revenue_quarterly: 0,
          commission_1time_pct: Number(r.commission_1time_pct || 0),
          commission_triannual_pct: Number(r.commission_triannual_pct || 0),
          commission_quarterly_pct: Number(r.commission_quarterly_pct || 0),
          commission_appointment_pct: Number((r as { commission_appointment_pct?: number | null }).commission_appointment_pct ?? 12.5),
          // "Live" view: earned credits the next payroll-gen will sweep up.
          commission_appointment_amount: stats.earned,
          revenue_appointments_set: stats.revenueSet,
          appointment_pending_amount: stats.pending,
          appointment_pending_count: stats.pendingCount,
          total_pay: stats.earned,
        }
      })

    return NextResponse.json({ technicians, salesmen, status: 'draft' })
  }

  // Payroll week exists — return frozen entries
  const { data: entries } = await client
    .from('payroll_entries')
    .select('*, cleaners!inner(name)')
    .eq('payroll_week_id', week.id)

  const technicians = (entries || [])
    .filter(e => e.role === 'technician' || e.role === 'team_lead')
    .map(e => ({
      cleaner_id: e.cleaner_id,
      name: (e as any).cleaners?.name || 'Unknown',
      role: e.role,
      revenue_completed: Number(e.revenue_completed || 0),
      revenue_sold: Number(e.revenue_sold || 0),
      revenue_upsell: Number(e.revenue_upsell || 0),
      pay_mode: ((e as any).pay_mode || 'hourly') as 'hourly' | 'percentage',
      pay_percentage: Number(e.pay_percentage || 0),
      hours_worked: Number(e.hours_worked || 0),
      overtime_hours: Number(e.overtime_hours || 0),
      hourly_rate: Number(e.hourly_rate || 0),
      review_count: Number(e.review_count || 0),
      total_pay: Number(e.total_pay || 0),
    }))

  // Pending credits aren't tied to a finalized week — pull them as a live
  // overlay so admin can still see what's coming next week even when
  // viewing a frozen past week. They'd settle in the NEXT payroll-gen.
  const { data: livePending } = await client
    .from('salesman_appointment_credits')
    .select('salesman_id, amount_pending')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .is('payroll_week_id', null)
  const pendingBySalesman = new Map<number, { amount: number; count: number }>()
  for (const c of livePending || []) {
    const sid = c.salesman_id as number
    const cur = pendingBySalesman.get(sid) ?? { amount: 0, count: 0 }
    cur.amount = Math.round((cur.amount + Number(c.amount_pending ?? 0)) * 100) / 100
    cur.count += 1
    pendingBySalesman.set(sid, cur)
  }

  const salesmen = (entries || [])
    .filter(e => e.role === 'salesman')
    .map(e => {
      const pending = pendingBySalesman.get(e.cleaner_id) ?? { amount: 0, count: 0 }
      return {
        cleaner_id: e.cleaner_id,
        name: (e as any).cleaners?.name || 'Unknown',
        revenue_1time: Number(e.revenue_1time || 0),
        revenue_triannual: Number(e.revenue_triannual || 0),
        revenue_quarterly: Number(e.revenue_quarterly || 0),
        commission_1time_pct: Number(e.commission_1time_pct || 0),
        commission_triannual_pct: Number(e.commission_triannual_pct || 0),
        commission_quarterly_pct: Number(e.commission_quarterly_pct || 0),
        commission_appointment_pct: Number((e as { commission_appointment_pct?: number | null }).commission_appointment_pct ?? 12.5),
        commission_appointment_amount: Number((e as { commission_appointment_amount?: number | null }).commission_appointment_amount ?? 0),
        revenue_appointments_set: Number((e as { revenue_appointments_set?: number | null }).revenue_appointments_set ?? 0),
        appointment_pending_amount: pending.amount,
        appointment_pending_count: pending.count,
        // Phase N (2026-04-29) — door-knock revenue + frozen rate.
        revenue_doorknock: Number((e as { revenue_doorknock?: number | null }).revenue_doorknock ?? 0),
        commission_doorknock_pct: Number((e as { commission_doorknock_pct?: number | null }).commission_doorknock_pct ?? 20),
        commission_doorknock_amount: Number((e as { commission_doorknock_amount?: number | null }).commission_doorknock_amount ?? 0),
        total_pay: Number(e.total_pay || 0),
      }
    })

  return NextResponse.json({
    technicians,
    salesmen,
    status: week.status,
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const cleanerId = body.cleaner_id as number
  if (!cleanerId) {
    return NextResponse.json({ error: 'cleaner_id is required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  // Build updates for pay_rates table
  const updates: Record<string, unknown> = {}
  const numericFields = [
    'hourly_rate', 'pay_percentage',
    'commission_1time_pct', 'commission_triannual_pct', 'commission_quarterly_pct',
  ] as const

  for (const field of numericFields) {
    if (field in body && typeof body[field] === 'number') {
      updates[field] = body[field]
    }
  }

  // pay_mode is a string enum, not a number — validate separately
  if ('pay_mode' in body && (body.pay_mode === 'hourly' || body.pay_mode === 'percentage')) {
    updates.pay_mode = body.pay_mode
  }

  if (Object.keys(updates).length > 0) {
    // Upsert into pay_rates
    const { error } = await client
      .from('pay_rates')
      .update(updates)
      .eq('tenant_id', tenantId)
      .eq('cleaner_id', cleanerId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // Handle review_count updates for payroll entries
  if ('review_count' in body && typeof body.review_count === 'number' && body.weekStart) {
    const weekStart = body.weekStart as string
    const { data: week } = await client
      .from('payroll_weeks')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('week_start', weekStart)
      .single()

    if (week) {
      await client
        .from('payroll_entries')
        .update({ review_count: body.review_count })
        .eq('payroll_week_id', week.id)
        .eq('cleaner_id', cleanerId)
    }
  }

  return NextResponse.json({ success: true })
}
