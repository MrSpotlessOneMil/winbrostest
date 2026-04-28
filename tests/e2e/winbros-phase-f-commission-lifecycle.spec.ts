/**
 * Phase F — 12.5% appointment-set commission lifecycle E2E.
 *
 * The commission state machine has three transitions; this spec drives
 * each one through real HTTP endpoints (not just the unit tests of the
 * pure helpers).
 *
 *   1. Create an appointment with crew_salesman_id + price → credit
 *      row inserted with status='pending', amount_pending = 12.5% × price.
 *   2. Create a quote linked via appointment_job_id, add a line item,
 *      then call /api/actions/quotes/approve → credit flips to 'earned'
 *      with amount_earned populated.
 *   3. (Phase F invariant) Re-converting an already-earned credit is
 *      idempotent — no double-counting.
 *
 * Test fixtures live in WinBros and are torn down in afterAll.
 */

import { test, expect } from '@playwright/test'
import {
  WINBROS_TENANT_ID,
  TEST_PERSONAS,
  supabaseRest,
  rawDelete,
  mintAdminSession,
  newRegistry,
  drainRegistry,
  futureIso,
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const APPOINTMENT_PRICE = 480
const EXPECTED_PENDING = 60 // 480 × 0.125

interface CreditRow {
  id: number
  status: 'pending' | 'earned' | 'voided'
  amount_pending: number | string | null
  amount_earned: number | string | null
  appointment_job_id: number
  converted_quote_id: number | null
  frozen_pct: number | string | null
}

async function readCreditByAppointment(
  appointmentJobId: number
): Promise<CreditRow | null> {
  const rows = await supabaseRest<CreditRow[]>(
    `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
  )
  return rows[0] ?? null
}

test.describe.configure({ mode: 'serial' })

test.describe('Phase F — appointment commission lifecycle', () => {
  let registry = newRegistry()
  let adminToken: string

  test.beforeAll(async () => {
    adminToken = await mintAdminSession()
    registry.sessionTokens.push(adminToken)
  })

  test.afterAll(async () => {
    // Credit rows reference jobs via appointment_job_id (FK ON DELETE
    // CASCADE per migration). Drain jobs first; credits go with them.
    // But also explicitly clean any lingering credit rows we know about.
    await drainRegistry(registry)
  })

  test('appointment POST + PATCH with salesman + price logs a pending 12.5% credit', async ({
    request,
  }) => {
    // Real flow per /api/actions/appointments contract: POST creates the
    // unassigned appointment, then PATCH ?id=N drops a salesman onto it
    // (drag-drop on /appointments). The credit fires from PATCH.
    const date = futureIso(7)
    const scheduledAt = '15:00'
    const endTime = `${date}T16:00:00.000Z`

    const postRes = await request.post(`${BASE}/api/actions/appointments`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: {
        price: APPOINTMENT_PRICE,
        date,
        scheduled_at: scheduledAt,
        end_time: endTime,
        service_type: 'PHASE_F_TEST_FIXTURE',
        address: 'PHASE_F_TEST_FIXTURE',
        phone_number: '+15555550102',
      },
    })
    expect(postRes.ok()).toBe(true)
    const postBody = await postRes.json()
    const appointmentJobId = postBody.appointment.id as number
    registry.jobIds.push(appointmentJobId)

    // Before PATCH: no credit yet.
    expect(await readCreditByAppointment(appointmentJobId)).toBeNull()

    // PATCH drops the salesman onto it.
    const patchRes = await request.patch(
      `${BASE}/api/actions/appointments?id=${appointmentJobId}`,
      {
        headers: { Cookie: `winbros_session=${adminToken}` },
        data: { crew_salesman_id: TEST_PERSONAS.salesman.cleanerId },
      }
    )
    expect(patchRes.ok()).toBe(true)

    // Pending credit row should exist now.
    const credit = await readCreditByAppointment(appointmentJobId)
    expect(credit).not.toBeNull()
    expect(credit!.status).toBe('pending')
    expect(Number(credit!.amount_pending)).toBe(EXPECTED_PENDING)
    expect(Number(credit!.frozen_pct)).toBe(12.5)
    expect(credit!.converted_quote_id).toBeNull()
    expect(credit!.amount_earned).toBeNull()
  })

  test('approving a quote linked to the appointment flips the credit to earned', async ({
    request,
  }) => {
    // Find the appointment we just created (registry has one job id at
    // this point — the appointment).
    const appointmentJobId = registry.jobIds[0]
    expect(appointmentJobId).toBeDefined()

    // Insert a quote that points back at the appointment, with a line
    // item, and salesman_id stamped (Phase I requirement).
    const quoteRows = await supabaseRest<Array<{ id: number }>>('quotes', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        status: 'sent',
        customer_name: 'PHASE_F Customer',
        phone_number: '+15555550102',
        address: 'PHASE_F_TEST_FIXTURE',
        total_price: APPOINTMENT_PRICE,
        appointment_job_id: appointmentJobId,
        salesman_id: TEST_PERSONAS.salesman.cleanerId,
      }),
    })
    const quoteId = quoteRows[0].id
    registry.quoteIds.push(quoteId)

    // Add a single line item so quote-conversion can mirror it onto the
    // converted job. quote_line_items requires tenant_id + is_upsell.
    await supabaseRest('quote_line_items', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        quote_id: quoteId,
        service_name: 'Exterior Window Cleaning',
        description: 'PHASE_F_TEST_FIXTURE',
        price: APPOINTMENT_PRICE,
        quantity: 1,
        sort_order: 0,
        is_upsell: false,
      }),
    })

    const res = await request.post(`${BASE}/api/actions/quotes/approve`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: { quoteId, approvedBy: 'salesman' },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Conversion creates a NEW jobs row (different from the appointment).
    expect(typeof body.job_id).toBe('number')
    registry.jobIds.push(body.job_id)
    if (body.visit_id) registry.visitIds.push(body.visit_id)

    // Credit should now be `earned`, with amount_earned set + a
    // converted_quote_id pointing at our quote.
    const credit = await readCreditByAppointment(appointmentJobId)
    expect(credit).not.toBeNull()
    expect(credit!.status).toBe('earned')
    expect(Number(credit!.amount_earned)).toBe(EXPECTED_PENDING)
    expect(credit!.converted_quote_id).toBe(quoteId)
  })

  test('re-approving the same quote is idempotent — credit stays earned, no duplicate', async ({
    request,
  }) => {
    // Approve ONCE was already done in the previous test. The conversion
    // route refuses to re-convert (status='converted' guard). Verify the
    // credit row count and amount didn't change.
    const appointmentJobId = registry.jobIds[0]
    const quoteId = registry.quoteIds[0]

    const res = await request.post(`${BASE}/api/actions/quotes/approve`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: { quoteId, approvedBy: 'salesman' },
    })
    // Conversion guard blocks already-converted quotes.
    expect(res.ok()).toBe(false)

    const allCredits = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
    )
    expect(allCredits).toHaveLength(1)
    expect(allCredits[0].status).toBe('earned')
    expect(Number(allCredits[0].amount_earned)).toBe(EXPECTED_PENDING)
  })

  test('appointment without a salesman → no credit row (skipped silently)', async ({
    request,
  }) => {
    // POST without crew_salesman_id (route doesn't accept it on POST anyway).
    // No PATCH after → credit never fires.
    const date = futureIso(8)
    const scheduledAt = '10:00'
    const endTime = `${date}T11:00:00.000Z`

    const res = await request.post(`${BASE}/api/actions/appointments`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: {
        price: 250,
        date,
        scheduled_at: scheduledAt,
        end_time: endTime,
        service_type: 'PHASE_F_TEST_FIXTURE_NO_SALESMAN',
        address: 'PHASE_F_TEST_FIXTURE',
        phone_number: '+15555550103',
      },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    const appointmentJobId = body.appointment.id as number
    registry.jobIds.push(appointmentJobId)

    const credit = await readCreditByAppointment(appointmentJobId)
    expect(credit).toBeNull()
  })

  test('appointment with salesman but price=0 → no credit row (skipped silently)', async ({
    request,
  }) => {
    // Create with price=0, then PATCH salesman onto it. The PATCH path
    // checks job.price > 0 before logging; price=0 → silent skip.
    const date = futureIso(9)
    const scheduledAt = '10:00'
    const endTime = `${date}T11:00:00.000Z`

    const postRes = await request.post(`${BASE}/api/actions/appointments`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: {
        price: 0,
        date,
        scheduled_at: scheduledAt,
        end_time: endTime,
        service_type: 'PHASE_F_TEST_FIXTURE_NO_PRICE',
        address: 'PHASE_F_TEST_FIXTURE',
        phone_number: '+15555550104',
      },
    })
    expect(postRes.ok()).toBe(true)
    const appointmentJobId = (await postRes.json()).appointment.id as number
    registry.jobIds.push(appointmentJobId)

    const patchRes = await request.patch(
      `${BASE}/api/actions/appointments?id=${appointmentJobId}`,
      {
        headers: { Cookie: `winbros_session=${adminToken}` },
        data: { crew_salesman_id: TEST_PERSONAS.salesman.cleanerId },
      }
    )
    expect(patchRes.ok()).toBe(true)

    const credit = await readCreditByAppointment(appointmentJobId)
    expect(credit).toBeNull()
  })
})
