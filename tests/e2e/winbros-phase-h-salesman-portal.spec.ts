/**
 * Phase H — Salesman portal E2E.
 *
 * Verifies the round-trip:
 *   1. A salesman session lands on /my-pipeline and sees the three columns.
 *   2. /team-schedules renders the read-only weekly grid.
 *   3. Sidebar shows salesman-specific entries (My Pipeline, Team Schedules)
 *      and NOT the technician-only entries (Calendar, Scheduling).
 *
 * Auth strategy: directly mint a sessions row via Supabase service role,
 * then inject it as a winbros_session cookie. We intentionally avoid the
 * /api/auth/portal-exchange path because middleware blocks it (see
 * findings 2026-04-28). Username/password login also works but requires
 * a test-account password in env, which we don't have here.
 *
 * Test cleaner: id=134 "Salesman (WinBros Test)". Confirmed active and
 * employee_type='salesman' as of 2026-04-28.
 */

import { test, expect, type BrowserContext } from '@playwright/test'
import { randomUUID } from 'crypto'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'
const SUPABASE_URL = 'https://kcmbwstjmdrjkhxhkkjt.supabase.co'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const TEST_SALESMAN_ID = 134

async function mintSession(cleanerId: number): Promise<string> {
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY env var is required for Phase H E2E')
  }
  const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sessions`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      cleaner_id: cleanerId,
      user_id: null,
      token,
      expires_at: expiresAt,
    }),
  })
  if (!res.ok) {
    throw new Error(`mintSession failed: ${res.status} ${await res.text()}`)
  }
  return token
}

async function deleteSession(token: string): Promise<void> {
  if (!SERVICE_KEY) return
  await fetch(
    `${SUPABASE_URL}/rest/v1/sessions?token=eq.${encodeURIComponent(token)}`,
    {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }
  )
}

async function attachSession(context: BrowserContext, token: string): Promise<void> {
  const u = new URL(BASE)
  await context.addCookies([
    {
      name: 'winbros_session',
      value: token,
      domain: u.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ])
}

test.describe('Phase H — salesman portal', () => {
  let sessionToken: string

  test.beforeAll(async () => {
    sessionToken = await mintSession(TEST_SALESMAN_ID)
  })

  test.afterAll(async () => {
    if (sessionToken) await deleteSession(sessionToken)
  })

  test('sidebar shows My Pipeline + Team Schedules and hides tech-only entries', async ({
    context,
    page,
  }) => {
    await attachSession(context, sessionToken)
    await page.goto(`${BASE}/my-day`)
    await page.waitForLoadState('domcontentloaded')

    const sidebar = page.locator('aside').first()

    // Salesman-only entries must be present.
    await expect(sidebar.getByRole('link', { name: /^My Pipeline$/ })).toBeVisible({ timeout: 15000 })
    await expect(sidebar.getByRole('link', { name: /^Team Schedules$/ })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /^My Customers$/ })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /^Customers$/ })).toBeVisible()
    await expect(sidebar.getByRole('link', { name: /^Off Days$/ })).toBeVisible()

    // Tech-only entries must be HIDDEN. Salesmen don't run the daily
    // Scheduling Gantt or the techs' Calendar.
    const schedulingLink = sidebar.getByRole('link', { name: /^Scheduling$/ })
    expect(await schedulingLink.count()).toBe(0)
    const calendarLink = sidebar.getByRole('link', { name: /^Calendar$/ })
    expect(await calendarLink.count()).toBe(0)
  })

  test('/my-pipeline renders three columns (Leads / Quotes / Jobs)', async ({
    context,
    page,
  }) => {
    await attachSession(context, sessionToken)
    await page.goto(`${BASE}/my-pipeline`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: /My Pipeline/i })).toBeVisible({ timeout: 15000 })

    // Wait for the loader to settle, then assert the three column headers.
    // Each header reads "Leads · N", "Quotes · N", "Jobs · N".
    await expect(page.locator('text=/Leads · \\d+/i')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('text=/Quotes · \\d+/i')).toBeVisible()
    await expect(page.locator('text=/Jobs · \\d+/i')).toBeVisible()
  })

  test('/team-schedules renders 7-day grid', async ({ context, page }) => {
    await attachSession(context, sessionToken)
    await page.goto(`${BASE}/team-schedules`)
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: /Team Schedules/i })).toBeVisible({
      timeout: 15000,
    })
    // 7 day cards rendered.
    await expect(page.locator('[data-testid="team-schedule-day"]')).toHaveCount(7, {
      timeout: 15000,
    })
  })

  test('/api/crew/[token]/pipeline returns shaped { leads, quotes, jobs }', async ({
    request,
  }) => {
    // Token is the salesman's portal_token — Phase C/H APIs are token-auth'd
    // and bypass the session middleware via the /api/crew public prefix.
    const portalToken = '5f6b3902-6851-4581-a211-2333c0b79ed8'
    const res = await request.get(`${BASE}/api/crew/${portalToken}/pipeline`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('leads')
    expect(body).toHaveProperty('quotes')
    expect(body).toHaveProperty('jobs')
    expect(Array.isArray(body.leads)).toBe(true)
    expect(Array.isArray(body.quotes)).toBe(true)
    expect(Array.isArray(body.jobs)).toBe(true)
  })

  test('/api/crew/[token]/pipeline rejects non-salesman with 403', async ({ request }) => {
    // Tech (WinBros Test) — employee_type='technician'. Should get 403.
    const techToken = '0f26a1f5dd309560a85c6ed64defe74c'
    const res = await request.get(`${BASE}/api/crew/${techToken}/pipeline`)
    expect(res.status()).toBe(403)
  })
})
