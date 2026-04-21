import { test, expect } from '@playwright/test'

/**
 * Spotless landing-page smoke test.
 *
 * Runs on every push to main (via .github/workflows/website-smoke.yml).
 * Catches the OTHER failure mode from the 2026-04-20 ad-URL incident:
 * a code change that makes /offer or /commercial etc. stop rendering.
 *
 * For each Meta-ad landing page:
 *   1. HTTP 200 on direct request
 *   2. No console errors while rendering
 *   3. BookingForm or QuoteCalculator element visible
 *   4. POST /api/webhooks/website/spotless-scrubbers returns {success: true}
 *
 * Test-lead cleanup: we tag leads with source='ci-smoke' so the nightly
 * cron scripts/ci/cleanup-smoke-leads.mjs can prune them.
 *
 * Override target via SPOTLESS_BASE_URL env var (defaults to production).
 */

const BASE = process.env.SPOTLESS_BASE_URL || 'https://spotlessscrubbers.org'

interface LandingSpec {
  path: string
  name: string
  /** A selector that proves the hero form rendered. */
  formSelector: string
}

const LANDINGS: LandingSpec[] = [
  { path: '/', name: 'Homepage', formSelector: 'form, [class*="QuoteCalculator"], input[name="phone"]' },
  { path: '/offer', name: '$149 Deep Clean landing', formSelector: 'input[name="phone"]' },
  { path: '/book', name: 'Book Now landing', formSelector: 'input[name="phone"]' },
  { path: '/commercial', name: 'Commercial / Office landing', formSelector: 'input[name="phone"]' },
  { path: '/post-construction', name: 'Post-Construction landing', formSelector: 'input[name="phone"]' },
  { path: '/airbnb', name: 'Airbnb Luxury landing', formSelector: 'input[name="phone"]' },
  { path: '/deep-clean-offer', name: 'Deep-clean offer landing', formSelector: 'input[name="phone"]' },
]

test.describe.configure({ mode: 'parallel' })

for (const landing of LANDINGS) {
  test(`${landing.name} (${landing.path}) — HTTP 200 + form renders + no console errors`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        // Ignore third-party noise we can't control.
        if (/facebook\.com|fbcdn|google-analytics|googletagmanager|doubleclick/i.test(text)) return
        if (/Failed to load resource.*4\d{2}/i.test(text)) return
        consoleErrors.push(text)
      }
    })

    const response = await page.goto(`${BASE}${landing.path}`, { waitUntil: 'domcontentloaded' })
    expect(response?.status(), `HTTP status for ${landing.path}`).toBe(200)

    await expect(page.locator(landing.formSelector).first()).toBeVisible({ timeout: 10_000 })

    // Allow the page to settle so deferred scripts can throw if they will.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // networkidle can time out on pages with long-poll or persistent analytics
      // connections — that's fine, we only care about the errors surfaced so far.
    })

    expect(consoleErrors, `Unexpected console errors on ${landing.path}:\n${consoleErrors.join('\n')}`).toEqual([])
  })
}

test('BookingForm POST endpoint accepts a synthetic lead (end-to-end)', async ({ request }) => {
  const marker = `ci-smoke-${Date.now()}`
  const res = await request.post(`${BASE}/api/webhooks/website/spotless-scrubbers`, {
    data: {
      name: marker,
      phone: `+1555${String(Date.now()).slice(-7)}`,
      service_type: 'standard-cleaning',
      source: 'ci-smoke',
      utm_source: 'ci-smoke',
      utm_medium: 'playwright',
      utm_campaign: 'landing-smoke',
    },
  })

  expect(res.ok(), `POST /api/webhooks/website/spotless-scrubbers returned ${res.status()}`).toBe(true)
  const body = await res.json().catch(() => ({}))
  expect(body?.success, 'BookingForm webhook should reply { success: true }').toBe(true)
})
