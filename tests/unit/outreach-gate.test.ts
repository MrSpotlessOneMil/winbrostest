/**
 * Unit tests for the outreach eligibility gate.
 *
 * OUTREACH-SPEC v1.0 Section 4. Every exclusion rule gets its own case plus
 * an allow case. Supabase client is stubbed via a minimal mock that returns
 * fixture data per table.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isEligibleForOutreach } from '../../packages/core/src/outreach-gate'

type Row = Record<string, unknown>

/**
 * Build a lightweight Supabase client stub. Configure per-table fixtures:
 *   stub({ customers: { 7: { id: 7, lifecycle_state: 'engaged', ... } }, ... })
 */
function buildClient(fixtures: {
  customers?: Record<number, Row>
  memberships?: Row[]
  jobs?: Row[]
  messages?: Row[]
  cleaners?: Row[]
}) {
  const chain = (table: string): any => {
    const filters: Record<string, unknown> = {}
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters[col] = val; return builder },
      in: (col: string, vals: unknown[]) => { filters[col + '_in'] = vals; return builder },
      gte: (col: string, val: unknown) => { filters[col + '_gte'] = val; return builder },
      lte: (col: string, val: unknown) => { filters[col + '_lte'] = val; return builder },
      is: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        if (table === 'customers') {
          const id = filters['id'] as number
          const customer = fixtures.customers?.[id]
          return { data: customer ?? null, error: null }
        }
        if (table === 'customer_memberships') {
          const customerId = filters['customer_id'] as number
          const rows = (fixtures.memberships || []).filter(m => m.customer_id === customerId)
          return { data: rows[0] ?? null, error: null }
        }
        if (table === 'jobs') {
          const customerId = filters['customer_id'] as number
          const allowed = filters['status_in'] as string[] | undefined
          const rows = (fixtures.jobs || []).filter(j =>
            j.customer_id === customerId &&
            (!allowed || allowed.includes(j.status as string))
          )
          return { data: rows[0] ?? null, error: null }
        }
        if (table === 'messages') {
          const customerId = filters['customer_id'] as number
          const dir = filters['direction']
          const tsGte = filters['timestamp_gte'] as string | undefined
          const rows = (fixtures.messages || []).filter(m => {
            if (m.customer_id !== customerId) return false
            if (dir && m.direction !== dir) return false
            if (tsGte && typeof m.timestamp === 'string' && m.timestamp < tsGte) return false
            return true
          })
          return { data: rows[0] ?? null, error: null }
        }
        return { data: null, error: null }
      },
    }
    return builder
  }
  return {
    from: (table: string) => chain(table),
  } as any
}

const BASE_CUSTOMER: Row = {
  id: 7,
  phone_number: '+15551234567',
  email: 'sarah@example.com',
  lifecycle_state: 'engaged',
  sms_opt_out: false,
  auto_response_disabled: false,
  auto_response_paused: false,
  human_takeover_until: null,
  retargeting_stopped_reason: null,
  manual_managed: false,
  email_bounced_at: null,
}

beforeEach(() => {
  // Make sure kill switches are OFF unless a test flips them
  delete process.env.RETARGETING_DISABLED
  delete process.env.PIPELINE_A_DISABLED
  delete process.env.PIPELINE_B_DISABLED
  delete process.env.PIPELINE_C_DISABLED
})

afterEach(() => {
  delete process.env.RETARGETING_DISABLED
  delete process.env.PIPELINE_A_DISABLED
  delete process.env.PIPELINE_B_DISABLED
  delete process.env.PIPELINE_C_DISABLED
})

// Mock getCleanerPhoneSet and isCleanerPhone (tenant.ts) to avoid DB-dependent
// cleaner lookups in unit tests.
vi.mock('../../packages/core/src/tenant', async () => {
  const actual = await vi.importActual<any>('../../packages/core/src/tenant')
  return {
    ...actual,
    getCleanerPhoneSet: vi.fn(async () => new Set<string>()),
    isCleanerPhone: vi.fn(() => false),
  }
})

describe('isEligibleForOutreach — happy path', () => {
  it('allows engaged customer for pre_quote', async () => {
    const client = buildClient({ customers: { 7: BASE_CUSTOMER } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(true)
  })

  it('allows quoted customer for post_quote', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'quoted' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'post_quote',
    })
    expect(res.ok).toBe(true)
  })

  it('allows retargeting customer for retargeting', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'retargeting' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.ok).toBe(true)
  })
})

