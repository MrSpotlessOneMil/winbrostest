/**
 * Wave 3d (Round 2) — Customer picker + quote builder + appointment flow
 *
 * HTTP-smoke level: pins the server contract behind the new picker modal
 * and the Customers-tab "Create Quote" rerouting.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

test.describe('Wave 3d — customer API for picker', () => {
  test('GET /api/actions/customer-search returns a list for the picker', async ({
    request,
  }) => {
    const res = await request.get(`${BASE_URL}/api/actions/customer-search`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('GET /api/actions/customer-search?search=<phrase> narrows results', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE_URL}/api/actions/customer-search?search=Max`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('POST /api/customers rejects missing phone', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/customers`, {
      data: { first_name: 'no phone test' },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('Wave 3d — builder accepts customer_id on PATCH', () => {
  test('quote PATCH persists customer_id and dependent fields', async ({ request }) => {
    // Seed a new customer via the public customers API.
    const unique = `e2e_wave3d_${Date.now()}`
    const customerRes = await request.post(`${BASE_URL}/api/customers`, {
      data: {
        first_name: 'E2E',
        last_name: 'WAVE3D',
        phone_number: `+1309${Math.floor(1000000 + Math.random() * 9000000)}`,
        email: `${unique}@example.test`,
        address: '404 Eastwood, Morton, IL',
      },
    })
    if (!customerRes.ok()) {
      const err = await customerRes.text()
      throw new Error(`customer seed failed: ${customerRes.status()} ${err}`)
    }
    const { data: customer } = await customerRes.json()

    // Create a blank draft quote.
    const draftRes = await request.post(`${BASE_URL}/api/actions/quotes`, {
      data: {
        customer_name: 'Placeholder',
        line_items: [{ service_name: 'x', price: 1 }],
      },
    })
    if (!draftRes.ok()) {
      throw new Error(`draft create failed: ${draftRes.status()} ${await draftRes.text()}`)
    }
    const { quote } = await draftRes.json()

    // Attach the customer via the builder PATCH.
    const patchRes = await request.fetch(
      `${BASE_URL}/api/actions/quotes/${quote.id}`,
      {
        method: 'PATCH',
        data: {
          customer_id: customer.id,
          customer_name: `${customer.first_name} ${customer.last_name}`,
          customer_phone: customer.phone_number,
          customer_email: customer.email,
          customer_address: customer.address,
        },
      }
    )
    expect(patchRes.ok()).toBe(true)
    const body = await patchRes.json()
    expect(body.quote.customer_id).toBe(customer.id)
    expect(body.quote.customer_address).toBe('404 Eastwood, Morton, IL')
  })
})

test.describe('Wave 3d — appointments POST accepts customer_id', () => {
  test('creates appointment tied to a real customer id', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10)
    const end = new Date(Date.now() + 2 * 3600000).toISOString()

    // Grab (or create) a customer to attach.
    const unique = `e2e_wave3d_appt_${Date.now()}`
    const customerRes = await request.post(`${BASE_URL}/api/customers`, {
      data: {
        first_name: 'Apt',
        last_name: 'Test',
        phone_number: `+1309${Math.floor(1000000 + Math.random() * 9000000)}`,
        email: `${unique}@example.test`,
        address: '123 Appointment St',
      },
    })
    if (!customerRes.ok()) {
      throw new Error(`customer seed failed: ${customerRes.status()}`)
    }
    const { data: customer } = await customerRes.json()

    const res = await request.post(`${BASE_URL}/api/actions/appointments`, {
      data: {
        date: today,
        scheduled_at: '10:00',
        end_time: end,
        customer_id: customer.id,
        phone_number: customer.phone_number,
        address: customer.address,
        service_type: 'Window Cleaning',
      },
    })
    if (!res.ok()) {
      throw new Error(`appointment POST failed: ${res.status()} ${await res.text()}`)
    }
    const body = await res.json()
    expect(body.appointment?.id).toBeTruthy()
    expect(body.appointment.customer_id).toBe(customer.id)
    expect(body.appointment.address).toBe('123 Appointment St')
  })
})
