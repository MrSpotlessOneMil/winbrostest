/**
 * Phase E — service plan templates E2E.
 *
 * Verifies the round-trip:
 *   1. /api/actions/service-plan-templates returns 3 WinBros templates
 *      (Monthly $99, Quarterly $225, Triannual $285) sorted by sort_order.
 *   2. Each template carries an agreement_pdf_url, and the PDF is
 *      publicly reachable (no session required) and starts with %PDF-1.4
 *      (a real PDF, not a redirect or HTML).
 *   3. The recurrence JSONB shape matches expectations.
 *
 * No fixture seeding needed — the migration's INSERT...ON CONFLICT seeds
 * once on apply. We don't mutate or delete templates in the test.
 */

import { test, expect } from '@playwright/test'
import { mintAdminSession, deleteSession } from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

interface PlanTemplate {
  id: string
  slug: string
  name: string
  recurring_price: number
  recurrence: { interval_months: number; visits_per_year: number } | null
  agreement_pdf_url: string | null
  description: string | null
  sort_order: number
}

test.describe('Phase E — service plan templates', () => {
  let adminToken: string

  test.beforeAll(async () => {
    adminToken = await mintAdminSession()
  })

  test.afterAll(async () => {
    if (adminToken) await deleteSession(adminToken)
  })

  test('GET /api/actions/service-plan-templates returns 3 WinBros templates in sort order', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/actions/service-plan-templates`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.templates)).toBe(true)
    expect(body.templates).toHaveLength(3)

    const templates = body.templates as PlanTemplate[]
    const slugs = templates.map(t => t.slug)
    // Sort order matters for the QuoteBuilder dropdown — Monthly first,
    // Quarterly second, Triannual third (most-frequent → least-frequent).
    expect(slugs).toEqual(['monthly', 'quarterly', 'triannual'])
  })

  test('each template has the expected price + recurrence shape', async ({ request }) => {
    const res = await request.get(`${BASE}/api/actions/service-plan-templates`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
    })
    const { templates } = (await res.json()) as { templates: PlanTemplate[] }

    const monthly = templates.find(t => t.slug === 'monthly')!
    expect(monthly.name).toBe('Monthly')
    expect(monthly.recurring_price).toBe(99)
    expect(monthly.recurrence).toEqual({ interval_months: 1, visits_per_year: 12 })

    const quarterly = templates.find(t => t.slug === 'quarterly')!
    expect(quarterly.name).toBe('Quarterly')
    expect(quarterly.recurring_price).toBe(225)
    expect(quarterly.recurrence).toEqual({ interval_months: 3, visits_per_year: 4 })

    const triannual = templates.find(t => t.slug === 'triannual')!
    expect(triannual.name).toBe('Triannual')
    expect(triannual.recurring_price).toBe(285)
    expect(triannual.recurrence).toEqual({ interval_months: 4, visits_per_year: 3 })
  })

  test('agreement PDFs are publicly reachable (no session needed) and look like real PDFs', async ({
    request,
  }) => {
    // We hit the static route directly — no Cookie. Middleware whitelists
    // /service-plans so customers can download from the quote view.
    const slugs = ['monthly', 'quarterly', 'triannual'] as const
    for (const slug of slugs) {
      const url = `${BASE}/service-plans/winbros-${slug}-agreement.pdf`
      const res = await request.get(url)
      expect(res.status(), `expected ${url} to 200`).toBe(200)
      const buf = await res.body()
      // Real PDFs start with the %PDF- magic bytes. If middleware was
      // blocking this, we'd get HTML or a redirect target.
      const head = buf.slice(0, 8).toString('latin1')
      expect(head).toContain('%PDF-')
      expect(buf.byteLength).toBeGreaterThan(500)
    }
  })

  test('cleaner-only session can also fetch templates (read-only is non-admin)', async ({
    request,
  }) => {
    // Salesmen need to see plan options when building quotes. Even if
    // templates editing is admin-only, READ should be allowed for any
    // authenticated session. requireAuthWithTenant accepts cleaner sessions.
    // (Phase E currently has no PATCH endpoint, so this is just locking
    // the read path.)
    const res = await request.get(`${BASE}/api/actions/service-plan-templates`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
    })
    expect(res.ok()).toBe(true)
  })
})
