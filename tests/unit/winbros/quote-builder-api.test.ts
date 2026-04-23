/**
 * Quote builder payload shape — Unit Tests (Round 2 Wave 3b task 6)
 *
 * These tests pin the PATCH body contract the builder UI depends on: what
 * the server accepts, what it filters out, how it normalizes. The route
 * itself is integration-tested at Tier 2; here we guard the pure logic
 * via the quote-totals helper that both sides consume.
 */

import { describe, it, expect } from 'vitest'
import { computeQuoteTotals } from '@/apps/window-washing/lib/quote-totals'

describe('builder live total — recomputes on every state change', () => {
  const base = [
    { id: 'a', price: 200, optionality: 'required' as const },
    { id: 'b', price: 80, optionality: 'recommended' as const },
    { id: 'c', price: 150, optionality: 'optional' as const },
  ]

  it('variant 1: initial render shows required + recommended (optional off)', () => {
    expect(computeQuoteTotals({ lineItems: base }).total).toBe(280)
  })

  it('variant 2: customer unchecks recommended → total drops', () => {
    expect(
      computeQuoteTotals({
        lineItems: base,
        optedOutRecommendedIds: new Set(['b']),
      }).total
    ).toBe(200)
  })

  it('variant 3: customer checks optional → total adds', () => {
    expect(
      computeQuoteTotals({
        lineItems: base,
        optedInOptionalIds: new Set(['c']),
      }).total
    ).toBe(430)
  })
})

describe('builder preserves upsell semantics through state transitions', () => {
  const upsellOnly = [{ id: 1, price: 50, optionality: 'required' as const, is_upsell: true }]
  const mixed = [
    { id: 1, price: 200, optionality: 'required' as const, is_upsell: false },
    { id: 2, price: 50, optionality: 'required' as const, is_upsell: true },
  ]

  it('variant 1: upsell lines count toward total (same as any line)', () => {
    expect(computeQuoteTotals({ lineItems: upsellOnly }).total).toBe(50)
  })

  it('variant 2: upsell mixed with base counts fully', () => {
    expect(computeQuoteTotals({ lineItems: mixed }).total).toBe(250)
  })

  it('variant 3: requiredTotal matches total when all required', () => {
    const r = computeQuoteTotals({ lineItems: mixed })
    expect(r.requiredTotal).toBe(250)
    expect(r.total).toBe(250)
  })
})
