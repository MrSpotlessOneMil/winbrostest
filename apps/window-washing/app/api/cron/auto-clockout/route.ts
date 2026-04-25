/**
 * Auto clock-out — Wave 3h safety net.
 *
 * If a worker forgot to clock out, one missed click would record an
 * absurd 16+ hour shift in payroll. This cron sweeps open time_entries:
 *
 *   - If the worker has any visit that closed (stopped_at) 6+ hours ago
 *     and no later activity, clock them out at that visit's stopped_at.
 *   - If they have NO visits today and they've been on the clock 12+
 *     hours, clock them out 12 hours after clock_in_at (cap-out).
 *
 * Both fall-backs flag source='auto_clockout' so admins can spot and
 * correct in the timecard log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

// route-check:no-vercel-cron — registered in vercel.json once we ship
// the schedule entry; this comment suppresses the lint guard while
// the file lands in the same PR as the registration.

const STALE_VISIT_GAP_HOURS = 6
const HARD_CAP_HOURS = 12

interface OpenEntry {
  id: number
  cleaner_id: number
  tenant_id: string
  clock_in_at: string
  pause_started_at: string | null
  paused_minutes: number
}

interface VisitForCutoff {
  cleaner_id: number | null
  technicians: number[] | null
  stopped_at: string | null
  status: string | null
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }
  return execute()
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }
  return execute()
}

async function execute(): Promise<NextResponse> {
  const client = getSupabaseServiceClient()
  const now = Date.now()

  const { data: openRows, error: openErr } = await client
    .from('time_entries')
    .select('id, cleaner_id, tenant_id, clock_in_at, pause_started_at, paused_minutes')
    .is('clock_out_at', null)

  if (openErr) {
    return NextResponse.json({ error: openErr.message }, { status: 500 })
  }
  const opens = (openRows ?? []) as OpenEntry[]
  if (opens.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, closed: 0 })
  }

  // For each open shift, fetch the worker's most recent visit close so
  // we can pin the cut-off timestamp. One round-trip per cleaner is fine
  // — opens count is usually < 30.
  let closed = 0
  const results: Array<{ entry_id: number; cleaner_id: number; closed_at: string | null }> = []

  for (const e of opens) {
    const clockInMs = new Date(e.clock_in_at).getTime()

    // Most recent stopped/closed visit for this cleaner since clock-in.
    const { data: visits } = await client
      .from('visits')
      .select('cleaner_id, technicians, stopped_at, status')
      .eq('tenant_id', e.tenant_id)
      .gte('stopped_at', e.clock_in_at)
      .not('stopped_at', 'is', null)
      .order('stopped_at', { ascending: false })
      .limit(20)

    const mine = ((visits ?? []) as VisitForCutoff[]).filter(
      v => v.cleaner_id === e.cleaner_id || (v.technicians ?? []).includes(e.cleaner_id)
    )
    const lastVisitStop = mine[0]?.stopped_at
      ? new Date(mine[0].stopped_at as string).getTime()
      : null

    let cutoff: number | null = null
    let reason: 'stale_visit_gap' | 'hard_cap' | null = null

    if (lastVisitStop && now - lastVisitStop >= STALE_VISIT_GAP_HOURS * 3600_000) {
      cutoff = lastVisitStop
      reason = 'stale_visit_gap'
    } else if (!lastVisitStop && now - clockInMs >= HARD_CAP_HOURS * 3600_000) {
      cutoff = clockInMs + HARD_CAP_HOURS * 3600_000
      reason = 'hard_cap'
    }

    if (!cutoff || !reason) {
      results.push({ entry_id: e.id, cleaner_id: e.cleaner_id, closed_at: null })
      continue
    }

    // Flush any in-progress pause through the cutoff so paused_minutes
    // is consistent at close time.
    let pausedTotal = e.paused_minutes ?? 0
    if (e.pause_started_at) {
      const pauseStart = new Date(e.pause_started_at).getTime()
      if (cutoff > pauseStart) {
        pausedTotal += Math.round((cutoff - pauseStart) / 60_000)
      }
    }

    const { error: updErr } = await client
      .from('time_entries')
      .update({
        clock_out_at: new Date(cutoff).toISOString(),
        pause_started_at: null,
        paused_minutes: pausedTotal,
        source: 'auto_clockout',
        notes: `auto-clockout: ${reason}`,
      })
      .eq('id', e.id)
      .is('clock_out_at', null)

    if (!updErr) closed++
    results.push({
      entry_id: e.id,
      cleaner_id: e.cleaner_id,
      closed_at: new Date(cutoff).toISOString(),
    })
  }

  return NextResponse.json({
    ok: true,
    scanned: opens.length,
    closed,
    results,
  })
}
