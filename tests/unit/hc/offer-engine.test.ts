/**
 * Unit tests for the retargeting offer engine (Build 2).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/07_RETARGETING.md §3 + §9
 */

import { describe, it, expect } from 'vitest'
import {
  pickEvergreenOffer,
  pickSeasonalTemplate,
  DEFAULT_OFFER_POOL,
  type OfferPoolEntry,
} from '../../../apps/house-cleaning/lib/services/followups/offer-engine'

describe('pickEvergreenOffer — basic selection', () => {
  it('returns a template_key from the pool', () => {
    const pick = pickEvergreenOffer({ pool: DEFAULT_OFFER_POOL })
    expect(pick.template_key).toBeTruthy()
    expect(typeof pick.template_key).toBe('string')
  })

  it('respects rng for deterministic selection', () => {
    const pick = pickEvergreenOffer({
      pool: DEFAULT_OFFER_POOL,
      rng: () => 0, // always pick the first eligible
    })
    expect(pick.template_key).toBe(DEFAULT_OFFER_POOL[0].template_key)
  })

  it('with rng returning value just under 1.0, picks the last eligible (or seasonal expansion)', () => {
    const pick = pickEvergreenOffer({
      pool: DEFAULT_OFFER_POOL,
      rng: () => 0.99,
    })
    // Last entry in default pool is `evergreen_seasonal`, which expands to a season template.
    // pickSeasonalTemplate returns 'evergreen_seasonal' in v1 (single template).
    expect(pick.type).toBe('seasonal')
  })
})

describe('pickEvergreenOffer — back-to-back exclusion', () => {
  it('excludes lastTemplateKey from selection', () => {
    const last = 'evergreen_dollar_20'
    // Run 50 picks; none should equal last
    for (let i = 0; i < 50; i++) {
      const pick = pickEvergreenOffer({
        pool: DEFAULT_OFFER_POOL,
        lastTemplateKey: last,
        rng: () => Math.random(),
      })
      expect(pick.template_key).not.toBe(last)
    }
  })

  it('falls back to full pool if filter empties it (single-entry pool case)', () => {
    const single: OfferPoolEntry[] = [
      { template_key: 'evergreen_dollar_20', weight: 1, type: 'dollar_off' },
    ]
    const pick = pickEvergreenOffer({
      pool: single,
      lastTemplateKey: 'evergreen_dollar_20',
    })
    expect(pick.template_key).toBe('evergreen_dollar_20') // had to fall back
  })
})

describe('pickEvergreenOffer — weighted distribution', () => {
  it('picks higher-weight entries more often (over many trials)', () => {
    // Pool: A weight=10, B weight=1
    const pool: OfferPoolEntry[] = [
      { template_key: 'evergreen_dollar_20', weight: 10, type: 'dollar_off' },
      { template_key: 'evergreen_dollar_40', weight: 1, type: 'dollar_off' },
    ]
    let aCount = 0
    let bCount = 0
    const seed = 42
    let rngState = seed
    const rng = () => {
      rngState = (rngState * 9301 + 49297) % 233280
      return rngState / 233280
    }
    for (let i = 0; i < 1000; i++) {
      const pick = pickEvergreenOffer({ pool, rng })
      if (pick.template_key === 'evergreen_dollar_20') aCount++
      else if (pick.template_key === 'evergreen_dollar_40') bCount++
    }
    // Roughly 10:1 ratio expected. Allow generous slack.
    expect(aCount).toBeGreaterThan(bCount * 5)
  })

  it('handles zero-weight entries gracefully (treats as ineligible)', () => {
    const pool: OfferPoolEntry[] = [
      { template_key: 'evergreen_dollar_20', weight: 0, type: 'dollar_off' },
      { template_key: 'evergreen_dollar_40', weight: 5, type: 'dollar_off' },
    ]
    for (let i = 0; i < 30; i++) {
      const pick = pickEvergreenOffer({ pool, rng: () => Math.random() })
      expect(pick.template_key).toBe('evergreen_dollar_40')
    }
  })
})

describe('pickEvergreenOffer — seasonal expansion', () => {
  it('seasonal pool entry expands to seasonal template', () => {
    const seasonalOnly: OfferPoolEntry[] = [
      { template_key: 'evergreen_seasonal', weight: 1, type: 'seasonal' },
    ]
    const pick = pickEvergreenOffer({ pool: seasonalOnly })
    expect(pick.type).toBe('seasonal')
    // For v1 we map all months to evergreen_seasonal; this asserts the shape.
    expect(pick.template_key).toBe('evergreen_seasonal')
  })
})

describe('pickSeasonalTemplate', () => {
  it('returns evergreen_seasonal for January (v1 single-template behavior)', () => {
    const jan = new Date('2026-01-15T12:00:00Z')
    expect(pickSeasonalTemplate(jan)).toBe('evergreen_seasonal')
  })
  it('returns evergreen_seasonal for July', () => {
    const jul = new Date('2026-07-15T12:00:00Z')
    expect(pickSeasonalTemplate(jul)).toBe('evergreen_seasonal')
  })
  it('returns evergreen_seasonal for December', () => {
    const dec = new Date('2026-12-15T12:00:00Z')
    expect(pickSeasonalTemplate(dec)).toBe('evergreen_seasonal')
  })
})
