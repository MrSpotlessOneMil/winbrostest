/**
 * Time-Off Validation — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import {
  validateTimeOffRequest,
  getMinimumTimeOffDate,
} from '@/apps/window-washing/lib/time-off-validation'

describe('validateTimeOffRequest', () => {
  it('accepts dates 14+ days in advance', () => {
    const result = validateTimeOffRequest('2026-04-30', '2026-04-12')
    expect(result).toBeNull()
  })

  it('accepts dates exactly 14 days out', () => {
    const result = validateTimeOffRequest('2026-04-26', '2026-04-12')
    expect(result).toBeNull()
  })

  it('rejects dates less than 14 days out', () => {
    const result = validateTimeOffRequest('2026-04-25', '2026-04-12')
    expect(result).toContain('14 days')
    expect(result).toContain('Contact your manager')
  })

  it('rejects tomorrow', () => {
    const result = validateTimeOffRequest('2026-04-13', '2026-04-12')
    expect(result).toContain('14 days')
  })

  it('rejects today', () => {
    const result = validateTimeOffRequest('2026-04-12', '2026-04-12')
    expect(result).toContain('today or past')
  })

  it('rejects past dates', () => {
    const result = validateTimeOffRequest('2026-04-10', '2026-04-12')
    expect(result).toContain('today or past')
  })

  it('accepts 30 days out', () => {
    const result = validateTimeOffRequest('2026-05-12', '2026-04-12')
    expect(result).toBeNull()
  })
})

describe('getMinimumTimeOffDate', () => {
  it('returns date 14 days from now', () => {
    const min = getMinimumTimeOffDate('2026-04-12')
    expect(min).toBe('2026-04-26')
  })
})
