/**
 * Wave 3d browser e2e — customer picker + "Click for directions"
 *
 * Drives a real browser through the Round 2 quote builder and the
 * Appointments New Appointment modal to confirm:
 *   - Select Client button opens the picker modal
 *   - Picker search hits /api/customers
 *   - Selecting a row closes the modal and renders a client card
 *   - Appointments modal shows "Click for directions" with a Google Maps URL
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3002'

async function ensureTestCustomer(
  request: import('@playwright/test').APIRequestContext
): Promise<{ id: number; name: string; phone: string; address: string }> {
  const unique = Date.now()
  const name = 'E2EBrowserPicker'
  const phone = `+1309${Math.floor(1000000 + Math.random() * 9000000)}`
  const address = '404 Eastwood, Morton, IL'
  const res = await request.post(`${BASE_URL}/api/customers`, {
    data: {
      first_name: name,
      last_name: String(unique),
      phone_number: phone,
      email: `browser_wave3d_${unique}@example.test`,
      address,
    },
  })
  if (!res.ok()) throw new Error(`seed failed: ${res.status()} ${await res.text()}`)
  const body = await res.json()
  return {
    id: Number(body.data.id),
    name: `${name} ${unique}`,
    phone,
    address,
  }
}

async function openBuilder(
  page: Page,
  request: import('@playwright/test').APIRequestContext
): Promise<string> {
  const draft = await request.post(`${BASE_URL}/api/actions/quotes`, {
    data: {
      customer_name: 'Draft for picker test',
      line_items: [{ service_name: 'x', price: 1 }],
    },
  })
  if (!draft.ok()) throw new Error(`draft create failed: ${draft.status()}`)
  const body = await draft.json()
  const id: string = body.quote.id
  await page.goto(`${BASE_URL}/quotes/${id}`)
  return id
}

test.describe('Quote builder picker flow', () => {
  test('Select Client opens picker, selecting a customer renders the card', async ({
    page,
    request,
  }) => {
    const customer = await ensureTestCustomer(request)
    await openBuilder(page, request)

    await expect(page.getByRole('heading', { name: 'Quote Builder' })).toBeVisible({
      timeout: 15000,
    })
    await page.getByRole('button', { name: /Select Client/i }).click()
    const search = page.getByPlaceholder(/Search by name or phone/i)
    await expect(search).toBeVisible()

    // Search by phone last digits so we land the seeded customer deterministically.
    const tail = customer.phone.slice(-7)
    await search.fill(tail)

    const candidate = page.locator('button', { hasText: customer.name }).first()
    await expect(candidate).toBeVisible({ timeout: 10000 })
    await candidate.click()

    // Card renders with the selected customer.
    await expect(page.getByText(customer.name)).toBeVisible()
    await expect(page.getByText(customer.address)).toBeVisible()
  })

  test('Create Client tab creates a new customer inline', async ({ page, request }) => {
    await openBuilder(page, request)
    await page.getByRole('button', { name: /Select Client/i }).click()
    await page.getByRole('button', { name: /^Create$/ }).click()

    // Form visible.
    await expect(page.getByText(/Phone \*/)).toBeVisible()

    const uniq = Date.now()
    await page.getByLabel(/First name/i).fill('Inline')
    await page.getByLabel(/Last name/i).fill(String(uniq))
    await page.getByLabel(/Phone \*/).fill(`+1309${Math.floor(Math.random() * 9000000)}`)
    await page.getByLabel(/Email/i).fill(`inline_${uniq}@example.test`)
    await page.getByLabel(/Address/i).fill('123 Inline St')
    await page.getByRole('button', { name: /^Create$/ }).click()

    // Card renders.
    await expect(page.getByText(`Inline ${uniq}`)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('123 Inline St')).toBeVisible()
  })
})

test.describe('Appointments New Appointment modal', () => {
  test('client picker + "Click for directions" link appears after select', async ({
    page,
    request,
  }) => {
    const customer = await ensureTestCustomer(request)
    await page.goto(`${BASE_URL}/appointments`)
    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible({
      timeout: 15000,
    })
    await page.getByRole('button', { name: /New appointment/i }).click()
    await expect(page.getByText(/^New Appointment$/)).toBeVisible()

    // Open picker.
    await page.getByRole('button', { name: /^Select$/ }).first().click()
    const search = page.getByPlaceholder(/Search by name or phone/i)
    await search.fill(customer.phone.slice(-7))
    await page.locator('button', { hasText: customer.name }).first().click()

    // Card + directions button rendered inside the modal.
    await expect(page.getByText(customer.name)).toBeVisible()
    const directions = page.getByRole('link', { name: /Click for directions/i })
    await expect(directions).toBeVisible()
    const href = await directions.getAttribute('href')
    expect(href).toContain('google.com/maps/dir/')
    expect(href).toContain(encodeURIComponent('404 Eastwood'))
  })
})
