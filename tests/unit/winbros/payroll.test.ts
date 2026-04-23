/**
 * Payroll Engine — Unit Tests
 *
 * Round 2 (2026-04-23): pay_mode is hourly XOR percentage. Never both.
 * Each operation tested with 3 input variants per the 3-tier-test-before-push rule.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateTechPay,
  calculateSalesmanPay,
} from '@/apps/window-washing/lib/payroll'

describe('calculateTechPay — hourly mode', () => {
  it('variant 1 (happy): 40hrs * $25/hr = $1000', () => {
    expect(calculateTechPay(0, 'hourly', null, 40, 0, 25)).toBe(1000)
  })

  it('variant 2 (with OT): 40 regular + 5 OT at 1.5x @ $25/hr = $1187.50', () => {
    // Regular: 40 * 25 = 1000
    // OT: 5 * 25 * 1.5 = 187.50
    expect(calculateTechPay(0, 'hourly', null, 45, 5, 25, 1.5)).toBe(1187.5)
  })

  it('variant 3 (edge): hourly mode IGNORES pay_percentage even if set', () => {
    // Revenue-based percentage must NOT contribute in hourly mode (that was the bug).
    expect(calculateTechPay(5000, 'hourly', 35, 40, 0, 25)).toBe(1000)
  })
})

describe('calculateTechPay — percentage mode', () => {
  it('variant 1 (happy): 15% of $4000 = $600', () => {
    expect(calculateTechPay(4000, 'percentage', 15, 0, 0, null)).toBe(600)
  })

  it('variant 2 (fractional): 22% of $5750 = $1265.00', () => {
    expect(calculateTechPay(5750, 'percentage', 22, 0, 0, null)).toBe(1265)
  })

  it('variant 3 (edge): percentage mode IGNORES hourly_rate + hours', () => {
    // Hours * rate must NOT contribute in percentage mode.
    expect(calculateTechPay(1000, 'percentage', 30, 40, 5, 25)).toBe(300)
  })
})

describe('calculateTechPay — null/edge mode handling', () => {
  it('variant 1: null pay_mode defaults to hourly (safe floor)', () => {
    expect(calculateTechPay(5000, null, 35, 40, 0, 25)).toBe(1000)
  })

  it('variant 2: hourly mode with 0 rate returns 0 (never negative or NaN)', () => {
    expect(calculateTechPay(1000, 'hourly', 30, 40, 0, 0)).toBe(0)
  })

  it('variant 3: percentage mode with null pct returns 0', () => {
    expect(calculateTechPay(1000, 'percentage', null, 0, 0, null)).toBe(0)
  })
})

describe('calculateSalesmanPay', () => {
  it('variant 1 (happy): mixed plan types', () => {
    // $1000 * 10% + $2000 * 15% + $3000 * 20% = 100 + 300 + 600 = 1000
    expect(calculateSalesmanPay(1000, 2000, 3000, 10, 15, 20)).toBe(1000)
  })

  it('variant 2 (single plan): only quarterly', () => {
    expect(calculateSalesmanPay(0, 0, 10000, 0, 0, 8)).toBe(800)
  })

  it('variant 3 (fractional): rounds to cents', () => {
    // $333 at 10% = $33.30
    expect(calculateSalesmanPay(333, 0, 0, 10, 0, 0)).toBe(33.3)
  })

  it('variant 4 (edge): zero revenue returns 0', () => {
    expect(calculateSalesmanPay(0, 0, 0, 10, 15, 20)).toBe(0)
  })
})
