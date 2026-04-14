/**
 * GHL Webhook Route Tests
 *
 * Tests POST /api/webhooks/ghl:
 * - Invalid signature returns 401
 * - Missing ?tenant= param returns 400
 * - Valid lead creates customer and lead records
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
  getSupabaseClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

vi.mock('@/lib/phone-utils', () => ({
  normalizePhoneNumber: (p: string) => p,
}))

// Return a known secret so signature verification logic runs
vi.mock('@/lib/user-api-keys', () => ({
  getApiKey: vi.fn().mockReturnValue('test-ghl-secret'),
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
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return {
    customers: [],
    leads: [],
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'

function createSignedGhlRequest(url: string, body: any) {
  const rawBody = JSON.stringify(body)
  const signature = createHmac('sha256', 'test-ghl-secret').update(rawBody).digest('hex')

  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GHL-Signature': signature,
    },
    body: rawBody,
  })
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/ghl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
  })

  it('returns 401 for missing signature', async () => {
    const { POST } = await import('@/app/api/webhooks/ghl/route')
    const req = createMockRequest('/api/webhooks/ghl?tenant=winbros', {
      method: 'POST',
      body: { data: { contact: { phone: '+13195550001', firstName: 'Jane' } } },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(401)
  })

  it('returns 400 for missing ?tenant= param', async () => {
    const { POST } = await import('@/app/api/webhooks/ghl/route')

    const body = { data: { contact: { phone: '+13195550001', firstName: 'Jane' } } }
    const req = createSignedGhlRequest('http://localhost:3000/api/webhooks/ghl', body)

    // @ts-ignore - NextRequest compatible
    const res = await POST(req as any)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
  })

  it('creates customer and lead for valid signed webhook', async () => {
    const { POST } = await import('@/app/api/webhooks/ghl/route')

    const body = { data: { contact: { phone: '+13195550001', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com', id: 'ghl-contact-001' } } }
    const req = createSignedGhlRequest('http://localhost:3000/api/webhooks/ghl?tenant=winbros', body)

    // @ts-ignore
    const res = await POST(req as any)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)

    // Verify customer was upserted
    const customers = mockClient.getTableData('customers')
    expect(customers.length).toBeGreaterThan(0)

    // Verify lead was created
    const leads = mockClient.getTableData('leads')
    expect(leads.length).toBeGreaterThan(0)
    expect(leads[0].tenant_id).toBe(WINBROS_ID)
  })
})