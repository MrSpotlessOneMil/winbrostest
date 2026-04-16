/**
 * Unit tests for the addon-inclusion rule.
 *
 * Rule: an add-on that is part of the quote's included scope must never add
 * to the price. It still shows on the invoice so the customer sees value,
 * but contributes $0 net.
 */

import { describe, it, expect } from 'vitest'
import {
  isEffectivelyIncluded,
  isIncludedInTier,
  normalizeAddon,
  normalizeAddons,
  getPaidAddons,
} from '../apps/house-cleaning/lib/service-scope'

describe('isEffectivelyIncluded', () => {
  it('explicit included=true always wins, even on a standard tier', () => {
    expect(isEffectivelyIncluded({ key: 'blinds', included: true }, 'standard', false)).toBe(true)
  })

  it('explicit included=false always wins, even on a custom-priced quote', () => {
    expect(isEffectivelyIncluded({ key: 'blinds', included: false }, 'custom', true)).toBe(false)
  })

  it('custom-priced quotes default every addon to included', () => {
    expect(isEffectivelyIncluded({ key: 'blinds' }, 'custom', true)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'inside_oven' }, 'custom', true)).toBe(true)
  })

  it('tiered quotes: deep tier auto-includes inside_oven, inside_fridge, baseboards', () => {
    expect(isEffectivelyIncluded({ key: 'inside_oven' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'inside_fridge' }, 'deep', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'baseboards' }, 'deep', false)).toBe(true)
  })

  it('tiered quotes: standard tier does NOT auto-include upgrade addons', () => {
    expect(isEffectivelyIncluded({ key: 'inside_oven' }, 'standard', false)).toBe(false)
    expect(isEffectivelyIncluded({ key: 'blinds' }, 'standard', false)).toBe(false)
  })

  it('tiered quotes: move-in tier includes inside_cabinets and wall_cleaning', () => {
    expect(isEffectivelyIncluded({ key: 'inside_cabinets' }, 'move', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'wall_cleaning' }, 'move', false)).toBe(true)
  })

  it('standard base tasks are always included regardless of tier', () => {
    expect(isEffectivelyIncluded({ key: 'kitchen_surfaces' }, 'standard', false)).toBe(true)
    expect(isEffectivelyIncluded({ key: 'bathroom_sanitize' }, 'deep', false)).toBe(true)
  })
})

describe('isIncludedInTier (backward-compat)', () => {
  it('returns true for tier upgrades', () => {
    expect(isIncludedInTier('inside_oven', 'deep')).toBe(true)
  })

  it('returns false for addons not in the tier', () => {
    expect(isIncludedInTier('blinds', 'deep')).toBe(false)
    expect(isIncludedInTier('inside_oven', 'standard')).toBe(false)
  })

  it('unknown tier returns false', () => {
    expect(isIncludedInTier('inside_oven', 'unknown')).toBe(false)
  })
})

describe('normalizeAddon', () => {
  it('string input → object with quantity 1 and correct included flag for tier', () => {
    const n = normalizeAddon('inside_oven', 'deep', false)
    expect(n).toEqual({ key: 'inside_oven', quantity: 1, included: true })
  })

  it('string input on a custom quote defaults included=true', () => {
    const n = normalizeAddon('blinds', 'custom', true)
    expect(n).toEqual({ key: 'blinds', quantity: 1, included: true })
  })

  it('object input preserves an explicit included=false', () => {
    const n = normalizeAddon({ key: 'blinds', included: false }, 'custom', true)
    expect(n.included).toBe(false)
  })

  it('object input preserves an explicit included=true on a standard tier', () => {
    const n = normalizeAddon({ key: 'blinds', included: true }, 'standard', false)
    expect(n.included).toBe(true)
  })

  it('clamps quantity to >= 1', () => {
    expect(normalizeAddon({ key: 'blinds', quantity: 0 }, 'standard', false).quantity).toBe(1)
    expect(normalizeAddon({ key: 'blinds', quantity: 3 }, 'standard', false).quantity).toBe(3)
  })
})

describe('normalizeAddons + getPaidAddons', () => {
  it("TJ's scenario: custom $500 + 3 catalog addons → all flagged included", () => {
    const addons = ['inside_oven', 'inside_fridge', 'blinds']
    const normalized = normalizeAddons(addons, 'custom', true)
    expect(normalized.every((a) => a.included)).toBe(true)
    const paid = getPaidAddons(normalized, 'custom', true)
    expect(paid).toHaveLength(0)
  })

  it('deep tier + auto-included addon + billable blinds → only blinds is paid', () => {
    const addons = ['inside_oven', 'inside_fridge', 'blinds']
    const normalized = normalizeAddons(addons, 'deep', false)
    const paid = getPaidAddons(normalized, 'deep', false)
    expect(paid).toHaveLength(1)
    expect(paid[0].key).toBe('blinds')
  })

  it('standard tier + blinds → blinds is paid (not in standard tier upgrades)', () => {
    const addons = ['blinds']
    const normalized = normalizeAddons(addons, 'standard', false)
    const paid = getPaidAddons(normalized, 'standard', false)
    expect(paid).toHaveLength(1)
  })

  it('custom quote + explicit billable override on one addon', () => {
    const addons = [
      { key: 'inside_oven' },
      { key: 'blinds', included: false },
    ]
    const normalized = normalizeAddons(addons, 'custom', true)
    const paid = getPaidAddons(normalized, 'custom', true)
    expect(paid).toHaveLength(1)
    expect(paid[0].key).toBe('blinds')
  })
})
