/**
 * Tenant Switch Route Tests
 *
 * Tests POST /api/auth/switch:
 * - Valid session token switches tenant and sets cookie
 * - Invalid/expired token returns 401
 * - Missing sessionToken returns 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient

const mockGetSession = vi.fn()
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
  getSession: (...args: any[]) => mockGetSession(...args),
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
      { id: WINBROS_ID, slug: 'winbros', name: 'WinBros', active: true, workflow_config: { sms_auto_response_enabled: true } },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/auth/switch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
    mockGetSession.mockResolvedValue(null)
  })

  it('switches tenant with valid session token', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 1, username: 'admin', display_name: 'Admin', email: 'admin@test.com', tenant_id: WINBROS_ID },
    })

    const { POST } = await import('@/app/api/auth/switch/route')
    const req = createMockRequest('/api/auth/switch', {
      method: 'POST',
      body: { sessionToken: 'valid-token-xyz' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.data.user.username).toBe('admin')
    expect(data.body.data.tenantStatus.active).toBe(true)
    expect(mockSetSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for invalid/expired session token', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('@/app/api/auth/switch/route')
    const req = createMockRequest('/api/auth/switch', {
      method: 'POST',
      body: { sessionToken: 'expired-token' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(401)
    expect(data.body.success).toBe(false)
  })

  it('returns 400 when sessionToken is missing', async () => {
    const { POST } = await import('@/app/api/auth/switch/route')
    const req = createMockRequest('/api/auth/switch', {
      method: 'POST',
      body: {},
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('required')
  })
})