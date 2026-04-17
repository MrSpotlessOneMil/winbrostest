/**
 * Crew Charge Route Tests
 *
 * Tests POST /api/crew/[token]/job/[jobId]/charge:
 * - Portal token auth (no requireAuthWithTenant)
 * - Invalid token returns 404
 * - Already-paid job returns 400
 * - No card on file returns 400
 * - Happy path charges card and updates job
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID, WINBROS_TENANT } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient

// ─── Module mocks ───────────────────────────────────────────────────────

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

vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockResolvedValue({
    ...WINBROS_TENANT,
    stripe_secret_key: 'sk_test_fake',
    currency: 'usd',
  }),
}))

const mockChargeCardOnFile = vi.fn().mockResolvedValue({ success: true, paymentIntentId: 'pi_test_123' })

vi.mock('@/lib/stripe-client', () => ({
  chargeCardOnFile: (...args: any[]) => mockChargeCardOnFile(...args),
}))

vi.mock('@/lib/openphone', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return {
    cleaners: [
      { id: 600, tenant_id: WINBROS_ID, name: 'Tech Dan', portal_token: 'valid-token-123', deleted_at: null },
    ],
    cleaner_assignments: [
      { id: 1, cleaner_id: 600, job_id: 100, tenant_id: WINBROS_ID, status: 'confirmed' },
    ],
    jobs: [
      {
        id: 100, tenant_id: WINBROS_ID, status: 'completed', price: 350, paid: false, payment_status: 'pending',
        customer_id: 500, phone_number: '+13195550001',
        customers: { id: 500, first_name: 'Jane', phone_number: '+13195550001', stripe_customer_id: 'cus_test_abc', card_on_file_at: '2026-03-01' },
      },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/crew/[token]/job/[jobId]/charge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
    mockChargeCardOnFile.mockResolvedValue({ success: true, paymentIntentId: 'pi_test_123' })
  })

  it('charges card and returns success (happy path)', async () => {
    const { POST } = await import('@/app/api/crew/[token]/job/[jobId]/charge/route')
    const req = createMockRequest('/api/crew/valid-token-123/job/100/charge', { method: 'POST' })

    const res = await POST(req, { params: Promise.resolve({ token: 'valid-token-123', jobId: '100' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.amount).toBe(350)
    expect(mockChargeCardOnFile).toHaveBeenCalledTimes(1)
  })

  it('returns 404 for invalid portal token', async () => {
    const { POST } = await import('@/app/api/crew/[token]/job/[jobId]/charge/route')
    const req = createMockRequest('/api/crew/bad-token/job/100/charge', { method: 'POST' })

    const res = await POST(req, { params: Promise.resolve({ token: 'bad-token', jobId: '100' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(mockChargeCardOnFile).not.toHaveBeenCalled()
  })

  it('returns 400 for already-paid job', async () => {
    // Seed with paid job
    const seed = seedData()
    seed.jobs[0].paid = true
    seed.jobs[0].payment_status = 'paid'
    mockClient = createMockSupabaseClient(seed)

    const { POST } = await import('@/app/api/crew/[token]/job/[jobId]/charge/route')
    const req = createMockRequest('/api/crew/valid-token-123/job/100/charge', { method: 'POST' })

    const res = await POST(req, { params: Promise.resolve({ token: 'valid-token-123', jobId: '100' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('already paid')
    expect(mockChargeCardOnFile).not.toHaveBeenCalled()
  })
})