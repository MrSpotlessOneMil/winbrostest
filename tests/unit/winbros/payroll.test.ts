/**
 * Payroll Engine — Unit Tests
 */

import { describe, it, expect } from 'vitest'
import {
  calculateTechPay,
  calculateSalesmanPay,
} from '@/apps/window-washing/lib/payroll'

describe('calculateTechPay', () => {
  it('percentage-based: 15% of $4000 revenue = $600', () => {
    expect(calculateTechPay(4000, 15, 0, 0, null)).toBe(600)
  })

  it('percentage-based: 22% of $5750 revenue = $1265', () => {
    expect(calculateTechPay(5750, 22, 0, 0, null)).toBe(1265)
  })

  it('hourly-based: 40hrs * $20/hr = $800', () => {
    expect(calculateTechPay(0, null, 40, 0, 20)).toBe(800)
  })

  it('hourly with OT: 45hrs (5 OT) * $20/hr, OT 1.5x', () => {
    // Regular: 40 * 20 = 800
    // OT: 5 * 20 * 1.5 = 150
    // Total: 950
    expect(calculateTechPay(0, null, 45, 5, 20, 1.5)).toBe(950)
  })

  it('combined: percentage + hourly', () => {
    // 15% of $3000 = $450
    // 20hrs * $15 = $300
    // Total: $750
    expect(calculateTechPay(3000, 15, 20, 0, 15)).toBe(750)
  })

  it('zero revenue and hours = $0', () => {
    expect(calculateTechPay(0, 15, 0, 0, 20)).toBe(0)
  })

  it('handles null percentage gracefully', () => {
    expect(calculateTechPay(5000, null, 0, 0, null)).toBe(0)
  })
})

describe('calculateSalesmanPay', () => {
  it('different rates per plan type', () => {
    // $1000 1-time at 10% = $100
    // $2000 triannual at 15% = $300
    // $3000 quarterly at 20% = $600
    // Total: $1000
    expect(calculateSalesmanPay(1000, 2000, 3000, 10, 15, 20)).toBe(1000)
  })

  it('only 1-time revenue', () => {
    expect(calculateSalesmanPay(5000, 0, 0, 12, 0, 0)).toBe(600)
  })

  it('only quarterly revenue', () => {
    expect(calculateSalesmanPay(0, 0, 10000, 0, 0, 8)).toBe(800)
  })

  it('zero revenue = $0', () => {
    expect(calculateSalesmanPay(0, 0, 0, 10, 15, 20)).toBe(0)
  })

  it('handles fractional cents with rounding', () => {
    // $333 at 10% = $33.30
    expect(calculateSalesmanPay(333, 0, 0, 10, 0, 0)).toBe(33.3)
  })
})
