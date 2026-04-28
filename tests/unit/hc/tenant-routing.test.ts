/**
 * HC — Tenant routing invariants.
 *
 * Per CLAUDE.md and feedback_tenant_identity.md:
 *   - WinBros (window cleaning) routes through getWindowCleaningPricing
 *   - All HC tenants (Spotless, Cedar, West Niagara, Texas Nova) route
 *     through the house-cleaning code path
 *
 * This file pins isWindowCleaningTenant() so an accidental rename of the
 * winbros tenant slug or a typo never silently sends a HC quote through
 * the WW pricing engine (or vice versa).
 */

import { describe, it, expect } from 'vitest'
import { isWindowCleaningTenant } from '@/apps/house-cleaning/lib/quote-pricing'

describe('isWindowCleaningTenant', () => {
  it('returns true ONLY for the winbros slug', () => {
    expect(isWindowCleaningTenant('winbros')).toBe(true)
  })

  it('returns false for every house-cleaning tenant', () => {
    expect(isWindowCleaningTenant('spotless-scrubbers')).toBe(false)
    expect(isWindowCleaningTenant('cedar-rapids')).toBe(false)
    expect(isWindowCleaningTenant('west-niagara')).toBe(false)
    expect(isWindowCleaningTenant('texas-nova')).toBe(false)
  })

  it('does NOT match a typo or partial match', () => {
    expect(isWindowCleaningTenant('Winbros')).toBe(false) // case-sensitive
    expect(isWindowCleaningTenant('winbross')).toBe(false)
    expect(isWindowCleaningTenant('winbro')).toBe(false)
    expect(isWindowCleaningTenant('window-bros')).toBe(false)
  })

  it('returns false for empty / unknown slugs', () => {
    expect(isWindowCleaningTenant('')).toBe(false)
    expect(isWindowCleaningTenant('unknown')).toBe(false)
  })
})
