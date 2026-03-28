import { test, expect } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000'

// Mobile iPhone SE viewport
const MOBILE_VIEWPORT = { width: 375, height: 667 }

// Helper: check no horizontal overflow
async function checkNoHorizontalOverflow(page: any, pageName: string) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)
  expect(scrollWidth, `${pageName}: scrollWidth (${scrollWidth}) should not exceed clientWidth (${clientWidth})`).toBeLessThanOrEqual(clientWidth + 2)
}

test.describe('Mobile Responsiveness (375px viewport)', () => {
  test.use({ viewport: MOBILE_VIEWPORT })

  test('Login page — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(1000)
    await checkNoHorizontalOverflow(page, 'Login')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-login.png', fullPage: true })
  })

  test('Cleaner portal landing — no horizontal overflow', async ({ page }) => {
    // Cleaner portal is public (token-based), test with a dummy token
    await page.goto(`${BASE_URL}/crew/test-token`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(1000)
    await checkNoHorizontalOverflow(page, 'Cleaner Portal')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-crew-portal.png', fullPage: true })
  })
})

// Auth-required tests — only run if E2E credentials are available
const hasAuth = !!(process.env.E2E_USERNAME && process.env.E2E_PASSWORD)

test.describe('Mobile Dashboard Pages (requires auth)', () => {
  test.skip(!hasAuth, 'Skipping auth-required tests — set E2E_USERNAME and E2E_PASSWORD')
  test.use({ viewport: MOBILE_VIEWPORT, storageState: '.playwright-auth.json' })

  test('Overview — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/overview`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000)
    await checkNoHorizontalOverflow(page, 'Overview')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-overview.png', fullPage: true })
  })

  test('Pipeline — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/retargeting/v3`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000)
    await checkNoHorizontalOverflow(page, 'Pipeline')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-pipeline.png', fullPage: true })
  })

  test('Teams — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/teams`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000)
    await checkNoHorizontalOverflow(page, 'Teams')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-teams.png', fullPage: true })
  })

  test('Calendar — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/jobs`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(3000)
    await checkNoHorizontalOverflow(page, 'Calendar')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-calendar.png', fullPage: true })
  })

  test('Insights — no horizontal overflow', async ({ page }) => {
    await page.goto(`${BASE_URL}/insights`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    await page.waitForTimeout(2000)
    await checkNoHorizontalOverflow(page, 'Insights')
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-insights.png', fullPage: true })
  })
})
