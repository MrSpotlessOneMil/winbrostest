/**
 * Service Plans — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import {
  calculateServiceMonths,
  getWeekOfMonth,
  getAnnualRevenue,
} from '@/apps/window-washing/lib/service-plans'

describe('calculateServiceMonths', () => {
  it('quarterly from January → Jan, Apr, Jul, Oct', () => {
    expect(calculateServiceMonths('quarterly', 1)).toEqual([1, 4, 7, 10])
  })

  it('quarterly from March → Mar, Jun, Sep, Dec', () => {
    expect(calculateServiceMonths('quarterly', 3)).toEqual([3, 6, 9, 12])
  })

  it('quarterly from November wraps around → Nov, Feb, May, Aug', () => {
    expect(calculateServiceMonths('quarterly', 11)).toEqual([2, 5, 8, 11])
  })

  it('triannual from January → Jan, May, Sep', () => {
    expect(calculateServiceMonths('triannual', 1)).toEqual([1, 5, 9])
  })

  it('triannual from April → Apr, Aug, Dec', () => {
    expect(calculateServiceMonths('triannual', 4)).toEqual([4, 8, 12])
  })

  it('triannual_exterior same as triannual', () => {
    expect(calculateServiceMonths('triannual_exterior', 1)).toEqual([1, 5, 9])
  })

  it('monthly returns all 12 months', () => {
    expect(calculateServiceMonths('monthly', 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('biannual from January → Jan, Jul', () => {
    expect(calculateServiceMonths('biannual', 1)).toEqual([1, 7])
  })

  it('biannual from September wraps → Mar, Sep', () => {
    expect(calculateServiceMonths('biannual', 9)).toEqual([3, 9])
  })
})

describe('getWeekOfMonth', () => {
  it('day 1 = week 1', () => {
    expect(getWeekOfMonth(new Date('2026-01-01'))).toBe(1)
  })

  it('day 7 = week 1', () => {
    expect(getWeekOfMonth(new Date('2026-01-07'))).toBe(1)
  })

  it('day 8 = week 2', () => {
    expect(getWeekOfMonth(new Date('2026-01-08'))).toBe(2)
  })

  it('day 11 = week 2 (Jan 11th example from Max)', () => {
    expect(getWeekOfMonth(new Date('2026-01-11'))).toBe(2)
  })

  it('day 28 = week 4', () => {
    expect(getWeekOfMonth(new Date('2026-01-28'))).toBe(4)
  })

  it('day 31 = week 5', () => {
    expect(getWeekOfMonth(new Date('2026-01-31'))).toBe(5)
  })
})

describe('getAnnualRevenue', () => {
  it('quarterly: price * 4', () => {
    expect(getAnnualRevenue('quarterly', 250)).toBe(1000)
  })

  it('triannual: price * 3', () => {
    expect(getAnnualRevenue('triannual', 300)).toBe(900)
  })

  it('triannual_exterior: price * 3', () => {
    expect(getAnnualRevenue('triannual_exterior', 200)).toBe(600)
  })

  it('monthly: price * 12', () => {
    expect(getAnnualRevenue('monthly', 100)).toBe(1200)
  })

  it('biannual: price * 2', () => {
    expect(getAnnualRevenue('biannual', 500)).toBe(1000)
  })
})
