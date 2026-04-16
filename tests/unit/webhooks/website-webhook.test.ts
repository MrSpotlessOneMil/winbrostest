/**
 * Website Webhook Route Tests
 *
 * Tests POST /api/webhooks/website/[slug]:
 * - Valid form creates customer and lead
 * - Missing name returns 400
 * - Missing phone returns 400
 * - Unknown slug returns 404
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

vi.mock('@/lib/phone-utils', () => ({
  normalizePhoneNumber: (p: string) => p,
}))

vi.mock('@/lib/openphone', () => ({
  sendSMS: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-001' }),
}))

vi.mock('@/lib/scheduler', () => ({
  scheduleLeadFollowUp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantBySlug: vi.fn().mockImplementation(async (slug: string) => {
    if (slug === 'winbros') return { ...WINBROS_TENANT }
    return null
  }),
  getTenantServiceDescription: vi.fn().mockReturnValue('window washing'),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return {
    customers: [],
    leads: [],
    messages: [],
    scheduled_tasks: [],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/website/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
  })

  it('creates customer and lead for valid form submission', async () => {
    const { POST } = await import('@/app/api/webhooks/website/[slug]/route')
    const req = createMockRequest('/api/webhooks/website/winbros', {
      method: 'POST',
      body: { name: 'Jane Doe', phone: '+13195550001', email: 'jane@test.com', service_type: 'ext_windows' },
    })

    const res = await POST(req, { params: Promise.resolve({ slug: 'winbros' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)

    const customers = mockClient.getTableData('customers')
    expect(customers.length).toBeGreaterThan(0)

    const leads = mockClient.getTableData('leads')
    expect(leads.length).toBeGreaterThan(0)
    expect(leads[0].source).toBe('website')
  })

  it('returns 400 when name is missing', async () => {
    const { POST } = await import('@/app/api/webhooks/website/[slug]/route')
    const req = createMockRequest('/api/webhooks/website/winbros', {
      method: 'POST',
      body: { phone: '+13195550001' }, // no name
    })

    const res = await POST(req, { params: Promise.resolve({ slug: 'winbros' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('Name')
  })

  it('returns 400 when phone is missing', async () => {
    const { POST } = await import('@/app/api/webhooks/website/[slug]/route')
    const req = createMockRequest('/api/webhooks/website/winbros', {
      method: 'POST',
      body: { name: 'Jane Doe' }, // no phone
    })

    const res = await POST(req, { params: Promise.resolve({ slug: 'winbros' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('Phone')
  })

  it('returns 404 for unknown tenant slug', async () => {
    const { POST } = await import('@/app/api/webhooks/website/[slug]/route')
    const req = createMockRequest('/api/webhooks/website/nonexistent', {
      method: 'POST',
      body: { name: 'Jane', phone: '+13195550001' },
    })

    const res = await POST(req, { params: Promise.resolve({ slug: 'nonexistent' }) })
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
  })
})