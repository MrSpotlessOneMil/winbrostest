import { test, expect } from '@playwright/test'

test.describe('Dashboard Smoke Tests', () => {
  test('overview page loads', async ({ page }) => {
    await page.goto('/overview')
    await expect(page).toHaveURL(/overview/)
    await expect(page.locator('nav, [class*="sidebar"]').first()).toBeVisible({ timeout: 10000 })
  })

  test('customers page loads', async ({ page }) => {
    await page.goto('/customers')
    await expect(page.getByText(/Customers|Customer/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('inbox page loads', async ({ page }) => {
    await page.goto('/inbox')
    await expect(page.getByText(/Inbox|Conversations/i).first()).toBeVisible({ timeout: 10000 })
  })

  test('leads page loads', async ({ page }) => {
    await page.goto('/leads')
    await expect(page.getByRole('heading', { name: 'Lead Funnel' })).toBeVisible({ timeout: 10000 })
  })

  test('navigation to customers works', async ({ page }) => {
    await page.goto('/overview')
    await page.waitForLoadState('networkidle')

    // Click sidebar link to customers
    const customersLink = page.locator('a[href*="customers"]').first()
    await customersLink.click()
    await expect(page).toHaveURL(/customers/)
  })

  test('unauthenticated API returns 401', async ({ browser }) => {
    // Create a clean context without auth cookies
    const context = await browser.newContext()
    const page = await context.newPage()

    // API routes should return 401 without session cookie
    const response = await page.request.get('/api/auth/session')
    const data = await response.json()
    // Should either be 401 or return no user
    expect(response.status() === 401 || !data.user).toBeTruthy()

    await context.close()
  })
})
