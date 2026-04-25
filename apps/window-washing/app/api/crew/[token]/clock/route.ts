/**
 * Crew clock-in/out — Wave 3h.
 *
 * GET  /api/crew/[token]/clock
 *   → { state, snapshot, today: TimeEntryRow[], week_hours }
 * POST /api/crew/[token]/clock { action: 'in'|'pause'|'resume'|'out' }
 *   → { ok, snapshot } or 400 on illegal transition.
 *
 * Token-gated like the rest of the crew portal — no admin auth.
 * The DB partial unique index (time_entries_one_open_per_cleaner)
 * is the second line of defense against double clock-in races.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import {
  paidHoursInRange,
  snapshotClock,
  validateAction,
  type ClockAction,
  type TimeEntryRow,
} from '@/lib/time-entries'

interface CleanerCtx {
  id: number
  tenant_id: string
  employee_type: string | null
  is_team_lead: boolean | null
}

async function resolveCleaner(token: string): Promise<CleanerCtx | null> {
  const client = getSupabaseServiceClient()
  const { data } = await client
    .from('cleaners')
    .select('id, tenant_id, employee_type, is_team_lead')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()
  return data as CleanerCtx | null
}

function isClockableRole(c: CleanerCtx): boolean {
  // Blake: technicians + team leads. Salesmen are commission-only and
  // have no business clocking in.
  return c.employee_type === 'technician' || !!c.is_team_lead
}

function todayBounds(): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return { start: `${y}-${m}-${d}`, end: `${y}-${m}-${d}` }
}

function weekBoundsMonStartFor(now: Date = new Date()): { start: string; end: string } {
  const dow = now.getDay()
  const diff = dow === 0 ? -6 : 1 - dow
  const monday = new Date(now)
  monday.setDate(monday.getDate() + diff)
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const fmt = (d: Date) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return { start: fmt(monday), end: fmt(sunday) }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const cleaner = await resolveCleaner(token)
  if (!cleaner) return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  if (!isClockableRole(cleaner)) {
    return NextResponse.json({ error: 'Clock-in is for technicians and team leads' }, { status: 403 })
  }

  const client = getSupabaseServiceClient()

  // Open entry (at most one per the partial unique index).
  const { data: openRow } = await client
    .from('time_entries')
    .select('*')
    .eq('cleaner_id', cleaner.id)
    .is('clock_out_at', null)
    .maybeSingle()
  const open = openRow as TimeEntryRow | null

  // Today's entries (closed + open, for the self-log on the portal).
  const { start: todayStart, end: todayEnd } = todayBounds()
  const { data: todayRows } = await client
    .from('time_entries')
    .select('*')
    .eq('cleaner_id', cleaner.id)
    .gte('clock_in_at', `${todayStart}T00:00:00Z`)
    .lte('clock_in_at', `${todayEnd}T23:59:59Z`)
    .order('clock_in_at', { ascending: false })

  // Week tally for the "X hrs this week" chip.
  const week = weekBoundsMonStartFor()
  const { data: weekRows } = await client
    .from('time_entries')
    .select('clock_in_at, clock_out_at, paused_minutes')
    .eq('cleaner_id', cleaner.id)
    .gte('clock_in_at', `${week.start}T00:00:00Z`)
    .lte('clock_in_at', `${week.end}T23:59:59Z`)

  const weekHours = paidHoursInRange(
    (weekRows as TimeEntryRow[]) ?? [],
    week.start,
    week.end
  )

  return NextResponse.json({
    snapshot: snapshotClock(open),
    today: todayRows ?? [],
    week_hours: weekHours,
    week_range: week,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const cleaner = await resolveCleaner(token)
  if (!cleaner) return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  if (!isClockableRole(cleaner)) {
    return NextResponse.json({ error: 'Clock-in is for technicians and team leads' }, { status: 403 })
  }

  let body: { action?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'in' && action !== 'pause' && action !== 'resume' && action !== 'out') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null

  const client = getSupabaseServiceClient()
  const now = new Date()

  const { data: openRow } = await client
    .from('time_entries')
    .select('*')
    .eq('cleaner_id', cleaner.id)
    .is('clock_out_at', null)
    .maybeSingle()
  const open = openRow as TimeEntryRow | null
  const snap = snapshotClock(open, now)
  const guard = validateAction(snap.state, action as ClockAction)
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.reason ?? 'Illegal clock action', state: snap.state },
      { status: 400 }
    )
  }

  if (action === 'in') {
    const { data: inserted, error: insErr } = await client
      .from('time_entries')
      .insert({
        tenant_id: cleaner.tenant_id,
        cleaner_id: cleaner.id,
        clock_in_at: now.toISOString(),
        paused_minutes: 0,
        source: 'crew_portal',
        notes,
      })
      .select('*')
      .single()
    if (insErr || !inserted) {
      // Race against the partial unique index — shouldn't happen post-guard,
      // but surface a clean error if it does.
      return NextResponse.json(
        { error: insErr?.message ?? 'Could not start shift' },
        { status: 409 }
      )
    }
    return NextResponse.json({ ok: true, snapshot: snapshotClock(inserted as TimeEntryRow, now) })
  }

  if (!open) {
    // Defense-in-depth — guard already returned for off_clock + non-'in'.
    return NextResponse.json({ error: 'No open shift' }, { status: 400 })
  }

  if (action === 'pause') {
    const { data: updated, error } = await client
      .from('time_entries')
      .update({ pause_started_at: now.toISOString() })
      .eq('id', open.id)
      .is('clock_out_at', null)
      .is('pause_started_at', null)
      .select('*')
      .single()
    if (error || !updated) {
      return NextResponse.json({ error: error?.message ?? 'Pause failed' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, snapshot: snapshotClock(updated as TimeEntryRow, now) })
  }

  if (action === 'resume') {
    if (!open.pause_started_at) {
      return NextResponse.json({ error: 'Not paused' }, { status: 400 })
    }
    const pausedMs = now.getTime() - new Date(open.pause_started_at).getTime()
    const addMin = Math.max(0, Math.round(pausedMs / 60000))
    const { data: updated, error } = await client
      .from('time_entries')
      .update({
        pause_started_at: null,
        paused_minutes: open.paused_minutes + addMin,
      })
      .eq('id', open.id)
      .is('clock_out_at', null)
      .select('*')
      .single()
    if (error || !updated) {
      return NextResponse.json({ error: error?.message ?? 'Resume failed' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, snapshot: snapshotClock(updated as TimeEntryRow, now) })
  }

  // action === 'out': also flush an in-progress pause first.
  let pausedTotal = open.paused_minutes
  if (open.pause_started_at) {
    const pausedMs = now.getTime() - new Date(open.pause_started_at).getTime()
    pausedTotal += Math.max(0, Math.round(pausedMs / 60000))
  }
  const { data: closed, error: closeErr } = await client
    .from('time_entries')
    .update({
      clock_out_at: now.toISOString(),
      pause_started_at: null,
      paused_minutes: pausedTotal,
    })
    .eq('id', open.id)
    .is('clock_out_at', null)
    .select('*')
    .single()
  if (closeErr || !closed) {
    return NextResponse.json({ error: closeErr?.message ?? 'Clock out failed' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, snapshot: snapshotClock(null, now), entry: closed })
}
