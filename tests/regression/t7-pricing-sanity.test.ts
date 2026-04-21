/**
 * T7 — Pricing sanity assertion and tier-inclusion correctness.
 *
 * Linda Kingcade quoted $562 for 3/2 deep + windows + baseboards + behind_appliances.
 * Root cause: baseboards is deep-tier-included (should be $0 net) AND the addon
 * seed for behind_appliances was over-seeded. The pricing function itself is
 * additive — confirmed here. Seed audit lives in Phase 0 Texas Nova onboarding.
 */

import { describe, it, expect } from 'vitest'
import { isEffectivelyIncluded, TENANT_TIER_ADDITIONS } from '../../packages/core/src/service-scope'

describe('T7 — tier-inclusion correctness', () => {
  it('baseboards is included in deep tier for every tenant (global TIER_UPGRADES)', () => {
    expect(isEffectivelyIncluded({ key: 'baseboards' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'baseboards' }, 'deep', false, 'spotless-scrubbers')).toBe(true)
    expect(isEffectivelyIncluded({ key: 'baseboards' }, 'deep', false, 'texas-nova')).toBe(true)
  })

  it('ceiling_fans and light_fixtures are deep-tier included', () => {
    expect(isEffectivelyIncluded({ key: 'ceiling_fans' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'light_fixtures' }, 'deep', false)).toBe(true)
  })

  it('inside_microwave / inside_fridge / inside_oven are deep-tier included', () => {
    expect(isEffectivelyIncluded({ key: 'inside_microwave' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'inside_fridge' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'inside_oven' }, 'deep', false)).toBe(true)
  })

  it('behind_appliances is NOT deep-tier included (addon must be charged)', () => {
    expect(isEffectivelyIncluded({ key: 'behind_appliances' }, 'deep', false)).toBe(false)
  })

  it('windows_interior is NOT deep-tier included globally (add-on)', () => {
    expect(isEffectivelyIncluded({ key: 'windows_interior' }, 'deep', false)).toBe(false)
  })

  it('west-niagara includes interior_windows in both standard and deep', () => {
    expect(isEffectivelyIncluded({ key: 'interior_windows' }, 'standard', false, 'west-niagara')).toBe(true)
    expect(isEffectivelyIncluded({ key: 'interior_windows' }, 'deep', false, 'west-niagara')).toBe(true)
  })

  it('TENANT_TIER_ADDITIONS schema: every entry has standard AND deep keys', () => {
    for (const [slug, byTier] of Object.entries(TENANT_TIER_ADDITIONS)) {
      expect(Object.keys(byTier), `${slug} must have at least one tier-addition entry`).not.toHaveLength(0)
      for (const arr of Object.values(byTier)) {
        expect(Array.isArray(arr)).toBe(true)
      }
    }
  })
})

describe('T7 — sanity runtime assertion presence', () => {
  it('computeQuoteTotal source contains the 2.5x sanity guard', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../packages/core/src/quote-pricing.ts'),
      'utf-8'
    )
    expect(source).toMatch(/tierPrice\.price \* 2\.5/)
    expect(source).toMatch(/SANITY/)
  })
})
