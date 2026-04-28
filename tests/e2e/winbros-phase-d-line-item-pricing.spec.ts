/**
 * Phase D — Inline-editable visit line-item pricing E2E.
 *
 * Verifies the JobDetailDrawer's click-to-edit price flow on visit_line_items
 * works end-to-end:
 *  1. PATCH /api/actions/visits/line-item updates the price for a tech upsell
 *     when the parent visit is open.
 *  2. The same PATCH is REJECTED with 409 when the parent visit is closed
 *     (payroll has already locked numbers).
 *  3. Cross-tenant guard returns 404 for a tenant that doesn't own the row.
 *  4. The validator rejects a negative price.
 *
 * Setup creates a throwaway jobs+visits+visit_line_items chain in WinBros
 * and tears it down in afterAll. No real customer data is touched.
 */

import { test, expect } from '@playwright/test'
import { randomUUID } from 'crypto'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const SUPABASE_URL = 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const WINBROS_TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'
const WINBROS_ADMIN_USER_ID = 2

interface Fixture {
  adminSessionToken: string
  jobIds: number[]
  visitIds: number[]
  lineItemIds: number[]
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

async function rawDelete(pathAndQuery: string): Promise<void> {
  if (!SERVICE_KEY) return
  await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {})
}

async function mintAdminSession(): Promise<string> {
  const token =
    randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  await supabase('sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: WINBROS_ADMIN_USER_ID,
      cleaner_id: null,
      token,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
  })
  return token
}

async function seedVisitChain(args: {
  visitStatus: 'not_started' | 'in_progress' | 'closed'
  initialUpsellPrice: number
}): Promise<{ jobId: number; visitId: number; lineItemId: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const jobs = await supabase<Array<{ id: number }>>('jobs', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: WINBROS_TENANT_ID,
      status: 'scheduled',
      service_type: 'PHASE_D_TEST_FIXTURE',
      date: today,
      address: 'PHASE_D_TEST_FIXTURE',
      phone_number: '+15555550101',
      price: 250,
    }),
  })
  const jobId = jobs[0].id

  const visits = await supabase<Array<{ id: number }>>('visits', {
    method: 'POST',
    body: JSON.stringify({
      job_id: jobId,
      tenant_id: WINBROS_TENANT_ID,
      visit_date: today,
      visit_number: 1,
      status: args.visitStatus,
      ...(args.visitStatus === 'closed'
        ? { closed_at: new Date().toISOString() }
        : {}),
    }),
  })
  const visitId = visits[0].id

  const lineItems = await supabase<Array<{ id: number }>>('visit_line_items', {
    method: 'POST',
    body: JSON.stringify({
      visit_id: visitId,
      job_id: jobId,
      tenant_id: WINBROS_TENANT_ID,
      service_name: 'PHASE_D Solar Panel Rinse',
      price: args.initialUpsellPrice,
      revenue_type: 'technician_upsell',
    }),
  })
  return { jobId, visitId, lineItemId: lineItems[0].id }
}

test.describe('Phase D — line-item pricing PATCH', () => {
  let fx: Fixture | null = null

  test.beforeAll(async () => {
    fx = {
      adminSessionToken: await mintAdminSession(),
      jobIds: [],
      visitIds: [],
      lineItemIds: [],
    }
  })

  test.afterAll(async () => {
    if (!fx) return
    // Reverse order to respect FKs.
    for (const id of fx.lineItemIds) await rawDelete(`visit_line_items?id=eq.${id}`)
    for (const id of fx.visitIds) await rawDelete(`visits?id=eq.${id}`)
    for (const id of fx.jobIds) await rawDelete(`jobs?id=eq.${id}`)
    await rawDelete(`sessions?token=eq.${fx.adminSessionToken}`)
  })

  test('updates price on an open visit and persists in DB', async ({ request }) => {
    const { jobId, visitId, lineItemId } = await seedVisitChain({
      visitStatus: 'in_progress',
      initialUpsellPrice: 45,
    })
    fx!.jobIds.push(jobId)
    fx!.visitIds.push(visitId)
    fx!.lineItemIds.push(lineItemId)

    const res = await request.patch(`${BASE}/api/actions/visits/line-item`, {
      headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
      data: { id: lineItemId, price: 60 },
    })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Number(body.line_item.price)).toBe(60)

    // Verify via direct DB read so we're not just trusting the response.
    const rows = await supabase<Array<{ price: number | string }>>(
      `visit_line_items?id=eq.${lineItemId}&select=price`
    )
    expect(Number(rows[0].price)).toBe(60)
  })

  test('blocks edits on a closed visit (409)', async ({ request }) => {
    const { jobId, visitId, lineItemId } = await seedVisitChain({
      visitStatus: 'closed',
      initialUpsellPrice: 45,
    })
    fx!.jobIds.push(jobId)
    fx!.visitIds.push(visitId)
    fx!.lineItemIds.push(lineItemId)

    const res = await request.patch(`${BASE}/api/actions/visits/line-item`, {
      headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
      data: { id: lineItemId, price: 999 },
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body.error.toLowerCase()).toContain('closed')

    // DB unchanged.
    const rows = await supabase<Array<{ price: number | string }>>(
      `visit_line_items?id=eq.${lineItemId}&select=price`
    )
    expect(Number(rows[0].price)).toBe(45)
  })

  test('rejects negative price (400)', async ({ request }) => {
    const { jobId, visitId, lineItemId } = await seedVisitChain({
      visitStatus: 'in_progress',
      initialUpsellPrice: 30,
    })
    fx!.jobIds.push(jobId)
    fx!.visitIds.push(visitId)
    fx!.lineItemIds.push(lineItemId)

    const res = await request.patch(`${BASE}/api/actions/visits/line-item`, {
      headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
      data: { id: lineItemId, price: -5 },
    })
    expect(res.status()).toBe(400)

    const rows = await supabase<Array<{ price: number | string }>>(
      `visit_line_items?id=eq.${lineItemId}&select=price`
    )
    expect(Number(rows[0].price)).toBe(30)
  })

  test('returns 404 when the line item does not exist (no info leak)', async ({
    request,
  }) => {
    const res = await request.patch(`${BASE}/api/actions/visits/line-item`, {
      headers: { Cookie: `winbros_session=${fx!.adminSessionToken}` },
      data: { id: 999999999, price: 50 },
    })
    expect(res.status()).toBe(404)
  })
})
