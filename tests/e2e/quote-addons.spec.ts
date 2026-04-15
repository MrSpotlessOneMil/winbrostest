import { test, expect } from '@playwright/test'

const QUOTE_URL = 'https://cleanmachine.live/quote/e5b105659bd3fed0ba392f16cf6088ecb1ae957a73cfd7e6'

test.describe('Custom Quote — Override = Base Price, Add-ons Additive', () => {
  test.setTimeout(30000)

  test('override replaces base price, add-ons are added on top separately', async ({ page }) => {
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: 'Your Custom Quote' })).toBeVisible({ timeout: 10000 })

    // Scroll to Price Summary
    const priceSummary = page.locator('text=Price Summary')
    await priceSummary.scrollIntoViewIfNeeded()

    // Base Service = $429.99 (the override price, NOT including add-ons)
    await expect(page.locator('text=Base Service')).toBeVisible()
    await expect(page.locator('text=$429.99').first()).toBeVisible()

    // Add-on line items shown separately with "+"
    await expect(page.locator('text=/\\+ Laundry/i')).toBeVisible()
    await expect(page.locator('text=$25.00').first()).toBeVisible()
    await expect(page.locator('text=/\\+ Carpet/i')).toBeVisible()
    await expect(page.locator('text=$180.00').first()).toBeVisible()

    // Total = $634.99 (base $429.99 + laundry $25 + carpet $180)
    await expect(page.locator('text=$634.99').first()).toBeVisible()

    // Save Card button = $634.99
    await expect(page.locator('text=/Save Card.*634\.99/i')).toBeVisible()

    await page.screenshot({ path: 'tests/e2e/artifacts/quote-override-base.png' })
  })
})
