/**
 * Unit tests for the shared cron guards added 2026-04-20.
 *
 * Guards prevent two incident classes:
 * 1. Late-night SMS blasts from crons that lacked a per-tenant timezone check
 *    (2026-03-28 incident: 58 follow-up texts at night, single-PT gate was the cause).
 * 2. WinBros customers receiving automated retargeting messages (Jack handles his own
 *    outreach; per feedback_winbros_no_retargeting.md).
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  RETARGETING_EXCLUDED_TENANTS,
  isRetargetingExcluded,
  isInPersonalHours,
} from '../../apps/house-cleaning/lib/cron-hours-guard'

describe('isRetargetingExcluded', () => {
  it('excludes winbros', () => {
    expect(isRetargetingExcluded('winbros')).toBe(true)
  })

  it('does NOT exclude any house-cleaning tenant', () => {
    expect(isRetargetingExcluded('spotless-scrubbers')).toBe(false)
    expect(isRetargetingExcluded('cedar-rapids')).toBe(false)
    expect(isRetargetingExcluded('west-niagara')).toBe(false)
  })

  it('RETARGETING_EXCLUDED_TENANTS contains exactly winbros', () => {
    // If this list grows, confirm intent — every addition silences outreach to that tenant.
    expect([...RETARGETING_EXCLUDED_TENANTS]).toEqual(['winbros'])
  })
})

describe('isInPersonalHours', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper: freeze clock at a specific UTC instant.
  function freezeAt(iso: string) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  describe('Los Angeles (PT, UTC-8 in winter)', () => {
    it('returns true at 12pm PT (20:00 UTC)', () => {
      freezeAt('2026-01-15T20:00:00Z') // noon PT
      expect(isInPersonalHours({ timezone: 'America/Los_Angeles' })).toBe(true)
    })

    it('returns false at 3am PT (11:00 UTC)', () => {
      freezeAt('2026-01-15T11:00:00Z') // 3am PT
      expect(isInPersonalHours({ timezone: 'America/Los_Angeles' })).toBe(false)
    })

    it('returns false at 10pm PT (06:00 UTC next day)', () => {
      freezeAt('2026-01-16T06:00:00Z') // 10pm PT on the 15th
      expect(isInPersonalHours({ timezone: 'America/Los_Angeles' })).toBe(false)
    })
  })

  describe('Chicago (CT, UTC-6 in winter)', () => {
    it('returns true at 12pm CT (18:00 UTC)', () => {
      freezeAt('2026-01-15T18:00:00Z')
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(true)
    })

    it('returns false at 11pm CT (05:00 UTC next day)', () => {
      // This was the Cedar-Rapids-gets-11pm-texts regression — cron ran at 20:00 PT
      // which is 22:00 CT, and the old code let it through with just a PT check.
      freezeAt('2026-01-16T05:00:00Z')
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(false)
    })
  })

  describe('Eastern (ET, UTC-5 in winter) — West Niagara', () => {
    it('returns true at 2pm ET (19:00 UTC)', () => {
      freezeAt('2026-01-15T19:00:00Z')
      expect(isInPersonalHours({ timezone: 'America/Toronto' })).toBe(true)
    })

    it('returns false at midnight ET (05:00 UTC next day)', () => {
      // West Niagara is UTC-5; 9pm PT = midnight ET.
      // Old follow-up-quoted cron used PT-only gate → WN customers got midnight texts.
      freezeAt('2026-01-16T05:00:00Z')
      expect(isInPersonalHours({ timezone: 'America/Toronto' })).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('falls back to America/Chicago when timezone is missing', () => {
      freezeAt('2026-01-15T18:00:00Z') // noon CT
      expect(isInPersonalHours({})).toBe(true)
      expect(isInPersonalHours({ timezone: null })).toBe(true)
      expect(isInPersonalHours(null)).toBe(true)
      expect(isInPersonalHours(undefined)).toBe(true)
    })

    it('boundary: 9:00 local is IN, 8:59 local is OUT', () => {
      // At 9:00 CT (15:00 UTC) — allowed
      freezeAt('2026-01-15T15:00:00Z')
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(true)
      // At 8:59 CT (14:59 UTC) — blocked. Intl.DateTimeFormat with hour-only rounds down,
      // so 14:59 UTC in CT returns hour=8 → false.
      freezeAt('2026-01-15T14:59:00Z')
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(false)
    })

    it('boundary: 20:59 local is IN, 21:00 local is OUT', () => {
      freezeAt('2026-01-16T02:59:00Z') // 20:59 CT
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(true)
      freezeAt('2026-01-16T03:00:00Z') // 21:00 CT
      expect(isInPersonalHours({ timezone: 'America/Chicago' })).toBe(false)
    })
  })
})

describe('combined guard behavior — the regression we are preventing', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('winbros is always blocked regardless of hour', () => {
    // The old bug: crons only gated on `monthly_followup_enabled`. If that flag flipped
    // to true on WinBros, the cron blasted Jack's customers.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T18:00:00Z')) // noon CT — hours guard would pass
    expect(isRetargetingExcluded('winbros')).toBe(true)
  })

  it('spotless at 3am LA is blocked by hours even though not excluded', () => {
    // follow-up-quoted regression: used to skip globally when PT < 9, but a tenant in CT
    // or ET could still be inside their 9–21 window. Per-tenant tz must hold the gate.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T11:00:00Z')) // 3am PT
    expect(isRetargetingExcluded('spotless-scrubbers')).toBe(false)
    expect(isInPersonalHours({ timezone: 'America/Los_Angeles' })).toBe(false)
  })
})
