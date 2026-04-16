/**
 * Promo Pipeline Unit Tests
 *
 * Tests the ENTIRE promo flow at unit level:
 * 1. promo-config.ts — detection, addons, terms, SMS templates
 * 2. Ad UTM → getPromoConfig mapping
 * 3. Diluted scope verification (no fridge/oven/baseboards for $149)
 * 4. Cleaner pay override values
 * 5. AI context injection
 * 6. Campaign contexts for non-promo campaigns
 * 7. Cross-contamination prevention
 */

import { describe, it, expect } from 'vitest'
import {
  getPromoConfig,
  PROMO_CAMPAIGNS,
  CAMPAIGN_CONTEXTS,
  type PromoConfig,
} from '../../lib/promo-config'

// ─── PROMO CONFIG: Detection ──────────────────────────────────────

describe('getPromoConfig — Promo Detection', () => {
  it('detects 149-deep-clean campaign', () => {
    const config = getPromoConfig({ utm_campaign: '149-deep-clean' })
    expect(config).not.toBeNull()
    expect(config!.price).toBe(149)
  })

  it('detects 99-3hr-clean campaign', () => {
    const config = getPromoConfig({ utm_campaign: '99-3hr-clean' })
    expect(config).not.toBeNull()
    expect(config!.price).toBe(99)
  })

  it('detects legacy 99-deep-clean campaign', () => {
    const config = getPromoConfig({ utm_campaign: '99-deep-clean' })
    expect(config).not.toBeNull()
    expect(config!.price).toBe(99)
  })

  it('returns null for book-now (NOT a promo)', () => {
    const config = getPromoConfig({ utm_campaign: 'book-now' })
    expect(config).toBeNull()
  })

  it('returns null for airbnb-turnover (NOT a promo)', () => {
    const config = getPromoConfig({ utm_campaign: 'airbnb-turnover' })
    expect(config).toBeNull()
  })

  it('returns null for empty/missing utm_campaign', () => {
    expect(getPromoConfig({})).toBeNull()
    expect(getPromoConfig(null)).toBeNull()
    expect(getPromoConfig(undefined)).toBeNull()
    expect(getPromoConfig({ utm_campaign: '' })).toBeNull()
  })

  it('returns null for unknown campaign', () => {
    expect(getPromoConfig({ utm_campaign: 'random-campaign' })).toBeNull()
  })

  it('Meta fallback: source_detail=meta + service_type=deep-cleaning → 99-3hr-clean', () => {
    const config = getPromoConfig({ source_detail: 'meta', service_type: 'deep-cleaning' })
    expect(config).not.toBeNull()
    expect(config!.price).toBe(99)
  })

  it('Meta fallback: source_detail=meta WITHOUT deep-cleaning → null', () => {
    const config = getPromoConfig({ source_detail: 'meta', service_type: 'standard' })
    expect(config).toBeNull()
  })
})

// ─── PROMO CONFIG: $149 Deep Clean Specifics ─────────────────────

describe('$149 Deep Clean Config', () => {
  const config = PROMO_CAMPAIGNS['149-deep-clean']

  it('has correct price', () => {
    expect(config.price).toBe(149)
  })

  it('has 4 hours', () => {
    expect(config.hours).toBe(4)
  })

  it('has 1 cleaner', () => {
    expect(config.cleaners).toBe(1)
  })

  it('has $100 pay override', () => {
    expect(config.payOverride).toBe(100)
  })

  it('has deep tier', () => {
    expect(config.tier).toBe('deep')
  })

  // CRITICAL: Diluted addons — NO fridge, oven, baseboards
  it('uses DILUTED addons (NOT full deep)', () => {
    expect(config.addons).toContain('ceiling_fans')
    expect(config.addons).toContain('light_fixtures')
    expect(config.addons).toContain('window_sills')
    expect(config.addons).toContain('inside_microwave')
  })

  it('does NOT include fridge', () => {
    expect(config.addons).not.toContain('inside_fridge')
  })

  it('does NOT include oven', () => {
    expect(config.addons).not.toContain('inside_oven')
  })

  it('does NOT include baseboards', () => {
    expect(config.addons).not.toContain('baseboards')
  })

  it('has exactly 4 diluted addons', () => {
    expect(config.addons).toHaveLength(4)
  })

  it('has terms mentioning fridge/oven NOT included', () => {
    const termsText = config.terms.join(' ')
    expect(termsText).toMatch(/fridge.*not included|not included.*fridge/i)
    expect(termsText).toMatch(/oven.*not included|not included.*oven/i)
  })

  it('has quoteSms with $149 price', () => {
    expect(config.quoteSms).toContain('149')
    expect(config.quoteSms).toContain('{name}')
    expect(config.quoteSms).toContain('{url}')
  })

  it('has firstSms with $149 price', () => {
    expect(config.firstSms).toContain('149')
  })

  it('AI context says NOT a full deep clean', () => {
    const contextText = config.aiContext.join(' ')
    expect(contextText).toMatch(/NOT a full deep clean/i)
  })

  it('AI context says DO NOT promise fridge/oven', () => {
    const contextText = config.aiContext.join(' ')
    expect(contextText).toMatch(/does NOT include.*fridge/i)
    expect(contextText).toMatch(/does NOT include.*oven/i)
  })

  it('AI context says HONOR the $149 price', () => {
    const contextText = config.aiContext.join(' ')
    expect(contextText).toMatch(/HONOR.*149/i)
  })
})

