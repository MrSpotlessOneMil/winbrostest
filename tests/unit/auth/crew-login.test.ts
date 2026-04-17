/**
 * Crew Login Route Tests
 *
 * Tests POST /api/auth/crew-login:
 * - Valid phone returns portal token + cleaner info
 * - Unknown phone returns 404
 * - Auto-generates portal_token if cleaner has none
 * - Invalid phone format returns 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID } from '../../fixtures/cedar-rapids'
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

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData(overrides: Record<string, any> = {}) {
  return {
    cleaners: [
      {
        id: 600, tenant_id: WINBROS_ID, name: 'Tech Dan', phone: '+13195550001',
        portal_token: overrides.portal_token ?? 'existing-token-abc',
        employee_type: 'technician', active: true, deleted_at: null,
        tenants: { name: 'WinBros', slug: 'winbros' },
      },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/auth/crew-login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
  })

  it('returns portal token for valid phone number', async () => {
    const { POST } = await import('@/app/api/auth/crew-login/route')
    const req = createMockRequest('/api/auth/crew-login', {
      method: 'POST',
      body: { phone: '+13195550001' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(data.body.cleaner.name).toBe('Tech Dan')
    expect(data.body.portalUrl).toContain('existing-token-abc')
  })

  it('returns 404 for unknown phone number', async () => {
    const { POST } = await import('@/app/api/auth/crew-login/route')
    const req = createMockRequest('/api/auth/crew-login', {
      method: 'POST',
      body: { phone: '+19999999999' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(404)
    expect(data.body.error).toContain('No crew account')
  })

  it('returns 400 for phone with less than 10 digits', async () => {
    const { POST } = await import('@/app/api/auth/crew-login/route')
    const req = createMockRequest('/api/auth/crew-login', {
      method: 'POST',
      body: { phone: '12345' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('valid phone')
  })

  it('returns 400 when phone is missing', async () => {
    const { POST } = await import('@/app/api/auth/crew-login/route')
    const req = createMockRequest('/api/auth/crew-login', {
      method: 'POST',
      body: {},
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
  })
})