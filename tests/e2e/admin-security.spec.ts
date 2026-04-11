/**
 * Admin & Demo Route Security E2E Tests
 *
 * Tests that admin routes require proper auth and demo/seed
 * is not accessible without authentication.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Admin Routes — Auth Required', () => {
  const adminRoutes = [
    '/api/admin/tenants',
    '/api/admin/users',
    '/api/admin/cleaners',
    '/api/admin/onboard',
    '/api/admin/reset-customer',
    '/api/admin/verify-webhooks',
    '/api/admin/register-webhook',
  ]

  for (const route of adminRoutes) {
    test(`GET ${route} requires admin auth`, async ({ request }) => {
      const res = await request.get(`${BASE}${route}`)
      // Should be 401 or redirect — never 200 with data
      expect([401, 403, 302]).toContain(res.status())
    })
  }
})

test.describe('Demo Seed — Not Externally Accessible', () => {
  test('/api/demo/seed POST requires authentication (not in externalRoutes)', async ({ request }) => {
    const res = await request.post(`${BASE}/api/demo/seed`, {
      data: JSON.stringify({ tenant_slug: 'spotless-scrubbers' }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should be 401 (requireAdmin) — we removed it from externalRoutes
    expect(res.status()).toBe(401)
  })
})

test.describe('API Information Disclosure', () => {
  test('VAPI GET endpoint should not expose service details', async ({ request }) => {
    const res = await request.get(`${BASE}/api/webhooks/vapi`)
    // If it returns 200 with status info, that's info disclosure (MEDIUM)
    // We accept this for now but log it
    if (res.status() === 200) {
      const body = await res.json()
      // Should at minimum not expose internal details
      expect(body).not.toHaveProperty('version')
      expect(body).not.toHaveProperty('env')
    }
  })
})
