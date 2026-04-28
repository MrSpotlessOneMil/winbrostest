/**
 * Phase E2 — editable service-plan agreement E2E (Blake 2026-04-28).
 *
 * Verifies the full round-trip:
 *   1. Admin PATCHes /api/actions/control-center { type:'config',
 *      data:{ service_plan_agreement_html: ... } } and the value lands
 *      in tenants.workflow_config.
 *   2. GET ?type=config returns the saved agreement.
 *   3. Customer-facing /api/quotes/[token] auto-attaches the agreement
 *      with variable substitution ({{customer_name}}, {{plan_name}},
 *      {{plan_price}}, {{tenant_name}}) when the quote has at least one
 *      offered service plan.
 *   4. A quote with NO offered plans gets a null servicePlanAgreementHtml
 *      (no auto-attach noise on plain quotes).
 *   5. Customer name is HTML-escaped to block XSS via injected names.
 *
 * Cleanup: restore agreement_html to its prior value, delete fixtures.
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
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

const SAMPLE_AGREEMENT_HTML =
  '<p>This Service Agreement is between {{customer_name}} ' +
  '("Customer") and {{tenant_name}} ("Provider"). ' +
  'Customer subscribes to the <strong>{{plan_name}}</strong> plan at ' +
  '{{plan_price}} per visit.</p>'

interface Fixture {
  adminToken: string
  priorAgreement: string
  registry: ReturnType<typeof newRegistry>
  customerToken: string | null
  customerQuoteId: string | null
}

test.describe.configure({ mode: 'serial' })

test.describe('Phase E2 — service-plan agreement', () => {
  let fx: Fixture

  test.beforeAll(async () => {
    // Snapshot the existing agreement value so we can restore it after.
    const tenants = await supabaseRest<
      Array<{ workflow_config: Record<string, unknown> | null }>
    >(
      `tenants?id=eq.${WINBROS_TENANT_ID}&select=workflow_config`
    )
    const wc = tenants[0]?.workflow_config ?? {}
    const prior = (wc.service_plan_agreement_html as string) || ''

    fx = {
      adminToken: await mintAdminSession(),
      priorAgreement: prior,
      registry: newRegistry(),
      customerToken: null,
      customerQuoteId: null,
    }
    fx.registry.sessionTokens.push(fx.adminToken)
  })

  test.afterAll(async () => {
    if (!fx) return
    // Restore the agreement to whatever was there before the test ran.
    await fetch(
      `https://kcmbwstjmdrjkhxhkkjt.supabase.co/rest/v1/tenants?id=eq.${WINBROS_TENANT_ID}`,
      {
        method: 'PATCH',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_config: await getCurrentWorkflowConfig().then((wc) => ({
            ...wc,
            service_plan_agreement_html: fx.priorAgreement,
          })),
        }),
      }
    ).catch(() => {})
    await drainRegistry(fx.registry)
  })

  test('admin saves agreement via control-center; GET returns it back', async ({
    request,
  }) => {
    const patch = await request.patch(
      `${BASE}/api/actions/control-center`,
      {
        headers: { Cookie: `winbros_session=${fx.adminToken}` },
        data: {
          type: 'config',
          data: { service_plan_agreement_html: SAMPLE_AGREEMENT_HTML },
        },
      }
    )
    expect(patch.ok()).toBe(true)
    const patchBody = await patch.json()
    expect(patchBody.success).toBe(true)
    expect(patchBody.data.service_plan_agreement_html).toBe(SAMPLE_AGREEMENT_HTML)

    const get = await request.get(
      `${BASE}/api/actions/control-center?type=config`,
      { headers: { Cookie: `winbros_session=${fx.adminToken}` } }
    )
    expect(get.ok()).toBe(true)
    const getBody = await get.json()
    expect(getBody.data.service_plan_agreement_html).toBe(SAMPLE_AGREEMENT_HTML)
  })

  test('customer view auto-attaches agreement with variables substituted when quote has offered plan', async ({
    request,
  }) => {
    // Seed: a customer-facing quote with one offered plan. The quote
    // needs a public token (defaults to a random uuid via the column
    // default if the schema has one — otherwise we set one explicitly).
    const quoteRows = await supabaseRest<Array<{ id: string; token: string | null }>>(
      'quotes',
      {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: WINBROS_TENANT_ID,
          status: 'sent',
          customer_name: 'Phase E2 Customer',
          phone_number: '+15555550199',
          address: 'PHASE_E2_TEST_FIXTURE',
          total_price: 320,
          salesman_id: TEST_PERSONAS.salesman.cleanerId,
        }),
      }
    )
    fx.customerQuoteId = quoteRows[0].id
    fx.registry.quoteIds.push(quoteRows[0].id as unknown as number)

    // Many WinBros quotes use a separate token column; fall back to id
    // if token wasn't auto-generated.
    fx.customerToken = quoteRows[0].token ?? quoteRows[0].id

    await supabaseRest('quote_service_plans', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        quote_id: fx.customerQuoteId,
        name: 'Quarterly',
        recurring_price: 225,
        offered_to_customer: true,
        first_visit_keeps_original_price: false,
        sort_order: 0,
      }),
    })

    // Customer view is public — no Cookie.
    const res = await request.get(
      `${BASE}/api/quotes/${fx.customerToken}`
    )
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(Array.isArray(body.attachedServicePlans)).toBe(true)
    expect(body.attachedServicePlans.length).toBe(1)

    expect(body.servicePlanAgreementHtml).toBeTruthy()
    const html = body.servicePlanAgreementHtml as string
    expect(html).toContain('Phase E2 Customer')   // {{customer_name}}
    expect(html).toContain('Quarterly')           // {{plan_name}}
    expect(html).toContain('$225.00')             // {{plan_price}}
    // No raw template syntax leaked through.
    expect(html).not.toMatch(/\{\{\s*customer_name\s*\}\}/)
    expect(html).not.toMatch(/\{\{\s*plan_name\s*\}\}/)
    expect(html).not.toMatch(/\{\{\s*plan_price\s*\}\}/)
  })

  test('quote without an offered plan → servicePlanAgreementHtml is null (no spam attach)', async ({
    request,
  }) => {
    const quoteRows = await supabaseRest<Array<{ id: string; token: string | null }>>(
      'quotes',
      {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: WINBROS_TENANT_ID,
          status: 'sent',
          customer_name: 'Phase E2 No-Plan',
          phone_number: '+15555550198',
          address: 'PHASE_E2_TEST_FIXTURE',
          total_price: 250,
          salesman_id: TEST_PERSONAS.salesman.cleanerId,
        }),
      }
    )
    const quoteId = quoteRows[0].id
    const customerToken = quoteRows[0].token ?? quoteId
    fx.registry.quoteIds.push(quoteId as unknown as number)

    const res = await request.get(`${BASE}/api/quotes/${customerToken}`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.attachedServicePlans).toEqual([])
    expect(body.servicePlanAgreementHtml).toBeNull()
  })

  test('XSS via customer_name is HTML-escaped, not executed', async ({
    request,
  }) => {
    const evilName = `<script>alert("xss")</script>`
    const quoteRows = await supabaseRest<Array<{ id: string; token: string | null }>>(
      'quotes',
      {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: WINBROS_TENANT_ID,
          status: 'sent',
          customer_name: evilName,
          phone_number: '+15555550197',
          address: 'PHASE_E2_TEST_FIXTURE',
          total_price: 320,
          salesman_id: TEST_PERSONAS.salesman.cleanerId,
        }),
      }
    )
    const quoteId = quoteRows[0].id
    const customerToken = quoteRows[0].token ?? quoteId
    fx.registry.quoteIds.push(quoteId as unknown as number)

    await supabaseRest('quote_service_plans', {
      method: 'POST',
      body: JSON.stringify({
        tenant_id: WINBROS_TENANT_ID,
        quote_id: quoteId,
        name: 'Monthly',
        recurring_price: 99,
        offered_to_customer: true,
        first_visit_keeps_original_price: false,
        sort_order: 0,
      }),
    })

    const res = await request.get(`${BASE}/api/quotes/${customerToken}`)
    const body = await res.json()
    const html = body.servicePlanAgreementHtml as string
    // The literal "<script>" must not appear unescaped in the agreement
    // HTML — escapeHtml should have replaced it.
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert')
  })
})

async function getCurrentWorkflowConfig(): Promise<Record<string, unknown>> {
  const tenants = await supabaseRest<
    Array<{ workflow_config: Record<string, unknown> | null }>
  >(`tenants?id=eq.${WINBROS_TENANT_ID}&select=workflow_config`)
  return tenants[0]?.workflow_config ?? {}
}
