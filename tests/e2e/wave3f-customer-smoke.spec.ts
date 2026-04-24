/**
 * Wave 3f — customer quote page HTTP smoke
 *
 * Confirms the server-side changes behind the new customer UX:
 *   - GET /api/public/quotes/[token] exposes card_on_file_at so the client
 *     can gate the Approve CTA.
 *   - POST /api/public/quotes/approve relaxes signature + agreement to
 *     conditional-on-plan. A one-time quote (no selected_plan_id) can be
 *     approved without a signature.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function seedQuoteWithCustomer(
  request: import('@playwright/test').APIRequestContext
): Promise<{ quoteId: string; token: string; customerId: number }> {
  // Seed a customer via the existing admin API (storageState cookie).
  const custRes = await request.post(`${BASE_URL}/api/customers`, {
    data: {
      first_name: 'Wave3f',
      last_name: `Smoke_${Date.now()}`,
      phone_number: `+1309${Math.floor(1000000 + Math.random() * 9000000)}`,
      email: `wave3f_smoke_${Date.now()}@example.test`,
      address: '404 Eastwood, Morton, IL',
    },
  })
  if (!custRes.ok()) throw new Error(`customer seed failed: ${custRes.status()}`)
  const cust = (await custRes.json()).data

  const qRes = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_id: cust.id,
      customer_name: `${cust.first_name} ${cust.last_name}`,
      customer_phone: cust.phone_number,
      customer_email: cust.email,
      customer_address: cust.address,
      line_items: [
        { service_name: 'Exterior', price: 200, optionality: 'required' },
      ],
    },
  })
  if (!qRes.ok()) throw new Error(`quote seed failed: ${qRes.status()}`)
  const q = (await qRes.json()).quote
  return { quoteId: q.id, token: q.token, customerId: cust.id }
}

test.describe('Wave 3f — public quote exposes card_on_file_at', () => {
  test('GET /api/public/quotes/[token] returns card_on_file_at (null pre-save)', async ({
    request,
  }) => {
    const { token } = await seedQuoteWithCustomer(request)
    const res = await request.get(`${BASE_URL}/api/public/quotes/${token}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.quote).toBeTruthy()
    expect('card_on_file_at' in body.quote).toBe(true)
    expect(body.quote.card_on_file_at).toBeNull()
  })
})

test.describe('Wave 3f — approve without a plan needs no signature', () => {
  test('POST /api/public/quotes/approve succeeds with no plan + no signature', async ({
    request,
  }) => {
    const { token, customerId } = await seedQuoteWithCustomer(request)

    // The approve route doesn't gate on card_on_file_at (that's client-side
    // enforcement). It just relaxes signature/agreement when no plan is
    // selected. Run the one-time-quote approval flow.
    const res = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token,
        selected_plan_id: null,
        agreement_read: false,
        signature_data: '',
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.job_id).toBeTruthy()

    // Cleanup: leave the seeded customer in place (doesn't hurt, avoids
    // cascading delete races in parallel runs).
    void customerId
  })

  test('approve with selected_plan_id still requires signature + agreement', async ({
    request,
  }) => {
    const { token, quoteId } = await seedQuoteWithCustomer(request)

    // Attach a plan offered_to_customer
    const planRes = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
      data: {
        quote_id: quoteId,
        name: 'Monthly',
        recurring_price: 99,
        offered_to_customer: true,
        first_visit_keeps_original_price: true,
      },
    })
    const planBody = await planRes.json()
    const planId = planBody.plan?.id ?? planBody.id

    // Missing signature -> 400
    const noSigRes = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token,
        selected_plan_id: planId,
        agreement_read: true,
        signature_data: '',
      },
    })
    expect(noSigRes.status()).toBe(400)

    // Missing agreement -> 400
    const noAgRes = await request.post(`${BASE_URL}/api/public/quotes/approve`, {
      data: {
        token,
        selected_plan_id: planId,
        agreement_read: false,
        signature_data: 'x'.repeat(250),
      },
    })
    expect(noAgRes.status()).toBe(400)
  })
})
