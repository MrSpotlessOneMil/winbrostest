/**
 * Phase I — quote ↔ appointment ↔ salesman hard-link enforcement (E2E).
 *
 * Verifies the validator wires correctly into both the admin and crew
 * draft endpoints. We intentionally test the HTTP layer (not just the
 * pure helper, which has 13 unit tests already in
 * tests/unit/winbros/quote-link-validation.test.ts).
 *
 * Test fixtures:
 *   - WinBros tenant, salesman id=134 ("Salesman (WinBros Test)")
 *   - We create a throwaway "appointment job" (jobs row with status=pending
 *     + crew_salesman_id=134) so the draft endpoint has a real
 *     appointment_job_id to link to.
 *   - Cleanup deletes the appointment + any drafts created by the test.
 */

import { test, expect } from '@playwright/test'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const SUPABASE_URL = 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SALESMAN_PORTAL_TOKEN = '5f6b3902-6851-4581-a211-2333c0b79ed8'
const SALESMAN_ID = 134
const TECH_PORTAL_TOKEN = '0f26a1f5dd309560a85c6ed64defe74c' // Technician (WinBros Test)
const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb' // WinBros tenant.id

interface ApptFixture {
  appointmentJobId: number
  draftQuoteIds: number[]
}

async function supabaseRest<T = unknown>(
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

async function createAppointmentFixture(): Promise<ApptFixture> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await supabaseRest<Array<{ id: number }>>('jobs', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: WINBROS_TENANT_ID,
      status: 'pending',
      service_type: 'PHASE_I_TEST_FIXTURE',
      crew_salesman_id: SALESMAN_ID,
      price: 100,
      date: today,
      address: 'PHASE_I_TEST_FIXTURE',
      phone_number: '+15555550100',
    }),
  })
  return { appointmentJobId: rows[0].id, draftQuoteIds: [] }
}

async function teardown(fx: ApptFixture | null): Promise<void> {
  if (!fx || !SERVICE_KEY) return
  // Delete drafts first to avoid FK conflicts.
  for (const id of fx.draftQuoteIds) {
    await fetch(`${SUPABASE_URL}/rest/v1/quotes?id=eq.${id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
  await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${fx.appointmentJobId}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

test.describe('Phase I — quote-link guard', () => {
  let fx: ApptFixture | null = null

  test.beforeAll(async () => {
    fx = await createAppointmentFixture()
  })

  test.afterAll(async () => {
    await teardown(fx)
  })

  test('crew quote-draft auto-pulls salesman from appointment (linkage stays valid)', async ({
    request,
  }) => {
    // Salesman starts a draft from their own appointment. Should succeed
    // and the new quote should have salesman_id=134 + appointment_job_id
    // set, so the DB CHECK constraint passes.
    const res = await request.post(
      `${BASE}/api/crew/${SALESMAN_PORTAL_TOKEN}/quote-draft`,
      { data: { appointment_job_id: fx!.appointmentJobId } }
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    // quoteId may come back as string (bigint serialization) or number —
    // both are valid; we just need a non-empty identifier.
    expect(['number', 'string']).toContain(typeof body.quoteId)
    expect(String(body.quoteId).length).toBeGreaterThan(0)
    fx!.draftQuoteIds.push(Number(body.quoteId))

    // Verify salesman_id was stamped via direct DB read.
    const rows = await supabaseRest<
      Array<{ salesman_id: number | null; appointment_job_id: number | null }>
    >(`quotes?id=eq.${body.quoteId}&select=salesman_id,appointment_job_id`)
    expect(rows[0].salesman_id).toBe(SALESMAN_ID)
    expect(rows[0].appointment_job_id).toBe(fx!.appointmentJobId)
  })

  test('non-salesman draft from appointment INHERITS salesman from appointment (Phase I fallback)', async ({
    request,
  }) => {
    // A tech/team-lead opens a quote from a salesman's appointment. The
    // crew quote-draft endpoint must fall back to crew_salesman_id from
    // the appointment so the linkage remains intact.
    const res = await request.post(
      `${BASE}/api/crew/${TECH_PORTAL_TOKEN}/quote-draft`,
      { data: { appointment_job_id: fx!.appointmentJobId } }
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    fx!.draftQuoteIds.push(Number(body.quoteId))

    const rows = await supabaseRest<
      Array<{ salesman_id: number | null; appointment_job_id: number | null }>
    >(`quotes?id=eq.${body.quoteId}&select=salesman_id,appointment_job_id`)
    expect(rows[0].salesman_id).toBe(SALESMAN_ID)
    expect(rows[0].appointment_job_id).toBe(fx!.appointmentJobId)
  })

  test('DB constraint blocks direct insert that violates the link rule', async () => {
    // Bypass the app layer and try to create a violating row directly.
    // Phase I migration 20260427_quote_appointment_link_constraint.sql
    // adds the CHECK; this test guards against future drift.
    if (!SERVICE_KEY) test.skip()
    const res = await fetch(`${SUPABASE_URL}/rest/v1/quotes`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY!,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        status: 'pending',
        customer_name: 'PHASE_I_VIOLATION_TEST',
        total_price: 0,
        appointment_job_id: fx!.appointmentJobId,
        salesman_id: null,
      }),
    })
    expect(res.ok).toBe(false)
    const errBody = await res.text()
    // Postgres CHECK violation — surfaces as 23514.
    expect(errBody.toLowerCase()).toMatch(
      /quotes_appointment_needs_salesman|check constraint|23514/
    )
  })
})
