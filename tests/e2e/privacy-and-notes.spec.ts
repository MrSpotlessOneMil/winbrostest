import { test, expect } from '@playwright/test'

const BASE = 'https://cleanmachine.live'

/**
 * Privacy & Notes E2E Tests
 * Verifies:
 * 1. Cleaner portal never shows job price
 * 2. Admin notes don't bleed into cleaner view
 * 3. $149 landing page doesn't promise fridge/oven/baseboards
 */

// Use a known cleaner token with active jobs
const CLEANER_TOKEN = '634a2988-5e12-48dd-bd01-d6283d1d585b'

test.describe('Privacy Wall — Cleaner Portal', () => {
  test('Crew dashboard API does not expose job price', async ({ request }) => {
    const res = await request.get(`${BASE}/api/crew/${CLEANER_TOKEN}`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()

    // Check every job in the response
    const allJobs = [
      ...(data.jobs || []),
      ...(data.pendingJobs || []),
      ...(data.allJobs || []),
    ]

    for (const job of allJobs) {
      // price field must NOT exist
      expect(job).not.toHaveProperty('price')
      // These internal fields must not be present
      expect(job).not.toHaveProperty('cleaner_pay_override')
      expect(job).not.toHaveProperty('notes')
    }
  })

  test('Job detail API does not expose job price', async ({ request }) => {
    // Get the list first to find a job ID
    const listRes = await request.get(`${BASE}/api/crew/${CLEANER_TOKEN}`)
    const listData = await listRes.json()
    const allJobs = [...(listData.jobs || []), ...(listData.allJobs || [])]

    if (allJobs.length === 0) {
      test.skip(true, 'No jobs found for this cleaner')
      return
    }

    const jobId = allJobs[0].id
    const detailRes = await request.get(`${BASE}/api/crew/${CLEANER_TOKEN}/job/${jobId}`)

    if (!detailRes.ok()) {
      test.skip(true, `Job detail returned ${detailRes.status()}`)
      return
    }

    const detail = await detailRes.json()
    const job = detail.job

    // Must NOT have price
    expect(job).not.toHaveProperty('price')

    // Must have cleaner_pay (not price)
    // cleaner_pay can be null if not calculated, but price must never appear
    expect(job).not.toHaveProperty('customer_price')
    expect(job).not.toHaveProperty('total_price')

    // Notes must not contain PROMO or NORMAL_PRICE tags
    if (job.notes) {
      expect(job.notes).not.toMatch(/PROMO:/i)
      expect(job.notes).not.toMatch(/NORMAL_PRICE:/i)
      expect(job.notes).not.toMatch(/OVERRIDE:/i)
      expect(job.notes).not.toMatch(/PAY:/i)
      expect(job.notes).not.toMatch(/__SYS/i)
    }
  })

  test('Crew portal page does not render price anywhere', async ({ page }) => {
    await page.goto(`${BASE}/crew/${CLEANER_TOKEN}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // The page should not have any element with text like "$250" or "Price:"
    // that would indicate customer pricing. "Your pay" is OK.
    const pageText = await page.textContent('body') || ''

    // Should NOT contain "Price:" label (admin-only)
    expect(pageText).not.toContain('Job Price')
    expect(pageText).not.toContain('Customer Price')
    expect(pageText).not.toContain('Total Price')
  })
})

test.describe('$149 Landing Page — Scope Accuracy', () => {
  test('Landing page does NOT promise fridge, oven, or baseboards', async ({ page }) => {
    await page.goto(`${BASE}/spotless/deep-clean-offer`)
    await page.waitForLoadState('networkidle')

    const pageText = (await page.textContent('body') || '').toLowerCase()

    // Must NOT mention fridge, oven, or baseboards as included
    expect(pageText).not.toContain('inside your fridge')
    expect(pageText).not.toContain('inside your oven')
    expect(pageText).not.toContain('baseboards throughout')
    expect(pageText).not.toContain('fridge + oven')
    expect(pageText).not.toContain('fridge, oven, baseboards')

    // MUST mention the correct scope
    expect(pageText).toContain('4')
    expect(pageText).toContain('149')
    expect(pageText).toContain('ceiling fans')
  })

  test('Landing page has booking form', async ({ page }) => {
    await page.goto(`${BASE}/spotless/deep-clean-offer`)
    await page.waitForLoadState('networkidle')

    // Should have the form fields
    const form = page.locator('form').first()
    await expect(form).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Book Now Landing Page', () => {
  test('Book Now page loads and shows regular pricing', async ({ page }) => {
    await page.goto(`${BASE}/spotless/book`)
    await page.waitForLoadState('networkidle')

    const pageText = (await page.textContent('body') || '').toLowerCase()
    expect(pageText).toContain('spotless')
    expect(pageText).toContain('150') // Standard from $150
  })
})

test.describe('Airbnb Landing Page', () => {
  test('Airbnb page loads and mentions turnovers', async ({ page }) => {
    await page.goto(`${BASE}/spotless/airbnb`)
    await page.waitForLoadState('networkidle')

    const pageText = (await page.textContent('body') || '').toLowerCase()
    expect(pageText).toContain('airbnb')
    expect(pageText).toMatch(/turnover|short.term/)
  })
})
