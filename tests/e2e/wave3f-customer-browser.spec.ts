/**
 * Wave 3f — customer /quote/[token]/v2 browser e2e
 *
 * Pins the new customer-facing UX:
 *   - Section header renamed "Line items" (PRD §2.2 rename)
 *   - Agreement + Signature sections only appear when a plan is selected
 *     (PRD §2.5 conditional drop-down).
 *   - Plan disclosure shows "New total" AND "Next visits auto-charge for $X"
 *     pulled from DB fields.
 *   - Approve CTA is disabled until a card is on file.
 *   - Sticky mobile approve bar exists below sm:.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function seedQuoteWithPlan(
  request: import('@playwright/test').APIRequestContext,
  opts: { includePlan: boolean }
): Promise<{ token: string; quoteId: string; planId?: number }> {
  const postRes = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_name: `E2E_WAVE3F_${Date.now()}`,
      customer_phone: '+13097777777',
      customer_email: `wave3f_browser_${Date.now()}@example.test`,
      customer_address: '404 Eastwood, Morton, IL',
      line_items: [
        { service_name: 'Exterior wash', price: 200, optionality: 'required' },
        { service_name: 'Screens', price: 80, optionality: 'recommended' },
      ],
    },
  })
  if (!postRes.ok()) {
    throw new Error(`seed failed: ${postRes.status()} ${await postRes.text()}`)
  }
  const body = await postRes.json()
  const quote = body.quote
  if (!opts.includePlan) return { token: quote.token, quoteId: quote.id }

  const planRes = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
    data: {
      quote_id: quote.id,
      name: 'Monthly',
      recurring_price: 99,
      offered_to_customer: true,
      first_visit_keeps_original_price: true,
    },
  })
  if (!planRes.ok()) {
    throw new Error(`plan seed failed: ${planRes.status()}`)
  }
  const planBody = await planRes.json()
  const planId = planBody.plan?.id ?? planBody.id
  return { token: quote.token, quoteId: quote.id, planId }
}

test.describe('Wave 3f — customer page conditional drop-down', () => {
  test('header renders "Line items" (PRD §2.2 copy)', async ({ page, request }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: false })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    await expect(
      page.getByTestId('line-items-section').getByRole('heading', { name: /Line items/i })
    ).toBeVisible({ timeout: 10000 })
  })

  test('agreement + signature hidden when plans offered but none picked', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: true })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    // The card-info section is always visible.
    await expect(page.getByTestId('card-section')).toBeVisible({ timeout: 10000 })
    // Agreement + signature are gated behind plan selection.
    await expect(page.getByTestId('agreement-section')).toHaveCount(0)
    await expect(page.getByTestId('signature-section')).toHaveCount(0)
  })

  test('agreement + signature appear once a plan is selected', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: true })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    await page.getByRole('button', { name: /Monthly/i }).click()
    await expect(page.getByTestId('agreement-section')).toBeVisible()
    await expect(page.getByTestId('signature-section')).toBeVisible()
  })

  test('plan-selected disclosure shows New total + Next visits auto-charge copy', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: true })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    await page.getByRole('button', { name: /Monthly/i }).click()
    const disclosure = page.getByTestId('plan-disclosure')
    await expect(disclosure).toBeVisible()
    await expect(disclosure).toContainText(/New total/)
    await expect(disclosure).toContainText(/Next visits will auto-charge/i)
    await expect(disclosure).toContainText('$99.00')
  })

  test('Approve CTA is disabled when card is not yet on file', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: false })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    const cta = page.getByTestId('approve-cta')
    await expect(cta).toBeDisabled()
  })

  test('mobile sticky approve bar exists', async ({ page, request }) => {
    const { token } = await seedQuoteWithPlan(request, { includePlan: false })
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto(`${BASE_URL}/quote/${token}/v2`)
    await expect(page.getByTestId('approve-sticky-bar')).toBeVisible()
  })
})
