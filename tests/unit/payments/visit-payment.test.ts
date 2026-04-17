/**
 * Visit Payment Route Tests
 *
 * Tests the HTTP layer of POST /api/actions/visits/payment:
 * - Auth enforcement (requireAuthWithTenant)
 * - Cross-tenant visit rejection (404)
 * - Request body validation (400)
 * - Happy path delegation to recordPayment()
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

const mockRecordPayment = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/apps/window-washing/lib/visit-flow', () => ({
  recordPayment: (...args: any[]) => mockRecordPayment(...args),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedVisits() {
  return {
    visits: [
      { id: 1, tenant_id: WINBROS_ID, job_id: 100, status: 'completed', visit_date: '2026-04-01' },
      { id: 2, tenant_id: CEDAR_RAPIDS_ID, job_id: 200, status: 'completed', visit_date: '2026-04-01' },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/actions/visits/payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authTenantOverride = WINBROS_TENANT
    mockClient = createMockSupabaseClient(seedVisits())
    mockRecordPayment.mockResolvedValue({ success: true })
  })

  it('records payment on valid visit (happy path)', async () => {
    const { POST } = await import('@/app/api/actions/visits/payment/route')
    const req = createMockRequest('/api/actions/visits/payment', {
      method: 'POST',
      body: { visitId: 1, payment_type: 'card', payment_amount: 350 },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(mockRecordPayment).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for visit belonging to different tenant', async () => {
    const { POST } = await import('@/app/api/actions/visits/payment/route')
    // Visit 2 belongs to CEDAR_RAPIDS, but auth is WINBROS
    const req = createMockRequest('/api/actions/visits/payment', {
      method: 'POST',
      body: { visitId: 2, payment_type: 'cash', payment_amount: 200 },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/actions/visits/payment/route')
    const req = createMockRequest('/api/actions/visits/payment', {
      method: 'POST',
      body: { visitId: 1 }, // missing payment_type and payment_amount
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('required')
    expect(mockRecordPayment).not.toHaveBeenCalled()
  })
})