describe('isEligibleForOutreach — kill switches', () => {
  it('RETARGETING_DISABLED=true blocks everything', async () => {
    process.env.RETARGETING_DISABLED = 'true'
    const client = buildClient({ customers: { 7: BASE_CUSTOMER } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('kill_switch')
  })

  it('PIPELINE_A_DISABLED=true blocks only pre_quote', async () => {
    process.env.PIPELINE_A_DISABLED = 'true'
    const client = buildClient({ customers: { 7: BASE_CUSTOMER } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('pipeline_disabled')
  })

  it('PIPELINE_A_DISABLED does not affect pipeline C', async () => {
    process.env.PIPELINE_A_DISABLED = 'true'
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'retargeting' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.ok).toBe(true)
  })
})

describe('isEligibleForOutreach — tenant exclusion', () => {
  it('blocks WinBros', async () => {
    const client = buildClient({ customers: { 7: BASE_CUSTOMER } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'winbros', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('tenant_excluded')
  })
})

describe('isEligibleForOutreach — customer-level exclusions', () => {
  it('opt_out', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, sms_opt_out: true } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('opt_out')
  })

  it('auto_response_disabled', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, auto_response_disabled: true } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('auto_response_disabled')
  })

  it('admin_disabled — the specific 2026-04-22 bug', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, retargeting_stopped_reason: 'admin_disabled' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'west-niagara', customerId: 7, kind: 'retargeting',
    })
    expect(res.reason).toBe('admin_disabled')
  })

  it('manual_managed (Raza/Mahas pattern)', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, manual_managed: true } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('manual_managed')
  })

  it('no phone_number for SMS channel', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, phone_number: null } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote', channel: 'sms',
    })
    expect(res.reason).toBe('no_phone')
  })

  it('human_takeover_active', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, human_takeover_until: future } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('human_takeover_active')
  })

  it('customer not found', async () => {
    const client = buildClient({})
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 999, kind: 'pre_quote',
    })
    expect(res.reason).toBe('customer_not_found')
  })
})

describe('isEligibleForOutreach — state mismatch', () => {
  it('blocks pre_quote when state is retargeting', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'retargeting' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('state_mismatch')
  })

  it('blocks retargeting for a recurring customer', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'recurring' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.reason).toBe('state_mismatch')
  })

  it('blocks anything for an archived customer', async () => {
    const client = buildClient({ customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'archived' } } })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.reason).toBe('state_mismatch')
  })
})

describe('isEligibleForOutreach — active job / membership', () => {
  it('blocks when active membership exists', async () => {
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      memberships: [{ customer_id: 7, status: 'active' }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('active_membership')
  })

  it('blocks when customer has a pending job (the 2026-04-22 bug)', async () => {
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      jobs: [{ customer_id: 7, status: 'pending' }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('active_job')
  })

  it('blocks when customer has a quoted job', async () => {
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      jobs: [{ customer_id: 7, status: 'quoted' }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.reason).toBe('active_job')
  })
})

describe('isEligibleForOutreach — retargeting recent-inbound pause', () => {
  it('pauses retargeting if inbound in last 14 days (but outside the 30-min live-convo window)', async () => {
    // 2 hours ago: outside 30-min active window, inside 14-day retargeting window
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'retargeting' } },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: twoHoursAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.reason).toBe('recent_inbound')
  })
})

describe('isEligibleForOutreach — active conversation (live back-and-forth)', () => {
  it('blocks pre_quote when customer sent an inbound message 5 minutes ago', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: fiveMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('active_conversation')
  })

  it('blocks post_quote when customer sent an inbound message 5 minutes ago', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'quoted' } },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: fiveMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'post_quote',
    })
    expect(res.reason).toBe('active_conversation')
  })

  it('blocks retargeting when customer sent an inbound message 5 minutes ago', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: { ...BASE_CUSTOMER, lifecycle_state: 'retargeting' } },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: fiveMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'retargeting',
    })
    expect(res.reason).toBe('active_conversation')
  })

  it('allows outreach when the inbound is older than the window (45 minutes ago, default 30-min window)', async () => {
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: fortyFiveMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
    })
    expect(res.ok).toBe(true)
  })

  it('per-tenant override: a 60-minute window blocks an inbound from 45 minutes ago', async () => {
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: fortyFiveMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
      activeConversationWindowMinutes: 60,
    })
    expect(res.reason).toBe('active_conversation')
  })

  it('setting the window to 0 disables the check entirely', async () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const client = buildClient({
      customers: { 7: BASE_CUSTOMER },
      messages: [{ customer_id: 7, direction: 'inbound', timestamp: oneMinAgo }],
    })
    const res = await isEligibleForOutreach({
      client, tenantId: 't1', tenantSlug: 'spotless-scrubbers', customerId: 7, kind: 'pre_quote',
      activeConversationWindowMinutes: 0,
    })
    expect(res.ok).toBe(true)
  })
})
