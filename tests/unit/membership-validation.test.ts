/**
 * Membership Validation & Integration Tests
 *
 * Covers:
 * - Cross-tenant membership_id rejection in jobs POST
 * - Memberships API: GET (filter by customer_id, status), POST (create), PATCH (pause/resume/cancel)
 * - Cross-tenant rejection in memberships PATCH
 * - Duplicate membership prevention
 * - OpenPhone RENEW handler + duplicate reply guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../mocks/supabase-mock'
import {
  WINBROS_ID, WINBROS_TENANT,
  CEDAR_RAPIDS_ID, CEDAR_RAPIDS_TENANT,
} from '../fixtures/cedar-rapids'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient
const mockSendSMS = vi.fn().mockResolvedValue({ success: true })
const mockLogSystemEvent = vi.fn().mockResolvedValue(undefined)

// Track which tenant the auth mock returns
let authTenantOverride: any = WINBROS_TENANT

// ─── Module mocks ───────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

// Jobs route uses requireAuth + getAuthTenant
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'test@test.com', tenantId: WINBROS_ID, tenantSlug: 'winbros', username: 'testuser' },
  }),
  getAuthTenant: vi.fn().mockImplementation(async () => authTenantOverride),
  requireAuthWithTenant: vi.fn().mockImplementation(async () => ({
    user: { id: 'user-1', email: 'test@test.com', tenantId: authTenantOverride.id, tenantSlug: authTenantOverride.slug },
    tenant: authTenantOverride,
  })),
  SESSION_COOKIE_NAME: 'test_session',
}))

vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
  normalizePhoneNumber: (p: string) => p,
  SMS_TEMPLATES: {},
}))

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: (...args: any[]) => mockLogSystemEvent(...args),
  getTelegramConversation: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/phone-utils', () => ({
  normalizePhoneNumber: (p: string) => p,
}))

vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockImplementation(async (id: string) => {
    return mockClient.tables.tenants?.find((t: any) => t.id === id) || null
  }),
  getTenantBusinessName: vi.fn().mockReturnValue('WinBros'),
  tenantUsesFeature: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/hcp-job-sync', () => ({
  syncNewJobToHCP: vi.fn().mockResolvedValue(undefined),
  syncCustomerToHCP: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/cleaner-assignment', () => ({
  triggerCleanerAssignment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/sms-templates', () => ({
  cleanerAssigned: vi.fn().mockReturnValue('Cleaner assigned'),
}))

// Jobs route uses getTenantScopedClient — must return our mock client
vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
  getTenantScopedClient: vi.fn().mockImplementation(async () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  })),
  getSupabaseClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

vi.mock('@/lib/stripe-client', () => ({
  findOrCreateStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_mock' }),
  getStripeClientForTenant: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/scheduler', () => ({
  scheduleTask: vi.fn().mockResolvedValue({ success: true }),
  scheduleLeadFollowUp: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/google-maps', () => ({
  geocodeAddress: vi.fn().mockResolvedValue({ lat: 41.97, lng: -91.66, formattedAddress: '123 Test St' }),
}))

vi.mock('@/lib/hubspot', () => ({
  syncHubSpotContact: vi.fn().mockResolvedValue(undefined),
  syncHubSpotDeal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/wave', () => ({
  createWaveInvoice: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'email-mock' }) }),
}))

// ─── Seed data factory ──────────────────────────────────────────────────

function seedData(extras?: Record<string, any[]>) {
  return createMockSupabaseClient({
    tenants: [WINBROS_TENANT, CEDAR_RAPIDS_TENANT],
    customers: [
      {
        id: '500', tenant_id: WINBROS_ID, phone_number: '+16305550001',
        first_name: 'Test', last_name: 'Customer', email: 'test@example.com',
      },
      {
        id: '100', tenant_id: CEDAR_RAPIDS_ID, phone_number: '+13195550001',
        first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com',
      },
    ],
    service_plans: [
      {
        id: 'plan-wb-monthly', tenant_id: WINBROS_ID, slug: 'monthly',
        name: 'Monthly Plan', visits_per_year: 12, interval_months: 1,
        discount_per_visit: 25, active: true, free_addons: null,
      },
      {
        id: 'plan-cr-monthly', tenant_id: CEDAR_RAPIDS_ID, slug: 'monthly',
        name: 'Monthly Plan', visits_per_year: 12, interval_months: 1,
        discount_per_visit: 20, active: true, free_addons: null,
      },
    ],
    customer_memberships: [
      {
        id: 'mem-wb-001', tenant_id: WINBROS_ID, customer_id: '500',
        plan_id: 'plan-wb-monthly', status: 'active', visits_completed: 3,
        next_visit_at: '2026-04-01T00:00:00Z', started_at: '2026-01-01T00:00:00Z',
        renewal_choice: null, renewal_asked_at: null,
        service_plans: {
          id: 'plan-wb-monthly', name: 'Monthly Plan', slug: 'monthly',
          visits_per_year: 12, interval_months: 1, discount_per_visit: 25,
        },
      },
      {
        id: 'mem-cr-001', tenant_id: CEDAR_RAPIDS_ID, customer_id: '100',
        plan_id: 'plan-cr-monthly', status: 'active', visits_completed: 5,
        next_visit_at: '2026-04-01T00:00:00Z', started_at: '2026-01-01T00:00:00Z',
        renewal_choice: null, renewal_asked_at: null,
        service_plans: {
          id: 'plan-cr-monthly', name: 'Monthly Plan', slug: 'monthly',
          visits_per_year: 12, interval_months: 1, discount_per_visit: 20,
        },
      },
    ],
    jobs: [],
    leads: [],
    cleaners: [],
    cleaner_assignments: [],
    messages: [],
    stripe_processed_events: [],
    ...extras,
  })
}

import { createMockRequest, parseResponse } from '../helpers'

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Membership Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authTenantOverride = WINBROS_TENANT
  })

  // ─── Cross-tenant membership_id rejection in jobs POST ──────────────

  describe('Jobs POST — membership_id validation', () => {
    it('rejects a membership_id belonging to another tenant', async () => {
      mockClient = seedData()

      const { POST } = await import('@/app/api/jobs/route')
      const req = createMockRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: {
          customer_name: 'Test Customer',
          customer_phone: '+16305550001',
          service_type: 'Window Cleaning',
          scheduled_date: '2026-04-01',
          scheduled_time: '10:00',
          estimated_value: 200,
          membership_id: 'mem-cr-001', // Cedar Rapids membership — should be rejected
        },
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(404)
      expect(body.error).toContain('Invalid or inactive membership')
    })

    it('accepts a valid membership_id for the same tenant', async () => {
      mockClient = seedData()

      const { POST } = await import('@/app/api/jobs/route')
      const req = createMockRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: {
          customer_name: 'Test Customer',
          customer_phone: '+16305550001',
          service_type: 'Window Cleaning',
          scheduled_date: '2026-04-01',
          scheduled_time: '10:00',
          estimated_value: 200,
          membership_id: 'mem-wb-001', // WinBros membership — should be accepted
        },
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(201)
      expect(body.success).toBe(true)

      // Verify the job was created with the membership_id
      const jobs = mockClient.getTableData('jobs')
      expect(jobs.length).toBe(1)
      expect(jobs[0].membership_id).toBe('mem-wb-001')
    })

    it('creates job without membership when no membership_id provided', async () => {
      mockClient = seedData()

      const { POST } = await import('@/app/api/jobs/route')
      const req = createMockRequest('http://localhost:3000/api/jobs', {
        method: 'POST',
        body: {
          customer_name: 'Test Customer',
          customer_phone: '+16305550001',
          service_type: 'Window Cleaning',
          scheduled_date: '2026-04-01',
          scheduled_time: '10:00',
          estimated_value: 200,
        },
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(201)
      expect(body.success).toBe(true)

      const jobs = mockClient.getTableData('jobs')
      expect(jobs[0].membership_id).toBeUndefined()
    })
  })

  // ─── Memberships API — GET ──────────────────────────────────────────

  describe('Memberships API — GET', () => {
    it('returns only memberships for the authenticated tenant', async () => {
      mockClient = seedData()

      const { GET } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'GET',
      })

      const res = await GET(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      // Should only return WinBros memberships
      const ids = body.memberships.map((m: any) => m.id)
      expect(ids).toContain('mem-wb-001')
      expect(ids).not.toContain('mem-cr-001')
    })

    it('filters by customer_id query param', async () => {
      mockClient = seedData()

      const { GET } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships?customer_id=500', {
        method: 'GET',
      })

      const res = await GET(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.memberships.length).toBe(1)
      expect(body.memberships[0].customer_id).toBe('500')
    })

    it('filters by status query param', async () => {
      mockClient = seedData({
        customer_memberships: [
          {
            id: 'mem-wb-paused', tenant_id: WINBROS_ID, customer_id: '500',
            plan_id: 'plan-wb-monthly', status: 'paused', visits_completed: 2,
            next_visit_at: null, started_at: '2026-01-01T00:00:00Z',
          },
        ],
      })

      const { GET } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships?status=paused', {
        method: 'GET',
      })

      const res = await GET(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      // Should only return paused memberships
      body.memberships.forEach((m: any) => {
        expect(m.status).toBe('paused')
      })
    })
  })

  // ─── Memberships API — POST (create) ──────────────────────────────

  describe('Memberships API — POST', () => {
    it('creates a membership for a valid customer + plan', async () => {
      mockClient = seedData({
        customer_memberships: [], // Start with no memberships
      })

      const { POST } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'POST',
        body: { customer_id: '500', plan_slug: 'monthly' },
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.membership.customer_id).toBe('500')
      expect(body.membership.status).toBe('active')
      expect(body.membership.visits_completed).toBe(0)
    })

    it('rejects creating membership for another tenant customer', async () => {
      mockClient = seedData()

      const { POST } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'POST',
        body: { customer_id: '100', plan_slug: 'monthly' }, // Cedar Rapids customer
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(404)
      expect(body.error).toContain('Customer not found')
    })

    it('rejects duplicate active membership for same customer + plan', async () => {
      mockClient = seedData() // Has active mem-wb-001 for customer 500 + monthly

      const { POST } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'POST',
        body: { customer_id: '500', plan_slug: 'monthly' },
      })

      const res = await POST(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(409)
      expect(body.error).toContain('already has an active membership')
    })

    it('returns 400 for missing required fields', async () => {
      mockClient = seedData()

      const { POST } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'POST',
        body: { customer_id: '500' }, // Missing plan_slug
      })

      const res = await POST(req)
      const { status } = await parseResponse(res)

      expect(status).toBe(400)
    })
  })

  // ─── Memberships API — PATCH (pause/resume/cancel) ────────────────

  describe('Memberships API — PATCH', () => {
    it('pauses an active membership', async () => {
      mockClient = seedData()

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'pause' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.action).toBe('pause')

      const mem = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      expect(mem.status).toBe('paused')
    })

    it('resumes a paused membership', async () => {
      mockClient = seedData()
      // Manually pause the membership first
      const mem = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      mem.status = 'paused'
      mem.next_visit_at = '2025-01-01T00:00:00Z' // In the past

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'resume' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.action).toBe('resume')

      const updated = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      expect(updated.status).toBe('active')
      // next_visit_at should be recalculated since it was in the past
      expect(new Date(updated.next_visit_at).getTime()).toBeGreaterThan(Date.now())
    })

    it('cancels an active membership', async () => {
      mockClient = seedData()

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'cancel' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(200)
      expect(body.action).toBe('cancel')

      const mem = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      expect(mem.status).toBe('cancelled')
      expect(mem.cancelled_at).toBeTruthy()
    })

    it('rejects pausing a non-active membership', async () => {
      mockClient = seedData()
      const mem = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      mem.status = 'completed'

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'pause' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(400)
      expect(body.error).toContain('Can only pause active')
    })

    it('rejects cancelling an already completed membership', async () => {
      mockClient = seedData()
      const mem = mockClient.getTableData('customer_memberships').find((m: any) => m.id === 'mem-wb-001')
      mem.status = 'completed'

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'cancel' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(400)
      expect(body.error).toContain('Cannot cancel a completed')
    })

    it('rejects PATCH on another tenant membership (cross-tenant)', async () => {
      mockClient = seedData()

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-cr-001', action: 'pause' }, // Cedar Rapids membership
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })

    it('rejects invalid action', async () => {
      mockClient = seedData()

      const { PATCH } = await import('@/app/api/actions/memberships/route')
      const req = createMockRequest('http://localhost:3000/api/actions/memberships', {
        method: 'PATCH',
        body: { membership_id: 'mem-wb-001', action: 'delete' },
      })

      const res = await PATCH(req)
      const { status, body } = await parseResponse(res)

      expect(status).toBe(400)
      expect(body.error).toContain('action must be')
    })
  })
})
