/**
 * Login Route Tests
 *
 * Tests POST /api/auth/login:
 * - Owner login with valid credentials
 * - Employee fallback when owner login fails
 * - Invalid credentials for both returns 401
 * - Missing username/password returns 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID, WINBROS_TENANT } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient

const mockVerifyPassword = vi.fn()
const mockVerifyEmployeePassword = vi.fn()
const mockCreateSession = vi.fn().mockResolvedValue('session-token-abc')
const mockCreateEmployeeSession = vi.fn().mockResolvedValue('employee-token-xyz')
const mockSetSessionCookie = vi.fn()

// ─── Module mocks ───────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

vi.mock('@/lib/auth', () => ({
  verifyPassword: (...args: any[]) => mockVerifyPassword(...args),
  verifyEmployeePassword: (...args: any[]) => mockVerifyEmployeePassword(...args),
  createSession: (...args: any[]) => mockCreateSession(...args),
  createEmployeeSession: (...args: any[]) => mockCreateEmployeeSession(...args),
  setSessionCookie: (...args: any[]) => mockSetSessionCookie(...args),
  SESSION_COOKIE_NAME: 'winbros_session',
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return {
    tenants: [
      { id: WINBROS_ID, slug: 'winbros', name: 'WinBros', service_type: 'window_washing', active: true },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
    mockVerifyPassword.mockResolvedValue(null)
    mockVerifyEmployeePassword.mockResolvedValue(null)
  })

  it('returns session token for valid owner login', async () => {
    mockVerifyPassword.mockResolvedValue({
      id: 1, username: 'admin', display_name: 'Admin', email: 'admin@test.com', tenant_id: WINBROS_ID,
    })

    const { POST } = await import('@/app/api/auth/login/route')
    const req = createMockRequest('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'correct-pass' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.data.type).toBe('owner')
    expect(data.body.data.sessionToken).toBe('session-token-abc')
    expect(mockCreateSession).toHaveBeenCalledWith(1)
  })

  it('falls back to employee login when owner fails', async () => {
    mockVerifyPassword.mockResolvedValue(null)
    mockVerifyEmployeePassword.mockResolvedValue({
      id: 600, username: 'tech_dan', name: 'Tech Dan', tenant_id: WINBROS_ID, portal_token: 'portal-abc',
    })

    const { POST } = await import('@/app/api/auth/login/route')
    const req = createMockRequest('/api/auth/login', {
      method: 'POST',
      body: { username: 'tech_dan', password: 'emp-pass' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.data.type).toBe('employee')
    expect(data.body.data.portalToken).toBe('portal-abc')
    expect(mockCreateEmployeeSession).toHaveBeenCalledWith(600)
  })

  it('returns 401 when both owner and employee login fail', async () => {
    const { POST } = await import('@/app/api/auth/login/route')
    const req = createMockRequest('/api/auth/login', {
      method: 'POST',
      body: { username: 'nobody', password: 'wrong' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(401)
    expect(data.body.success).toBe(false)
  })

  it('returns 400 when username or password is missing', async () => {
    const { POST } = await import('@/app/api/auth/login/route')
    const req = createMockRequest('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin' }, // missing password
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('required')
  })
})