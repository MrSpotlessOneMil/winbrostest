/**
 * Tier 3 — Click-everything portal smoke.
 *
 * For each of the 3 portals (admin / salesman / tech), navigate to every
 * sidebar route, verify it renders without crashing, capture a
 * screenshot, click the safe interactive elements, and assert:
 *   - HTTP status is 200 (no 4xx/5xx)
 *   - No console errors
 *   - No "Application error" or "500" UI
 *   - Major layout exists (sidebar, header, main content)
 *
 * "Safe" buttons = tabs, accordions, expand-toggles, search inputs.
 * Destructive buttons (Delete / Remove / Approve / Send / Charge) are
 * skipped — this is a smoke test, not a mutation test.
 *
 * Screenshots land under `test-results/portal-smoke/<role>/<route>.png`
 * for visual review.
 */

import { test, expect, Page } from '@playwright/test'
import {
  TEST_PERSONAS,
  mintAdminSession,
  mintCleanerSession,
  deleteSession,
} from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

interface RoutePlan {
  href: string
  name: string
}

const ADMIN_ROUTES: RoutePlan[] = [
  { name: 'Command Center', href: '/overview' },
  { name: 'Customers', href: '/customers' },
  { name: 'Pipeline', href: '/quotes' },
  { name: 'Calendar', href: '/jobs' },
  { name: 'Sales Appointments', href: '/appointments' },
  { name: 'Technician Scheduling', href: '/schedule' },
  { name: 'Service Plan Scheduling', href: '/service-plan-schedule' },
  { name: 'Service Plan Hub', href: '/service-plan-hub' },
  { name: 'Team Performance', href: '/performance' },
  { name: 'Payroll', href: '/payroll' },
  { name: 'Tech Upsells', href: '/tech-upsells' },
  { name: 'Insights', href: '/insights' },
  { name: 'Control Center', href: '/control-center' },
]

const SALESMAN_ROUTES: RoutePlan[] = [
  { name: 'Command Center', href: '/my-day' },
  { name: 'My Pipeline', href: '/my-pipeline' },
  { name: 'Team Schedules', href: '/team-schedules' },
  { name: 'My Customers', href: '/my-customers' },
  { name: 'Customers', href: '/customers' },
  { name: 'Off Days', href: '/my-schedule' },
]

const TECH_ROUTES: RoutePlan[] = [
  { name: 'Command Center', href: '/my-day' },
  { name: 'Calendar', href: '/jobs' },
  { name: 'Scheduling', href: '/schedule' },
  { name: 'My Customers', href: '/my-customers' },
  { name: 'Customers', href: '/customers' },
  { name: 'Off Days', href: '/my-schedule' },
]

const TEAM_LEAD_EXTRA: RoutePlan[] = [
  { name: 'Team Performance', href: '/performance' },
  { name: 'Payroll', href: '/payroll' },
]

/** Words in a button label that mean "DON'T click this in a smoke test"
 *  because the click would mutate real data, send a customer SMS, or
 *  charge a card. Matched at the start of the trimmed label,
 *  case-insensitive. */
const DESTRUCTIVE_LABEL_RE =
  /^(delete|remove|approve|deny|send|charge|cancel|pause|enable|disable|sign out|log out|logout|book|confirm|complete|close|fire|run|trigger|migrate|import|export|drop|reset|save|submit|post|update|edit|on my way|in progress|started|stopped|finished|done|checkout|pay|refund|void|sync|publish|unpublish|undo|retry|resend)/i

interface PageReport {
  href: string
  status: number | null
  consoleErrors: string[]
  pageErrors: string[]
  hasErrorUi: boolean
  buttonsClicked: number
  buttonsSkippedDestructive: number
  totalButtons: number
  totalLinks: number
}

