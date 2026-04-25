/**
 * Wave 3h — clock state machine + paid hours math.
 */

import { describe, it, expect } from 'vitest'
import {
  paidHoursInRange,
  paidMinutesForEntry,
  snapshotClock,
  validateAction,
  type TimeEntryRow,
} from '@/apps/window-washing/lib/time-entries'

const aDay = (iso: string) => new Date(iso).toISOString()

describe('snapshotClock', () => {
  const now = new Date('2026-04-24T17:30:00Z')

  it('off_clock when no open entry', () => {
    const snap = snapshotClock(null, now)
    expect(snap.state).toBe('off_clock')
    expect(snap.live_worked_minutes).toBe(0)
    expect(snap.open_entry_id).toBeNull()
  })

  it('off_clock when entry already has a clock_out_at', () => {
    const closed: TimeEntryRow = {
      id: 1,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T16:00:00Z'),
      clock_out_at: aDay('2026-04-24T17:00:00Z'),
      pause_started_at: null,
      paused_minutes: 0,
      notes: null,
    }
    expect(snapshotClock(closed, now).state).toBe('off_clock')
  })

  it('on_clock + 90 worked minutes after a 1.5h shift, no pauses', () => {
    const open: TimeEntryRow = {
      id: 2,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T16:00:00Z'),
      clock_out_at: null,
      pause_started_at: null,
      paused_minutes: 0,
      notes: null,
    }
    const snap = snapshotClock(open, now)
    expect(snap.state).toBe('on_clock')
    expect(snap.live_worked_minutes).toBe(90)
  })

  it('subtracts frozen paused_minutes', () => {
    const open: TimeEntryRow = {
      id: 3,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T16:00:00Z'),
      clock_out_at: null,
      pause_started_at: null,
      paused_minutes: 30, // already paused for half an hour earlier
      notes: null,
    }
    expect(snapshotClock(open, now).live_worked_minutes).toBe(60)
  })

  it('paused state freezes the live timer', () => {
    const open: TimeEntryRow = {
      id: 4,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T16:00:00Z'),
      clock_out_at: null,
      pause_started_at: aDay('2026-04-24T17:00:00Z'), // 30 min into pause
      paused_minutes: 0,
      notes: null,
    }
    const snap = snapshotClock(open, now)
    expect(snap.state).toBe('paused')
    // 90 elapsed - 30 in-progress pause = 60 worked
    expect(snap.live_worked_minutes).toBe(60)
  })
})

describe('paidMinutesForEntry', () => {
  it('returns 0 for an open entry', () => {
    expect(
      paidMinutesForEntry({
        id: 1,
        cleaner_id: 1,
        tenant_id: 't',
        clock_in_at: aDay('2026-04-24T16:00:00Z'),
        clock_out_at: null,
        pause_started_at: null,
        paused_minutes: 0,
        notes: null,
      })
    ).toBe(0)
  })

  it('subtracts paused_minutes from the span', () => {
    const e: TimeEntryRow = {
      id: 1,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T08:00:00Z'),
      clock_out_at: aDay('2026-04-24T17:00:00Z'),
      pause_started_at: null,
      paused_minutes: 30, // 30-min lunch
      notes: null,
    }
    // 9 hours - 30 min = 510 minutes paid
    expect(paidMinutesForEntry(e)).toBe(510)
  })

  it('floors negative values to 0', () => {
    const e: TimeEntryRow = {
      id: 1,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-24T16:00:00Z'),
      clock_out_at: aDay('2026-04-24T16:30:00Z'),
      pause_started_at: null,
      paused_minutes: 600, // bogus pause longer than the shift
      notes: null,
    }
    expect(paidMinutesForEntry(e)).toBe(0)
  })
})

describe('paidHoursInRange', () => {
  const week = { start: '2026-04-20', end: '2026-04-26' }
  const closed = (id: number, inIso: string, outIso: string, pausedMin = 0): TimeEntryRow => ({
    id,
    cleaner_id: 1,
    tenant_id: 't',
    clock_in_at: aDay(inIso),
    clock_out_at: aDay(outIso),
    pause_started_at: null,
    paused_minutes: pausedMin,
    notes: null,
  })

  it('sums full 8-hour shifts across a week', () => {
    const entries = [
      closed(1, '2026-04-21T13:00:00Z', '2026-04-21T21:00:00Z'),
      closed(2, '2026-04-22T13:00:00Z', '2026-04-22T21:00:00Z'),
      closed(3, '2026-04-23T13:00:00Z', '2026-04-23T21:00:00Z'),
    ]
    expect(paidHoursInRange(entries, week.start, week.end)).toBe(24)
  })

  it('subtracts a 30-min lunch', () => {
    const entries = [closed(1, '2026-04-21T13:00:00Z', '2026-04-21T21:00:00Z', 30)]
    expect(paidHoursInRange(entries, week.start, week.end)).toBe(7.5)
  })

  it('skips open entries', () => {
    const open: TimeEntryRow = {
      id: 1,
      cleaner_id: 1,
      tenant_id: 't',
      clock_in_at: aDay('2026-04-21T13:00:00Z'),
      clock_out_at: null,
      pause_started_at: null,
      paused_minutes: 0,
      notes: null,
    }
    expect(paidHoursInRange([open], week.start, week.end)).toBe(0)
  })

  it('excludes entries entirely outside the range', () => {
    const entries = [
      closed(1, '2026-04-13T13:00:00Z', '2026-04-13T21:00:00Z'),
      closed(2, '2026-04-21T13:00:00Z', '2026-04-21T17:00:00Z'),
    ]
    expect(paidHoursInRange(entries, week.start, week.end)).toBe(4)
  })
})

describe('validateAction', () => {
  it('clock in only from off_clock', () => {
    expect(validateAction('off_clock', 'in').ok).toBe(true)
    expect(validateAction('on_clock', 'in').ok).toBe(false)
    expect(validateAction('paused', 'in').ok).toBe(false)
  })
  it('pause only from on_clock', () => {
    expect(validateAction('on_clock', 'pause').ok).toBe(true)
    expect(validateAction('off_clock', 'pause').ok).toBe(false)
    expect(validateAction('paused', 'pause').ok).toBe(false)
  })
  it('resume only from paused', () => {
    expect(validateAction('paused', 'resume').ok).toBe(true)
    expect(validateAction('on_clock', 'resume').ok).toBe(false)
    expect(validateAction('off_clock', 'resume').ok).toBe(false)
  })
  it('clock out from on_clock or paused, never off_clock', () => {
    expect(validateAction('on_clock', 'out').ok).toBe(true)
    expect(validateAction('paused', 'out').ok).toBe(true)
    expect(validateAction('off_clock', 'out').ok).toBe(false)
  })
})
