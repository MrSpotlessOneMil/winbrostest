import { test, expect } from '@playwright/test'

const QUOTE_URL = 'https://cleanmachine.live/quote/e5b105659bd3fed0ba392f16cf6088ecb1ae957a73cfd7e6'

test.describe('Custom Quote — Override Price is Final Total', () => {
  test.setTimeout(30000)

  test('override price = final total, add-ons shown as included, not additive', async ({ page }) => {
    await page.goto(QUOTE_URL, { waitUntil: 'networkidle' })

    // 1. Page loads
    await expect(page.getByRole('heading', { name: 'Your Custom Quote' })).toBeVisible({ timeout: 10000 })

    // 2. Standard Clean shown
    await expect(page.locator('text=Standard Clean').first()).toBeVisible()

    // 3. Base tasks inside blue box
    await expect(page.locator('text=/Included|INCLUDED/i').first()).toBeVisible()

    // 4. Price Summary shows "Custom Quote" at $429.99 — NOT $634.99
    const priceSummary = page.locator('text=Price Summary')
    await priceSummary.scrollIntoViewIfNeeded()
    await expect(page.locator('text=Custom Quote')).toBeVisible()
    await expect(page.locator('text=$429.99').first()).toBeVisible()

    // 5. Total = $429.99 (override price IS the total, add-ons NOT added on top)
    const totalText = await page.locator('text=/Total/').last().textContent()
    expect(totalText).toContain('$429.99')

    // 6. Save Card button = $429.99
    await expect(page.locator('text=/Save Card.*429\.99/i')).toBeVisible()

    // 7. Add-ons listed as "Includes:" not as separate charges
    await expect(page.locator('text=/Includes:.*Laundry/i')).toBeVisible()

    await page.screenshot({ path: 'tests/e2e/artifacts/quote-override-price.png' })
  })
})
