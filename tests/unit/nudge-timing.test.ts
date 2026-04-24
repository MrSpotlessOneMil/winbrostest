import { describe, it, expect } from 'vitest'
import { computeNudgeSendTime } from '../../packages/core/src/nudge-timing'

const TZ = 'America/Los_Angeles'

function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(d)
  const n = Number(h)
  return n === 24 ? 0 : n
}

function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

describe('computeNudgeSendTime', () => {
  it('returns now + 2h when now + 2h is in business hours', () => {
    // 2 PM PT → +2h = 4 PM PT, both in 9–21 window
    const now = new Date('2026-04-23T21:00:00Z') // 2 PM PT
    const result = computeNudgeSendTime({ now, timezone: TZ })
    expect(localHour(result, TZ)).toBe(16)
    expect(result.getTime()).toBe(now.getTime() + 120 * 60_000)
  })

  it('pushes overnight lead to 9 AM local the next day', () => {
    // 11 PM PT → +2h = 1 AM PT next day → bump to 9 AM same local day
    const now = new Date('2026-04-23T06:00:00Z') // 11 PM PT Apr 22
    const result = computeNudgeSendTime({ now, timezone: TZ })
    expect(localHour(result, TZ)).toBe(9)
    // Candidate (now + 2h) in LA is 2026-04-23 01:00 → same local day, bump to 9 AM → 2026-04-23
    expect(localDay(result, TZ)).toBe('04/23/2026')
  })

  it('bumps a candidate that lands at 8 AM local to 9 AM local (same day)', () => {
    // now = 6 AM PT → +2h = 8 AM PT (pre-9 AM quiet); bump to 9 AM same day
    const now = new Date('2026-04-23T13:00:00Z') // 6 AM PT
    const result = computeNudgeSendTime({ now, timezone: TZ })
    expect(localHour(result, TZ)).toBe(9)
    expect(localDay(result, TZ)).toBe('04/23/2026')
  })

  it('bumps a candidate that lands at 9 PM local to 9 AM next day', () => {
    // now = 7 PM PT → +2h = 9 PM PT (at quiet-start); bump to 9 AM next day
    const now = new Date('2026-04-24T02:00:00Z') // 7 PM PT Apr 23
    const result = computeNudgeSendTime({ now, timezone: TZ })
    expect(localHour(result, TZ)).toBe(9)
    expect(localDay(result, TZ)).toBe('04/24/2026')
  })

  it('respects a custom minMinutes override', () => {
    const now = new Date('2026-04-23T21:00:00Z') // 2 PM PT
    const result = computeNudgeSendTime({ now, timezone: TZ, minMinutes: 30 })
    expect(result.getTime()).toBe(now.getTime() + 30 * 60_000)
  })

  it('produces the same in-business-hours output regardless of timezone input', () => {
    const nowPT = new Date('2026-04-23T21:00:00Z') // 2 PM PT / 4 PM CT / 5 PM ET
    const ptResult = computeNudgeSendTime({ now: nowPT, timezone: 'America/Los_Angeles' })
    const ctResult = computeNudgeSendTime({ now: nowPT, timezone: 'America/Chicago' })
    const etResult = computeNudgeSendTime({ now: nowPT, timezone: 'America/New_York' })
    // All three land 2h later in their respective business hours (16 PT / 18 CT / 19 ET)
    expect(localHour(ptResult, 'America/Los_Angeles')).toBe(16)
    expect(localHour(ctResult, 'America/Chicago')).toBe(18)
    expect(localHour(etResult, 'America/New_York')).toBe(19)
  })

  it('is always strictly later than now', () => {
    const cases = [
      new Date('2026-04-23T05:00:00Z'),
      new Date('2026-04-23T15:00:00Z'),
      new Date('2026-04-23T23:00:00Z'),
      new Date('2026-04-24T03:00:00Z'),
    ]
    for (const now of cases) {
      const result = computeNudgeSendTime({ now, timezone: TZ })
      expect(result.getTime()).toBeGreaterThan(now.getTime())
    }
  })
})
