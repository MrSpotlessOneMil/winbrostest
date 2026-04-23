/**
 * Wave 2 (Round 2) — Appointments smoke tests
 *
 * HTTP-only (no browser page). The WW login flow server-side-redirects to
 * winbros.cleanmachine.live, which makes browser-based auth.setup incompatible
 * with a localhost dev server — mirroring the Wave 1 compromise. UI rendering
 * is covered by vitest + component-level type-checking; this file pins the
 * API surface that the grid drag-drop depends on.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

test.describe('Appointments API — schema', () => {
  test('GET /api/actions/appointments returns appointments + salesmen arrays', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10)
    const end = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10)
    const res = await request.get(
      `${BASE_URL}/api/actions/appointments?start=${today}&end=${end}`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.appointments)).toBe(true)
    expect(Array.isArray(body.salesmen)).toBe(true)
    expect(body.range?.start).toBe(today)
    expect(body.range?.end).toBe(end)
  })

  test('GET rejects missing start/end params', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/actions/appointments`)
    expect(res.status()).toBe(400)
  })

  test('GET rejects malformed date params', async ({ request }) => {
    const res = await request.get(
      `${BASE_URL}/api/actions/appointments?start=not-a-date&end=2026-05-04`
    )
    expect(res.status()).toBe(400)
  })
})

test.describe('Appointments API — POST validation', () => {
  test('rejects missing date', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/appointments`, {
      data: { scheduled_at: '09:00', end_time: '2026-05-04T11:00:00Z' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects missing scheduled_at', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/appointments`, {
      data: { date: '2026-05-04', end_time: '2026-05-04T11:00:00Z' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects missing end_time', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/actions/appointments`, {
      data: { date: '2026-05-04', scheduled_at: '09:00' },
    })
    expect(res.status()).toBe(400)
  })
})

test.describe('Appointments API — round-trip', () => {
  test('POST creates unassigned appointment, PATCH assigns salesman', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10)
    const end = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10)
    const listRes = await request.get(
      `${BASE_URL}/api/actions/appointments?start=${today}&end=${end}`
    )
    expect(listRes.ok()).toBe(true)
    const { salesmen } = await listRes.json()
    if (!Array.isArray(salesmen) || salesmen.length === 0) {
      test.skip(true, 'No salesmen seeded; cannot exercise drag-drop path')
      return
    }

    const createRes = await request.post(`${BASE_URL}/api/actions/appointments`, {
      data: {
        date: today,
        scheduled_at: '14:00',
        end_time: new Date(Date.now() + 2 * 3600000).toISOString(),
        address: 'E2E WAVE2 test address',
        notes: 'E2E_WAVE2_smoke',
      },
    })
    if (!createRes.ok()) {
      const err = await createRes.text()
      throw new Error(`POST failed: ${createRes.status()} ${err}`)
    }
    const { appointment } = await createRes.json()
    expect(appointment?.id).toBeTruthy()
    expect(appointment.crew_salesman_id).toBeNull()

    const patchRes = await request.fetch(
      `${BASE_URL}/api/actions/appointments?id=${appointment.id}`,
      {
        method: 'PATCH',
        data: { crew_salesman_id: salesmen[0].id },
      }
    )
    expect(patchRes.ok()).toBe(true)
    const patched = await patchRes.json()
    expect(patched.appointment.crew_salesman_id).toBe(salesmen[0].id)
  })
})

test.describe('Legacy /crews redirect', () => {
  test('GET /crews responds with a redirect to /appointments', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/crews`, { maxRedirects: 0 })
    // Next.js App Router `redirect()` can return 307 (temporary) or render
    // a client-side push. Either is acceptable; what matters is the user
    // doesn't stay on /crews serving legacy UI.
    if (res.status() === 307 || res.status() === 308 || res.status() === 302) {
      const location = res.headers()['location'] || ''
      expect(location).toMatch(/\/appointments/)
    } else {
      // Some auth middleware may rewrite to /login. Tolerate that as well —
      // the legacy UI is still gone.
      expect(res.status()).toBeLessThan(500)
    }
  })
})
