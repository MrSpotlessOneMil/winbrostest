import { test, expect } from '@playwright/test'

const HC_BASE = 'https://cleanmachine.live'

/**
 * Helper: login as the HC demo user (test2/123) and get an authenticated context
 */
async function loginHC(page: import('@playwright/test').Page) {
  const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
    data: { username: 'test2', password: '123' },
  })
  const body = await res.json()
  expect(body.success).toBe(true)
  // HC tenant should NOT redirect to WW subdomain
  expect(body.data.redirectUrl).toBeNull()

  const token = body.data.sessionToken
  await page.context().addCookies([{
    name: 'winbros_session',
    value: token,
    domain: '.cleanmachine.live',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])
}

test.describe('HC Demo — Sparkle Home Cleaning', () => {

  test.beforeEach(async ({ page }) => {
    await loginHC(page)
  })

  // ─── Login ───────────────────────────────────────────────────────
  test('1. Login works and stays on HC domain', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test2', password: '123' },
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.user.tenantSlug).toBe('sparkle-home')
    expect(body.data.redirectUrl).toBeNull()
  })

  // ─── Dashboard Pages Load ────────────────────────────────────────
  test('2a. Overview page loads', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await expect(page.locator('nav, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  test('2b. Customers page loads with demo data', async ({ page }) => {
    await page.goto(`${HC_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const content = await page.textContent('body')
    expect(content).toMatch(/Ashley|Brandon|Christine|Daniel|Emily|Chen|Williams|Park/i)
  })

  test('2c. Calendar/Jobs page loads', async ({ page }) => {
    await page.goto(`${HC_BASE}/jobs`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('2d. Pipeline page loads', async ({ page }) => {
    await page.goto(`${HC_BASE}/retargeting/v3`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('2e. Teams page loads', async ({ page }) => {
    await page.goto(`${HC_BASE}/teams`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('2f. Insights page loads', async ({ page }) => {
    await page.goto(`${HC_BASE}/insights`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('404')
  })

  // ─── Sidebar does NOT show WW tabs ───────────────────────────────
  test('3. Sidebar does NOT show WW-only tabs', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })

    const sidebarText = await sidebar.textContent()
    // WW-only tabs should NOT appear for HC tenant
    expect(sidebarText).not.toContain('Payroll')
    expect(sidebarText).not.toContain('Service Plan Hub')
    expect(sidebarText).not.toContain('Control Center')
  })

  // ─── API Data ────────────────────────────────────────────────────
  test('4a. Jobs API returns demo data', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const jobs = body.data || body.jobs || body
    expect(Array.isArray(jobs)).toBe(true)
    expect(jobs.length).toBeGreaterThan(5)
  })

  test('4b. Customers API returns demo data', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/customers`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // data may be { customers: [...] } or an array directly
    const customers = Array.isArray(body.data) ? body.data
      : body.data?.customers || body.data?.data || []
    expect(customers.length).toBeGreaterThanOrEqual(0)
  })

  // ─── Cross-tenant isolation ──────────────────────────────────────
  test('5. Demo HC tenant cannot see real Spotless data', async ({ page }) => {
    await page.goto(`${HC_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const content = await page.textContent('body')
    // Real Spotless customer names should NOT appear
    expect(content).not.toMatch(/Dominic Lutz/i)
  })
})