// ─── PROMO CONFIG: $99 3-Hour Clean Specifics ────────────────────

describe('$99 3-Hour Clean Config', () => {
  const config = PROMO_CAMPAIGNS['99-3hr-clean']

  it('has correct price', () => {
    expect(config.price).toBe(99)
  })

  it('has 3 hours', () => {
    expect(config.hours).toBe(3)
  })

  it('has 1 cleaner', () => {
    expect(config.cleaners).toBe(1)
  })

  it('has $75 pay override', () => {
    expect(config.payOverride).toBe(75)
  })

  it('uses DILUTED addons', () => {
    expect(config.addons).not.toContain('inside_fridge')
    expect(config.addons).not.toContain('inside_oven')
    expect(config.addons).not.toContain('baseboards')
    expect(config.addons).toContain('ceiling_fans')
  })

  it('has terms with 3-hour cap', () => {
    const termsText = config.terms.join(' ')
    expect(termsText).toMatch(/3 hours/i)
  })

  it('AI context says 3-HOUR session, NOT full deep clean', () => {
    const contextText = config.aiContext.join(' ')
    expect(contextText).toMatch(/3-HOUR/i)
    expect(contextText).toMatch(/NOT a full deep clean/i)
  })
})

// ─── PROMO CONFIG: Legacy $99 Deep Clean ─────────────────────────

describe('Legacy $99 Deep Clean Config', () => {
  const config = PROMO_CAMPAIGNS['99-deep-clean']

  it('exists for backward compatibility', () => {
    expect(config).toBeDefined()
  })

  it('has same params as 99-3hr-clean', () => {
    const threeHr = PROMO_CAMPAIGNS['99-3hr-clean']
    expect(config.price).toBe(threeHr.price)
    expect(config.hours).toBe(threeHr.hours)
    expect(config.cleaners).toBe(threeHr.cleaners)
    expect(config.payOverride).toBe(threeHr.payOverride)
  })
})

// ─── CAMPAIGN CONTEXTS: Non-Promo Campaigns ─────────────────────

describe('Campaign Contexts (non-promo)', () => {
  it('book-now has empty context (regular lead)', () => {
    expect(CAMPAIGN_CONTEXTS['book-now']).toBeDefined()
    expect(CAMPAIGN_CONTEXTS['book-now']).toHaveLength(0)
  })

  it('airbnb-turnover has Airbnb-specific context', () => {
    const ctx = CAMPAIGN_CONTEXTS['airbnb-turnover']
    expect(ctx).toBeDefined()
    expect(ctx.length).toBeGreaterThan(0)
    const text = ctx.join(' ')
    expect(text).toMatch(/airbnb|short-term rental/i)
    expect(text).toMatch(/host/i)
  })

  it('airbnb context explicitly says NO discounts', () => {
    const text = CAMPAIGN_CONTEXTS['airbnb-turnover'].join(' ')
    // Context should say "no promotional discount" — confirming standard pricing
    expect(text).toMatch(/no promotional discount/i)
    // Should NOT offer a deal or special price
    expect(text).not.toMatch(/\d+%\s*off|\$\d+\s*off|special.*price/i)
  })
})

// ─── CROSS-CONTAMINATION: Promo values never leak ────────────────

describe('Cross-Contamination Prevention', () => {
  it('each promo campaign has independent config', () => {
    const configs = Object.entries(PROMO_CAMPAIGNS)
    for (const [key, config] of configs) {
      expect(config.price).toBeGreaterThan(0)
      expect(config.hours).toBeGreaterThan(0)
      expect(config.cleaners).toBeGreaterThan(0)
      expect(config.payOverride).toBeGreaterThan(0)
      expect(config.addons).toBeDefined()
      expect(config.terms).toBeDefined()
      expect(config.firstSms).toBeDefined()
      expect(config.quoteSms).toBeDefined()
      expect(config.aiContext).toBeDefined()
    }
  })

  it('$149 config price !== $99 config price', () => {
    expect(PROMO_CAMPAIGNS['149-deep-clean'].price).not.toBe(PROMO_CAMPAIGNS['99-3hr-clean'].price)
  })

  it('$149 config payOverride !== $99 config payOverride', () => {
    expect(PROMO_CAMPAIGNS['149-deep-clean'].payOverride).not.toBe(PROMO_CAMPAIGNS['99-3hr-clean'].payOverride)
  })

  it('$149 has more hours than $99', () => {
    expect(PROMO_CAMPAIGNS['149-deep-clean'].hours).toBeGreaterThan(PROMO_CAMPAIGNS['99-3hr-clean'].hours)
  })

  it('quoteSms templates contain correct prices', () => {
    expect(PROMO_CAMPAIGNS['149-deep-clean'].quoteSms).toContain('149')
    expect(PROMO_CAMPAIGNS['149-deep-clean'].quoteSms).not.toContain('$99')

    expect(PROMO_CAMPAIGNS['99-3hr-clean'].quoteSms).toContain('99')
    expect(PROMO_CAMPAIGNS['99-3hr-clean'].quoteSms).not.toContain('$149')
  })

  it('firstSms templates contain correct prices', () => {
    expect(PROMO_CAMPAIGNS['149-deep-clean'].firstSms).toContain('149')
    expect(PROMO_CAMPAIGNS['99-3hr-clean'].firstSms).toContain('99')
  })

  it('no promo config is returned for regular campaigns', () => {
    const regularCampaigns = ['book-now', 'airbnb-turnover', 'google-ads', 'seo', 'referral', '']
    for (const campaign of regularCampaigns) {
      const config = getPromoConfig({ utm_campaign: campaign })
      expect(config).toBeNull()
    }
  })
})

