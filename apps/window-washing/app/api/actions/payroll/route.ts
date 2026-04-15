/**
 * Payroll API
 * GET /api/actions/payroll?weekStart=2026-04-07&weekEnd=2026-04-13
 *
 * Returns payroll data for a given week — technicians + salesmen + status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

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
      .select('cleaner_id, role, hourly_rate, pay_percentage, commission_1time_pct, commission_triannual_pct, commission_quarterly_pct, cleaners!inner(name)')
      .eq('tenant_id', tenantId)

    const technicians = (rates || [])
      .filter(r => r.role === 'technician' || r.role === 'team_lead')
      .map(r => ({
        cleaner_id: r.cleaner_id,
        name: (r as any).cleaners?.name || 'Unknown',
        role: r.role,
        revenue_completed: 0,
        revenue_sold: 0,
        revenue_upsell: 0,
        pay_percentage: Number(r.pay_percentage || 0),
        hours_worked: 0,
        overtime_hours: 0,
        hourly_rate: Number(r.hourly_rate || 0),
        review_count: 0,
        total_pay: 0,
      }))

    const salesmen = (rates || [])
      .filter(r => r.role === 'salesman')
      .map(r => ({
        cleaner_id: r.cleaner_id,
        name: (r as any).cleaners?.name || 'Unknown',
        revenue_1time: 0,
        revenue_triannual: 0,
        revenue_quarterly: 0,
        commission_1time_pct: Number(r.commission_1time_pct || 0),
        commission_triannual_pct: Number(r.commission_triannual_pct || 0),
        commission_quarterly_pct: Number(r.commission_quarterly_pct || 0),
        total_pay: 0,
      }))

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
      pay_percentage: Number(e.pay_percentage || 0),
      hours_worked: Number(e.hours_worked || 0),
      overtime_hours: Number(e.overtime_hours || 0),
      hourly_rate: Number(e.hourly_rate || 0),
      review_count: Number(e.review_count || 0),
      total_pay: Number(e.total_pay || 0),
    }))

  const salesmen = (entries || [])
    .filter(e => e.role === 'salesman')
    .map(e => ({
      cleaner_id: e.cleaner_id,
      name: (e as any).cleaners?.name || 'Unknown',
      revenue_1time: Number(e.revenue_1time || 0),
      revenue_triannual: Number(e.revenue_triannual || 0),
      revenue_quarterly: Number(e.revenue_quarterly || 0),
      commission_1time_pct: Number(e.commission_1time_pct || 0),
      commission_triannual_pct: Number(e.commission_triannual_pct || 0),
      commission_quarterly_pct: Number(e.commission_quarterly_pct || 0),
      total_pay: Number(e.total_pay || 0),
    }))

  return NextResponse.json({
    technicians,
    salesmen,
    status: week.status,
  })
}
