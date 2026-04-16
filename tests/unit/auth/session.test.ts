/**
 * Session Route Tests
 *
 * Tests GET /api/auth/session:
 * - Valid owner session returns user + tenant data
 * - Valid employee session returns cleaner + portal token
 * - No session returns 401
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient

const mockGetAuthUser = vi.fn()
const mockGetAuthCleaner = vi.fn()

// ─── Module mocks ───────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

vi.mock('@/lib/auth', () => ({
  getAuthUser: (...args: any[]) => mockGetAuthUser(...args),
  getAuthCleaner: (...args: any[]) => mockGetAuthCleaner(...args),
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

describe('GET /api/auth/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
    mockGetAuthUser.mockResolvedValue(null)
    mockGetAuthCleaner.mockResolvedValue(null)
  })

  it('returns owner data for valid owner session', async () => {
    mockGetAuthCleaner.mockResolvedValue(null)
    mockGetAuthUser.mockResolvedValue({
      id: 1, username: 'admin', display_name: 'Admin', email: 'admin@test.com', tenant_id: WINBROS_ID,
    })

    const { GET } = await import('@/app/api/auth/session/route')
    const req = createMockRequest('/api/auth/session', { method: 'GET' })

    const res = await GET(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.data.type).toBe('owner')
    expect(data.body.data.user.username).toBe('admin')
    expect(data.body.data.tenantStatus).toBeDefined()
    expect(data.body.data.tenantStatus.active).toBe(true)
  })

  it('returns employee data for valid cleaner session', async () => {
    mockGetAuthCleaner.mockResolvedValue({
      id: 600, username: 'tech_dan', name: 'Tech Dan', tenant_id: WINBROS_ID, portal_token: 'portal-abc',
    })

    const { GET } = await import('@/app/api/auth/session/route')
    const req = createMockRequest('/api/auth/session', { method: 'GET' })

    const res = await GET(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.data.type).toBe('employee')
    expect(data.body.data.portalToken).toBe('portal-abc')
  })

  it('returns 401 when no session exists', async () => {
    const { GET } = await import('@/app/api/auth/session/route')
    const req = createMockRequest('/api/auth/session', { method: 'GET' })

    const res = await GET(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(401)
    expect(data.body.success).toBe(false)
  })
})