/**
 * T6 — Quiet-hours enforcement on outreach SMS.
 *
 * Shantia Antoine incident (2026-04-20): initial outreach sent at 1:38 AM local.
 * The timezone-from-area-code helper must correctly map area codes to IANA
 * zones and the isWithinQuietHoursWindow check must reject early-morning sends.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  extractAreaCode,
  timezoneFromPhone,
  resolveTimezone,
  isWithinQuietHoursWindow,
  nextAllowedSendAt,
} from '../../packages/core/src/timezone-from-area-code'

describe('extractAreaCode', () => {
  it('handles E.164 format', () => {
    expect(extractAreaCode('+13466158455')).toBe('346')
  })
  it('handles 11-digit with leading 1', () => {
    expect(extractAreaCode('13466158455')).toBe('346')
  })
  it('handles 10-digit bare', () => {
    expect(extractAreaCode('3466158455')).toBe('346')
  })
  it('handles formatted input', () => {
    expect(extractAreaCode('(346) 615-8455')).toBe('346')
  })
  it('returns null for garbage', () => {
    expect(extractAreaCode('abc')).toBeNull()
    expect(extractAreaCode('123')).toBeNull()
    expect(extractAreaCode(null)).toBeNull()
  })
})

describe('timezoneFromPhone', () => {
  it('maps Houston area codes to America/Chicago', () => {
    expect(timezoneFromPhone('+13466158455')).toBe('America/Chicago')
    expect(timezoneFromPhone('+17135551234')).toBe('America/Chicago')
    expect(timezoneFromPhone('+12815551234')).toBe('America/Chicago')
    expect(timezoneFromPhone('+18325551234')).toBe('America/Chicago')
  })
  it('maps LA area codes to America/Los_Angeles', () => {
    expect(timezoneFromPhone('+12135551234')).toBe('America/Los_Angeles')
    expect(timezoneFromPhone('+13105551234')).toBe('America/Los_Angeles')
    expect(timezoneFromPhone('+17475551234')).toBe('America/Los_Angeles')
  })
  it('maps Niagara area codes to America/Toronto', () => {
    expect(timezoneFromPhone('+19055551234')).toBe('America/Toronto')
    expect(timezoneFromPhone('+12895551234')).toBe('America/Toronto')
    expect(timezoneFromPhone('+13655551234')).toBe('America/Toronto')
  })
  it('falls back for unknown area codes', () => {
    expect(timezoneFromPhone('+19995551234', 'America/Chicago')).toBe('America/Chicago')
  })
})

describe('resolveTimezone', () => {
  it('prefers tenant timezone when provided', () => {
    expect(resolveTimezone({ tenantTimezone: 'America/Toronto', phone: '+13465551234' }))
      .toBe('America/Toronto')
  })
  it('falls back to phone-derived when tenant tz is empty', () => {
    expect(resolveTimezone({ tenantTimezone: '', phone: '+17135551234' }))
      .toBe('America/Chicago')
  })
  it('falls back to given fallback when both missing', () => {
    expect(resolveTimezone({ phone: '+19995551234', fallback: 'America/Denver' }))
      .toBe('America/Denver')
  })
})

describe('isWithinQuietHoursWindow', () => {
  afterEach(() => { vi.useRealTimers() })

  it('rejects 1:38 AM America/Chicago (Shantia repro)', () => {
    // 1:38 AM CT = 07:38 UTC in winter (CST is UTC-6)
    vi.setSystemTime(new Date('2026-04-21T06:38:00.000Z')) // 01:38 America/Chicago
    expect(isWithinQuietHoursWindow('America/Chicago')).toBe(false)
  })

  it('allows 10:00 AM America/Chicago', () => {
    vi.setSystemTime(new Date('2026-04-21T15:00:00.000Z')) // 10:00 America/Chicago
    expect(isWithinQuietHoursWindow('America/Chicago')).toBe(true)
  })

  it('rejects 9:01 PM America/Chicago', () => {
    vi.setSystemTime(new Date('2026-04-22T02:01:00.000Z')) // 21:01 CT
    expect(isWithinQuietHoursWindow('America/Chicago')).toBe(false)
  })

  it('allows 8:59 PM America/Chicago', () => {
    vi.setSystemTime(new Date('2026-04-22T01:59:00.000Z')) // 20:59 CT
    expect(isWithinQuietHoursWindow('America/Chicago')).toBe(true)
  })

  it('fails OPEN for invalid timezone', () => {
    expect(isWithinQuietHoursWindow('Not/A_Real_Zone')).toBe(true)
  })
})

describe('nextAllowedSendAt', () => {
  afterEach(() => { vi.useRealTimers() })

  it('returns today 9am when current local hour is before 9am', () => {
    // 5am America/Chicago on 2026-04-21 = 10am UTC
    const now = new Date('2026-04-21T10:00:00.000Z')
    const next = nextAllowedSendAt('America/Chicago', now)
    // Expect target ~= 2026-04-21 09:00 America/Chicago = 14:00 UTC (CDT is UTC-5)
    expect(next.getUTCHours()).toBeGreaterThanOrEqual(13)
    expect(next.getUTCHours()).toBeLessThanOrEqual(15)
  })

  it('returns tomorrow 9am when current local hour is past 9am', () => {
    // 3pm CT on 2026-04-21 = 20:00 UTC
    const now = new Date('2026-04-21T20:00:00.000Z')
    const next = nextAllowedSendAt('America/Chicago', now)
    // Next allowed = 2026-04-22 09:00 CT
    expect(next.getTime()).toBeGreaterThan(now.getTime())
    expect(next.getUTCDate()).toBe(22)
  })
})
