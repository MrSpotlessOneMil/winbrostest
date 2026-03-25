/**
 * E2E test: verify add-on auto-select when choosing Deep Cleaning or Move-in/out
 */
import { test, expect } from '@playwright/test'

const BASE = 'https://cleanmachine.live'

test.describe('Add-on auto-select on service type change', () => {
  test.setTimeout(60000)

  test.beforeEach(async ({ page }) => {
    // Go to login — if already authenticated it will redirect to dashboard
    await page.goto(`${BASE}/login`)
    await page.waitForLoadState('networkidle')

    // If still on login page, fill credentials
    const onLogin = page.url().includes('/login')
    if (onLogin) {
      const usernameField = page.locator('#username')
      if (await usernameField.isVisible({ timeout: 3000 }).catch(() => false)) {
        await usernameField.fill('spotless-scrubbers')
        await page.locator('#password').fill('password')
        await page.locator('button[type="submit"]').click()
        await expect(page).not.toHaveURL(/login/, { timeout: 15000 })
      }
    }
  })

  async function openCreateForm(page: any) {
    await page.goto(`${BASE}/jobs`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000) // Let calendar fully render

    // Click a future day cell on the calendar to open create form
    const dayCell = page.locator('td.fc-day-future.fc-daygrid-day').first()
    await dayCell.click({ timeout: 10000 })

    // Wait for the service type dropdown to appear
    await page.waitForTimeout(1000)
    const serviceSelect = page.locator('select').filter({ has: page.locator('option:has-text("Deep cleaning")') }).first()
    await expect(serviceSelect).toBeVisible({ timeout: 10000 })
    return serviceSelect
  }

  test('Deep Cleaning auto-selects inside fridge and inside oven', async ({ page }) => {
    const serviceSelect = await openCreateForm(page)

    // Change to Deep cleaning
    await serviceSelect.selectOption('Deep cleaning')
    await page.waitForTimeout(1000)

    // Verify inside fridge and inside oven checkboxes are checked
    const fridgeCheckbox = page.locator('label:has-text("Inside fridge") input[type="checkbox"]')
    const ovenCheckbox = page.locator('label:has-text("Inside oven") input[type="checkbox"]')

    await expect(fridgeCheckbox).toBeChecked({ timeout: 5000 })
    await expect(ovenCheckbox).toBeChecked({ timeout: 5000 })

    // Verify they show "INCLUDED" label
    await expect(page.locator('label:has-text("Inside fridge"):has-text("INCLUDED")')).toBeVisible()
    await expect(page.locator('label:has-text("Inside oven"):has-text("INCLUDED")')).toBeVisible()
  })

  test('Move-in/out auto-selects fridge, oven, and cabinets', async ({ page }) => {
    const serviceSelect = await openCreateForm(page)

    await serviceSelect.selectOption('Move-in/move-out')
    await page.waitForTimeout(1000)

    const fridgeCheckbox = page.locator('label:has-text("Inside fridge") input[type="checkbox"]')
    const ovenCheckbox = page.locator('label:has-text("Inside oven") input[type="checkbox"]')
    const cabinetsCheckbox = page.locator('label:has-text("Inside cabinets") input[type="checkbox"]')

    await expect(fridgeCheckbox).toBeChecked({ timeout: 5000 })
    await expect(ovenCheckbox).toBeChecked({ timeout: 5000 })
    await expect(cabinetsCheckbox).toBeChecked({ timeout: 5000 })
  })

  test('Switching back to Standard unselects auto-included add-ons', async ({ page }) => {
    const serviceSelect = await openCreateForm(page)

    // Select Deep to auto-check
    await serviceSelect.selectOption('Deep cleaning')
    await page.waitForTimeout(1000)

    // Verify checked first
    await expect(page.locator('label:has-text("Inside fridge") input[type="checkbox"]')).toBeChecked()

    // Switch back to Standard
    await serviceSelect.selectOption('Standard cleaning')
    await page.waitForTimeout(1000)

    // Should be unchecked now
    await expect(page.locator('label:has-text("Inside fridge") input[type="checkbox"]')).not.toBeChecked({ timeout: 5000 })
    await expect(page.locator('label:has-text("Inside oven") input[type="checkbox"]')).not.toBeChecked({ timeout: 5000 })
  })
})
