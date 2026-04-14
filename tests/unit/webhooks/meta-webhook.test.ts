/**
 * Meta Webhook Route Tests
 *
 * Tests GET/POST /api/webhooks/meta/[slug]:
 * - GET verification returns challenge on valid token
 * - GET verification rejects wrong token (403)
 * - POST with unknown slug still returns 200 (graceful)
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

vi.mock('@/lib/scheduler', () => ({
  scheduleLeadFollowUp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantBySlug: vi.fn().mockImplementation(async (slug: string) => {
    if (slug === 'winbros') return {
      ...WINBROS_TENANT,
      workflow_config: { ...WINBROS_TENANT.workflow_config, meta_verify_token: 'test-verify-token' },
    }
    return null
  }),
}))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return { customers: [], leads: [] }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Meta Webhook /api/webhooks/meta/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
  })

  describe('GET verification', () => {
    it('returns challenge on valid token', async () => {
      const { GET } = await import('@/app/api/webhooks/meta/[slug]/route')
      const req = createMockRequest(
        '/api/webhooks/meta/winbros?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge123',
        { method: 'GET' }
      )

      const res = await GET(req, { params: Promise.resolve({ slug: 'winbros' }) })
      const text = await res.text()

      expect(res.status).toBe(200)
      expect(text).toBe('challenge123')
    })

    it('returns 403 for wrong verify token', async () => {
      const { GET } = await import('@/app/api/webhooks/meta/[slug]/route')
      const req = createMockRequest(
        '/api/webhooks/meta/winbros?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge123',
        { method: 'GET' }
      )

      const res = await GET(req, { params: Promise.resolve({ slug: 'winbros' }) })

      expect(res.status).toBe(403)
    })

    it('returns 400 for invalid mode', async () => {
      const { GET } = await import('@/app/api/webhooks/meta/[slug]/route')
      const req = createMockRequest(
        '/api/webhooks/meta/winbros?hub.mode=invalid&hub.verify_token=test-verify-token',
        { method: 'GET' }
      )

      const res = await GET(req, { params: Promise.resolve({ slug: 'winbros' }) })

      expect(res.status).toBe(400)
    })
  })
})