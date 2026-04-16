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
  const allowedFields = [
    'hourly_rate', 'pay_percentage',
    'commission_1time_pct', 'commission_triannual_pct', 'commission_quarterly_pct',
  ] as const

  for (const field of allowedFields) {
    if (field in body && typeof body[field] === 'number') {
      updates[field] = body[field]
    }
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
