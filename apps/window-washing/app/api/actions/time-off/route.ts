/**
 * GET /api/actions/time-off?month=2026-04&cleaner_id=12&status=pending
 *   Returns time-off entries scoped to the tenant.
 *   - cleaner_id filter: worker view (their own entries)
 *   - status filter: 'pending' | 'approved' | 'denied' | 'all' (default 'all')
 *
 * POST /api/actions/time-off
 *   Add time-off requests. Body: { cleaner_id, dates, reason? }
 *   New rows insert with status='pending'. The 14-day-advance rule is
 *   enforced client-side (lib/time-off-validation.ts) and the calendar
 *   already disables those cells.
 *
 * DELETE /api/actions/time-off
 *   Remove time-off entries. Body: { cleaner_id, dates }
 *   Workers can withdraw any of their own requests; admins can remove any.
 *
 * PATCH (decision) lives in /api/actions/time-off/decision (admin-only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

type TimeOffStatus = 'pending' | 'approved' | 'denied'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const cleanerId = url.searchParams.get('cleaner_id')
  const statusParam = url.searchParams.get('status')

  const client = getSupabaseServiceClient()

  let query = client
    .from('time_off')
    .select('id, cleaner_id, date, reason, status, decided_at, decided_by_user_id, denial_reason, created_at')
    .eq('tenant_id', tenant.id)
    .order('date')

  if (month) {
    const startDate = `${month}-01`
    const endDate = `${month}-31`
    query = query.gte('date', startDate).lte('date', endDate)
  }

  if (cleanerId) {
    query = query.eq('cleaner_id', Number(cleanerId))
  }

  if (statusParam && statusParam !== 'all') {
    if (statusParam !== 'pending' && statusParam !== 'approved' && statusParam !== 'denied') {
      return NextResponse.json({ error: 'invalid status filter' }, { status: 400 })
    }
    query = query.eq('status', statusParam)
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

  // New rows always start pending; rows being re-upserted (e.g. a denied one
  // the worker re-requests) reset back to pending.
  const rows = body.dates.map(date => ({
    tenant_id: tenant.id,
    cleaner_id: body.cleaner_id,
    date,
    reason: body.reason || null,
    status: 'pending' as TimeOffStatus,
    decided_at: null,
    decided_by_user_id: null,
    denial_reason: null,
  }))

  const { data, error } = await client
    .from('time_off')
    .upsert(rows, { onConflict: 'tenant_id,cleaner_id,date' })
    .select('id, date, status')

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
