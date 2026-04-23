/**
 * Wave 3b (Round 2) — Quote builder API smoke
 *
 * Pins the GET/PATCH contract the new /quotes/[id] builder page relies on.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function createDraftQuote(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_name: 'E2E_WAVE3B_draft',
      phone_number: '+13095555556',
      line_items: [
        {
          service_name: 'E2E_WAVE3B_seed',
          price: 100,
          quantity: 1,
          optionality: 'required',
        },
      ],
    },
  })
  if (!res.ok()) {
    const err = await res.text()
    throw new Error(`quote create failed: ${res.status()} ${err}`)
  }
  const body = await res.json()
  const quoteId: string | undefined = body?.quote?.id
  if (!quoteId) throw new Error('quote create returned no id')
  return quoteId
}

test.describe('Quote builder API', () => {
  test('POST accepts optionality and persists it', async ({ request }) => {
    const id = await createDraftQuote(request)
    const detail = await request.get(`${BASE_URL}/api/actions/quotes/${id}`)
    expect(detail.ok()).toBe(true)
    const body = await detail.json()
    expect(body.quote.id).toBe(id)
    expect(Array.isArray(body.line_items)).toBe(true)
    expect(body.line_items[0]?.optionality).toBe('required')
  })

  test('GET returns 404 for non-existent quote', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/actions/quotes/00000000-0000-0000-0000-000000000000`
    )
    expect(res.status()).toBe(404)
  })

  test('PATCH replaces line items and plans atomically', async ({ request }) => {
    const id = await createDraftQuote(request)
    const res = await request.fetch(`${BASE_URL}/api/actions/quotes/${id}`, {
      method: 'PATCH',
      data: {
        customer_name: 'E2E_WAVE3B_renamed',
        original_price: 450,
        line_items: [
          { service_name: 'E2E_WAVE3B_base', price: 200, optionality: 'required' },
          { service_name: 'E2E_WAVE3B_rec', price: 80, optionality: 'recommended' },
          { service_name: 'E2E_WAVE3B_opt', price: 150, optionality: 'optional' },
        ],
        plans: [
          {
            name: 'E2E_WAVE3B_Monthly',
            recurring_price: 99,
            offered_to_customer: true,
            first_visit_keeps_original_price: true,
          },
        ],
      },
    })
    if (!res.ok()) {
      const err = await res.text()
      throw new Error(`PATCH failed: ${res.status()} ${err}`)
    }
    const body = await res.json()
    expect(body.quote.customer_name).toBe('E2E_WAVE3B_renamed')
    expect(Number(body.quote.original_price)).toBe(450)
    expect(body.line_items.length).toBe(3)
    const optionalities = body.line_items.map((li: { optionality: string }) => li.optionality).sort()
    expect(optionalities).toEqual(['optional', 'recommended', 'required'])
    expect(body.plans.length).toBe(1)
    expect(body.plans[0].offered_to_customer).toBe(true)
    // commission_rule default applied
    expect(body.plans[0].commission_rule?.salesman_first_visit).toBe(true)
  })

  test('PATCH rejects writes to converted quote', async ({ request }) => {
    const id = await createDraftQuote(request)
    // Force the status to converted via a PATCH first.
    await request.fetch(`${BASE_URL}/api/actions/quotes/${id}`, {
      method: 'PATCH',
      data: { status: 'converted' },
    })
    const res = await request.fetch(`${BASE_URL}/api/actions/quotes/${id}`, {
      method: 'PATCH',
      data: { customer_name: 'E2E_WAVE3B_blocked' },
    })
    expect(res.status()).toBe(409)
  })

  test('PATCH cross-tenant quote id returns 404', async ({ request }) => {
    const res = await request.fetch(
      `${BASE_URL}/api/actions/quotes/00000000-0000-0000-0000-000000000000`,
      { method: 'PATCH', data: { customer_name: 'fail' } }
    )
    expect(res.status()).toBe(404)
  })
})
