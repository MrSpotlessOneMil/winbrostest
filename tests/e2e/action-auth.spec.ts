/**
 * Action Routes Auth E2E Tests
 *
 * Tests that all dashboard action routes reject unauthenticated requests.
 * Verifies requireAuthWithTenant is enforced on every action route.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

const actionRoutes = [
  { method: 'POST', path: '/api/actions/add-charge' },
  { method: 'POST', path: '/api/actions/attach-card' },
  { method: 'POST', path: '/api/actions/batch-create-customers' },
  { method: 'POST', path: '/api/actions/batch-create-leads' },
  { method: 'POST', path: '/api/actions/charge-card' },
  { method: 'POST', path: '/api/actions/complete-job' },
  { method: 'POST', path: '/api/actions/generate-payment-link' },
  { method: 'POST', path: '/api/actions/retry-payment' },
  { method: 'POST', path: '/api/actions/send-payment-links' },
  { method: 'POST', path: '/api/actions/send-sms' },
  { method: 'POST', path: '/api/actions/send-invoice' },
  { method: 'POST', path: '/api/actions/assign-cleaner' },
  { method: 'POST', path: '/api/actions/notify-cleaners' },
  { method: 'POST', path: '/api/actions/send-employee-credentials' },
  { method: 'POST', path: '/api/actions/import-customers' },
  { method: 'POST', path: '/api/actions/auto-schedule' },
  { method: 'POST', path: '/api/actions/recurring' },
  { method: 'POST', path: '/api/actions/redeem-offer' },
  { method: 'POST', path: '/api/actions/export' },
  { method: 'POST', path: '/api/actions/quotes/send' },
  { method: 'POST', path: '/api/actions/retargeting-pipeline' },
  { method: 'POST', path: '/api/actions/sync-hubspot' },
  { method: 'GET', path: '/api/actions/inbox' },
  { method: 'GET', path: '/api/actions/insights-data' },
  { method: 'GET', path: '/api/actions/pipeline' },
  { method: 'GET', path: '/api/actions/customer-offers' },
  { method: 'GET', path: '/api/actions/offers-summary' },
  { method: 'GET', path: '/api/actions/lead-journey' },
  { method: 'GET', path: '/api/actions/memberships' },
  { method: 'GET', path: '/api/actions/retargeting-customers' },
  { method: 'GET', path: '/api/actions/retargeting-ab-results' },
]

test.describe('Action Routes — Unauthenticated Rejection', () => {
  for (const route of actionRoutes) {
    test(`${route.method} ${route.path} returns 401 without session`, async ({ request }) => {
      let res
      if (route.method === 'POST') {
        res = await request.post(`${BASE}${route.path}`, {
          data: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        })
      } else {
        res = await request.get(`${BASE}${route.path}`)
      }
      // Should be 401 (requireAuthWithTenant) — never 200 or 500
      expect(res.status()).toBe(401)
    })
  }
})

test.describe('Action Routes — Malformed Body Returns 400', () => {
  const postRoutes = actionRoutes.filter(r => r.method === 'POST').slice(0, 5)

  for (const route of postRoutes) {
    test(`${route.path} returns 400 on malformed JSON (not 500)`, async ({ page }) => {
      // Use authenticated context from setup
      const res = await page.request.post(`${BASE}${route.path}`, {
        data: 'this is not json{{{',
        headers: { 'Content-Type': 'application/json' },
      })
      // With auth: should be 400 (malformed body), not 500 (unhandled error)
      // Without auth: should be 401
      expect([400, 401]).toContain(res.status())
    })
  }
})
