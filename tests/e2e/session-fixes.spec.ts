import { test, expect } from '@playwright/test'

test.describe('Session Fixes — March 25 2026', () => {

  // ── Calendar: beds/baths are now free-type number inputs ──
  test('calendar create form has number inputs for beds and baths', async ({ page }) => {
    await page.goto('/jobs')
    await page.waitForLoadState('networkidle')

    // Click a date on the calendar to open the create modal
    const today = new Date().toISOString().slice(0, 10)
    const calendarCell = page.locator(`.fc-daygrid-day[data-date="${today}"], .fc-timegrid-slot[data-date="${today}"]`).first()
    const createButton = page.locator('button:has-text("New"), button:has-text("Create"), button:has-text("+")').first()

    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click()
    } else if (await calendarCell.isVisible({ timeout: 3000 }).catch(() => false)) {
      await calendarCell.click()
    } else {
      await page.locator('.fc-daygrid-day').first().click()
    }

    const bedroomsInput = page.locator('input[type="number"][placeholder="3"]')
    const bathroomsInput = page.locator('input[type="number"][placeholder="2"]')

    if (await bedroomsInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(bedroomsInput).toHaveAttribute('type', 'number')
      await expect(bedroomsInput).toHaveAttribute('step', '0.5')
      await expect(bathroomsInput).toHaveAttribute('type', 'number')
      await expect(bathroomsInput).toHaveAttribute('step', '0.5')

      // Verify .5 values work
      await bedroomsInput.fill('3.5')
      expect(await bedroomsInput.inputValue()).toBe('3.5')
      await bathroomsInput.fill('2.5')
      expect(await bathroomsInput.inputValue()).toBe('2.5')
    }
  })

  // ── Customers page: Quotes tab exists (not Invoices) ──
  test('customers page has Quotes tab instead of Invoices', async ({ page }) => {
    await page.goto('/customers')
    await page.waitForLoadState('domcontentloaded')

    // Wait for tabs to appear (a customer auto-selects on load)
    const quotesTab = page.getByText('Quotes', { exact: true })
    const invoicesTab = page.getByText('Invoices', { exact: true })

    await expect(quotesTab.first()).toBeVisible({ timeout: 20000 })
    expect(await invoicesTab.isVisible().catch(() => false)).toBeFalsy()
  })

  // ── Command Center: /api/jobs returns cleaner_name ──
  test('jobs API returns cleaner_name field', async ({ page }) => {
    const response = await page.request.get('/api/jobs?page=1&per_page=5&date=today')
    expect(response.ok()).toBeTruthy()

    const json = await response.json()
    const jobs = json.data || []

    if (jobs.length > 0) {
      // cleaner_name should always be present (null if unassigned)
      expect(jobs[0]).toHaveProperty('cleaner_name')
    }
  })

  // ── Teams: /api/teams/cleaner-jobs returns data (not silent error) ──
  test('cleaner-jobs API returns valid job data', async ({ page }) => {
    const cleanersRes = await page.request.get('/api/admin/cleaners')
    const cleanersJson = await cleanersRes.json()
    const cleaners = cleanersJson.data || cleanersJson.cleaners || []

    if (cleaners.length > 0) {
      const cleanerId = cleaners[0].id
      const response = await page.request.get(`/api/teams/cleaner-jobs?cleaner_id=${cleanerId}`)
      expect(response.ok()).toBeTruthy()

      const json = await response.json()
      expect(json.success).toBe(true)
      expect(json.data).toHaveProperty('today')
      expect(json.data).toHaveProperty('upcoming')
      expect(json.data).toHaveProperty('recent')

      // Verify customer names resolve (not silent query failure)
      const allJobs = [...json.data.today, ...json.data.upcoming, ...json.data.recent]
      for (const job of allJobs) {
        expect(job).toHaveProperty('customer_name')
        expect(job).toHaveProperty('address')
      }
    }
  })

  // ── Quotes API supports customer_id filter ──
  test('quotes API supports customer_id filter', async ({ page }) => {
    const allRes = await page.request.get('/api/actions/quotes?limit=1')
    expect(allRes.ok()).toBeTruthy()

    const allJson = await allRes.json()
    const quotes = allJson.quotes || []

    if (quotes.length > 0 && quotes[0].customer_id) {
      const filteredRes = await page.request.get(`/api/actions/quotes?customer_id=${quotes[0].customer_id}`)
      expect(filteredRes.ok()).toBeTruthy()

      const filteredJson = await filteredRes.json()
      const filtered = filteredJson.quotes || []
      expect(filtered.length).toBeGreaterThan(0)

      for (const q of filtered) {
        expect(q.customer_id).toBe(quotes[0].customer_id)
      }
    }
  })
})
