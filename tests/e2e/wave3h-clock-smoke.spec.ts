/**
 * Wave 3h — clock-in/out HTTP smoke.
 *
 * Pins the state machine on the server side: in → pause → resume → out
 * cycles cleanly, illegal transitions return 400, salesman is rejected.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

// Seeded portal tokens (same as wave3e-salesman-smoke.spec.ts).
const TECHLEAD_TOKEN = '8cd7b9a1-3528-4d82-8b65-4152cc723dac'
const TECHNICIAN_TOKEN = '0f26a1f5dd309560a85c6ed64defe74c'
const SALESMAN_TOKEN = '5f6b3902-6851-4581-a211-2333c0b79ed8'

async function clockOutIfOpen(
  request: import('@playwright/test').APIRequestContext,
  token: string
) {
  const get = await request.get(`${BASE_URL}/api/crew/${token}/clock`)
  if (!get.ok()) return
  const body = await get.json()
  if (body.snapshot?.state && body.snapshot.state !== 'off_clock') {
    await request.post(`${BASE_URL}/api/crew/${token}/clock`, { data: { action: 'out' } })
  }
}

// Serial: every test mutates the same TECHLEAD/TECHNICIAN open-shift
// state (DB partial unique index = at most one open entry per cleaner),
// so parallel workers race the cleanup. http-smoke runs all spec files
// in parallel; this just serializes within wave3h.
test.describe.serial('Wave 3h — clock state machine', () => {
  test.beforeEach(async ({ request }) => {
    await clockOutIfOpen(request, TECHLEAD_TOKEN)
    await clockOutIfOpen(request, TECHNICIAN_TOKEN)
  })

  test('GET on a fresh shift returns off_clock + week_hours', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.snapshot.state).toBe('off_clock')
    expect(typeof body.week_hours).toBe('number')
    expect(Array.isArray(body.today)).toBe(true)
  })

  test('happy path: in → pause → resume → out', async ({ request }) => {
    const inRes = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'in' },
    })
    expect(inRes.ok()).toBe(true)
    expect((await inRes.json()).snapshot.state).toBe('on_clock')

    const pauseRes = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'pause' },
    })
    expect(pauseRes.ok()).toBe(true)
    expect((await pauseRes.json()).snapshot.state).toBe('paused')

    const resumeRes = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'resume' },
    })
    expect(resumeRes.ok()).toBe(true)
    expect((await resumeRes.json()).snapshot.state).toBe('on_clock')

    const outRes = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'out' },
    })
    expect(outRes.ok()).toBe(true)
    const outBody = await outRes.json()
    expect(outBody.snapshot.state).toBe('off_clock')
    expect(outBody.entry?.clock_out_at).toBeTruthy()
  })

  test('illegal transition: pause when off_clock returns 400', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'pause' },
    })
    expect(res.status()).toBe(400)
  })

  test('illegal transition: clock in twice returns 400', async ({ request }) => {
    const first = await request.post(`${BASE_URL}/api/crew/${TECHNICIAN_TOKEN}/clock`, {
      data: { action: 'in' },
    })
    expect(first.ok()).toBe(true)
    const second = await request.post(`${BASE_URL}/api/crew/${TECHNICIAN_TOKEN}/clock`, {
      data: { action: 'in' },
    })
    expect(second.status()).toBe(400)
    // Cleanup so the next test sees off_clock.
    await request.post(`${BASE_URL}/api/crew/${TECHNICIAN_TOKEN}/clock`, {
      data: { action: 'out' },
    })
  })

  test('salesman is rejected with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/crew/${SALESMAN_TOKEN}/clock`)
    expect(res.status()).toBe(403)

    const post = await request.post(`${BASE_URL}/api/crew/${SALESMAN_TOKEN}/clock`, {
      data: { action: 'in' },
    })
    expect(post.status()).toBe(403)
  })

  test('unknown action returns 400', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/crew/${TECHLEAD_TOKEN}/clock`, {
      data: { action: 'launch_rocket' },
    })
    expect(res.status()).toBe(400)
  })

  test('invalid token returns 404', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/crew/00000000-0000-0000-0000-000000000000/clock`)
    expect(res.status()).toBe(404)
  })
})
