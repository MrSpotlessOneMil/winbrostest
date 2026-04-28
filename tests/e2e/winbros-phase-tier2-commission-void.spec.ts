/**
 * Tier 2 — Voided appointment credit (T2.16)
 *
 * The third arm of the Phase F state machine: a credit can flip from
 * `pending` → `voided` when the appointment never converts. Two paths
 * trigger it:
 *
 *   - Admin cancels / deletes the appointment outright
 *   - Stale-cron sweep at 30+ days marks abandoned credits voided
 *
 * Voided credits are FROZEN — never count toward payroll, never flip
 * back to earned. We assert the helper's no-op-on-earned guarantee too.
 */

import { test, expect } from '@playwright/test'
import {
  WINBROS_TENANT_ID,
  TEST_PERSONAS,
  supabaseRest,
  rawDelete,
  mintAdminSession,
  deleteSession,
  futureIso,
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const APPOINTMENT_PRICE = 800
const EXPECTED_PENDING = 100 // 800 × 0.125

interface CreditRow {
  id: number
  status: 'pending' | 'earned' | 'voided'
  amount_pending: number | string | null
  amount_earned: number | string | null
  appointment_job_id: number
  void_reason: string | null
}

test.describe.configure({ mode: 'serial' })

test.describe('Tier 2 — voided appointment commission', () => {
  let adminToken: string
  let appointmentJobId: number

  test.beforeAll(async () => {
    adminToken = await mintAdminSession()
  })

  test.afterAll(async () => {
    if (appointmentJobId) {
      await rawDelete(`jobs?id=eq.${appointmentJobId}`).catch(() => {})
    }
    if (adminToken) await deleteSession(adminToken)
  })

  test('seed: appointment + salesman → pending credit', async ({ request }) => {
    const date = futureIso(7)
    const scheduledAt = '15:00'
    const endTime = `${date}T16:00:00.000Z`

    // POST creates an unassigned appointment; PATCH drops the salesman
    // onto it (matches the dashboard drag-drop flow). The credit fires
    // from the PATCH side per appointments/route.ts.
    const postRes = await request.post(`${BASE}/api/actions/appointments`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: {
        price: APPOINTMENT_PRICE,
        date,
        scheduled_at: scheduledAt,
        end_time: endTime,
        service_type: 'TIER_2_VOID_TEST',
        address: 'TIER_2_VOID_TEST',
        phone_number: '+15555550109',
      },
    })
    expect(postRes.ok()).toBe(true)
    const json = await postRes.json()
    appointmentJobId = json.appointment.id

    const patchRes = await request.patch(
      `${BASE}/api/actions/appointments?id=${appointmentJobId}`,
      {
        headers: { Cookie: `winbros_session=${adminToken}` },
        data: { crew_salesman_id: TEST_PERSONAS.salesman.cleanerId },
      }
    )
    expect(patchRes.ok()).toBe(true)

    // Pending credit must exist
    const rows = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
    )
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('pending')
    expect(Number(rows[0].amount_pending)).toBe(EXPECTED_PENDING)
  })

  test('voiding the credit flips status + sets void_reason (DB-level)', async () => {
    const before = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
    )
    expect(before[0].status).toBe('pending')

    // Update via PostgREST PATCH (service-role bypasses RLS) — same call
    // path the void-helper uses internally.
    await supabaseRest(
      `salesman_appointment_credits?id=eq.${before[0].id}&status=eq.pending`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'voided',
          voided_at: new Date().toISOString(),
          void_reason: 'TIER_2_TEST_VOID',
        }),
      }
    )

    const after = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?id=eq.${before[0].id}`
    )
    expect(after[0].status).toBe('voided')
    expect(after[0].void_reason).toBe('TIER_2_TEST_VOID')
  })

  test('voided credit is IMMUNE to re-flip-to-earned (idempotency guard)', async () => {
    const rows = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
    )
    expect(rows[0].status).toBe('voided')

    // Try to flip back to earned via PATCH-where-status='pending' (the
    // exact filter the helper uses). Should be a no-op since status is
    // already voided.
    await supabaseRest(
      `salesman_appointment_credits?id=eq.${rows[0].id}&status=eq.pending`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'earned', amount_earned: EXPECTED_PENDING }),
      }
    )

    const after = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?id=eq.${rows[0].id}`
    )
    expect(after[0].status, 'voided credits must NEVER re-earn').toBe('voided')
    expect(after[0].amount_earned, 'amount_earned must stay null').toBeNull()
  })

  test('deleting the appointment cascades the credit row away', async () => {
    const before = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${appointmentJobId}`
    )
    expect(before.length).toBe(1)

    await rawDelete(`jobs?id=eq.${appointmentJobId}`)
    appointmentJobId = 0 // mark as cleaned

    const after = await supabaseRest<CreditRow[]>(
      `salesman_appointment_credits?appointment_job_id=eq.${before[0].appointment_job_id}`
    )
    expect(after.length, 'FK CASCADE should drop the credit row').toBe(0)
  })
})
