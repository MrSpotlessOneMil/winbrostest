/**
 * Wave 3c (Round 2) — Public customer approve API smoke
 *
 * Exercises the token-gated endpoints at /api/public/quotes/*. These tests
 * seed a draft quote via the admin API (cached cookie) then hit the public
 * endpoints with no session — those must respond based on token alone.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function seedDraftQuote(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_name: 'E2E_WAVE3C_customer',
      customer_phone: '+13097777777',
      customer_email: `e2e_wave3c_${Date.now()}@example.test`,
      line_items: [
        { service_name: 'E2E_WAVE3C_base', price: 200, quantity: 1, optionality: 'required' },
        { service_name: 'E2E_WAVE3C_rec', price: 80, quantity: 1, optionality: 'recommended' },
        { service_name: 'E2E_WAVE3C_opt', price: 150, quantity: 1, optionality: 'optional' },
      ],
    },
  })
  if (!res.ok()) throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  const body = await res.json()
  const quoteId: string = body.quote.id
  const token: string = body.quote.token

  // Attach a plan via plans API so /approve can exercise plan selection.
  await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
    data: {
      quote_id: quoteId,
      name: 'E2E_WAVE3C_Monthly',
      recurring_price: 99,
      offered_to_customer: true,
      first_visit_keeps_original_price: true,
    },
  })
  // Flip to 'sent' so the approve guard lets it through.
  await request.fetch(`${BASE_URL}/api/actions/quotes/${quoteId}`, {
    method: 'PATCH',
    data: { status: 'sent' },
  })
  return { quoteId, token }
}

test.describe('Public quote endpoint', () => {
  test('GET /api/public/quotes/:token returns line_items + offered plans', async ({ request }) => {
    const { token } = await seedDraftQuote(request)
    // Use a fresh request context so no admin cookies leak in.
    const res = await request.get(`${BASE_URL}/api/public/quotes/${token}`, {
      headers: { cookie: '' },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.quote?.token).toBe(token)
    expect(Array.isArray(body.line_items)).toBe(true)
    expect(body.line_items.length).toBe(3)
    expect(body.plans.every((p: { offered_to_customer: boolean }) => p.offered_to_customer)).toBe(
      true
    )
    expect(body.tenant?.name).toBeTruthy()
  })

  test('GET returns 404 for unknown token', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/public/quotes/${'x'.repeat(40)}`,
      { headers: { cookie: '' } }
    )
    expect(res.status()).toBe(404)
  })

  test('GET returns 400 for short token', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/public/quotes/short`, {
      headers: { cookie: '' },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('Public approve endpoint — validation', () => {
  test('rejects missing token', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: { agreement_read: true, signature_data: 'data:image/png;base64,' + 'A'.repeat(400) },
      headers: { cookie: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects missing signature (when a plan is selected)', async ({ request }) => {
    // Wave 3f: signature is only gated when selected_plan_id is present.
    // Include selected_plan_id so this still exercises the signature gate.
    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token: 'x'.repeat(40),
        selected_plan_id: 1,
        agreement_read: true,
        signature_data: '',
      },
      headers: { cookie: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects agreement_read=false (when a plan is selected)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token: 'x'.repeat(40),
        selected_plan_id: 1,
        agreement_read: false,
        signature_data: 'data:image/png;base64,' + 'A'.repeat(400),
      },
      headers: { cookie: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects unknown token as 404', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token: 'x'.repeat(40),
        agreement_read: true,
        signature_data: 'data:image/png;base64,' + 'A'.repeat(400),
      },
      headers: { cookie: '' },
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('Public approve endpoint — successful approval', () => {
  test('signs + converts a draft quote', async ({ request }) => {
    const { quoteId, token } = await seedDraftQuote(request)
    // Plan id from the admin GET (still admin-auth here; we need it to test plan selection).
    const detail = await request.get(`${BASE_URL}/api/actions/quotes/${quoteId}`)
    expect(detail.ok()).toBe(true)
    const detailBody = await detail.json()
    const planId: number | undefined = detailBody.plans?.[0]?.id

    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token,
        selected_plan_id: planId ?? null,
        agreement_read: true,
        signature_data: 'data:image/png;base64,' + 'A'.repeat(400),
        opted_in_optional_ids: [],
        opted_out_recommended_ids: [],
      },
      headers: { cookie: '' },
    })
    if (!res.ok()) {
      const body = await res.text()
      throw new Error(`approve failed: ${res.status()} ${body}`)
    }
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.job_id).toBeTruthy()

    // Second approval should 409 because the quote is already converted.
    const repeat = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token,
        agreement_read: true,
        signature_data: 'data:image/png;base64,' + 'A'.repeat(400),
      },
      headers: { cookie: '' },
    })
    expect(repeat.status()).toBe(409)
  })
})
