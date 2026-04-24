/**
 * Quote totals — Unit Tests (Round 2 Wave 3a task 6)
 *
 * Matches PDF pages 3 & 5 customer-view semantics: required always counts,
 * recommended counts unless unchecked, optional doesn't count unless checked.
 * Three variants per operation.
 */

import { describe, it, expect } from 'vitest'
import {
  computeQuoteTotals,
  firstVisitChargeForPlan,
  formatTotalEquation,
} from '@/apps/window-washing/lib/quote-totals'

describe('computeQuoteTotals — optionality semantics', () => {
  it('variant 1 (happy): required + recommended + unchecked optional', () => {
    const { total, requiredTotal } = computeQuoteTotals({
      lineItems: [
        { id: 1, price: 200, optionality: 'required' },
        { id: 2, price: 50, optionality: 'recommended' },
        { id: 3, price: 100, optionality: 'optional' },
      ],
    })
    // 200 + 50 (recommended default-on) + 0 (optional default-off) = 250
    expect(total).toBe(250)
    expect(requiredTotal).toBe(200)
  })

  it('variant 2 (opt-in optional): checking an optional adds it', () => {
    const { total } = computeQuoteTotals({
      lineItems: [
        { id: 1, price: 200, optionality: 'required' },
        { id: 2, price: 100, optionality: 'optional' },
      ],
      optedInOptionalIds: new Set([2]),
    })
    expect(total).toBe(300)
  })

  it('variant 3 (opt-out recommended): unchecking a recommended removes it', () => {
    const { total, requiredTotal } = computeQuoteTotals({
      lineItems: [
        { id: 1, price: 200, optionality: 'required' },
        { id: 2, price: 50, optionality: 'recommended' },
      ],
      optedOutRecommendedIds: new Set([2]),
    })
    expect(total).toBe(200)
    expect(requiredTotal).toBe(200)
  })
})

describe('computeQuoteTotals — edge cases', () => {
  it('variant 1: quantity multiplies price', () => {
    const { total } = computeQuoteTotals({
      lineItems: [{ id: 1, price: 50, quantity: 3, optionality: 'required' }],
    })
    expect(total).toBe(150)
  })

  it('variant 2: missing optionality defaults to required', () => {
    const { total } = computeQuoteTotals({
      lineItems: [{ id: 1, price: 123.45 }],
    })
    expect(total).toBe(123.45)
  })

  it('variant 3: empty line items returns 0', () => {
    expect(computeQuoteTotals({ lineItems: [] })).toEqual({
      total: 0,
      requiredTotal: 0,
    })
  })
})

describe('firstVisitChargeForPlan', () => {
  it('variant 1: plan keeps original price → base total wins', () => {
    expect(firstVisitChargeForPlan(450, 99, true)).toBe(450)
  })

  it('variant 2: plan discounts first visit → recurring price wins', () => {
    expect(firstVisitChargeForPlan(450, 99, false)).toBe(99)
  })

  it('variant 3: fractional cents round correctly', () => {
    expect(firstVisitChargeForPlan(449.995, 99, true)).toBe(450)
    expect(firstVisitChargeForPlan(100, 33.333, false)).toBe(33.33)
  })
})

describe('formatTotalEquation (Wave 3e sketch: "$100 + $300 − $50 = $350")', () => {
  it('variant 1 (happy): two positive required lines + negative optional discount', () => {
    // Optional lines are NOT counted by default, so the −$50 discount only
    // shows up in the equation when it's promoted to required/recommended.
    expect(
      formatTotalEquation([
        { price: 100, optionality: 'required' },
        { price: 300, optionality: 'required' },
        { price: -50, optionality: 'required' },
      ])
    ).toBe('$100.00 + $300.00 − $50.00 = $350.00')
  })

  it('variant 2: optional lines are excluded even if priced', () => {
    expect(
      formatTotalEquation([
        { price: 100, optionality: 'required' },
        { price: 175, optionality: 'recommended' },
        { price: 40, optionality: 'optional' }, // excluded
      ])
    ).toBe('$100.00 + $175.00 = $275.00')
  })

  it('variant 3 (empty): no counted lines renders $0.00', () => {
    expect(formatTotalEquation([])).toBe('$0.00')
    expect(
      formatTotalEquation([{ price: 999, optionality: 'optional' }])
    ).toBe('$0.00')
  })

  it('variant 4: quantities multiply into each part', () => {
    expect(
      formatTotalEquation([
        { price: 50, quantity: 3, optionality: 'required' }, // 150
        { price: 20, quantity: 2, optionality: 'recommended' }, // 40
      ])
    ).toBe('$150.00 + $40.00 = $190.00')
  })
})
