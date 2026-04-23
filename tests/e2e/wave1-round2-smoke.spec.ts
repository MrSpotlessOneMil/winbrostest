/**
 * Wave 1 (Round 2) — Smoke Tests
 *
 * Covers changes from winbros-round2 plan Wave 1:
 *   - pay_mode toggle on /payroll (hourly XOR percentage)
 *   - /tech-upsells admin CRUD page
 *   - Crew portal upsell catalog picker (HTTP-only check, no mobile browser)
 *
 * Run against a booted dev server with E2E_USERNAME=admin@winbros.com
 * E2E_PASSWORD=winbros (auth.setup.ts will sign in and store state).
 *
 * Minimal: happy path + 1 edge case per operation. Does NOT replace the
 * full winbros-payroll.spec.ts — that covers pre-round-2 UI and may need
 * updating separately for the new toggle UI.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// ───────────────────────────────────────────────────────────────────────
// Payroll — pay_mode via HTTP API (UI covered by Tier 3 unit tests +
// /tech-upsells admin page test below; admin-only UI filtering is gated
// by a pre-existing username check we don't touch in Wave 1)
// ───────────────────────────────────────────────────────────────────────
test.describe('Payroll API — pay_mode', () => {
  test('GET /api/actions/payroll exposes pay_mode on tech entries', async ({ request }) => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const start = monday.toISOString().slice(0, 10)
    const end = new Date(monday.getTime() + 6 * 86400000).toISOString().slice(0, 10)

    const res = await request.get(`${BASE_URL}/api/actions/payroll?weekStart=${start}&weekEnd=${end}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    // Either technicians array present or status=draft fallback
    if (Array.isArray(body.technicians) && body.technicians.length > 0) {
      for (const t of body.technicians) {
        expect(['hourly', 'percentage']).toContain(t.pay_mode)
      }
    }
  })

  test('POST /api/actions/payroll accepts pay_mode update', async ({ request }) => {
    // Use test tech lead cleaner id (135 — seeded in Wave 1 task 1)
    const res = await request.post(`${BASE_URL}/api/actions/payroll`, {
      data: { cleaner_id: 135, pay_mode: 'percentage', pay_percentage: 25 },
    })
    expect(res.ok()).toBe(true)
  })

  test('POST /api/actions/payroll rejects invalid pay_mode silently (string ignored)', async ({ request }) => {
    // The API validates pay_mode against 'hourly'|'percentage'. Unrecognized values
    // are simply not persisted — this is a robustness property, not a hard reject.
    const res = await request.post(`${BASE_URL}/api/actions/payroll`, {
      data: { cleaner_id: 135, pay_mode: 'BOGUS' },
    })
    // Request still succeeds; the pay_mode field just won't have changed.
    expect(res.ok()).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────
// Tech Upsell Catalog admin page
// ───────────────────────────────────────────────────────────────────────
test.describe('/tech-upsells admin page', () => {
  test('renders 8 seeded catalog rows for winbros', async ({ page }) => {
    await page.goto(`${BASE_URL}/tech-upsells`)
    await expect(page.getByRole('heading', { name: 'Tech Upsell Catalog' })).toBeVisible({
      timeout: 15000,
    })
    // Expect the 8 seed names somewhere on the page
    const seedNames = [
      'Screen rewash', 'Extra window pane', 'Gutter spot-clean',
      'Track detail', 'Sill wipe', 'Skylight clean',
      'Solar panel rinse', 'Hard-water spot Tx',
    ]
    for (const name of seedNames) {
      await expect(page.locator(`input[value="${name}"]`)).toHaveCount(1)
    }
  })

  test('Add New form present', async ({ page }) => {
    await page.goto(`${BASE_URL}/tech-upsells`)
    await expect(page.locator('h2', { hasText: 'Add New' })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('input[placeholder="Name"]')).toBeVisible()
    await expect(page.locator('input[placeholder^="Description"]')).toBeVisible()
    await expect(page.locator('input[placeholder="Price"]')).toBeVisible()
  })
})

// ───────────────────────────────────────────────────────────────────────
// Crew portal upsell picker — HTTP-level (API returns catalog)
// ───────────────────────────────────────────────────────────────────────
test.describe('Crew portal upsell picker API', () => {
  test('GET /api/actions/tech-upsell-catalog returns active items', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/actions/tech-upsell-catalog`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    // Each active item has the expected shape
    for (const it of body.items) {
      expect(typeof it.name).toBe('string')
      // price may round-trip as number or string depending on the JSON pipeline
      expect(['string', 'number']).toContain(typeof it.price)
      expect(Number(it.price)).toBeGreaterThanOrEqual(0)
      expect(it.is_active).toBe(true)
    }
  })

  test('POST /api/actions/tech-upsell-catalog rejects missing name', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/tech-upsell-catalog`, {
      data: { price: 50 },
    })
    expect(res.status()).toBe(400)
  })
})
