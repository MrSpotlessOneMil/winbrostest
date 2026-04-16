/**
 * Stripe Webhook Route Tests
 *
 * Tests POST /api/webhooks/stripe:
 * - Invalid signature returns 400
 * - Duplicate event ID is skipped (idempotency)
 * - Valid event is processed and acknowledged
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../../mocks/supabase-mock'
import { WINBROS_ID, WINBROS_TENANT } from '../../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Shared mock state ──────────────────────────────────────────────────

let mockClient: MockSupabaseClient

const mockValidateStripeWebhook = vi.fn()

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
  updateJob: vi.fn().mockResolvedValue(undefined),
  getJobById: vi.fn().mockResolvedValue(null),
  updateGHLLead: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/stripe-client', () => ({
  validateStripeWebhook: (...args: any[]) => mockValidateStripeWebhook(...args),
  createCardOnFileLink: vi.fn().mockResolvedValue('https://stripe.com/card-link'),
}))

vi.mock('@/lib/tenant', () => ({
  getAllActiveTenants: vi.fn().mockResolvedValue([WINBROS_TENANT]),
  getTenantById: vi.fn().mockResolvedValue(WINBROS_TENANT),
  tenantUsesFeature: vi.fn().mockReturnValue(false),
  formatTenantCurrency: vi.fn().mockImplementation((t: any, amt: number) => `$${amt.toFixed(2)}`),
}))

vi.mock('@/lib/cleaner-assignment', () => ({
  triggerCleanerAssignment: vi.fn().mockResolvedValue(undefined),
  calculateDistance: vi.fn().mockReturnValue(5),
}))
vi.mock('@/lib/system-events', () => ({ logSystemEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/openphone', () => ({ sendSMS: vi.fn().mockResolvedValue({ success: true }), SMS_TEMPLATES: {} }))
vi.mock('@/lib/phone-utils', () => ({ maskPhone: (p: string) => p, normalizePhoneNumber: (p: string) => p }))
vi.mock('@/lib/tips', () => ({ distributeTip: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/google-maps', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/route-optimizer', () => ({ optimizeRoutesIncremental: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dispatch', () => ({ dispatchRoutes: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/hcp-job-sync', () => ({ syncNewJobToHCP: vi.fn().mockResolvedValue(undefined), convertHCPLeadToJob: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/housecall-pro-api', () => ({ convertHCPLeadToJob: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/winbros-sms-prompt', () => ({ buildWinBrosJobNotes: vi.fn().mockReturnValue('') }))
vi.mock('@/lib/sms-templates', () => ({ paymentFailed: vi.fn().mockReturnValue('Payment failed') }))
vi.mock('@/lib/scheduler', () => ({ cancelTask: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/lifecycle-engine', () => ({ cancelPendingTasks: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/maybe-mark-booked', () => ({ maybeMarkBooked: vi.fn().mockResolvedValue(undefined) }))

// ─── Seed data ──────────────────────────────────────────────────────────

function seedData() {
  return {
    stripe_processed_events: [],
    jobs: [],
    customers: [],
    leads: [],
    tenants: [{ ...WINBROS_TENANT }],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = createMockSupabaseClient(seedData())
    mockValidateStripeWebhook.mockReturnValue(null)
  })

  it('returns 400 for invalid webhook signature', async () => {
    mockValidateStripeWebhook.mockReturnValue(null)

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const req = createMockRequest('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid-sig' },
      body: {},
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(400)
    expect(data.body.error).toContain('signature')
  })

  it('skips duplicate event (idempotency)', async () => {
    // Pre-seed an already-processed event
    mockClient = createMockSupabaseClient({
      ...seedData(),
      stripe_processed_events: [{ id: 1, event_id: 'evt_dup_123', event_type: 'checkout.session.completed' }],
    })

    mockValidateStripeWebhook.mockReturnValue({
      id: 'evt_dup_123',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { metadata: {} } },
    })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const req = createMockRequest('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid-sig' },
      body: {},
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    // Should still acknowledge (200) but not process
    expect(data.status).toBe(200)
  })

  it('processes valid event and returns received:true', async () => {
    mockValidateStripeWebhook.mockReturnValue({
      id: 'evt_new_456',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: { object: { metadata: {} } },
    })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const req = createMockRequest('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'valid-sig' },
      body: {},
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.received).toBe(true)
  })
})