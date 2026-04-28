/**
 * HC — suggestCleanerPay unit tests.
 *
 * Per the Mandy incident (memory: incident_mandy_promo_pipeline_20260412),
 * cleaner pay must be computed off the NORMAL price, not the discounted
 * promo price — otherwise cleaners get paid 50% of $99 ($49.50) instead
 * of 50% of the normal price.
 *
 * `suggestCleanerPay` is the client-side helper used in the Create/Edit
 * Job form. The promo override is enforced in promo-config.ts
 * (`payOverride: 75`) and applied at job-creation time. This file just
 * locks the suggestion math itself.
 */

import { describe, it, expect } from 'vitest'
import { suggestCleanerPay } from '@/apps/house-cleaning/lib/suggest-cleaner-pay'

describe('suggestCleanerPay — null/empty config', () => {
  it('returns null amount + null description when config is null', () => {
    const r = suggestCleanerPay(null, { price: 200 })
    expect(r).toEqual({ amount: null, ruleDescription: null })
  })

  it('returns null when config is undefined', () => {
    const r = suggestCleanerPay(undefined, { price: 200 })
    expect(r.amount).toBeNull()
  })
})

describe('suggestCleanerPay — percentage model', () => {
  const config = {
    model: 'percentage' as const,
    percentage: 35,
    hourly_standard: null,
    hourly_deep: null,
  }

  it('computes 35% of price', () => {
    const r = suggestCleanerPay(config, { price: 200 })
    expect(r.amount).toBe(70)
    expect(r.ruleDescription).toBe('35% of job price')
  })

  it('rounds to nearest dollar (no fractional pay)', () => {
    const r = suggestCleanerPay(config, { price: 199 })
    // 199 × 0.35 = 69.65 → rounds to 70
    expect(r.amount).toBe(70)
  })

  it('parses string price ("250") as number', () => {
    const r = suggestCleanerPay(config, { price: '250' })
    expect(r.amount).toBe(88) // 250 × 0.35 = 87.5 → 88
  })

  it('returns null when price is 0 (no work)', () => {
    const r = suggestCleanerPay(config, { price: 0 })
    expect(r.amount).toBeNull()
  })

  it('returns null when price is negative (corrupt data)', () => {
    const r = suggestCleanerPay(config, { price: -50 })
    expect(r.amount).toBeNull()
  })

  it('returns null when percentage is null', () => {
    const r = suggestCleanerPay(
      { model: 'percentage', percentage: null, hourly_standard: null, hourly_deep: null },
      { price: 200 }
    )
    expect(r.amount).toBeNull()
  })

  it('Cedar Rapids 35% rule (per pricing_cedar_rapids.md): $200 → $70', () => {
    const r = suggestCleanerPay(config, { price: 200 })
    expect(r.amount).toBe(70)
  })
})

describe('suggestCleanerPay — hourly model', () => {
  const config = {
    model: 'hourly' as const,
    percentage: null,
    hourly_standard: 25,
    hourly_deep: 30,
  }

  it('uses hourly_standard for non-deep services', () => {
    const r = suggestCleanerPay(config, { hours: 4, serviceType: 'standard' })
    expect(r.amount).toBe(100) // 4 × 25
    expect(r.ruleDescription).toBe('4hr × $25/hr standard')
  })

  it('uses hourly_deep for deep cleans', () => {
    const r = suggestCleanerPay(config, { hours: 5, serviceType: 'deep clean' })
    expect(r.amount).toBe(150) // 5 × 30
    expect(r.ruleDescription).toBe('5hr × $30/hr deep')
  })

  it('uses hourly_deep for move-in/move-out', () => {
    const r = suggestCleanerPay(config, { hours: 6, serviceType: 'move-out' })
    expect(r.amount).toBe(180) // 6 × 30
    expect(r.ruleDescription).toContain('deep')
  })

  it('falls back to hourly_standard when hourly_deep is null', () => {
    const r = suggestCleanerPay(
      { model: 'hourly', percentage: null, hourly_standard: 25, hourly_deep: null },
      { hours: 4, serviceType: 'deep clean' }
    )
    expect(r.amount).toBe(100) // falls back to 25/hr
  })

  it('returns null when both hourly rates are null', () => {
    const r = suggestCleanerPay(
      { model: 'hourly', percentage: null, hourly_standard: null, hourly_deep: null },
      { hours: 4 }
    )
    expect(r.amount).toBeNull()
  })

  it('returns null when hours is 0', () => {
    const r = suggestCleanerPay(config, { hours: 0 })
    expect(r.amount).toBeNull()
  })

  it('parses string hours', () => {
    const r = suggestCleanerPay(config, { hours: '3.5', serviceType: 'standard' })
    expect(r.amount).toBe(88) // 3.5 × 25 = 87.5 → 88
  })
})

describe('suggestCleanerPay — legacy null model fallback', () => {
  it('infers percentage model when model is null but percentage is set', () => {
    const r = suggestCleanerPay(
      { model: null, percentage: 50, hourly_standard: null, hourly_deep: null },
      { price: 200 }
    )
    expect(r.amount).toBe(100)
    expect(r.ruleDescription).toBe('50% of job price')
  })

  it('does NOT infer hourly when model is null and only hourly_standard is set', () => {
    // Legacy rows without `model` set should fail safe — no payment auto-suggested
    const r = suggestCleanerPay(
      { model: null, percentage: null, hourly_standard: 25, hourly_deep: null },
      { hours: 4 }
    )
    expect(r.amount).toBeNull()
  })
})

describe('suggestCleanerPay — promo regression (Mandy incident)', () => {
  // The promo cleaner pay is enforced at promo-config.ts via payOverride.
  // suggestCleanerPay does NOT know about promos — it just suggests
  // based on the price you pass in. So if a user accidentally enters the
  // promo price, they'd get a low number. The CALLER must pass the
  // normal_price stored in jobs.notes (per memory_promo_cleaner_pay).
  it('passing $99 promo price yields percentage of $99 — caller must pass normal_price', () => {
    const config = {
      model: 'percentage' as const, percentage: 50,
      hourly_standard: null, hourly_deep: null,
    }
    const r = suggestCleanerPay(config, { price: 99 })
    expect(r.amount).toBe(50)
    // This is the EXACT bug from Mandy. The fix is upstream — caller
    // resolves cleaner_pay_override before invoking this helper.
  })

  it('with normal_price ($200) suggests the right $100', () => {
    const config = {
      model: 'percentage' as const, percentage: 50,
      hourly_standard: null, hourly_deep: null,
    }
    const r = suggestCleanerPay(config, { price: 200 })
    expect(r.amount).toBe(100)
  })
})