// ─── CLEANER PAY: Override values are correct ────────────────────

describe('Cleaner Pay Override Values', () => {
  it('$99 promo: cleaner gets $75 (not $99, not $50)', () => {
    const config = PROMO_CAMPAIGNS['99-3hr-clean']
    expect(config.payOverride).toBe(75)
    expect(config.payOverride).not.toBe(99)
    expect(config.payOverride).not.toBe(50)
    expect(config.payOverride).not.toBe(49.50) // not 50% of 99
  })

  it('$149 promo: cleaner gets $100 (not $149, not $50)', () => {
    const config = PROMO_CAMPAIGNS['149-deep-clean']
    expect(config.payOverride).toBe(100)
    expect(config.payOverride).not.toBe(149)
    expect(config.payOverride).not.toBe(50)
    expect(config.payOverride).not.toBe(74.50) // not 50% of 149
  })

  it('pay override is LESS than customer price (business makes money)', () => {
    for (const [key, config] of Object.entries(PROMO_CAMPAIGNS)) {
      expect(config.payOverride).toBeLessThan(config.price)
    }
  })

  it('pay override covers minimum wage for hours (sanity check)', () => {
    // LA minimum wage ~$18/hr, pay should be above that
    for (const [key, config] of Object.entries(PROMO_CAMPAIGNS)) {
      const hourlyRate = config.payOverride / config.hours
      expect(hourlyRate).toBeGreaterThan(18) // above LA minimum wage
    }
  })
})

// ─── ADDONS: Diluted vs Full arrays are correct ──────────────────

describe('Addon Arrays', () => {
  const EXPECTED_DILUTED = ['ceiling_fans', 'light_fixtures', 'window_sills', 'inside_microwave']
  const FULL_DEEP_ITEMS = ['baseboards', 'inside_fridge', 'inside_oven']

  it('$149 uses exactly the diluted set', () => {
    const config = PROMO_CAMPAIGNS['149-deep-clean']
    expect(config.addons.sort()).toEqual(EXPECTED_DILUTED.sort())
  })

  it('$99 3hr uses exactly the diluted set', () => {
    const config = PROMO_CAMPAIGNS['99-3hr-clean']
    expect(config.addons.sort()).toEqual(EXPECTED_DILUTED.sort())
  })

  it('$99 legacy uses exactly the diluted set', () => {
    const config = PROMO_CAMPAIGNS['99-deep-clean']
    expect(config.addons.sort()).toEqual(EXPECTED_DILUTED.sort())
  })

  it('NO promo campaign includes fridge, oven, or baseboards', () => {
    for (const [key, config] of Object.entries(PROMO_CAMPAIGNS)) {
      for (const item of FULL_DEEP_ITEMS) {
        expect(config.addons).not.toContain(item)
      }
    }
  })
})

// ─── TERMS: Service agreements are correct ───────────────────────

describe('Service Agreement Terms', () => {
  it('$99 terms mention 3-hour limit', () => {
    const terms = PROMO_CAMPAIGNS['99-3hr-clean'].terms
    const text = terms.join(' ')
    expect(text).toMatch(/3 hour/i)
  })

  it('$149 terms mention 4-hour limit', () => {
    const terms = PROMO_CAMPAIGNS['149-deep-clean'].terms
    const text = terms.join(' ')
    expect(text).toMatch(/4 hour/i)
  })

  it('all promo terms mention first visit only', () => {
    for (const [key, config] of Object.entries(PROMO_CAMPAIGNS)) {
      const text = config.terms.join(' ')
      expect(text).toMatch(/first visit only|promotional rate/i)
    }
  })

  it('all promo terms mention cancellation fee', () => {
    for (const [key, config] of Object.entries(PROMO_CAMPAIGNS)) {
      const text = config.terms.join(' ')
      expect(text).toMatch(/cancellation/i)
    }
  })
})
