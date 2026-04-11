/**
 * Playwright auth setup — logs in once and saves session state
 * for all tests to reuse. Set E2E_USERNAME and E2E_PASSWORD env vars.
 */
import { test as setup, expect } from '@playwright/test'
import path from 'path'

export const STORAGE_STATE = path.join(__dirname, '../../.playwright-auth.json')

setup('authenticate', async ({ page }) => {
  const username = process.env.E2E_USERNAME
  const password = process.env.E2E_PASSWORD

  if (!username || !password) {
    throw new Error(
      'E2E_USERNAME and E2E_PASSWORD env vars are required.\n' +
      'Set them before running: E2E_USERNAME=spotless-scrubbers E2E_PASSWORD=test123 npx playwright test'
    )
  }

  await page.goto('/login')

  // Fill login form using input IDs from login page
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
  await page.locator('button[type="submit"]').click()

  // Wait for redirect to dashboard
  await expect(page).not.toHaveURL(/login/, { timeout: 15000 })

  // Save session state (cookie)
  await page.context().storageState({ path: STORAGE_STATE })
})
