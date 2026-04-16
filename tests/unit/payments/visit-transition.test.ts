/**
 * Visit Transition Route Tests
 *
 * Tests the HTTP layer of POST /api/actions/visits/transition:
 * - Cross-tenant visit rejection (404)
 * - Request body validation (400)
 * - Happy path delegation to transitionVisit()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID, WINBROS_TENANT, CEDAR_RAPIDS_ID } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient
let authTenantOverride: any = WINBROS_TENANT

// ─── Module mocks ───────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

vi.mock('@/lib/auth', () => ({
  requireAuthWithTenant: vi.fn().mockImplementation(async () => ({
    user: { id: 'user-1', tenantId: authTenantOverride.id },
    tenant: authTenantOverride,
  })),
  SESSION_COOKIE_NAME: 'test_session',
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

const mockTransitionVisit = vi.fn().mockResolvedValue({ success: true, new_status: 'on_my_way' })

vi.mock('@/apps/window-washing/lib/visit-flow', () => ({
  transitionVisit: (...args: any[]) => mockTransitionVisit(...args),
}))

vi.mock('@/apps/window-washing/lib/close-job', () => ({
  executeCloseJobAutomation: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/openphone', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedVisits() {
  return {
    visits: [
      {
        id: 1, tenant_id: WINBROS_ID, job_id: 100, status: 'not_started', visit_date: '2026-04-01',
        jobs: { customer_id: 500, customers: { phone_number: '+13195550001', first_name: 'Jane' } },
      },
      { id: 2, tenant_id: CEDAR_RAPIDS_ID, job_id: 200, status: 'not_started', visit_date: '2026-04-01' },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/actions/visits/transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authTenantOverride = WINBROS_TENANT
    mockClient = createMockSupabaseClient(seedVisits())
    mockTransitionVisit.mockResolvedValue({ success: true, new_status: 'on_my_way' })
  })

  it('transitions visit to next status (happy path)', async () => {
    const { POST } = await import('@/app/api/actions/visits/transition/route')
    const req = createMockRequest('/api/actions/visits/transition', {
      method: 'POST',
      body: { visitId: 1, targetStatus: 'on_my_way' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.new_status).toBe('on_my_way')
    expect(mockTransitionVisit).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for visit belonging to different tenant', async () => {
    const { POST } = await import('@/app/api/actions/visits/transition/route')
    const req = createMockRequest('/api/actions/visits/transition', {
      method: 'POST',
      body: { visitId: 2, targetStatus: 'on_my_way' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(mockTransitionVisit).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/actions/visits/transition/route')
    const req = createMockRequest('/api/actions/visits/transition', {
      method: 'POST',
      body: { visitId: 1 }, // missing targetStatus
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('required')
    expect(mockTransitionVisit).not.toHaveBeenCalled()
  })
})