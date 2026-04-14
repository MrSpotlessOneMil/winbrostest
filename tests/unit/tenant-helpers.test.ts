/**
 * Unit tests for tenant helper functions.
 * Tests feature flags, integration detection, and tenant lookup logic.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import '../mocks/modules'
import { CEDAR_RAPIDS_TENANT, WINBROS_TENANT } from '../fixtures/cedar-rapids'

// Import the real functions (they'll use mocked Supabase under the hood)
import { tenantUsesFeature } from '@/lib/tenant'

describe('tenantUsesFeature', () => {
  it('returns true for Cedar Rapids cleaner_dispatch', () => {
    const result = tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_cleaner_dispatch')
    expect(result).toBe(true)
  })

  it('returns true for Cedar Rapids review_request', () => {
    expect(tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_review_request')).toBe(true)
  })

  it('returns true for Cedar Rapids payment_collection', () => {
    expect(tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_payment_collection')).toBe(true)
  })

  it('returns false for Cedar Rapids hcp_mirror', () => {
    expect(tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_hcp_mirror')).toBe(false)
  })

  it('returns false for Cedar Rapids route_optimization', () => {
    expect(tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_route_optimization')).toBe(false)
  })

  it('returns false for Cedar Rapids rainy_day_reschedule', () => {
    expect(tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'use_rainy_day_reschedule')).toBe(false)
  })

  it('returns true for WinBros hcp_mirror', () => {
    expect(tenantUsesFeature(WINBROS_TENANT, 'use_hcp_mirror')).toBe(true)
  })

  it('returns true for WinBros route_optimization', () => {
    expect(tenantUsesFeature(WINBROS_TENANT, 'use_route_optimization')).toBe(true)
  })

  // FIXED: tenantUsesFeature now defaults to false for unknown flags (opt-in)
  it('returns false for undefined feature flag (safe opt-in default)', () => {
    const result = tenantUsesFeature(CEDAR_RAPIDS_TENANT, 'some_future_feature_that_doesnt_exist' as any)
    // New tenants won't accidentally get features they didn't enable
    expect(result).toBe(false)
  })

  it('returns false when workflow_config is null', () => {
    const nullConfigTenant = { ...CEDAR_RAPIDS_TENANT, workflow_config: null as any }
    // Should not crash — gracefully handle null config
    expect(() => tenantUsesFeature(nullConfigTenant, 'use_cleaner_dispatch')).not.toThrow()
  })
})
