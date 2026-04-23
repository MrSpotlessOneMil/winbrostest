/**
 * Wave 3c (Round 2) — Customer /quote/[token]/v2 browser e2e
 *
 * Drives the real page in a real browser:
 *   - Admin seeds a quote (via request fixture, cached admin cookie)
 *   - Navigate to /quote/:token/v2 (public, no auth needed)
 *   - Assert line items render grouped by optionality
 *   - Tick/untick checkboxes, verify live total updates
 *   - Pick a plan, see first-visit charge copy update
 *   - Tick "I agree"
 *   - Draw a signature on the canvas via mouse events
 *   - Click Approve, assert success screen
 *   - Assert the underlying quote flipped to converted in the DB via admin GET
 *
 * Runs under the customer-browser Playwright project (no auth.setup dep).
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function seedQuoteWithPlan(
  request: import('@playwright/test').APIRequestContext
): Promise<{ quoteId: string; token: string; planId: number }> {
  const postRes = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_name: 'E2E_WAVE3C_browser',
      customer_phone: '+13098888888',
      customer_email: `wave3c_browser_${Date.now()}@example.test`,
      line_items: [
        { service_name: 'Exterior wash', price: 200, optionality: 'required' },
        { service_name: 'Screens', price: 80, optionality: 'recommended' },
        { service_name: 'Tracks & sills', price: 150, optionality: 'optional' },
      ],
    },
  })
  if (!postRes.ok()) throw new Error(`seed failed: ${postRes.status()} ${await postRes.text()}`)
  const postBody = await postRes.json()
  const quoteId: string = postBody.quote.id
  const token: string = postBody.quote.token

  const planRes = await request.post(`${BASE_URL}/api/actions/quotes/plans`, {
    data: {
      quote_id: quoteId,
      name: 'Monthly',
      recurring_price: 99,
      offered_to_customer: true,
      first_visit_keeps_original_price: true,
    },
  })
  if (!planRes.ok()) throw new Error(`plan seed failed: ${planRes.status()}`)
  const planBody = await planRes.json()
  const planId: number = planBody.plan.id

  await request.fetch(`${BASE_URL}/api/actions/quotes/${quoteId}`, {
    method: 'PATCH',
    data: { status: 'sent' },
  })

  return { quoteId, token, planId }
}

async function drawSignature(page: Page) {
  // The SignaturePad renders a <canvas>. We sweep the mouse across it so
  // the onChange callback fires with a non-empty base64 PNG.
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const startX = box.x + 20
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(startX + i * 20, startY + (i % 2 === 0 ? -10 : 10))
  }
  await page.mouse.up()
}

test.describe('Customer /quote/[token]/v2 browser flow', () => {
  test('renders line items grouped by optionality', async ({ page, request }) => {
    const { token } = await seedQuoteWithPlan(request)
    await page.goto(`${BASE_URL}/quote/${token}/v2`)

    await expect(page.getByRole('heading', { name: /Your Quote from/i })).toBeVisible({
      timeout: 15000,
    })
    // Required line shows plain.
    await expect(page.getByText('Exterior wash')).toBeVisible()
    // Recommended section header.
    await expect(page.getByText('Recommended', { exact: false })).toBeVisible()
    await expect(page.getByText('Screens')).toBeVisible()
    // Optional section header.
    await expect(page.getByText('Optional add-ons', { exact: false })).toBeVisible()
    await expect(page.getByText('Tracks & sills')).toBeVisible()
  })

  test('live total updates when recommended and optional checkboxes toggle', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request)
    await page.goto(`${BASE_URL}/quote/${token}/v2`)

    await expect(page.getByText(/Total: \$280\.00/)).toBeVisible({ timeout: 15000 })

    // Uncheck the recommended "Screens" → total drops to 200.
    const screensRow = page.locator('li', { hasText: 'Screens' })
    await screensRow.locator('input[type="checkbox"]').uncheck()
    await expect(page.getByText(/Total: \$200\.00/)).toBeVisible()

    // Check the optional "Tracks & sills" → total climbs to 350.
    const tracksRow = page.locator('li', { hasText: 'Tracks & sills' })
    await tracksRow.locator('input[type="checkbox"]').check()
    await expect(page.getByText(/Total: \$350\.00/)).toBeVisible()
  })

  test('plan selection reveals first-visit charge copy', async ({ page, request }) => {
    const { token } = await seedQuoteWithPlan(request)
    await page.goto(`${BASE_URL}/quote/${token}/v2`)

    await page.getByRole('button', { name: /Monthly/i }).first().click()
    const firstVisitCopy = page.locator('div', {
      hasText: /First visit charge will be/i,
    }).first()
    await expect(firstVisitCopy).toBeVisible()
    // first_visit_keeps_original_price=true, so the inline amount in the
    // first-visit banner equals the shown total ($280.00), not the
    // $99 recurring price.
    await expect(firstVisitCopy).toContainText('$280.00')
  })

  test('full approve flow: pick plan, sign, agree, submit → success screen', async ({
    page,
    request,
  }) => {
    const { quoteId, token } = await seedQuoteWithPlan(request)
    await page.goto(`${BASE_URL}/quote/${token}/v2`)

    // Pick the plan.
    await page.getByRole('button', { name: /Monthly/i }).first().click()

    // Agreement checkbox is near the bottom of the agreement section.
    await page
      .locator('label', { hasText: /I have read and agree/i })
      .locator('input[type="checkbox"]')
      .check()

    // Sign with the mouse.
    await drawSignature(page)

    // Approve.
    await page.getByRole('button', { name: /^Approve quote$/ }).click()

    await expect(page.getByRole('heading', { name: /Thanks,/i })).toBeVisible({
      timeout: 20000,
    })

    // Confirm the DB side-effect via admin GET (admin cookie via storageState).
    const detailRes = await request.get(`${BASE_URL}/api/actions/quotes/${quoteId}`)
    expect(detailRes.ok()).toBe(true)
    const detail = await detailRes.json()
    expect(detail.quote.status).toBe('converted')
    expect(detail.quote.approved_at).toBeTruthy()
  })

  test('approve button stays disabled until signature + agreement ready', async ({
    page,
    request,
  }) => {
    const { token } = await seedQuoteWithPlan(request)
    await page.goto(`${BASE_URL}/quote/${token}/v2`)

    const approve = page.getByRole('button', { name: /^Approve quote$/ })
    await expect(approve).toBeDisabled()

    // Tick agreement — still disabled (no signature yet).
    await page
      .locator('label', { hasText: /I have read and agree/i })
      .locator('input[type="checkbox"]')
      .check()
    await expect(approve).toBeDisabled()

    // Sign → now enabled.
    await drawSignature(page)
    await expect(approve).toBeEnabled()
  })
})