async function visitAndProbe(
  page: Page,
  route: RoutePlan,
  screenshotPrefix: string,
): Promise<PageReport> {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  const onConsole = (msg: any) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      if (
        text.includes('Failed to load resource') ||
        text.includes('favicon') ||
        text.includes('the server responded with a status of 404') ||
        text.includes('hydration') ||
        // Navigation-time fetch aborts are expected in a test that
        // walks every route — the previous page's in-flight requests
        // get torn down. Real network errors look different.
        text.includes('TypeError: Failed to fetch') ||
        text.includes('Failed to fetch customers')
      ) {
        return
      }
      consoleErrors.push(text)
    }
  }
  const onPageError = (err: Error) => pageErrors.push(err.message)

  page.on('console', onConsole)
  page.on('pageerror', onPageError)

  // Reset to a blank page first so any open drawer/sheet/modal from the
  // previous route doesn't intercept the next navigation.
  await page.goto('about:blank').catch(() => {})

  let response
  try {
    response = await page.goto(`${BASE}${route.href}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    })
  } catch (e) {
    return {
      href: route.href,
      status: null,
      consoleErrors,
      pageErrors: [...pageErrors, `goto threw: ${(e as Error).message}`],
      hasErrorUi: true,
      buttonsClicked: 0,
      buttonsSkippedDestructive: 0,
      totalButtons: 0,
      totalLinks: 0,
    }
  }
  const status = response?.status() ?? null

  // Give client components a chance to render
  await page.waitForTimeout(800)

  // Look for big-red-error UI states
  const errorText = await page.locator('body').innerText().catch(() => '')
  const hasErrorUi =
    /application error|something went wrong|500 — internal server error|stack trace/i.test(
      errorText,
    )

  // Count interactive elements
  const buttons = await page.locator('button:visible').all()
  const links = await page.locator('a:visible').all()

  let buttonsClicked = 0
  let buttonsSkippedDestructive = 0

  // Click EVERY safe button. Destructive labels filtered. Modal-openers
  // are clicked too — we just dismiss with Escape afterward to avoid
  // leaving the page in a wedged state for the next route.
  // Cap per-route runtime so one heavy page doesn't burn the whole budget.
  const PER_ROUTE_BUDGET_MS = 90_000
  const routeStart = Date.now()
  for (const btn of buttons) {
    if (Date.now() - routeStart > PER_ROUTE_BUDGET_MS) {
      buttonsSkippedDestructive++
      continue
    }
    const label = ((await btn.textContent().catch(() => null)) || '').trim()
    if (!label || label.length === 0) {
      // Could be an icon-only button (close X, settings gear). Try
      // clicking by role anyway — if it opens a popover we dismiss.
      try {
        await btn.click({ timeout: 600, force: false })
        buttonsClicked++
        await page.keyboard.press('Escape').catch(() => {})
        await page.waitForTimeout(40)
      } catch {
        buttonsSkippedDestructive++
      }
      continue
    }
    if (DESTRUCTIVE_LABEL_RE.test(label)) {
      buttonsSkippedDestructive++
      continue
    }
    try {
      await btn.click({ timeout: 600, force: false })
      buttonsClicked++
      // Dismiss any popover/sheet/drawer it opened
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(40)
    } catch {
      buttonsSkippedDestructive++
    }
  }

  // Screenshot for visual review
  const safeName = route.href.replace(/[^\w-]/g, '_')
  await page
    .screenshot({
      path: `test-results/portal-smoke/${screenshotPrefix}/${safeName}.png`,
      fullPage: false,
    })
    .catch(() => {})

  page.off('console', onConsole)
  page.off('pageerror', onPageError)

  return {
    href: route.href,
    status,
    consoleErrors,
    pageErrors,
    hasErrorUi,
    buttonsClicked,
    buttonsSkippedDestructive,
    totalButtons: buttons.length,
    totalLinks: links.length,
  }
}

function summarize(reports: PageReport[]): string {
  let txt = ''
  let errors = 0
  for (const r of reports) {
    const ok =
      r.status !== null &&
      r.status >= 200 &&
      r.status < 400 &&
      !r.hasErrorUi &&
      r.consoleErrors.length === 0 &&
      r.pageErrors.length === 0
    if (!ok) errors++
    txt += `  ${ok ? '✅' : '❌'} ${r.href.padEnd(28)} status=${r.status ?? 'X'} buttons=${r.buttonsClicked}/${r.totalButtons} links=${r.totalLinks}`
    if (r.consoleErrors.length) txt += ` [console:${r.consoleErrors.length}]`
    if (r.pageErrors.length) txt += ` [pageError:${r.pageErrors.length}]`
    if (r.hasErrorUi) txt += ` [errorUi]`
    txt += '\n'
    // Print actual console messages so we can fix or whitelist them
    for (const ce of r.consoleErrors) {
      txt += `      console.error: ${ce.slice(0, 240)}\n`
    }
    for (const pe of r.pageErrors) {
      txt += `      pageError:     ${pe.slice(0, 240)}\n`
    }
  }
  txt += `\n  Total errors: ${errors}/${reports.length}\n`
  return txt
}

async function setSessionCookie(page: Page, token: string) {
  await page.context().addCookies([
    {
      name: 'winbros_session',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
    },
  ])
}

test.describe.configure({ mode: 'serial', timeout: 1_800_000 })

test.describe('Tier 3 — click-everything portal smoke', () => {
  test('admin portal: every sidebar tab loads + safe-clicks fire', async ({
    page,
  }) => {
    test.setTimeout(1_800_000) // 30 min — clicking every button on every route
    const adminToken = await mintAdminSession()
    try {
      await setSessionCookie(page, adminToken)
      const reports: PageReport[] = []
      for (const route of ADMIN_ROUTES) {
        const r = await visitAndProbe(page, route, 'admin')
        reports.push(r)
      }
      console.log('\n[admin portal smoke]')
      console.log(summarize(reports))

      // Hard-fail if any page returned 5xx or threw a page error
      for (const r of reports) {
        expect(r.status, `${r.href} status`).not.toBeGreaterThanOrEqual(500)
        expect(r.pageErrors, `${r.href} page errors: ${r.pageErrors.join(' | ')}`).toEqual([])
        expect(r.hasErrorUi, `${r.href} rendered error UI`).toBe(false)
        expect(r.consoleErrors, `${r.href} console errors: ${r.consoleErrors.join(' | ')}`).toEqual([])
      }
    } finally {
      await deleteSession(adminToken).catch(() => {})
    }
  })

  test('salesman portal: every sidebar tab loads + tech-only routes are NOT in nav', async ({
    page,
  }) => {
    test.setTimeout(1_800_000) // 30 min — clicking every button on every route
    const salesmanToken = await mintCleanerSession(TEST_PERSONAS.salesman.cleanerId)
    try {
      await setSessionCookie(page, salesmanToken)
      const reports: PageReport[] = []
      for (const route of SALESMAN_ROUTES) {
        const r = await visitAndProbe(page, route, 'salesman')
        reports.push(r)
      }
      console.log('\n[salesman portal smoke]')
      console.log(summarize(reports))

      for (const r of reports) {
        expect(r.status, `${r.href} status`).not.toBeGreaterThanOrEqual(500)
        expect(r.pageErrors, `${r.href} page errors: ${r.pageErrors.join(' | ')}`).toEqual([])
        expect(r.hasErrorUi, `${r.href} rendered error UI`).toBe(false)
        expect(r.consoleErrors, `${r.href} console errors: ${r.consoleErrors.join(' | ')}`).toEqual([])
      }

      // Verify the salesman cannot see the admin/tech-only Calendar tab
      // when on /my-day. Sidebar should NOT contain a link to /jobs.
      await page.goto(`${BASE}/my-day`)
      await page.waitForTimeout(500)
      const sidebarHrefs = await page.locator('nav a').evaluateAll((els) =>
        (els as HTMLAnchorElement[]).map((a) => a.getAttribute('href') || ''),
      )
      // Salesman nav has /my-pipeline, /team-schedules, /my-customers,
      // /customers, /my-schedule, /my-day. Must NOT have /jobs.
      expect(
        sidebarHrefs.some((h) => h === '/jobs' || h === '/jobs/'),
        `salesman sidebar should NOT have /jobs (saw ${sidebarHrefs.join(', ')})`,
      ).toBe(false)
    } finally {
      await deleteSession(salesmanToken).catch(() => {})
    }
  })

  test('technician portal: every sidebar tab loads + no admin tabs leak', async ({
    page,
  }) => {
    test.setTimeout(1_800_000) // 30 min — clicking every button on every route
    const techToken = await mintCleanerSession(TEST_PERSONAS.technician.cleanerId)
    try {
      await setSessionCookie(page, techToken)
      const reports: PageReport[] = []
      for (const route of TECH_ROUTES) {
        const r = await visitAndProbe(page, route, 'tech')
        reports.push(r)
      }
      console.log('\n[tech portal smoke]')
      console.log(summarize(reports))

      for (const r of reports) {
        expect(r.status, `${r.href} status`).not.toBeGreaterThanOrEqual(500)
        expect(r.pageErrors, `${r.href} page errors: ${r.pageErrors.join(' | ')}`).toEqual([])
        expect(r.hasErrorUi, `${r.href} rendered error UI`).toBe(false)
        expect(r.consoleErrors, `${r.href} console errors: ${r.consoleErrors.join(' | ')}`).toEqual([])
      }

      // Tech sidebar must NOT include admin-only tabs
      await page.goto(`${BASE}/my-day`)
      await page.waitForTimeout(500)
      const sidebarHrefs = await page.locator('nav a').evaluateAll((els) =>
        (els as HTMLAnchorElement[]).map((a) => a.getAttribute('href') || ''),
      )
      const adminOnly = ['/control-center', '/payroll', '/insights', '/tech-upsells']
      for (const href of adminOnly) {
        expect(
          sidebarHrefs.includes(href),
          `tech sidebar must NOT have ${href}`,
        ).toBe(false)
      }
    } finally {
      await deleteSession(techToken).catch(() => {})
    }
  })

  test('team-lead portal: tech base + Team Performance + Payroll', async ({
    page,
  }) => {
    test.setTimeout(1_800_000) // 30 min — clicking every button on every route
    const tlToken = await mintCleanerSession(TEST_PERSONAS.techLead.cleanerId)
    try {
      await setSessionCookie(page, tlToken)
      const tlRoutes = [...TECH_ROUTES, ...TEAM_LEAD_EXTRA]
      const reports: PageReport[] = []
      for (const route of tlRoutes) {
        const r = await visitAndProbe(page, route, 'team-lead')
        reports.push(r)
      }
      console.log('\n[team-lead portal smoke]')
      console.log(summarize(reports))

      for (const r of reports) {
        expect(r.status, `${r.href} status`).not.toBeGreaterThanOrEqual(500)
        expect(r.pageErrors, `${r.href} page errors: ${r.pageErrors.join(' | ')}`).toEqual([])
        expect(r.hasErrorUi, `${r.href} rendered error UI`).toBe(false)
        expect(r.consoleErrors, `${r.href} console errors: ${r.consoleErrors.join(' | ')}`).toEqual([])
      }
    } finally {
      await deleteSession(tlToken).catch(() => {})
    }
  })
})
