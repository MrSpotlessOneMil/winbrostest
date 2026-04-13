import { test, expect } from '@playwright/test'

const HC_BASE = 'https://cleanmachine.live'
const WW_BASE = 'https://winbros.cleanmachine.live'

/**
 * Helper: login as the HC demo user (test2/123) and attach session cookie
 */
async function loginHC(page: import('@playwright/test').Page) {
  const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
    data: { username: 'test2', password: '123' },
  })
  const body = await res.json()
  expect(body.success).toBe(true)
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

test.describe('HC Demo Deep — Sparkle Home Cleaning', () => {

  test.beforeEach(async ({ page }) => {
    await loginHC(page)
  })

  // ─── Login payload shape ──────────────────────────────────────────
  test('login: response has all required fields', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test2', password: '123' },
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sessionToken).toBeTruthy()
    expect(body.data.user.tenantSlug).toBe('sparkle-home')
    expect(body.data.user.username).toBe('test2')
    // HC stays on HC domain — no redirect
    expect(body.data.redirectUrl).toBeNull()
    expect(body.data.sessionToken).toMatch(/^[a-f0-9]{40,}$/)
  })

  test('login: wrong password returns failure', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test2', password: 'wrongpassword' },
    })
    expect(res.status()).not.toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  test('login: HC user does NOT get redirectUrl to WW subdomain', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test2', password: '123' },
    })
    const body = await res.json()
    // Explicitly: no WW redirect for house-cleaning tenants
    expect(body.data.redirectUrl).not.toBe(WW_BASE)
    expect(body.data.redirectUrl).toBeNull()
  })

  // ─── Jobs API — data integrity ────────────────────────────────────
  test('jobs API: returns exactly 18 jobs', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const jobs = body.data || body
    expect(Array.isArray(jobs)).toBe(true)
    expect(jobs.length).toBe(18)
  })

  test('jobs API: all jobs are full_service (HC-only service type)', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    // HC demo only has full_service, never window_cleaning or gutter_cleaning
    for (const job of jobs) {
      expect(job.service_type).toBe('full_service')
    }
  })

  test('jobs API: correct status breakdown (8 scheduled, 3 in-progress, 7 completed)', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const scheduled = jobs.filter((j: { status: string }) => j.status === 'scheduled').length
    const inProgress = jobs.filter((j: { status: string }) => j.status === 'in-progress').length
    const completed = jobs.filter((j: { status: string }) => j.status === 'completed').length
    expect(scheduled).toBe(8)
    expect(inProgress).toBe(3)
    expect(completed).toBe(7)
  })

  test('jobs API: all jobs have valid scheduled dates', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    for (const job of jobs) {
      expect(job.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(job.customer_name).toBeTruthy()
      expect(job.address).toBeTruthy()
    }
  })

  test('jobs API: no WW service types present', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const wwTypes = jobs.filter(
      (j: { service_type: string }) =>
        j.service_type === 'window_cleaning' || j.service_type === 'gutter_cleaning')
    expect(wwTypes.length).toBe(0)
  })

  // ─── Customers API — data integrity ──────────────────────────────
  test('customers API: returns 12 HC demo customers', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/customers`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const customers = body.data?.customers || body.data || body.customers || body
    const list = Array.isArray(customers) ? customers : []
    expect(list.length).toBe(12)
  })

  test('customers API: contains expected demo customer names', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/customers`)
    const body = await res.json()
    const customers = body.data?.customers || body.data || body.customers || body
    const list = Array.isArray(customers) ? customers : []
    const names = list.map((c: { first_name: string; last_name: string }) =>
      `${c.first_name} ${c.last_name}`)
    // These are confirmed seeded names
    const expectedNames = [
      'Ashley Chen', 'Brandon Williams', 'Christine Park', 'Daniel Nguyen',
      'Emily Rodriguez', 'Frank Kim', 'Grace Johnson', 'Henry Lopez',
    ]
    for (const expected of expectedNames) {
      expect(names.some((n: string) => n === expected),
        `Expected to find customer "${expected}"`).toBe(true)
    }
  })

  test('customers API: no real Spotless customer data present', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/customers`)
    const text = JSON.stringify(await res.json())
    expect(text).not.toMatch(/Dominic Lutz/i)
    expect(text).not.toMatch(/Raza|Mahas/i)
  })

  // ─── Leads API ────────────────────────────────────────────────────
  test('leads API: returns demo leads with correct sources', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/leads`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.total).toBeGreaterThanOrEqual(10)
    expect(Array.isArray(body.data)).toBe(true)
    // HC leads come from multiple sources: meta, sms, website, phone
    const sources = new Set(body.data.map((l: { source: string }) => l.source))
    expect(sources.size).toBeGreaterThanOrEqual(2)
  })

  test('leads API: lead statuses cover the full pipeline', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/leads`)
    const body = await res.json()
    const statuses = new Set(body.data.map((l: { status: string }) => l.status))
    // Should cover new, contacted, qualified, booked
    const expectedStatuses = ['new', 'contacted', 'qualified', 'booked']
    const covered = expectedStatuses.filter(s => statuses.has(s))
    expect(covered.length).toBeGreaterThanOrEqual(3)
  })

  test('leads API: Olivia Price (meta/booked lead) is present', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/leads`)
    const body = await res.json()
    const olivia = body.data.find((l: { name: string }) => l.name === 'Olivia Price')
    expect(olivia).toBeDefined()
    expect(olivia?.source).toBe('meta')
    expect(olivia?.status).toBe('booked')
  })

  // ─── Teams API ────────────────────────────────────────────────────
  test('teams API: returns success with cleaners data', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/teams`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Either teams or unassigned_cleaners array must exist
    const hasCleaner = Array.isArray(body.data) || Array.isArray(body.unassigned_cleaners)
    expect(hasCleaner).toBe(true)
  })

  test('teams API: demo cleaners present (Ana Flores, Jessica Reyes)', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/teams`)
    const body = await res.json()
    const allCleaners = [
      ...(body.data?.flatMap((t: { members: unknown[] }) => t.members || []) || []),
      ...(body.unassigned_cleaners || []),
    ]
    const names = allCleaners.map((c: { name: string }) => c.name)
    expect(names.some((n: string) => n.includes('Ana'))).toBe(true)
    expect(names.some((n: string) => n.includes('Jessica'))).toBe(true)
  })

  // ─── Page UI — Overview ───────────────────────────────────────────
  test('overview page: renders without application error', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    // Next.js real error pages show "Application error" — RSC payloads may contain "500" in chunk IDs
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  // ─── Page UI — Customers ──────────────────────────────────────────
  test('customers page: shows Ashley Chen and Brandon Williams', async ({ page }) => {
    await page.goto(`${HC_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const content = await page.textContent('body')
    expect(content).toMatch(/Ashley|Chen/i)
    expect(content).toMatch(/Brandon|Williams/i)
  })

  test('customers page: no real Spotless data visible', async ({ page }) => {
    await page.goto(`${HC_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const content = await page.textContent('body')
    expect(content).not.toMatch(/Dominic Lutz/i)
  })

  // ─── Page UI — Jobs/Calendar ──────────────────────────────────────
  test('jobs page: renders calendar or list with job entries', async ({ page }) => {
    await page.goto(`${HC_BASE}/jobs`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
    // Calendar or list must contain scheduling-related rendered elements
    await expect(
      page.locator('h1, h2, h3, [class*="title"], [class*="heading"], [class*="calendar"], td, th, button')
        .filter({ hasText: /job|schedule|calendar|clean|april|may/i })
        .first()
    ).toBeVisible({ timeout: 10000 })
  })

  // ─── Page UI — Retargeting / Pipeline ────────────────────────────
  test('pipeline page: loads without application error', async ({ page }) => {
    await page.goto(`${HC_BASE}/retargeting/v3`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  // ─── Page UI — Teams ──────────────────────────────────────────────
  test('teams page: renders team management UI', async ({ page }) => {
    await page.goto(`${HC_BASE}/teams`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
    // Teams page must have some team/cleaner related text in rendered elements
    await expect(
      page.locator('h1, h2, h3, [class*="title"], [class*="heading"], button, td, th, label')
        .filter({ hasText: /team|cleaner|technician|assign/i })
        .first()
    ).toBeVisible({ timeout: 10000 })
  })

  // ─── Page UI — Insights ───────────────────────────────────────────
  test('insights page: loads without application error', async ({ page }) => {
    await page.goto(`${HC_BASE}/insights`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  // ─── Sidebar: WW tabs absent ──────────────────────────────────────
  test('sidebar: no Payroll tab (WW-only feature)', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
    const sidebarText = await sidebar.textContent()
    expect(sidebarText).not.toContain('Payroll')
  })

  test('sidebar: no Service Plan Hub tab (WW-only feature)', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
    const sidebarText = await sidebar.textContent()
    expect(sidebarText).not.toContain('Service Plan Hub')
  })

  test('sidebar: no Control Center tab (WW-only feature)', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
    const sidebarText = await sidebar.textContent()
    expect(sidebarText).not.toContain('Control Center')
  })

  test('sidebar: has HC-specific navigation tabs', async ({ page }) => {
    await page.goto(`${HC_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
    const sidebarText = await sidebar.textContent()
    // HC should have standard cleaning CRM tabs
    expect(sidebarText).toMatch(/customers|jobs|calendar|insights/i)
  })

  // ─── WW pages must not load under HC domain ───────────────────────
  test('WW payroll URL returns 404 under HC domain', async ({ page }) => {
    const res = await page.request.get(`${HC_BASE}/api/actions/payroll`)
    // Payroll is a WW-only endpoint — should 404 on HC domain
    expect(res.status()).toBe(404)
  })

  // ─── Unauthenticated access blocked ──────────────────────────────
  test('overview page: blocks or prompts unauthenticated users', async ({ browser }) => {
    const freshCtx = await browser.newContext()
    const freshPage = await freshCtx.newPage()
    await freshPage.goto(`${HC_BASE}/overview`)
    await freshPage.waitForLoadState('networkidle')
    const content = await freshPage.textContent('body')
    // The app must not expose real customer data to unauthenticated visitors.
    // Acceptable: redirect to /login, show sign-in form, render empty/loading state.
    const showsCustomerData = /Ashley Chen|Brandon Williams|Christine Park|Daniel Nguyen/i.test(content ?? '')
    expect(showsCustomerData, 'Unauthenticated user should not see customer data').toBe(false)
    await freshCtx.close()
  })

  // ─── HC cannot access WW subdomain pages ─────────────────────────
  test('HC session does not expose WW window_cleaning jobs', async ({ page }) => {
    // Get HC jobs — must all be full_service
    const res = await page.request.get(`${HC_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const wwTypeJobs = jobs.filter(
      (j: { service_type: string }) =>
        j.service_type === 'window_cleaning' || j.service_type === 'gutter_cleaning')
    expect(wwTypeJobs.length).toBe(0)
  })
})
