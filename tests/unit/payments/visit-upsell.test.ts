/**
 * Visit Upsell Route Tests
 *
 * Tests the HTTP layer of POST /api/actions/visits/upsell:
 * - Cross-tenant visit rejection (404)
 * - Request body validation (400)
 * - Happy path delegation to addUpsell()
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
    user: { id: 'user-1', tenantId: authTenantOverride.id, cleaner_id: 600 },
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

const mockAddUpsell = vi.fn().mockResolvedValue({ success: true, line_item_id: 99 })

vi.mock('@/apps/window-washing/lib/visit-flow', () => ({
  addUpsell: (...args: any[]) => mockAddUpsell(...args),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedVisits() {
  return {
    visits: [
      { id: 1, tenant_id: WINBROS_ID, job_id: 100, status: 'in_progress', visit_date: '2026-04-01' },
      { id: 2, tenant_id: CEDAR_RAPIDS_ID, job_id: 200, status: 'in_progress', visit_date: '2026-04-01' },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/actions/visits/upsell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authTenantOverride = WINBROS_TENANT
    mockClient = createMockSupabaseClient(seedVisits())
    mockAddUpsell.mockResolvedValue({ success: true, line_item_id: 99 })
  })

  it('adds upsell line item to own tenant visit (happy path)', async () => {
    const { POST } = await import('@/app/api/actions/visits/upsell/route')
    const req = createMockRequest('/api/actions/visits/upsell', {
      method: 'POST',
      body: { visitId: 1, service_name: 'Screen Cleaning', price: 50 },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.line_item_id).toBe(99)
    expect(mockAddUpsell).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for visit belonging to different tenant', async () => {
    const { POST } = await import('@/app/api/actions/visits/upsell/route')
    const req = createMockRequest('/api/actions/visits/upsell', {
      method: 'POST',
      body: { visitId: 2, service_name: 'Gutter Clean', price: 100 },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(mockAddUpsell).not.toHaveBeenCalled()
  })

  it('returns 400 when required fields are missing', async () => {
    const { POST } = await import('@/app/api/actions/visits/upsell/route')
    const req = createMockRequest('/api/actions/visits/upsell', {
      method: 'POST',
      body: { visitId: 1 }, // missing service_name and price
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('required')
    expect(mockAddUpsell).not.toHaveBeenCalled()
  })
})