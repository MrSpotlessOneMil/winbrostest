/**
 * Tier 1 — Portal token exchange smoke (T1.17)
 *
 * Background: This route was 401'ing every SMS magic link in production
 * because middleware had it gated. Fixed in commit history; this spec
 * makes sure it never regresses.
 *
 * Verifies:
 *   1. GET /api/auth/portal-exchange?token=<valid> redirects (302) and
 *      sets a winbros_session cookie. The cookie value is a fresh UUID,
 *      not the portal_token.
 *   2. Bad token → 302 to /login?error=invalid_link, no session cookie.
 *   3. Open-redirect attempts via `next` are sanitized to /schedule.
 *   4. Tokens shorter than 16 chars → invalid_link redirect (no DB hit).
 */

import { test, expect } from '@playwright/test'
import { TEST_PERSONAS } from './_helpers/winbros-fixtures'

const BASE = process.env.WW_BASE_URL || 'http://localhost:3002'

test.describe('Tier 1 — portal-exchange magic link', () => {
  test('valid portal token mints a session cookie and 302s to /schedule', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=${TEST_PERSONAS.salesman.portalToken}`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    const location = res.headers()['location']
    expect(location).toContain('/schedule')

    const setCookie = res.headers()['set-cookie'] || ''
    expect(setCookie).toContain('winbros_session=')
    // The minted session cookie must NOT echo the portal token back.
    expect(setCookie).not.toContain(TEST_PERSONAS.salesman.portalToken)
  })

  test('honors safe relative `next` path', async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=${TEST_PERSONAS.salesman.portalToken}&next=/my-day`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    expect(res.headers()['location']).toContain('/my-day')
  })

  test('rejects open-redirect attempt (//evil.com)', async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=${TEST_PERSONAS.salesman.portalToken}&next=//evil.com/steal`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    const location = res.headers()['location'] || ''
    expect(location).not.toContain('evil.com')
    expect(location).toContain('/schedule')
  })

  test('rejects fully-qualified URL in `next`', async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=${TEST_PERSONAS.salesman.portalToken}&next=https://evil.com/x`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    const location = res.headers()['location'] || ''
    expect(location).not.toContain('evil.com')
  })

  test('invalid (too-short) token → /login?error=invalid_link', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=tooshort`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    expect(res.headers()['location']).toContain('error=invalid_link')
    expect(res.headers()['set-cookie'] || '').not.toContain('winbros_session=')
  })

  test('unknown valid-shaped token → invalid_link (no info leak)', async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=00000000-0000-0000-0000-000000000000`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    expect(res.headers()['location']).toContain('error=invalid_link')
  })

  test('missing token → invalid_link', async ({ request }) => {
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange`,
      { maxRedirects: 0 }
    )
    expect([302, 307]).toContain(res.status())
    expect(res.headers()['location']).toContain('error=invalid_link')
  })

  test('route is publicly reachable — middleware did NOT gate it (regression)', async ({
    request,
  }) => {
    // Without any cookie at all, hitting the endpoint should still produce
    // a 302 redirect, not a 401 from middleware.
    const res = await request.get(
      `${BASE}/api/auth/portal-exchange?token=tooshort`,
      { maxRedirects: 0 }
    )
    expect(res.status(), 'middleware must allow this route').not.toBe(401)
    expect([302, 307]).toContain(res.status())
    expect(res.headers()['location']).toContain('error=invalid_link')
  })
})
