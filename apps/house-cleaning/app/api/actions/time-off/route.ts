/**
 * GET /api/actions/time-off?month=2026-04
 * Returns time-off entries for the current worker or all workers (admin).
 *
 * POST /api/actions/time-off
 * Add time-off days. Body: { cleaner_id, dates: ["2026-04-01", "2026-04-02"], reason? }
 *
 * DELETE /api/actions/time-off
 * Remove time-off days. Body: { cleaner_id, dates: ["2026-04-01"] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const url = new URL(request.url)
  const month = url.searchParams.get('month') // e.g. "2026-04"
  const cleanerId = url.searchParams.get('cleaner_id')

  const client = getSupabaseServiceClient()

  let query = client
    .from('time_off')
    .select('id, cleaner_id, date, reason')
    .eq('tenant_id', tenant.id)
    .order('date')

  if (month) {
    const startDate = `${month}-01`
    const endDate = `${month}-31` // Supabase handles overflow gracefully
    query = query.gte('date', startDate).lte('date', endDate)
  }

  if (cleanerId) {
    query = query.eq('cleaner_id', Number(cleanerId))
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ timeOff: data || [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { cleaner_id: number; dates: string[]; reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.cleaner_id || !body.dates || body.dates.length === 0) {
    return NextResponse.json({ error: 'cleaner_id and dates required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const rows = body.dates.map(date => ({
    tenant_id: tenant.id,
    cleaner_id: body.cleaner_id,
    date,
    reason: body.reason || null,
  }))

  const { data, error } = await client
    .from('time_off')
    .upsert(rows, { onConflict: 'tenant_id,cleaner_id,date' })
    .select('id, date')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, added: data })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { cleaner_id: number; dates: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.cleaner_id || !body.dates || body.dates.length === 0) {
    return NextResponse.json({ error: 'cleaner_id and dates required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { error } = await client
    .from('time_off')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('cleaner_id', body.cleaner_id)
    .in('date', body.dates)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, removed: body.dates })
}
