/**
 * Portal Exchange Route Tests
 *
 * Tests GET /api/auth/portal-exchange?token=<>&next=<>:
 * - Valid token + relative next → 302 to next, sets winbros_session cookie
 * - Invalid token → 302 to /login?error=invalid_link
 * - Inactive cleaner → 302 to /login?error=invalid_link
 * - Soft-deleted cleaner → 302 to /login?error=invalid_link
 * - Absolute `next` (open-redirect attempt) → falls back to /schedule
 * - Protocol-relative `next` (//evil.com) → falls back to /schedule
 * - Missing token → 302 to /login?error=invalid_link
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID } from '../../fixtures/cedar-rapids'
import { createMockRequest } from '../../helpers'

let mockClient: MockSupabaseClient

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    createEmployeeSession: vi.fn(async () => 'mock-session-token-' + Math.random().toString(36).slice(2)),
    setSessionCookie: vi.fn((response, token) => {
      response.cookies.set('winbros_session', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
      })
    }),
  }
})

const VALID_TOKEN = 'aaaaaaaaaaaaaaaaaaaa'
const INACTIVE_TOKEN = 'bbbbbbbbbbbbbbbbbbbb'
const DELETED_TOKEN = 'cccccccccccccccccccc'

function seedData() {
  return {
    cleaners: [
      {
        id: 700, tenant_id: WINBROS_ID, name: 'Active Tech',
        portal_token: VALID_TOKEN, active: true, deleted_at: null,
      },
      {
        id: 701, tenant_id: WINBROS_ID, name: 'Inactive Tech',
        portal_token: INACTIVE_TOKEN, active: false, deleted_at: null,
      },
      {
        id: 702, tenant_id: WINBROS_ID, name: 'Deleted Tech',
        portal_token: DELETED_TOKEN, active: true, deleted_at: '2026-01-01T00:00:00Z',
      },
    ],
  }
}

describe('GET /api/auth/portal-exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
  })

  it('redirects to /schedule when given a valid token (default next)', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${VALID_TOKEN}`,
      { method: 'GET' }
    )

    const res = await GET(req)

    expect(res.status).toBe(307) // NextResponse.redirect default
    const location = res.headers.get('location') || ''
    expect(location).toContain('/schedule')
    expect(location).not.toContain('/login')
    // Session cookie set
    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain('winbros_session=')
  })

  it('redirects to a relative `next` path when provided', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${VALID_TOKEN}&next=${encodeURIComponent('/jobs/123')}`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/jobs/123')
  })

  it('falls back to /schedule when `next` is an absolute URL (open-redirect guard)', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${VALID_TOKEN}&next=${encodeURIComponent('https://evil.com/steal')}`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).not.toContain('evil.com')
    expect(location).toContain('/schedule')
  })

  it('falls back to /schedule when `next` is protocol-relative (//evil.com)', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${VALID_TOKEN}&next=${encodeURIComponent('//evil.com/steal')}`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).not.toContain('evil.com')
    expect(location).toContain('/schedule')
  })

  it('redirects to /login?error=invalid_link when token is unknown', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=zzzzzzzzzzzzzzzzzzzz`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
    expect(location).toContain('error=invalid_link')
  })

  it('redirects to /login?error=invalid_link when cleaner is inactive', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${INACTIVE_TOKEN}`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
    expect(location).toContain('error=invalid_link')
  })

  it('redirects to /login?error=invalid_link when cleaner is soft-deleted', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=${DELETED_TOKEN}`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
    expect(location).toContain('error=invalid_link')
  })

  it('redirects to /login when token is missing', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
  })

  it('redirects to /login when token is too short to be valid', async () => {
    const { GET } = await import('@/app/api/auth/portal-exchange/route')
    const req = createMockRequest(
      `http://localhost:3000/api/auth/portal-exchange?token=short`,
      { method: 'GET' }
    )

    const res = await GET(req)
    const location = res.headers.get('location') || ''
    expect(location).toContain('/login')
  })
})
