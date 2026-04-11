import { test, expect } from '@playwright/test'

test.describe('Memberships / Service Plans', () => {
  test('memberships page loads', async ({ page }) => {
    await page.goto('/memberships')
    await page.waitForLoadState('networkidle')

    const content = await page.textContent('body')
    const hasMembershipContent = content?.includes('Weekly') ||
      content?.includes('Bi-Weekly') ||
      content?.includes('Monthly') ||
      content?.includes('Membership') ||
      content?.includes('Service Plan') ||
      content?.includes('No active')

    expect(hasMembershipContent).toBeTruthy()
  })

  test('memberships page does not error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await page.goto('/memberships')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // No JS errors should have occurred
    expect(errors).toHaveLength(0)
  })
})

test.describe('Service Plans API', () => {
  test('service plans endpoint returns data', async ({ request }) => {
    const response = await request.get('/api/service-plans')
    // Should return 200 or 401 (auth required)
    expect([200, 401].includes(response.status())).toBeTruthy()
  })
})
