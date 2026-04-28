/**
 * Tier 1 — Currency isolation (T1.18)
 *
 * West Niagara is the lone CAD tenant in the Osiris stack — every other
 * tenant is USD. The /quote/[token] public endpoint returns the tenant
 * currency so the customer page renders the right symbol.
 *
 * Verifies:
 *   1. WinBros (USD) quote → currency 'usd'
 *   2. West Niagara (CAD) quote → currency 'cad'
 *   3. Spotless / Cedar / Texas Nova (USD) quotes → currency 'usd'
 *   4. Cross-checks NO tenant accidentally returns the wrong currency
 *      from a stale defaulting bug.
 *
 * Runs through the same dev server (port 3002) since the route exists in
 * apps/window-washing — but the /api/quotes/[token] route is shared via
 * the monorepo so it serves any tenant.
 */

import { test, expect } from '@playwright/test'
import { supabaseRest, rawDelete } from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

const TENANTS = {
  winbros: { id: 'e954fbd6-b3e1-4271-88b0-341c9df56beb', expected: 'usd' },
  spotless: { id: '2d6c05fc-ee61-4e5e-bd2e-02e0d845f9df', expected: 'usd' },
  cedar: { id: '583eee3f-fc92-431b-b555-8f0ea5fe42c7', expected: 'usd' },
  westNiagara: { id: 'bf74b185-b731-4ecf-b4ce-ff81d90b8fb7', expected: 'cad' },
  texasNova: { id: '617d0f83-dede-46b3-b1fb-298b59517046', expected: 'usd' },
} as const

interface QuoteRow { id: string; token: string }

async function seedQuote(tenantId: string, label: string): Promise<QuoteRow> {
  const inserted = await supabaseRest<QuoteRow[]>('quotes', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: tenantId,
      token: `currency-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'pending',
      customer_name: `Currency Test (${label})`,
      bedrooms: 3,
      bathrooms: 2,
      square_footage: 1800,
    }),
  })
  return inserted[0]
}

test.describe('Tier 1 — currency isolation per tenant', () => {
  const seeded: QuoteRow[] = []

  test.afterAll(async () => {
    for (const q of seeded) {
      await rawDelete(`quotes?id=eq.${q.id}`).catch(() => {})
    }
  })

  for (const [label, { id: tenantId, expected }] of Object.entries(TENANTS)) {
    test(`${label} → currency '${expected}'`, async ({ request }) => {
      const quote = await seedQuote(tenantId, label)
      seeded.push(quote)

      const res = await request.get(`${BASE}/api/quotes/${quote.token}`)
      expect(res.ok(), `quote endpoint should respond OK`).toBe(true)
      const json = await res.json()
      expect(json.success).toBe(true)

      const currency = String(json?.tenant?.currency || '').toLowerCase()
      expect(currency, `${label} should return currency '${expected}'`).toBe(expected)
    })
  }

  test('CAD tenant does NOT default to USD', async ({ request }) => {
    const quote = await seedQuote(TENANTS.westNiagara.id, 'wn-double-check')
    seeded.push(quote)
    const res = await request.get(`${BASE}/api/quotes/${quote.token}`)
    const json = await res.json()
    expect(String(json?.tenant?.currency).toLowerCase()).not.toBe('usd')
    expect(String(json?.tenant?.currency).toLowerCase()).toBe('cad')
  })
})
