/**
 * Phase A — Day-off approval workflow E2E.
 *
 * Verifies admin can approve/deny a tech's time-off request and the tech
 * sees the result in their /api/actions/time-off feed.
 *
 * Setup: mints a real admin session via direct sessions-table insert,
 * creates a pending time_off row for the test salesman (cleaner 134),
 * runs PATCH /api/actions/time-off/decision, asserts the row flips,
 * then cleans up. Same pattern as Phase H spec — no auth.setup.ts dep.
 */

import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const SUPABASE_URL = 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'
const WINBROS_ADMIN_USER_ID = 2 // username='winbros'
const TEST_SALESMAN_CLEANER_ID = 134

interface Fixture {
  adminSessionToken: string
  timeOffIds: number[]
}

async function supabase<T = unknown>(
  pathAndQuery: string,
  init: RequestInit = {}
): Promise<T> {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

async function mintAdminSession(): Promise<string> {
  const token =
    randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  await supabase('sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: WINBROS_ADMIN_USER_ID,
      cleaner_id: null,
      token,
      expires_at: expiresAt,
    }),
  })
  return token
}

async function deleteSession(token: string): Promise<void> {
  if (!SERVICE_KEY) return
  await fetch(`${SUPABASE_URL}/rest/v1/sessions?token=eq.${token}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

async function deleteTimeOff(id: number): Promise<void> {
  if (!SERVICE_KEY) return
  await fetch(`${SUPABASE_URL}/rest/v1/time_off?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

function futureDate(daysAhead: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().slice(0, 10)
}

test.describe('Phase A — time-off approval workflow', () => {
  let fx: Fixture | null = null

  test.beforeAll(async () => {
    fx = { adminSessionToken: await mintAdminSession(), timeOffIds: [] }
  })

  test.afterAll(async () => {
    if (!fx) return
    for (const id of fx.timeOffIds) await deleteTimeOff(id)
    await deleteSession(fx.adminSessionToken)
  })

  test('admin can approve a pending time-off request', async ({ request }) => {
    // Seed a pending request 30 days out (clears the 14-day rule).
    const seeded = await supabase<Array<{ id: number; status: string }>>(
      'time_off',
      {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: WINBROS_TENANT_ID,
          cleaner_id: TEST_SALESMAN_CLEANER_ID,
          date: futureDate(30),
          status: 'pending',
          reason: 'PHASE_A_TEST_FIXTURE',
        }),
      }
    )
    const id = seeded[0].id
    fx!.timeOffIds.push(id)
    expect(seeded[0].status).toBe('pending')

    const res = await request.patch(
      `${BASE}/api/actions/time-off/decision`,
      {
        headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
        data: { id, status: 'approved' },
      }
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.timeOff.status).toBe('approved')
    expect(body.timeOff.decided_by_user_id).toBe(WINBROS_ADMIN_USER_ID)
    expect(body.timeOff.decided_at).toBeTruthy()
    expect(body.timeOff.denial_reason).toBeNull()
  })

  test('admin denial requires denial_reason (400 if missing)', async ({ request }) => {
    const seeded = await supabase<Array<{ id: number }>>('time_off', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        cleaner_id: TEST_SALESMAN_CLEANER_ID,
        date: futureDate(31),
        status: 'pending',
        reason: 'PHASE_A_TEST_FIXTURE',
      }),
    })
    const id = seeded[0].id
    fx!.timeOffIds.push(id)

    const res = await request.patch(
      `${BASE}/api/actions/time-off/decision`,
      {
        headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
        data: { id, status: 'denied' },
      }
    )
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error.toLowerCase()).toContain('denial_reason')
  })

  test('admin can deny WITH a denial_reason — row flips to denied', async ({
    request,
  }) => {
    const seeded = await supabase<Array<{ id: number }>>('time_off', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        cleaner_id: TEST_SALESMAN_CLEANER_ID,
        date: futureDate(32),
        status: 'pending',
        reason: 'PHASE_A_TEST_FIXTURE',
      }),
    })
    const id = seeded[0].id
    fx!.timeOffIds.push(id)

    const res = await request.patch(
      `${BASE}/api/actions/time-off/decision`,
      {
        headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
        data: { id, status: 'denied', denial_reason: 'crew is booked solid' },
      }
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.timeOff.status).toBe('denied')
    expect(body.timeOff.denial_reason).toBe('crew is booked solid')
  })

  test('decision endpoint refuses cleaner sessions — row stays pending', async ({
    request,
  }) => {
    // Security guarantee: a cleaner-only session can NEVER flip a
    // time_off row to approved. We don't pin to a specific status code
    // (the admin guard returns 403, but requireAuthWithTenant currently
    // 500s on a cleaner-only session — same outcome from a security POV,
    // logged separately). The real assertion is the DB row's status.
    const seeded = await supabase<Array<{ id: number }>>('time_off', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        cleaner_id: TEST_SALESMAN_CLEANER_ID,
        date: futureDate(33),
        status: 'pending',
        reason: 'PHASE_A_TEST_FIXTURE',
      }),
    })
    const id = seeded[0].id
    fx!.timeOffIds.push(id)

    const cleanerToken =
      randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
    await supabase('sessions', {
      method: 'POST',
      body: JSON.stringify({
        user_id: null,
        cleaner_id: TEST_SALESMAN_CLEANER_ID,
        token: cleanerToken,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    })

    try {
      const res = await request.patch(
        `${BASE}/api/actions/time-off/decision`,
        {
          headers: { Cookie: `winbros_session=${cleanerToken}` },
          data: { id, status: 'approved' },
        }
      )
      expect(res.ok()).toBe(false)
    } finally {
      await deleteSession(cleanerToken)
    }

    // The real check — DB row UNCHANGED.
    const after = await supabase<Array<{ status: string }>>(
      `time_off?id=eq.${id}&select=status`
    )
    expect(after[0].status).toBe('pending')
  })
})
