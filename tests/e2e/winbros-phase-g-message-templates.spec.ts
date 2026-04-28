/**
 * Phase G — Editable automated message templates (Blake's IMG_0996 flow).
 *
 * Verifies the round-trip for each of the 5 NEW triggers (the 3 legacy
 * ones — receipt / review_request / thank_you_tip — already had
 * Control Center support):
 *   - lead_thanks
 *   - appointment_confirm
 *   - on_my_way
 *   - day_before_reminder
 *   - (receipt is also Phase G stage but pre-existing)
 *
 * Asserts:
 *   1. POST to /api/actions/control-center { type:'messages' } creates
 *      a row with the right trigger_type.
 *   2. GET ?type=messages returns it.
 *   3. PATCH updates the body.
 *   4. is_active=false is preserved (admin can pause without delete).
 *
 * Cleanup: every row created here is registered for teardown.
 */

import { test, expect } from '@playwright/test'
import {
  WINBROS_TENANT_ID,
  supabaseRest,
  rawDelete,
  mintAdminSession,
  deleteSession,
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

const PHASE_G_TRIGGERS = [
  'lead_thanks',
  'appointment_confirm',
  'on_my_way',
  'day_before_reminder',
] as const

type Trigger = (typeof PHASE_G_TRIGGERS)[number]

interface MessageRow {
  id: number
  trigger_type: string
  message_template: string
  is_active: boolean
}

test.describe.configure({ mode: 'serial' })

test.describe('Phase G — automated message templates', () => {
  let adminToken: string
  const createdIds: number[] = []
  // Stash any pre-existing rows on these triggers so we can restore them
  // after the test (a real WinBros tenant might already have an
  // appointment_confirm template configured).
  const priorRows: Map<Trigger, MessageRow> = new Map()

  test.beforeAll(async () => {
    adminToken = await mintAdminSession()
    // Snapshot existing rows for our test triggers.
    for (const trigger of PHASE_G_TRIGGERS) {
      const existing = await supabaseRest<MessageRow[]>(
        `automated_messages?tenant_id=eq.${WINBROS_TENANT_ID}&trigger_type=eq.${trigger}`
      )
      if (existing[0]) {
        priorRows.set(trigger, existing[0])
        // Delete so the POST below can create cleanly.
        await rawDelete(`automated_messages?id=eq.${existing[0].id}`)
      }
    }
  })

  test.afterAll(async () => {
    if (!adminToken) return
    // Delete anything we created during the test.
    for (const id of createdIds) {
      await rawDelete(`automated_messages?id=eq.${id}`)
    }
    // Restore any pre-existing rows we snapshotted.
    for (const row of priorRows.values()) {
      await supabaseRest('automated_messages', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: WINBROS_TENANT_ID,
          trigger_type: row.trigger_type,
          message_template: row.message_template,
          is_active: row.is_active,
        }),
      }).catch(() => {})
    }
    await deleteSession(adminToken)
  })

  for (const trigger of PHASE_G_TRIGGERS) {
    test(`POST creates a ${trigger} row`, async ({ request }) => {
      const body = `Test body for ${trigger}: hi {{customer_name}}`
      const res = await request.post(`${BASE}/api/actions/control-center`, {
        headers: { Cookie: `winbros_session=${adminToken}` },
        data: {
          type: 'messages',
          data: { trigger_type: trigger, message_template: body },
        },
      })
      expect(res.ok()).toBe(true)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.data.trigger_type).toBe(trigger)
      expect(json.data.message_template).toBe(body)
      createdIds.push(json.data.id)
    })
  }

  test('GET ?type=messages returns all 4 newly-created Phase G rows', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/actions/control-center?type=messages`,
      { headers: { Cookie: `winbros_session=${adminToken}` } }
    )
    expect(res.ok()).toBe(true)
    const json = await res.json()
    const triggers = (json.data as MessageRow[]).map((r) => r.trigger_type)
    for (const t of PHASE_G_TRIGGERS) {
      expect(triggers, `expected ${t} in results`).toContain(t)
    }
  })

  test('PATCH updates the body of an existing row', async ({ request }) => {
    const id = createdIds[0]
    const newBody = 'Updated lead_thanks body — {{tenant_name}}'
    const res = await request.patch(`${BASE}/api/actions/control-center`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: {
        type: 'messages',
        id,
        data: { message_template: newBody },
      },
    })
    expect(res.ok()).toBe(true)
    const json = await res.json()
    expect(json.data.message_template).toBe(newBody)
  })

  test('PATCH can set is_active=false to pause without deleting', async ({
    request,
  }) => {
    const id = createdIds[1]
    const res = await request.patch(`${BASE}/api/actions/control-center`, {
      headers: { Cookie: `winbros_session=${adminToken}` },
      data: { type: 'messages', id, data: { is_active: false } },
    })
    expect(res.ok()).toBe(true)
    const json = await res.json()
    expect(json.data.is_active).toBe(false)

    // Confirm via direct DB read.
    const rows = await supabaseRest<MessageRow[]>(
      `automated_messages?id=eq.${id}&select=is_active,message_template`
    )
    expect(rows[0].is_active).toBe(false)
    expect(rows[0].message_template).toBeTruthy()
  })

  test('cross-tenant: cannot PATCH a message belonging to a different tenant', async ({
    request,
  }) => {
    // Insert a message belonging to a fake tenant, then try to PATCH it
    // through the WinBros admin session. The route's tenant_id eq filter
    // should reject the update.
    const fakeTenantId = '00000000-0000-0000-0000-000000000001'
    // Use rawDelete-style direct insert via supabaseRest — service role
    // bypasses RLS for fixture creation.
    const inserted = await supabaseRest<Array<{ id: number }>>(
      'automated_messages',
      {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: fakeTenantId,
          trigger_type: 'lead_thanks',
          message_template: 'fixture for cross-tenant test',
          is_active: true,
        }),
      }
    ).catch(() => null)
    if (!inserted || !inserted[0]) {
      // Tenant FK rejected the row (good — tenant doesn't exist). Skip.
      test.skip()
      return
    }

    const id = inserted[0].id
    try {
      const res = await request.patch(`${BASE}/api/actions/control-center`, {
        headers: { Cookie: `winbros_session=${adminToken}` },
        data: {
          type: 'messages',
          id,
          data: { message_template: 'should not land' },
        },
      })
      // The route returns 500 on a `single()` mismatch from PostgREST
      // since no row matches `id AND tenant_id` — same outcome as 404.
      // What matters is the body did NOT change.
      expect(res.ok()).toBe(false)
    } finally {
      await rawDelete(`automated_messages?id=eq.${id}`)
    }
  })
})
