/**
 * Promo quote shape regression guards.
 *
 * Incident (2026-04-17, AJ quote db5cdfc9): the $149 Meta promo was
 * rendering the full deep checklist (baseboards scrubbed, inside oven,
 * inside fridge, grout, interior windows) even though the custom_terms
 * explicitly excluded those items. Root cause: quote page keyed the
 * checklist off selected_tier='deep' instead of service_category='standard',
 * and the baseboards line leaked through from the standard checklist.
 *
 * These tests lock in:
 * 1. The promo-config.ts shape — price, tier, addons, terms must match the
 *    ads customers see. The "promotional" keyword in terms is load-bearing:
 *    the quote page uses it to detect promo quotes and dilute the checklist.
 * 2. All three openphone quote-creation sites write service_category,
 *    selected_tier, custom_base_price, selected_addons and custom_terms
 *    from the same promoConfig. Any new site added must follow the pattern.
 * 3. The quote page keeps the isPromoOffer/filterPromoChecklist fix.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { PROMO_CAMPAIGNS, getPromoConfig } from '../../apps/house-cleaning/lib/promo-config'

const HC_ROOT = path.resolve(__dirname, '../../apps/house-cleaning')

const DILUTED_ADDONS = ['ceiling_fans', 'light_fixtures', 'window_sills', 'inside_microwave']

describe('Promo quote shape — $149 Meta diluted deep', () => {
  const config = PROMO_CAMPAIGNS['149-deep-clean']

  it('campaign exists in PROMO_CAMPAIGNS', () => {
    expect(config).toBeDefined()
  })

  it('price is $149', () => {
    expect(config.price).toBe(149)
  })

  it('tier is deep (so the ad copy matches) but scope is diluted', () => {
    expect(config.tier).toBe('deep')
  })

  it('addons are exactly the 4 diluted-deep items (no fridge/oven/baseboards)', () => {
    expect(config.addons.slice().sort()).toEqual(DILUTED_ADDONS.slice().sort())
    expect(config.addons).not.toContain('inside_fridge')
    expect(config.addons).not.toContain('inside_oven')
    expect(config.addons).not.toContain('baseboards')
  })

  it('terms contain the "promotional" keyword (required for isPromoOffer detection on the quote page)', () => {
    const hasPromoKeyword = config.terms.some((t) => /promotional|promo/i.test(t))
    expect(hasPromoKeyword).toBe(true)
  })

  it('terms explicitly state fridge/oven/baseboards are excluded', () => {
    const joined = config.terms.join(' ').toLowerCase()
    expect(joined).toMatch(/fridge/)
    expect(joined).toMatch(/oven/)
    expect(joined).toMatch(/baseboard/)
    expect(joined).toMatch(/not included/)
  })
})

describe('Promo quote shape — getPromoConfig() resolution', () => {
  it('resolves 149-deep-clean from utm_campaign', () => {
    const cfg = getPromoConfig({ utm_campaign: '149-deep-clean' })
    expect(cfg?.price).toBe(149)
    expect(cfg?.addons).toEqual(DILUTED_ADDONS)
  })

  it('returns null for non-promo leads', () => {
    expect(getPromoConfig(null)).toBeNull()
    expect(getPromoConfig({})).toBeNull()
    expect(getPromoConfig({ utm_campaign: 'book-now' })).toBeNull()
  })

  it('falls back to default Meta promo when utm_campaign is absent but source is meta', () => {
    const cfg = getPromoConfig({ source_detail: 'meta', service_type: 'deep-cleaning' })
    expect(cfg).not.toBeNull()
    // Whatever the default Meta promo is, it must still contain the "promotional"
    // keyword so the quote page can detect it.
    const hasPromoKeyword = cfg!.terms.some((t) => /promotional|promo/i.test(t))
    expect(hasPromoKeyword).toBe(true)
  })
})

describe('Meta → quote creation: every openphone insert must wire promoConfig', () => {
  const openphoneRoute = path.join(HC_ROOT, 'app/api/webhooks/openphone/route.ts')
  const source = fs.readFileSync(openphoneRoute, 'utf-8')

  // Find every `.from("quotes").insert(...)` block.
  const inserts = source.match(/\.from\(["']quotes["']\)\s*\.insert\(\s*\{[\s\S]*?\}\s*\)/g) || []

  it('openphone route has at least one quote insert', () => {
    expect(inserts.length).toBeGreaterThan(0)
  })

  it('every quote insert reads custom_base_price from a promoConfig', () => {
    for (const block of inserts) {
      const hasCustomBasePrice =
        /custom_base_price\s*:\s*promoConfig[0-9A-Za-z_]*\?\.price/.test(block)
      expect(hasCustomBasePrice, `quote insert missing promoConfig custom_base_price:\n${block.slice(0, 200)}`).toBe(true)
    }
  })

  it('every quote insert reads selected_addons from a promoConfig', () => {
    for (const block of inserts) {
      const hasSelectedAddons =
        /selected_addons\s*:\s*promoConfig[0-9A-Za-z_]*\?\.addons/.test(block)
      expect(hasSelectedAddons, `quote insert missing promoConfig selected_addons:\n${block.slice(0, 200)}`).toBe(true)
    }
  })

  it('every quote insert spreads custom_terms from promoConfig when promo is active', () => {
    for (const block of inserts) {
      const hasCustomTerms = /custom_terms\s*:\s*promoConfig[0-9A-Za-z_]*\.terms/.test(block)
      expect(hasCustomTerms, `quote insert missing promoConfig custom_terms:\n${block.slice(0, 200)}`).toBe(true)
    }
  })

  it('every quote insert writes service_category (drives the diluted checklist on the page)', () => {
    for (const block of inserts) {
      const hasServiceCategory = /service_category\s*:/.test(block)
      expect(hasServiceCategory, `quote insert missing service_category:\n${block.slice(0, 200)}`).toBe(true)
    }
  })
})

describe('Quote page — isPromoOffer + filterPromoChecklist must stay intact', () => {
  const quotePage = path.join(HC_ROOT, 'app/quote/[token]/page.tsx')
  const source = fs.readFileSync(quotePage, 'utf-8')

  it('detects promo offers via custom_terms "promotional" keyword', () => {
    expect(source).toMatch(/isPromoOffer\s*=\s*!!data\?\.custom_terms\?\.some/)
    expect(source).toMatch(/promotional\|promo/i)
  })

  it('has filterPromoChecklist() that strips baseboards for promo offers', () => {
    expect(source).toMatch(/filterPromoChecklist/)
    expect(source).toMatch(/baseboard/i)
  })

  it('applies filterPromoChecklist to every checklist render site', () => {
    // There are three render sites (top card, price-summary expansion, approved view).
    const applications = source.match(/filterPromoChecklist\(getDetailedChecklist/g) || []
    expect(applications.length).toBeGreaterThanOrEqual(3)
  })

  it('gates the membership section to standard non-promo quotes', () => {
    expect(source).toMatch(/effectiveTierKey\s*===\s*['"]standard['"]\s*&&\s*!isPromoOffer/)
  })
})
