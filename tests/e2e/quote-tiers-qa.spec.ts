import { test, expect } from '@playwright/test'

const BASE = 'https://cleanmachine.live'

// Quote page QA tests — tiers, recurring, addons, pricing, currency

test.describe('Quote Page — Tier Display', () => {

  test('Spotless standard shows 2 tiers, no Extra Deep', async ({ page }) => {
    await page.goto(`${BASE}/quote/493c8a1d539c595f9541621e95dbedbf59fd5b6df5f5714c`)
    await page.waitForLoadState('networkidle')
    // Tier selection heading
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })
    // Count tier cards (buttons with tier names in the grid)
    const tierCards = page.locator('.space-y-3 > button, .sm\\:grid > button')
    await expect(tierCards).toHaveCount(2)
    // Verify names
    const html = await page.content()
    expect(html).toContain('Standard Clean')
    expect(html).toContain('Deep Clean')
    expect(html).not.toContain('Extra Deep Clean')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-spotless-2tiers.png', fullPage: true })
  })

  test('Cedar Rapids standard shows 2 tiers with correct pricing', async ({ page }) => {
    await page.goto(`${BASE}/quote/e2bc19d0026af78e4d39f0c08d5ecadea168722e20f60c5e`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })
    const html = await page.content()
    expect(html).toContain('Standard Clean')
    expect(html).toContain('Deep Clean')
    expect(html).not.toContain('Extra Deep Clean')
    // Cedar 3b/2ba standard = $190
    expect(html).toContain('$190')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-cedar-2tiers.png', fullPage: true })
  })

  test('West Niagara shows $ not CA$', async ({ page }) => {
    await page.goto(`${BASE}/quote/d59db7d3987486117aed7a26f137f5ff01192f292f42248b`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })
    const html = await page.content()
    expect(html).not.toContain('CA$')
    expect(html).toContain('Standard Clean')
    expect(html).toContain('Deep Clean')
    expect(html).not.toContain('Extra Deep Clean')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-niagara-no-ca.png', fullPage: true })
  })

  test('Spotless move-out shows single Move-Out Clean tier', async ({ page }) => {
    await page.goto(`${BASE}/quote/b38ce4ed62a5aad06d972e47585b5bf9b1881287769aab20`)
    await page.waitForLoadState('networkidle')
    const html = await page.content()
    expect(html).toContain('Move-Out Clean')
    // Should NOT have standard/deep as selectable tier buttons
    const tierButtons = page.locator('button:has-text("Standard Clean"):visible')
    await expect(tierButtons).toHaveCount(0)
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-spotless-moveout.png', fullPage: true })
  })

  test('Niagara move-out shows $ not CA$', async ({ page }) => {
    await page.goto(`${BASE}/quote/ba6a6b12c2e48c04383b784c2db8724660fba2b4f0ff5aed`)
    await page.waitForLoadState('networkidle')
    const html = await page.content()
    expect(html).toContain('Move-Out Clean')
    expect(html).not.toContain('CA$')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-niagara-moveout.png', fullPage: true })
  })
})

