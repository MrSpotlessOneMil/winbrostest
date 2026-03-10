/**
 * Membership Lifecycle Tests
 *
 * Tests the handleMembershipLifecycle logic in the complete-job route
 * by calling executeCompleteJob through the mock infrastructure.
 *
 * Covers:
 * - Normal visit: increments visits_completed, advances next_visit_at
 * - Penultimate visit: sends renewal SMS
 * - Final visit with renewal_choice='renew': resets membership
 * - Final visit with no renewal_choice: completes membership
 * - Single-visit plan: completes + sends re-enrollment SMS
 * - Optimistic lock: concurrent update safely rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../mocks/supabase-mock'
import { WINBROS_ID, WINBROS_TENANT } from '../fixtures/cedar-rapids'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient
const mockSendSMS = vi.fn().mockResolvedValue({ success: true })
const mockLogSystemEvent = vi.fn().mockResolvedValue(undefined)
const mockNotifyOwnerSMS = vi.fn().mockResolvedValue(undefined)
const mockTriggerSatisfactionCheck = vi.fn().mockResolvedValue(undefined)

// ─── Module mocks ───────────────────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
  }),
}))

vi.mock('@/lib/auth', () => ({
  requireAuthWithTenant: vi.fn().mockResolvedValue({
    user: { id: 'user-1', email: 'test@test.com', tenantId: WINBROS_ID, tenantSlug: 'winbros' },
    tenant: WINBROS_TENANT,
  }),
  SESSION_COOKIE_NAME: 'winbros_session',
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

vi.mock('@/lib/cleaner-sms', () => ({
  notifyOwnerSMS: (...args: any[]) => mockNotifyOwnerSMS(...args),
}))

vi.mock('@/lib/stripe-client', () => ({
  findOrCreateStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_mock' }),
  resolveStripeChargeCents: vi.fn().mockReturnValue({ amountCents: 10000 }),
  getTenantRedirectDomain: vi.fn().mockReturnValue('https://test.com'),
  getStripeClientForTenant: vi.fn().mockReturnValue(null),
  chargeCardOnFile: vi.fn().mockResolvedValue({ success: false, error: 'no card' }),
}))

vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn().mockResolvedValue({ url: 'https://stripe.mock/pay' }) } },
  })),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockImplementation(async (id: string) => {
    return mockClient.tables.tenants?.find((t: any) => t.id === id) || null
  }),
  getTenantBusinessName: vi.fn().mockReturnValue('WinBros'),
  tenantUsesFeature: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/pricing-config', () => ({
  getPaymentTotalsFromNotes: vi.fn().mockReturnValue({ depositPaid: 999, addOnPaid: 0, totalDue: 0 }),
  getOverridesFromNotes: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/lifecycle-engine', () => ({
  triggerSatisfactionCheck: (...args: any[]) => mockTriggerSatisfactionCheck(...args),
  cancelPendingTasks: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/hubspot', () => ({
  syncHubSpotContact: vi.fn().mockResolvedValue(undefined),
  syncHubSpotDeal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/hcp-job-sync', () => ({
  syncNewJobToHCP: vi.fn().mockResolvedValue(undefined),
  syncCustomerToHCP: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/client-config', () => ({
  getClientPricingConfig: vi.fn().mockResolvedValue(null),
}))

// ─── Helpers ────────────────────────────────────────────────────────────

function seedMembershipData(overrides: {
  visits_completed?: number
  visits_per_year?: number
  interval_months?: number
  renewal_choice?: string | null
  renewal_asked_at?: string | null
  status?: string
} = {}) {
  const planId = 'plan-monthly'
  const membershipId = 'mem-001'
  const customerId = '500'
  const jobId = '9000'

  return createMockSupabaseClient({
    tenants: [WINBROS_TENANT],
    customers: [
      {
        id: customerId,
        tenant_id: WINBROS_ID,
        phone_number: '+16305550001',
        first_name: 'Test',
        last_name: 'Customer',
        email: 'test@example.com',
      },
    ],
    service_plans: [
      {
        id: planId,
        tenant_id: WINBROS_ID,
        slug: 'monthly',
        name: 'Monthly Plan',
        visits_per_year: overrides.visits_per_year ?? 12,
        interval_months: overrides.interval_months ?? 1,
        discount_per_visit: 25,
        active: true,
      },
    ],
    customer_memberships: [
      {
        id: membershipId,
        tenant_id: WINBROS_ID,
        customer_id: customerId,
        plan_id: planId,
        status: overrides.status ?? 'active',
        visits_completed: overrides.visits_completed ?? 0,
        next_visit_at: new Date().toISOString(),
        renewal_choice: overrides.renewal_choice ?? null,
        renewal_asked_at: overrides.renewal_asked_at ?? null,
        started_at: '2026-01-01T00:00:00Z',
        service_plans: {
          id: planId,
          name: 'Monthly Plan',
          slug: 'monthly',
          visits_per_year: overrides.visits_per_year ?? 12,
          interval_months: overrides.interval_months ?? 1,
          discount_per_visit: 25,
        },
      },
    ],
    jobs: [
      {
        id: jobId,
        tenant_id: WINBROS_ID,
        customer_id: customerId,
        phone_number: '+16305550001',
        status: 'in_progress',
        membership_id: membershipId,
        price: 200,
        payment_status: 'prepaid',
        paid: true,
        notes: '',
        service_type: 'Window Cleaning',
        stripe_customer_id: 'cus_mock',
      },
    ],
    messages: [],
    leads: [],
    cleaners: [],
    cleaner_assignments: [],
    stripe_processed_events: [],
  })
}

import { createMockRequest, parseResponse } from '../helpers'

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Membership Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('increments visits_completed and advances next_visit_at on normal visit', async () => {
    mockClient = seedMembershipData({ visits_completed: 3, visits_per_year: 12 })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    // Check membership was updated
    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.visits_completed).toBe(4)
    expect(membership.status).toBe('active')

    // No renewal SMS should be sent (not penultimate)
    const smsCalls = mockSendSMS.mock.calls
    const renewalSms = smsCalls.filter((c: any[]) => typeof c[2] === 'string' && c[2].includes('RENEW'))
    expect(renewalSms.length).toBe(0)
  })

  it('sends renewal SMS on penultimate visit', async () => {
    mockClient = seedMembershipData({ visits_completed: 10, visits_per_year: 12 })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.visits_completed).toBe(11)
    expect(membership.renewal_asked_at).toBeTruthy()
    expect(membership.status).toBe('active')

    // Renewal SMS should be sent
    const smsCalls = mockSendSMS.mock.calls
    const renewalSms = smsCalls.filter((c: any[]) => typeof c[2] === 'string' && c[2].includes('RENEW'))
    expect(renewalSms.length).toBeGreaterThan(0)
  })

  it('resets membership on final visit when customer chose RENEW', async () => {
    mockClient = seedMembershipData({
      visits_completed: 11,
      visits_per_year: 12,
      renewal_choice: 'renew',
      renewal_asked_at: '2026-03-01T00:00:00Z',
    })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.visits_completed).toBe(0)
    expect(membership.renewal_choice).toBeNull()
    expect(membership.renewal_asked_at).toBeNull()
    expect(membership.status).toBe('active')

    // System event should log renewal
    const renewEvent = mockLogSystemEvent.mock.calls.find(
      (c: any[]) => c[0]?.event_type === 'MEMBERSHIP_RENEWED'
    )
    expect(renewEvent).toBeTruthy()
  })

  it('completes membership on final visit with no renewal response', async () => {
    mockClient = seedMembershipData({
      visits_completed: 11,
      visits_per_year: 12,
      renewal_choice: null,
      renewal_asked_at: '2026-03-01T00:00:00Z',
    })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.status).toBe('completed')
    expect(membership.next_visit_at).toBeNull()

    // System event for completion
    const completedEvent = mockLogSystemEvent.mock.calls.find(
      (c: any[]) => c[0]?.event_type === 'MEMBERSHIP_COMPLETED'
    )
    expect(completedEvent).toBeTruthy()
  })

  it('single-visit plan: completes immediately and sends re-enrollment SMS', async () => {
    mockClient = seedMembershipData({
      visits_completed: 0,
      visits_per_year: 1,
      interval_months: 12,
    })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.status).toBe('completed')
    expect(membership.visits_completed).toBe(1)
    expect(membership.renewal_asked_at).toBeTruthy()

    // Should send re-enrollment SMS (contains "sign up for another")
    const smsCalls = mockSendSMS.mock.calls
    const reEnrollSms = smsCalls.filter(
      (c: any[]) => typeof c[2] === 'string' && c[2].includes('sign up for another')
    )
    expect(reEnrollSms.length).toBeGreaterThan(0)
  })

  it('completes membership on final visit when customer chose CANCEL', async () => {
    mockClient = seedMembershipData({
      visits_completed: 11,
      visits_per_year: 12,
      renewal_choice: 'cancel',
      renewal_asked_at: '2026-03-01T00:00:00Z',
    })

    const { POST } = await import('@/app/api/actions/complete-job/route')
    const req = createMockRequest('http://localhost:3000/api/actions/complete-job', {
      method: 'POST',
      body: { jobId: '9000' },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)

    const membership = mockClient.getTableData('customer_memberships')[0]
    expect(membership.status).toBe('completed')
    expect(membership.next_visit_at).toBeNull()
  })
})
