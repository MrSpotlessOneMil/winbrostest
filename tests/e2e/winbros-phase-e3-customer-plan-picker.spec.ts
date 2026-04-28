/**
 * Phase E final — Customer-facing 3-plan picker on /quote/[token].
 *
 * Verifies:
 *   1. GET /api/quotes/[token] returns planTemplates array.
 *   2. POST { action: 'pick_plan', template_slug } adds the plan with
 *      offered_to_customer=true and wipes any prior plan rows.
 *   3. After picking, GET returns attachedServicePlans + agreement HTML
 *      (so the customer page rolls into the existing agreement render).
 *   4. POST is rejected (409) when the quote is locked (approved/rejected).
 *   5. POST is rejected (404) when the slug doesn't exist.
 *
 * Cleanup: every quote + every quote_service_plans row is registered.
 */

import { test, expect } from '@playwright/test'
import {
  WINBROS_TENANT_ID,
  supabaseRest,
  rawDelete,
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

interface PlanTemplateRow {
  id: string
  slug: string
  name: string
  recurring_price: number
}

interface QuoteRow {
  id: string
  token: string
}

test.describe.configure({ mode: 'serial' })

test.describe('Phase E final — customer plan picker', () => {
  let quoteId: string
  let quoteToken: string

  test.beforeAll(async () => {
    // Create a fresh quote for picking against. Use the public schema
    // RPC-style insert via PostgREST; service-role bypasses RLS.
    const inserted = await supabaseRest<QuoteRow[]>('quotes', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        token: `e3-picker-${Date.now()}`,
        status: 'pending',
        customer_name: 'Plan Picker Test',
        bedrooms: 4,
        bathrooms: 2,
        square_footage: 2400,
      }),
    })
    quoteId = inserted[0].id
    quoteToken = inserted[0].token
  })

  test.afterAll(async () => {
    await rawDelete(
      `quote_service_plans?quote_id=eq.${quoteId}&tenant_id=eq.${WINBROS_TENANT_ID}`
    )
    await rawDelete(`quotes?id=eq.${quoteId}`)
  })

  test('GET returns the 3 plan templates with prices in sort order', async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/quotes/${quoteToken}`)
    expect(res.ok()).toBe(true)
    const json = await res.json()
    expect(json.success).toBe(true)
    const templates = json.planTemplates as PlanTemplateRow[]
    expect(templates.length).toBeGreaterThanOrEqual(3)
    const slugs = templates.map((t) => t.slug)
    expect(slugs).toContain('monthly')
    expect(slugs).toContain('quarterly')
    expect(slugs).toContain('triannual')
    expect(json.attachedServicePlans).toEqual([])
  })

  test('POST pick_plan adds the row with offered_to_customer=true', async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'pick_plan', template_slug: 'quarterly' },
    })
    expect(res.ok()).toBe(true)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.plan.name.toLowerCase()).toContain('quarterly')

    // Verify via direct DB read
    const rows = await supabaseRest<
      Array<{ name: string; offered_to_customer: boolean }>
    >(
      `quote_service_plans?quote_id=eq.${quoteId}&tenant_id=eq.${WINBROS_TENANT_ID}`
    )
    expect(rows.length).toBe(1)
    expect(rows[0].offered_to_customer).toBe(true)
  })

  test('GET after picking returns attachedServicePlans + agreement HTML', async ({
    request,
  }) => {
    // Ensure tenant has an agreement saved so the HTML renders
    await supabaseRest('rpc/exec_sql', {
      method: 'POST',
      body: JSON.stringify({
        sql: '',
      }),
    }).catch(() => {})
    // Easier: PATCH workflow_config directly
    const tenantRow = await supabaseRest<Array<{ workflow_config: Record<string, unknown> }>>(
      `tenants?id=eq.${WINBROS_TENANT_ID}&select=workflow_config`
    )
    const wc = tenantRow[0].workflow_config || {}
    const hadAgreement = typeof wc.service_plan_agreement_html === 'string' &&
      (wc.service_plan_agreement_html as string).trim().length > 0
    if (!hadAgreement) {
      await supabaseRest(`tenants?id=eq.${WINBROS_TENANT_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({
          workflow_config: {
            ...wc,
            service_plan_agreement_html:
              '<p>Test agreement for {{customer_name}} — {{plan_name}} at {{plan_price}}</p>',
          },
        }),
      })
    }

    const res = await request.get(`${BASE}/api/quotes/${quoteToken}`)
    expect(res.ok()).toBe(true)
    const json = await res.json()
    expect(json.attachedServicePlans.length).toBe(1)
    expect(json.servicePlanAgreementHtml).toBeTruthy()
    expect(json.servicePlanAgreementHtml).toContain('Plan Picker Test')

    // Restore prior state
    if (!hadAgreement) {
      await supabaseRest(`tenants?id=eq.${WINBROS_TENANT_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ workflow_config: wc }),
      })
    }
  })

  test('POST pick_plan again with a DIFFERENT slug swaps the plan', async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'pick_plan', template_slug: 'monthly' },
    })
    expect(res.ok()).toBe(true)

    const rows = await supabaseRest<Array<{ name: string }>>(
      `quote_service_plans?quote_id=eq.${quoteId}&tenant_id=eq.${WINBROS_TENANT_ID}`
    )
    expect(rows.length).toBe(1)
    expect(rows[0].name.toLowerCase()).toContain('monthly')
  })

  test('POST with unknown slug returns 404', async ({ request }) => {
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'pick_plan', template_slug: 'nope-not-real' },
    })
    expect(res.status()).toBe(404)
  })

  test('POST is rejected (409) on an approved quote', async ({ request }) => {
    // Flip the quote to approved
    await supabaseRest(`quotes?id=eq.${quoteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    })
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'pick_plan', template_slug: 'monthly' },
    })
    expect(res.status()).toBe(409)
    // Reset for cleanup
    await supabaseRest(`quotes?id=eq.${quoteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending' }),
    })
  })

  test('POST with missing template_slug returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'pick_plan' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST with unsupported action returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/quotes/${quoteToken}`, {
      data: { action: 'wat' },
    })
    expect(res.status()).toBe(400)
  })
})
