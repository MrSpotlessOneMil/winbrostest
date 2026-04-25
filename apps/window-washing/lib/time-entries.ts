/**
 * Worker clock-in/out helpers.
 *
 * Single open shift per cleaner (DB partial unique index enforces this).
 * State derived from the open entry:
 *   - no open entry           → 'off_clock'
 *   - open + pause_started_at → 'paused'
 *   - open + no pause stamp   → 'on_clock'
 *
 * Drive time between jobs is paid because the clock keeps running unless
 * the worker explicitly hits Pause. That's exactly what Blake asked for.
 */

export interface TimeEntryRow {
  id: number
  cleaner_id: number
  tenant_id: string
  clock_in_at: string
  clock_out_at: string | null
  pause_started_at: string | null
  paused_minutes: number
  notes: string | null
}

export type ClockState = 'off_clock' | 'on_clock' | 'paused'

export interface ClockSnapshot {
  state: ClockState
  open_entry_id: number | null
  clock_in_at: string | null
  pause_started_at: string | null
  paused_minutes: number
  /** Worked-minutes accrued so far on the open shift, EXCLUDING the
   *  in-progress pause. Live timer for the UI. */
  live_worked_minutes: number
}

/**
 * Snapshot the cleaner's clock right now from their currently-open entry
 * (or null if they're off the clock).
 */
export function snapshotClock(open: TimeEntryRow | null, now: Date = new Date()): ClockSnapshot {
  if (!open || open.clock_out_at) {
    return {
      state: 'off_clock',
      open_entry_id: null,
      clock_in_at: null,
      pause_started_at: null,
      paused_minutes: 0,
      live_worked_minutes: 0,
    }
  }

  const start = new Date(open.clock_in_at).getTime()
  const elapsedMin = Math.max(0, (now.getTime() - start) / 60000)
  // paused_minutes is the *frozen* paused total. If a pause is in progress,
  // do NOT add the in-progress pause minutes to the worked counter.
  const inProgressPauseMin = open.pause_started_at
    ? Math.max(0, (now.getTime() - new Date(open.pause_started_at).getTime()) / 60000)
    : 0
  const worked = Math.max(0, elapsedMin - open.paused_minutes - inProgressPauseMin)

  return {
    state: open.pause_started_at ? 'paused' : 'on_clock',
    open_entry_id: open.id,
    clock_in_at: open.clock_in_at,
    pause_started_at: open.pause_started_at,
    paused_minutes: open.paused_minutes,
    live_worked_minutes: Math.round(worked),
  }
}

/**
 * Paid minutes for a CLOSED entry. Floors negative values to 0 in case
 * paused_minutes was over-recorded by clock skew.
 */
export function paidMinutesForEntry(entry: TimeEntryRow): number {
  if (!entry.clock_out_at) return 0
  const span =
    (new Date(entry.clock_out_at).getTime() - new Date(entry.clock_in_at).getTime()) / 60000
  return Math.max(0, span - (entry.paused_minutes ?? 0))
}

/**
 * Sum paid hours for entries that overlap the given inclusive date range
 * (YYYY-MM-DD). Open entries are excluded — they get counted on close.
 */
export function paidHoursInRange(
  entries: TimeEntryRow[],
  weekStart: string,
  weekEnd: string
): number {
  const startMs = new Date(`${weekStart}T00:00:00Z`).getTime()
  // Inclusive end-of-day for weekEnd.
  const endMs = new Date(`${weekEnd}T23:59:59Z`).getTime()
  let totalMin = 0
  for (const e of entries) {
    if (!e.clock_out_at) continue
    const inMs = new Date(e.clock_in_at).getTime()
    const outMs = new Date(e.clock_out_at).getTime()
    if (outMs < startMs || inMs > endMs) continue
    // Pro-rate when the entry straddles the range boundary. For the v1
    // payroll scope the worker normally clocks in/out within the week,
    // but clamping protects the math against bad data.
    const clampedIn = Math.max(inMs, startMs)
    const clampedOut = Math.min(outMs, endMs)
    if (clampedOut <= clampedIn) continue
    const span = (clampedOut - clampedIn) / 60000
    // Pause minutes apply to the whole entry, not pro-rated. Conservative
    // (workers benefit) when an entry straddles a boundary, which is rare.
    const paid = Math.max(0, span - (e.paused_minutes ?? 0))
    totalMin += paid
  }
  return Math.round((totalMin / 60) * 100) / 100
}

/**
 * Pure transition validator. The route handler still does the SQL writes,
 * but exporting this lets unit tests pin every legal/illegal action
 * combination without a Supabase mock.
 */
export type ClockAction = 'in' | 'pause' | 'resume' | 'out'

export function validateAction(state: ClockState, action: ClockAction): {
  ok: boolean
  reason?: string
  next?: ClockState
} {
  if (action === 'in') {
    if (state !== 'off_clock') return { ok: false, reason: 'Already on the clock' }
    return { ok: true, next: 'on_clock' }
  }
  if (action === 'out') {
    if (state === 'off_clock') return { ok: false, reason: 'Not on the clock' }
    return { ok: true, next: 'off_clock' }
  }
  if (action === 'pause') {
    if (state !== 'on_clock') return { ok: false, reason: 'Already paused or off the clock' }
    return { ok: true, next: 'paused' }
  }
  // resume
  if (state !== 'paused') return { ok: false, reason: 'Nothing to resume' }
  return { ok: true, next: 'on_clock' }
}
