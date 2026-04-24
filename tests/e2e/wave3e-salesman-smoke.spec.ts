/**
 * Wave 3e — Salesman flow HTTP smoke
 *
 * Confirms the attribution + availability plumbing behind the salesman
 * portal: draft creation stamps quote.salesman_id, PATCH derives is_upsell
 * from optionality, and the two new token endpoints return the expected
 * shape.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'
const SALESMAN_TOKEN = '5f6b3902-6851-4581-a211-2333c0b79ed8'
const SALESMAN_ID = 134

test.describe('Wave 3e — quote attribution', () => {
  test('POST /api/crew/[salesman_token]/quote-draft stamps salesman_id', async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/quote-draft`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.quoteId).toBeTruthy()

    // Hydrate the new quote and verify salesman_id was set.
    const qRes = await request.get(
      `${BASE_URL}/api/actions/quotes/${body.quoteId}`
    )
    expect(qRes.ok()).toBe(true)
    const q = await qRes.json()
    expect(q.quote.salesman_id).toBe(SALESMAN_ID)
  })

  test('PATCH /api/actions/quotes/[id] auto-derives is_upsell from optionality', async ({
    request,
  }) => {
    // Create a draft as the salesman so we have a quote to mutate.
    const draftRes = await request.post(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/quote-draft`
    )
    const { quoteId } = await draftRes.json()

    // Send three line items, each with a different optionality AND a WRONG
    // is_upsell value. The server must correct is_upsell to match the rule
    // (optionality !== 'required').
    const patchRes = await request.fetch(
      `${BASE_URL}/api/actions/quotes/${quoteId}`,
      {
        method: 'PATCH',
        data: {
          line_items: [
            {
              service_name: 'Exterior window',
              price: 100,
              optionality: 'required',
              is_upsell: true, // wrong — server should flip to false
            },
            {
              service_name: 'Deck cleaning',
              price: 175,
              optionality: 'recommended',
              is_upsell: false, // wrong — server should flip to true
            },
            {
              service_name: 'Discount',
              price: -50,
              optionality: 'optional',
              is_upsell: false, // wrong — server should flip to true
            },
          ],
        },
      }
    )
    expect(patchRes.ok()).toBe(true)

    const check = await request.get(
      `${BASE_URL}/api/actions/quotes/${quoteId}`
    )
    const body = await check.json()
    const byName: Record<string, { is_upsell: boolean; optionality: string }> =
      {}
    for (const li of body.line_items) {
      byName[li.service_name] = {
        is_upsell: !!li.is_upsell,
        optionality: li.optionality,
      }
    }
    expect(byName['Exterior window'].is_upsell).toBe(false)
    expect(byName['Deck cleaning'].is_upsell).toBe(true)
    expect(byName['Discount'].is_upsell).toBe(true)
  })
})

test.describe('Wave 3e — door-knock availability', () => {
  test('GET /api/crew/[salesman_token]/availability?days=14 returns 14 day buckets', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/availability?days=14`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBe(14)
    for (const row of body.data) {
      expect(typeof row.date).toBe('string')
      expect(typeof row.count).toBe('number')
      expect(row.count).toBeGreaterThanOrEqual(0)
    }
  })

  test('GET availability clamps days param to 30', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/availability?days=9999`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.data.length).toBe(30)
  })

  test('GET availability rejects invalid token', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/crew/not-a-real-token/availability`
    )
    expect(res.status()).toBe(404)
  })
})

test.describe('Wave 3e — commission summary', () => {
  test('GET /api/crew/[salesman_token]/commission-summary returns bucket totals', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/crew/${SALESMAN_TOKEN}/commission-summary`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.revenue).toBeTruthy()
    expect(typeof body.data.revenue.onetime).toBe('number')
    expect(typeof body.data.revenue.triannual).toBe('number')
    expect(typeof body.data.revenue.quarterly).toBe('number')
    expect(typeof body.data.total_pay).toBe('number')
    expect(body.data.range.start).toBeTruthy()
    expect(body.data.range.end).toBeTruthy()
  })
})
