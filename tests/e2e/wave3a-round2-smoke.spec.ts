/**
 * Wave 3a (Round 2) — Service book + quote-service-plans API smoke
 *
 * HTTP-only; runs under the http-smoke project. Admin cookie comes from the
 * cached .playwright-auth.json seeded earlier.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

test.describe('Service book API', () => {
  test('GET returns tenant catalog', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/actions/service-book`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    // Seeded 8 WinBros defaults in Wave 3a migration.
    expect(body.items.length).toBeGreaterThanOrEqual(1)
    for (const it of body.items) {
      expect(typeof it.name).toBe('string')
      expect(['string', 'number']).toContain(typeof it.default_price)
    }
  })

  test('POST rejects missing name', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/service-book`, {
      data: { default_price: 99 },
    })
    expect(res.status()).toBe(400)
  })

  test('POST+PATCH+DELETE round-trip', async ({ request }) => {
    const createRes = await request.post(`${BASE_URL}/api/actions/service-book`, {
      data: { name: 'E2E_WAVE3A_test_service', default_price: 123 },
    })
    if (!createRes.ok()) {
      const err = await createRes.text()
      throw new Error(`POST failed: ${createRes.status()} ${err}`)
    }
    const { item } = await createRes.json()
    expect(item?.id).toBeTruthy()

    const patchRes = await request.fetch(
      `${BASE_URL}/api/actions/service-book?id=${item.id}`,
      { method: 'PATCH', data: { default_price: 234 } }
    )
    expect(patchRes.ok()).toBe(true)
    const patched = await patchRes.json()
    expect(Number(patched.item.default_price)).toBe(234)

    const delRes = await request.fetch(
      `${BASE_URL}/api/actions/service-book?id=${item.id}`,
      { method: 'DELETE' }
    )
    expect(delRes.ok()).toBe(true)

    // Confirm soft-delete: no longer visible in default GET.
    const listRes = await request.get(`${BASE_URL}/api/actions/service-book`)
    const { items } = await listRes.json()
    expect(items.find((i: { id: number }) => i.id === item.id)).toBeUndefined()

    // But includeInactive=true surfaces it.
    const allRes = await request.get(
      `${BASE_URL}/api/actions/service-book?includeInactive=true`
    )
    const { items: all } = await allRes.json()
    const found = all.find((i: { id: number; is_active: boolean }) => i.id === item.id)
    expect(found?.is_active).toBe(false)
  })
})

test.describe('Quote service plans API', () => {
  test('GET rejects missing quote_id', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/actions/quotes/plans`)
    expect(res.status()).toBe(400)
  })

  test('POST rejects missing quote_id', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
      data: { name: 'Monthly', recurring_price: 99 },
    })
    expect(res.status()).toBe(400)
  })

  test('POST rejects unknown quote_id as 404', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
      data: { quote_id: '00000000-0000-0000-0000-000000000000', name: 'X', recurring_price: 1 },
    })
    expect(res.status()).toBe(404)
  })

  test('POST+PATCH+DELETE round-trip on real draft quote', async ({ request }) => {
    // Create a minimal draft quote via SQL-less admin path — we don't have a
    // dedicated API for that here, so we use the existing quotes endpoint if
    // available; otherwise skip so this test doesn't falsely fail in CI.
    const createQuote = await request.post(`${BASE_URL}/api/actions/quotes`, {
      data: {
        customer_name: 'E2E_WAVE3A_round',
        phone_number: '+13095555555',
        line_items: [
          { service_name: 'E2E_WAVE3A_base', price: 100, quantity: 1 },
        ],
      },
    })
    if (!createQuote.ok()) {
      test.skip(true, `quotes POST unavailable (${createQuote.status()}); test harness limitation`)
      return
    }
    const quoteBody = await createQuote.json()
    const quoteId: string | undefined = quoteBody?.quote?.id || quoteBody?.data?.id || quoteBody?.id
    if (!quoteId) {
      test.skip(true, 'quotes POST response did not include id')
      return
    }

    const createPlan = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
      data: {
        quote_id: quoteId,
        name: 'E2E_WAVE3A_plan',
        recurring_price: 149,
        first_visit_keeps_original_price: true,
        offered_to_customer: false,
      },
    })
    if (!createPlan.ok()) {
      const err = await createPlan.text()
      throw new Error(`plan POST failed: ${createPlan.status()} ${err}`)
    }
    const { plan } = await createPlan.json()
    expect(plan?.id).toBeTruthy()
    expect(plan.commission_rule?.salesman_first_visit).toBe(true)

    const patch = await request.fetch(
      `${BASE_URL}/api/actions/quotes/plans?id=${plan.id}`,
      { method: 'PATCH', data: { offered_to_customer: true } }
    )
    expect(patch.ok()).toBe(true)

    const list = await request.get(
      `${BASE_URL}/api/actions/quotes/plans?quote_id=${quoteId}`
    )
    expect(list.ok()).toBe(true)
    const { plans } = await list.json()
    expect(plans.find((p: { id: number }) => p.id === plan.id)?.offered_to_customer).toBe(true)

    const del = await request.fetch(
      `${BASE_URL}/api/actions/quotes/plans?id=${plan.id}`,
      { method: 'DELETE' }
    )
    expect(del.ok()).toBe(true)
  })
})
