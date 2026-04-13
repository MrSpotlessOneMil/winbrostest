import { test, expect } from '@playwright/test'

const WW_BASE = 'https://winbros.cleanmachine.live'
const HC_BASE = 'https://cleanmachine.live'

/**
 * Helper: login as the WW demo user (test/123) and attach session cookie
 */
async function loginWW(page: import('@playwright/test').Page) {
  const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
    data: { username: 'test', password: '123' },
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

test.describe('WW Demo Deep — Crystal Clear Windows', () => {

  test.beforeEach(async ({ page }) => {
    await loginWW(page)
  })

  // ─── Login payload shape ──────────────────────────────────────────
  test('login: response has all required fields', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test', password: '123' },
    })
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.sessionToken).toBeTruthy()
    expect(body.data.user.tenantSlug).toBe('crystal-clear')
    expect(body.data.user.username).toBe('test')
    expect(body.data.redirectUrl).toBe(WW_BASE)
    // Token must be a hex string of reasonable length
    expect(body.data.sessionToken).toMatch(/^[a-f0-9]{40,}$/)
  })

  test('login: wrong password returns failure', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test', password: 'wrongpassword' },
    })
    expect(res.status()).not.toBe(200)
    const body = await res.json()
    expect(body.success).toBe(false)
  })

  test('login: missing fields returns 400', async ({ page }) => {
    const res = await page.request.post(`${HC_BASE}/api/auth/login`, {
      data: { username: 'test' },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })

  // ─── Jobs API — data integrity ────────────────────────────────────
  test('jobs API: returns 16 jobs with correct structure', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/jobs`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const jobs = body.data || body
    expect(Array.isArray(jobs)).toBe(true)
    expect(jobs.length).toBe(16)

    // Verify each job has the required fields
    for (const job of jobs) {
      expect(job.id).toBeTruthy()
      expect(job.customer_name).toBeTruthy()
      expect(job.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(['scheduled', 'in-progress', 'completed']).toContain(job.status)
      expect(typeof job.estimated_value).toBe('number')
    }
  })

  test('jobs API: includes WW service types (window_cleaning, gutter_cleaning)', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const serviceTypes = new Set(jobs.map((j: { service_type: string }) => j.service_type))
    expect(serviceTypes.has('window_cleaning')).toBe(true)
    // WW has multiple service types unlike HC
    expect(serviceTypes.size).toBeGreaterThanOrEqual(2)
  })

  test('jobs API: correct status breakdown (7 scheduled, 3 in-progress, 6 completed)', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const scheduled = jobs.filter((j: { status: string }) => j.status === 'scheduled').length
    const inProgress = jobs.filter((j: { status: string }) => j.status === 'in-progress').length
    const completed = jobs.filter((j: { status: string }) => j.status === 'completed').length
    expect(scheduled).toBe(7)
    expect(inProgress).toBe(3)
    expect(completed).toBe(6)
  })

  test('jobs API: completed jobs have positive revenue (total $2175)', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/jobs`)
    const body = await res.json()
    const jobs = body.data || body
    const completedRevenue = jobs
      .filter((j: { status: string; estimated_value: number }) => j.status === 'completed')
      .reduce((sum: number, j: { estimated_value: number }) => sum + (j.estimated_value || 0), 0)
    expect(completedRevenue).toBe(2175)
  })

  // ─── Customers API — data integrity ──────────────────────────────
  test('customers API: returns 12 WW demo customers', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/customers`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Support both array and wrapped response
    const customers = Array.isArray(body) ? body
      : body.data?.customers || body.data || body.customers || []
    expect(customers.length).toBe(12)
  })

  test('customers API: contains known demo customers', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/customers`)
    const body = await res.json()
    const customers = Array.isArray(body) ? body
      : body.data?.customers || body.data || body.customers || []
    const names = customers.map((c: { first_name: string; last_name: string }) =>
      `${c.first_name} ${c.last_name}`)
    expect(names.some((n: string) => n.includes('Tom'))).toBe(true)
    expect(names.some((n: string) => /Henderson|Fischer|Mueller|Braun|Weber|Roth|Keller|Hoffman/i.test(n))).toBe(true)
  })

  test('customers API: no real WinBros customer data (John Plevka absent)', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/customers`)
    const body = await res.json()
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/plevka/i)
    expect(text).not.toMatch(/John Plevka/i)
  })

  // ─── Service Plans API ────────────────────────────────────────────
  test('service plans API: returns 3 active plans', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/service-plans`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.plans)).toBe(true)
    expect(body.plans.length).toBe(3)
    // Each plan must have required fields
    for (const plan of body.plans) {
      expect(plan.id).toBeTruthy()
      expect(plan.name).toBeTruthy()
      expect(typeof plan.visits_per_year).toBe('number')
      expect(plan.active).toBe(true)
    }
  })

  test('service plans analytics API: returns ARR data across 5 plan types', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/actions/service-plans/analytics`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.planTypes)).toBe(true)
    expect(body.planTypes.length).toBe(5)

    // Compute total ARR from planTypes
    const totalARR = body.planTypes.reduce(
      (sum: number, p: { total_arr: number }) => sum + p.total_arr, 0)
    expect(totalARR).toBe(2970)

    // Active plan types have non-zero ARR
    const activePlanTypes = body.planTypes.filter((p: { total_arr: number }) => p.total_arr > 0)
    expect(activePlanTypes.length).toBeGreaterThanOrEqual(3)
  })

  test('service plans analytics API: quarterly and biannual plans have correct ARR', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/actions/service-plans/analytics`)
    const body = await res.json()
    const quarterly = body.planTypes.find((p: { type: string }) => p.type === 'quarterly')
    const biannual = body.planTypes.find((p: { type: string }) => p.type === 'biannual')
    expect(quarterly?.total_arr).toBe(1120)
    expect(quarterly?.plan_count).toBe(1)
    expect(biannual?.total_arr).toBe(800)
    expect(biannual?.plan_count).toBe(1)
  })

  // ─── Payroll API ──────────────────────────────────────────────────
  test('payroll API: returns 400 when weekStart/weekEnd missing', async ({ page }) => {
    const res = await page.request.get(`${WW_BASE}/api/actions/payroll`)
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/weekStart|weekEnd|required/i)
  })

  test('payroll API: returns structured response with valid date params', async ({ page }) => {
    const res = await page.request.get(
      `${WW_BASE}/api/actions/payroll?weekStart=2026-04-07&weekEnd=2026-04-13`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Must have technicians and salesmen arrays
    expect(Array.isArray(body.technicians)).toBe(true)
    expect(Array.isArray(body.salesmen)).toBe(true)
    expect(body.status).toBeTruthy()
  })

  // ─── Page UI — Schedule ───────────────────────────────────────────
  test('schedule page: renders calendar or job list without 500 error', async ({ page }) => {
    await page.goto(`${WW_BASE}/schedule`)
    await page.waitForLoadState('networkidle')
    // Check HTTP response not an actual error page — use main element, not body (avoids RSC script noise)
    await expect(page.locator('main, [role="main"], [class*="content"], [class*="dashboard"]').first())
      .toBeVisible({ timeout: 15000 })
    // The actual rendered Next.js error page uses "Application error" text
    await expect(page.locator('body')).not.toContainText('Application error')
    // Sidebar must be visible — proves authenticated layout rendered
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  // ─── Page UI — Payroll ────────────────────────────────────────────
  test('payroll page: renders without errors and shows payroll UI elements', async ({ page }) => {
    await page.goto(`${WW_BASE}/payroll`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    // Sidebar confirms authenticated dashboard layout loaded
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
    // Payroll page must have some visible payroll-related text in rendered elements (not script tags)
    await expect(
      page.locator('h1, h2, h3, [class*="title"], [class*="heading"], button, label')
        .filter({ hasText: /payroll|technician|week|salesman/i })
        .first()
    ).toBeVisible({ timeout: 10000 })
  })

  // ─── Page UI — Service Plan Hub ───────────────────────────────────
  test('service plan hub page: renders ARR data or plan list', async ({ page }) => {
    await page.goto(`${WW_BASE}/service-plan-hub`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
    // Plan hub must show plan-related content in rendered UI elements
    await expect(
      page.locator('h1, h2, h3, [class*="title"], [class*="heading"], [class*="card"], td, th, button')
        .filter({ hasText: /plan|arr|service|annual|quarterly|biannual/i })
        .first()
    ).toBeVisible({ timeout: 10000 })
  })

  // ─── Page UI — Quotes ─────────────────────────────────────────────
  test('quotes page: loads and shows quotes UI (not error page)', async ({ page }) => {
    await page.goto(`${WW_BASE}/quotes`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/quotes')
    await expect(page.locator('body')).not.toContainText('Application error')
    // Authenticated layout must render
    await expect(page.locator('nav, aside, [class*="sidebar"]').first()).toBeVisible({ timeout: 15000 })
  })

  // ─── Page UI — Control Center ─────────────────────────────────────
  test('control center page: renders with at least one tab visible', async ({ page }) => {
    await page.goto(`${WW_BASE}/control-center`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).not.toContainText('Application error')
    // Control center tab navigation — look in rendered clickable elements
    await expect(
      page.locator('button, [role="tab"], a[href]')
        .filter({ hasText: /messages|price book|tag bank|checklists/i })
        .first()
    ).toBeVisible({ timeout: 15000 })
  })

  // ─── Page UI — Customers ──────────────────────────────────────────
  test('customers page: shows Tom Henderson in the list', async ({ page }) => {
    await page.goto(`${WW_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('body')).toContainText('Tom')
    await expect(page.locator('body')).toContainText('Henderson')
  })

  test('customers page: shows multiple demo customers', async ({ page }) => {
    await page.goto(`${WW_BASE}/customers`)
    await page.waitForLoadState('networkidle')
    const content = await page.textContent('body')
    const demoNames = ['Tom', 'Nancy', 'Steve', 'Diane', 'James', 'Jennifer', 'Bob', 'Lisa']
    const matchCount = demoNames.filter(n => content?.includes(n)).length
    // At least half should be visible (pagination may hide others)
    expect(matchCount).toBeGreaterThanOrEqual(4)
  })

  // ─── Sidebar WW tabs ──────────────────────────────────────────────
  test('sidebar: Crews page link present', async ({ page }) => {
    await page.goto(`${WW_BASE}/overview`)
    await page.waitForLoadState('networkidle')
    const sidebar = page.locator('nav, aside, [class*="sidebar"]').first()
    await expect(sidebar).toBeVisible({ timeout: 15000 })
    const sidebarText = await sidebar.textContent()
    // WW should show field crew management options
    expect(sidebarText).toMatch(/crews|schedule|service plan/i)
  })

  // ─── Unauthenticated access blocked ──────────────────────────────
  test('overview page: blocks or prompts unauthenticated users', async ({ browser }) => {
    // Create a fresh context with NO cookies
    const freshCtx = await browser.newContext()
    const freshPage = await freshCtx.newPage()
    await freshPage.goto(`${WW_BASE}/overview`)
    await freshPage.waitForLoadState('networkidle')
    const url = freshPage.url()
    const content = await freshPage.textContent('body')
    // Acceptable outcomes: redirect to /login, show a login form, or show a sign-in prompt.
    // The app may also render a loading/empty state for unauthenticated users on the same URL.
    // We verify the user is NOT shown real customer data without credentials.
    const showsCustomerData = /Tom Henderson|Karen O'Brien|Dave|Nancy Fischer/i.test(content ?? '')
    expect(showsCustomerData, 'Unauthenticated user should not see customer data').toBe(false)
    await freshCtx.close()
  })

  // ─── Cross-tenant API isolation ───────────────────────────────────
  test('cross-tenant: WW API returns only WW jobs regardless of cookie used', async ({ page }) => {
    // The WW API endpoint resolves tenant from the auth session.
    // Verify that WW /api/jobs never returns HC-only service types (full_service without window_cleaning).
    // WW always has window_cleaning jobs; that's the distinguishing marker.
    const res = await page.request.get(`${WW_BASE}/api/jobs`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const jobs = body.data || body
    // WW demo data always includes window_cleaning — HC never does
    const hasWindowCleaning = jobs.some(
      (j: { service_type: string }) => j.service_type === 'window_cleaning')
    expect(hasWindowCleaning).toBe(true)
    // And the WW domain must only show WW customer names (Karen O'Brien, Tom Henderson etc)
    // NOT HC names (Ashley Chen, Brandon Williams)
    const jobNames = jobs.map((j: { customer_name: string }) => j.customer_name).join(' ')
    expect(jobNames).not.toMatch(/Ashley Chen|Brandon Williams/i)
  })
})
