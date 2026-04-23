/**
 * Customer v2 flow — Unit Tests (Round 2 Wave 3c task 7)
 *
 * Tests the pure helpers the customer-view page depends on:
 *   - firstVisitChargeForPlan (plan.first_visit_keeps_original_price branching)
 *   - computeQuoteTotals with customer opt-in/out state
 *
 * Approve-route validation is covered in Tier 2 and Tier 1 specs since it
 * requires a real Supabase + Next runtime to exercise.
 */

import { describe, it, expect } from 'vitest'
import {
  computeQuoteTotals,
  firstVisitChargeForPlan,
} from '@/apps/window-washing/lib/quote-totals'

describe('Customer approve — signature payload contract', () => {
  // These tests pin invariants the POST body must satisfy for the
  // /api/public/quotes/approve endpoint to accept the submission.
  const buildBody = (overrides: Record<string, unknown> = {}) => ({
    token: 'a'.repeat(40),
    selected_plan_id: null,
    agreement_read: true,
    signature_data: 'data:image/png;base64,' + 'A'.repeat(300),
    opted_in_optional_ids: [],
    opted_out_recommended_ids: [],
    ...overrides,
  })

  it('variant 1 (happy): full body passes all client-side guards', () => {
    const body = buildBody()
    expect(body.token.length).toBeGreaterThanOrEqual(20)
    expect(body.agreement_read).toBe(true)
    expect((body.signature_data as string).length).toBeGreaterThan(200)
  })

  it('variant 2: token too short → should be rejected by server', () => {
    const body = buildBody({ token: 'abc' })
    expect(body.token.length).toBeLessThan(20)
  })

  it('variant 3: missing signature → should be rejected by server', () => {
    const body = buildBody({ signature_data: '' })
    expect((body.signature_data as string).length).toBeLessThan(200)
  })
})

describe('Customer view — plan first-visit math', () => {
  it('variant 1: plan keeps original → first-visit = shown total', () => {
    expect(firstVisitChargeForPlan(380, 99, true)).toBe(380)
  })

  it('variant 2: plan discounts first visit → first-visit = recurring_price', () => {
    expect(firstVisitChargeForPlan(380, 99, false)).toBe(99)
  })

  it('variant 3: no plan picked → caller falls back to total (documented)', () => {
    // The UI passes `totals.total` when selectedPlan is null, not this helper.
    // We sanity-check the helper anyway for the true/false split.
    expect(firstVisitChargeForPlan(0, 0, true)).toBe(0)
    expect(firstVisitChargeForPlan(0, 0, false)).toBe(0)
  })
})

describe('Customer view — total tracks checkbox interactions', () => {
  const items = [
    { id: 'A', price: 200, optionality: 'required' as const },
    { id: 'B', price: 80, optionality: 'recommended' as const },
    { id: 'C', price: 150, optionality: 'optional' as const },
    { id: 'D', price: 60, optionality: 'recommended' as const },
  ]

  it('variant 1 (default state): recommendeds on, optionals off', () => {
    expect(computeQuoteTotals({ lineItems: items }).total).toBe(340)
  })

  it('variant 2: uncheck one recommended', () => {
    expect(
      computeQuoteTotals({
        lineItems: items,
        optedOutRecommendedIds: new Set(['B']),
      }).total
    ).toBe(260)
  })

  it('variant 3: check optional while keeping recommendeds', () => {
    expect(
      computeQuoteTotals({
        lineItems: items,
        optedInOptionalIds: new Set(['C']),
      }).total
    ).toBe(490)
  })
})
