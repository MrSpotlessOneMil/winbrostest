/**
 * Quote Approve Route Tests
 *
 * Tests the HTTP layer of POST /api/actions/quotes/approve:
 * - Cross-tenant quote rejection (404)
 * - Request body validation (400)
 * - Happy path delegation to approveAndConvertQuote()
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

const mockApproveAndConvert = vi.fn().mockResolvedValue({ success: true, job_id: 10, visit_id: 20 })

vi.mock('@/apps/window-washing/lib/quote-conversion', () => ({
  approveAndConvertQuote: (...args: any[]) => mockApproveAndConvert(...args),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedQuotes() {
  return {
    quotes: [
      { id: 1, tenant_id: WINBROS_ID, status: 'sent', customer_id: 500, total_price: 450 },
      { id: 2, tenant_id: CEDAR_RAPIDS_ID, status: 'sent', customer_id: 501, total_price: 300 },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/actions/quotes/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authTenantOverride = WINBROS_TENANT
    mockClient = createMockSupabaseClient(seedQuotes())
    mockApproveAndConvert.mockResolvedValue({ success: true, job_id: 10, visit_id: 20 })
  })

  it('approves quote and returns job + visit IDs (happy path)', async () => {
    const { POST } = await import('@/app/api/actions/quotes/approve/route')
    const req = createMockRequest('/api/actions/quotes/approve', {
      method: 'POST',
      body: { quoteId: 1, approvedBy: 'salesman' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.job_id).toBe(10)
    expect(data.body.visit_id).toBe(20)
    expect(mockApproveAndConvert).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for quote belonging to different tenant', async () => {
    const { POST } = await import('@/app/api/actions/quotes/approve/route')
    const req = createMockRequest('/api/actions/quotes/approve', {
      method: 'POST',
      body: { quoteId: 2, approvedBy: 'customer' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(mockApproveAndConvert).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid approvedBy value', async () => {
    const { POST } = await import('@/app/api/actions/quotes/approve/route')
    const req = createMockRequest('/api/actions/quotes/approve', {
      method: 'POST',
      body: { quoteId: 1, approvedBy: 'invalid' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('approvedBy')
    expect(mockApproveAndConvert).not.toHaveBeenCalled()
  })
})