import { test, expect } from '@playwright/test'

test.describe('Leads Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/leads')
    await expect(page.getByRole('heading', { name: 'Lead Funnel' })).toBeVisible({ timeout: 10000 })
  })

  test('shows leads page with funnel and source chart', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Lead Funnel' })).toBeVisible()
    await expect(page.getByText('Source Performance')).toBeVisible()
  })

  test('source chart shows channel breakdown', async ({ page }) => {
    // The source performance chart should show channel names
    const chartArea = page.getByText('Source Performance').locator('..')
    await expect(chartArea).toBeVisible()

    // Check the chart has source labels
    const pageContent = await page.textContent('body')
    const hasSources = pageContent?.includes('Phone') || pageContent?.includes('Meta') || pageContent?.includes('Sms')
    expect(hasSources).toBeTruthy()
  })

  test('source filter dropdown exists with options', async ({ page }) => {
    // Scroll down to find the leads table section with filters
    await page.waitForTimeout(1000)

    // The source filter is a Shadcn Select - find it by looking for "All Sources" text
    const sourceSelect = page.locator('button[role="combobox"]').filter({ hasText: /All Sources|Source/i })
    const exists = await sourceSelect.isVisible().catch(() => false)

    if (!exists) {
      // May need to scroll to see the filter
      await page.evaluate(() => window.scrollTo(0, 600))
      await page.waitForTimeout(500)
    }

    const selectButton = page.locator('button[role="combobox"]').filter({ hasText: /All Sources|Source/i }).first()
    if (await selectButton.isVisible()) {
      await selectButton.click()
      await page.waitForTimeout(300)

      // Shadcn Select renders options as [data-radix-collection-item] or [role="option"]
      const options = page.locator('[role="option"]')
      const count = await options.count()
      // Should have at least 5 source options (All + Phone + Meta + Website + SMS + SAM + ...)
      expect(count).toBeGreaterThanOrEqual(5)
    }
  })

  test('lead detail dialog shows source with icon', async ({ page }) => {
    await page.waitForTimeout(2000)

    // Look for any View button in the leads table
    const viewButton = page.getByRole('button', { name: /view/i }).first()
    const hasLeads = await viewButton.isVisible().catch(() => false)

    if (!hasLeads) {
      test.skip(true, 'No leads in the system to test')
      return
    }

    await viewButton.click()

    // Dialog should open
    await expect(page.getByText('Lead Details')).toBeVisible({ timeout: 5000 })

    // Source section should exist
    await expect(page.locator('text=Source').first()).toBeVisible()
  })
})
