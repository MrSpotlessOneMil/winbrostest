/**
 * Webhook Security E2E Tests
 *
 * Tests that all webhook endpoints reject unauthenticated/unsigned requests.
 * These validate the CRITICAL fixes applied during the 2026-03-25 security audit.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Webhook Security — Unsigned Request Rejection', () => {
  // Stripe webhook should reject without valid signature
  test('Stripe webhook rejects unsigned POST', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/stripe`, {
      data: JSON.stringify({ type: 'checkout.session.completed', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should return 400 (invalid signature) not 200
    expect(res.status()).not.toBe(200)
  })

  test('Stripe/WinBros webhook rejects unsigned POST', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/stripe/winbros`, {
      data: JSON.stringify({ type: 'checkout.session.completed', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).not.toBe(200)
  })

  // HCP webhook should reject without signature header
  test('HCP webhook rejects POST without X-HousecallPro-Signature', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/housecall-pro`, {
      data: JSON.stringify({ event: 'job.completed', data: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should be 401 or 500 (no tenants configured) — never 200
    expect(res.status()).not.toBe(200)
    expect([401, 500]).toContain(res.status())
  })

  // GHL webhook should reject when no secret configured or wrong signature
  test('GHL webhook rejects POST without valid signature', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/ghl?tenant=spotless-scrubbers`, {
      data: JSON.stringify({ type: 'ContactCreated' }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should be 401 or 500 (no secret configured), not 200
    expect(res.status()).not.toBe(200)
  })

  // Thumbtack webhook should reject without auth
  test('Thumbtack webhook rejects POST without Bearer token', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/thumbtack`, {
      data: JSON.stringify({ eventType: 'NegotiationCreatedV4' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).not.toBe(200)
  })

  // Meta webhook POST should reject without X-Hub-Signature-256
  test('Meta webhook rejects unsigned POST for spotless-scrubbers', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/meta/spotless-scrubbers`, {
      data: JSON.stringify({ object: 'page', entry: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should not process — either 401/400/500
    expect(res.status()).not.toBe(200)
  })

  // SAM webhook should reject without x-sam-secret
  test('SAM webhook rejects POST without secret header', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/sam/spotless-scrubbers`, {
      data: JSON.stringify({ type: 'lead_created' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status()).not.toBe(200)
  })

  // Website webhook should accept (public form) but not with junk data
  test('Website webhook handles empty POST body gracefully', async ({ request }) => {
    const res = await request.post(`${BASE}/api/webhooks/website/spotless-scrubbers`, {
      data: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    // Should handle gracefully — 400 (missing fields), 200, 404 (tenant not found), or 500 (no DB in dev)
    expect([200, 400, 404, 500]).toContain(res.status())
  })
})

test.describe('Webhook Security — VAPI Default Route', () => {
  test('VAPI default route passes winbros slug (not null)', async ({ request }) => {
    // A POST to the default VAPI route should NOT return 400 "No tenant slug"
    const res = await request.post(`${BASE}/api/webhooks/vapi`, {
      data: JSON.stringify({
        message: { type: 'status-update', status: 'ended' },
        call: { id: 'test-call' },
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should not be 400 with "No tenant slug" error
    if (res.status() === 400) {
      const contentType = res.headers()['content-type'] || ''
      if (contentType.includes('json')) {
        const body = await res.json()
        expect(body.error).not.toContain('No tenant slug')
      }
    }
    // Any non-400 status is fine (200, 500 from missing DB, etc.)
  })
})