test.describe('Quote Page — Recurring Upsell', () => {

  test('Recurring shows when Standard selected, nothing preselected', async ({ page }) => {
    await page.goto(`${BASE}/quote/493c8a1d539c595f9541621e95dbedbf59fd5b6df5f5714c`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })
    // Click standard tier (first tier card)
    await page.locator('[class*="rounded-2xl"][class*="border-2"]').first().click()
    await page.waitForTimeout(500)
    // Recurring section visible
    await expect(page.getByText('Save on Every Clean')).toBeVisible()
    const html = await page.content()
    expect(html).toContain('One-Time')
    expect(html).toContain('Weekly')
    expect(html).toContain('Bi-Weekly')
    expect(html).toContain('Monthly')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-recurring-visible.png', fullPage: true })
  })

  test('Recurring hidden when Deep selected', async ({ page }) => {
    await page.goto(`${BASE}/quote/493c8a1d539c595f9541621e95dbedbf59fd5b6df5f5714c`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })
    // Click deep tier (second tier card)
    const tierCards = page.locator('[class*="rounded-2xl"][class*="border-2"]')
    await tierCards.nth(1).click()
    await page.waitForTimeout(500)
    // Recurring should NOT be visible
    await expect(page.getByText('Save on Every Clean')).not.toBeVisible()
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-recurring-hidden.png', fullPage: true })
  })

  test('Custom quote with membership_plan shows recurring with Monthly pre-toggled', async ({ page }) => {
    await page.goto(`${BASE}/quote/83dd1c81e1fc9d2276d729774c3c36bb9f51cf5ae7fcc322`)
    await page.waitForLoadState('networkidle')
    const html = await page.content()
    expect(html).toContain('Your Custom Quote')
    // Should show full recurring selection (not locked)
    expect(html).toContain('Save on Every Clean')
    expect(html).toContain('One-Time')
    expect(html).toContain('Monthly')
    expect(html).toContain('Weekly')
    // Monthly should be pre-toggled (operator selected it)
    expect(html).toContain('$125') // one-time price
    expect(html).toContain('$115') // monthly discounted ($125 - $10)
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-custom-recurring-toggled.png', fullPage: true })
  })

  test('Custom deep clean quote has no recurring', async ({ page }) => {
    await page.goto(`${BASE}/quote/9beaa578e76033317900ce8f660702283af9ab29270adc8d`)
    await page.waitForLoadState('networkidle')
    const html = await page.content()
    expect(html).toContain('Deep Clean')
    expect(html).not.toContain('Save on Every Clean')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-deep-no-recurring.png', fullPage: true })
  })

  test('Move-out quote has no recurring', async ({ page }) => {
    await page.goto(`${BASE}/quote/b38ce4ed62a5aad06d972e47585b5bf9b1881287769aab20`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    const html = await page.content()
    expect(html).not.toContain('Save on Every Clean')
    expect(html).not.toContain('Recurring Plan Active')
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-moveout-no-recurring.png', fullPage: true })
  })
})

test.describe('Quote Page — Addons & Total', () => {

  test('Addons display correctly, no carpet steam', async ({ page }) => {
    await page.goto(`${BASE}/quote/493c8a1d539c595f9541621e95dbedbf59fd5b6df5f5714c`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Customize Your Clean')).toBeVisible({ timeout: 15000 })
    const html = await page.content()
    // Key addons present
    expect(html).toContain('Inside cabinets')
    expect(html).toContain('Range Hood')
    expect(html).toContain('Baseboards')
    expect(html).toContain('Blinds')
    // Carpet steam should NOT appear
    expect(html).not.toContain('Carpet Steam')
    // Prices
    expect(html).toContain('$50.00') // cabinets or garage
    expect(html).toContain('$40.00') // baseboards or blinds
    expect(html).toContain('$25.00') // fridge, oven, etc
    await page.screenshot({ path: 'tests/e2e/screenshots/qa-addons.png', fullPage: true })
  })

  test('Total updates when toggling addon', async ({ page }) => {
    await page.goto(`${BASE}/quote/493c8a1d539c595f9541621e95dbedbf59fd5b6df5f5714c`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Choose Your Package')).toBeVisible({ timeout: 15000 })

    // Click standard tier
    await page.locator('[class*="rounded-2xl"][class*="border-2"]').first().click()
    await page.waitForTimeout(500)

    // Get initial total from the book button (use first — there's a mobile sticky + desktop)
    const bookBtn = page.locator('button:has-text("Save Card & Book")').first()
    const initialText = await bookBtn.textContent()
    // Spotless 1b/1ba standard = $150
    expect(initialText).toContain('$150')

    // Click "Inside cabinets" addon ($50) — find the addon button by its name
    await page.locator('button:has-text("Inside cabinets")').click()
    await page.waitForTimeout(500)

    // Total should now be $200
    const newText = await bookBtn.textContent()
    expect(newText).toContain('$200')

    await page.screenshot({ path: 'tests/e2e/screenshots/qa-total-update.png', fullPage: true })
  })
})
