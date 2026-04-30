/**
 * Unit tests for v2 follow-up wiring helper.
 *
 * Test strategy: mock the underlying deps (scheduleTask, sendSMS, supabase)
 * and let wire.ts → real ghost-chase / retargeting-service → mocked deps run.
 * This matches the pattern in hc-followup-integration.test.ts.
 *
 * Source: apps/house-cleaning/lib/services/followups/wire.ts
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────
const mockScheduleTask = vi.fn().mockResolvedValue({ success: true, taskId: 'mock-task-id' })
vi.mock('@/lib/scheduler', () => ({
  scheduleTask: (...args: any[]) => mockScheduleTask(...args),
  cancelTask: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockResolvedValue({
    id: 'tenant-spotless', slug: 'spotless-scrubbers',
    name: 'Spotless', business_name: 'Spotless Scrubbers',
    business_name_short: 'Spotless', timezone: 'America/Los_Angeles',
    workflow_config: { followup_rebuild_v2_enabled: true, currency: 'USD' },
  }),
}))

const mockSendSMS = vi.fn().mockResolvedValue({ success: true })
vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}))

const mockLogSystemEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/system-events', () => ({
  logSystemEvent: (...args: any[]) => mockLogSystemEvent(...args),
}))

// ─── Mock supabase with table-backed fake ────────────────────────────────
const tables: Record<string, any[]> = {}

function makeFakeChain(table: string) {
  let op: 'select' | 'update' = 'select'
  let mutData: any = null
  const matchers: Array<(r: any) => boolean> = []

  const builder: any = {
    eq(field: string, value: any) { matchers.push(r => r[field] === value); return builder },
    is(field: string, value: any) { matchers.push(r => (value === null ? r[field] == null : r[field] === value)); return builder },
    in(field: string, values: any[]) { matchers.push(r => values.includes(r[field])); return builder },
    gt(field: string, value: any) { matchers.push(r => r[field] > value); return builder },
    not(field: string, _op: string, value: any) { matchers.push(r => r[field] !== value); return builder },
    order() { return builder },
    limit() { return builder },
    filter(field: string, op2: string, value: any) {
      if (field.includes('->>')) {
        const [parent, child] = field.split('->>')
        matchers.push(r => {
          const v = r[parent]?.[child]
          return op2 === 'eq' ? String(v) === String(value) : false
        })
      } else {
        matchers.push(r => (op2 === 'eq' ? r[field] === value : false))
      }
      return builder
    },
    select() { return builder },
    update(data: any) { op = 'update'; mutData = data; return builder },
    insert(data: any) {
      const items = Array.isArray(data) ? data : [data]
      for (const it of items) {
        if (!tables[table]) tables[table] = []
        tables[table].push({ id: Math.random().toString(36).slice(2), ...it })
      }
      return Promise.resolve({ data: items, error: null })
    },
    maybeSingle: async () => {
      if (op === 'update') {
        const all = (tables[table] || []).filter(r => matchers.every(m => m(r)))
        for (const r of all) Object.assign(r, mutData)
        return { data: all[0] || null, error: null }
      }
      const rows = (tables[table] || []).filter(r => matchers.every(m => m(r)))
      return { data: rows[0] || null, error: null }
    },
    single: async () => builder.maybeSingle(),
    then: (resolve: any) => {
      if (op === 'update') {
        const all = (tables[table] || []).filter(r => matchers.every(m => m(r)))
        for (const r of all) Object.assign(r, mutData)
        return resolve({ data: all, error: null })
      }
      const rows = (tables[table] || []).filter(r => matchers.every(m => m(r)))
      return resolve({ data: rows, error: null })
    },
  }
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({ from: (t: string) => makeFakeChain(t) }),
  getSupabaseClient: () => ({ from: (t: string) => makeFakeChain(t) }),
}))

import {
  wireFollowupsAfterOutbound,
  wireRetargetingOnJobComplete,
  isV2Enabled,
  getActiveLeadIdForCustomer,
  getActiveQuoteIdForCustomer,
} from '../../../apps/house-cleaning/lib/services/followups/wire'

const TENANT_V2_ON = {
  id: 'tenant-spotless',
  slug: 'spotless-scrubbers',
  workflow_config: { followup_rebuild_v2_enabled: true, currency: 'USD' },
}
const TENANT_V2_OFF = {
  id: 'tenant-cedar',
  slug: 'cedar-rapids',
  workflow_config: { followup_rebuild_v2_enabled: false, currency: 'USD' },
}
const CUST = { id: 42, phone_number: '+15551234567' }

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
  mockLogSystemEvent.mockClear()
  // Seed customer required by enrollInRetargeting eligibility check
  tables.customers = [{
    id: 42, tenant_id: TENANT_V2_ON.id,
    first_name: 'Sarah', phone_number: '+15551234567',
    bedrooms: 3, bathrooms: 2,
    retargeting_active: false,
    unsubscribed_at: null, sms_opt_out: false,
    last_retargeting_template_key: null,
    human_takeover_until: null,
  }]
})

// ─── isV2Enabled ────────────────────────────────────────────────────────

describe('isV2Enabled', () => {
  it('returns true only when workflow_config.followup_rebuild_v2_enabled === true', () => {
    expect(isV2Enabled(TENANT_V2_ON)).toBe(true)
    expect(isV2Enabled(TENANT_V2_OFF)).toBe(false)
    expect(isV2Enabled({ id: 't' })).toBe(false)
    expect(isV2Enabled({ id: 't', workflow_config: null as any })).toBe(false)
    expect(isV2Enabled({ id: 't', workflow_config: { followup_rebuild_v2_enabled: 'true' } })).toBe(false)
  })
})

// ─── wireFollowupsAfterOutbound ─────────────────────────────────────────

describe('wireFollowupsAfterOutbound', () => {
  it('no-ops when v2 flag is OFF', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_OFF, customer: CUST, quoteJustSent: false, activeLeadId: 100, source: 't',
    })
    expect(res.scheduled).toBe(false)
    expect(res.reason).toBe('v2_disabled')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('no-ops when customer.id is missing', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: { id: 0, phone_number: null }, quoteJustSent: false, source: 't',
    })
    expect(res.scheduled).toBe(false)
    expect(res.reason).toBe('no_customer')
  })

  it('schedules quote ghost chase (6 steps) when quoteJustSent + quoteId provided', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: CUST, quoteJustSent: true, quoteId: 999, activeLeadId: 100, source: 't',
    })
    expect(res.scheduled).toBe(true)
    expect(res.entity_type).toBe('quote')
    // 6 ghost-chase task rows scheduled
    expect(mockScheduleTask).toHaveBeenCalledTimes(6)
    const firstCall = mockScheduleTask.mock.calls[0][0]
    expect(firstCall.taskType).toBe('followup.ghost_chase')
    expect(firstCall.payload.entity_type).toBe('quote')
    expect(firstCall.payload.entity_id).toBe(999)
    expect(firstCall.payload.customer_id).toBe(42)
  })

  it('no-ops when quoteJustSent but quoteId is missing', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: CUST, quoteJustSent: true, source: 't',
    })
    expect(res.scheduled).toBe(false)
    expect(res.reason).toBe('no_eligible_entity')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('schedules lead ghost chase (6 steps) when activeLeadId provided and no quote', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: CUST, quoteJustSent: false, activeLeadId: 100, source: 'meta_lead',
    })
    expect(res.scheduled).toBe(true)
    expect(res.entity_type).toBe('lead')
    expect(mockScheduleTask).toHaveBeenCalledTimes(6)
    const firstCall = mockScheduleTask.mock.calls[0][0]
    expect(firstCall.taskType).toBe('followup.ghost_chase')
    expect(firstCall.payload.entity_type).toBe('lead')
    expect(firstCall.payload.entity_id).toBe(100)
    expect(firstCall.payload.phone).toBe('+15551234567')
  })

  it('no-ops when neither quoteJustSent nor activeLeadId', async () => {
    const res = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: CUST, quoteJustSent: false, source: 't',
    })
    expect(res.scheduled).toBe(false)
    expect(res.reason).toBe('no_eligible_entity')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('logs a GHOST_CHASE_WIRED system event on success', async () => {
    await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: CUST, quoteJustSent: false, activeLeadId: 100, source: 'webhook',
    })
    const wiredCall = mockLogSystemEvent.mock.calls.find(c => c[0]?.event_type === 'GHOST_CHASE_WIRED')
    expect(wiredCall).toBeDefined()
    expect(wiredCall![0].tenant_id).toBe(TENANT_V2_ON.id)
  })
})

// ─── wireRetargetingOnJobComplete ───────────────────────────────────────

describe('wireRetargetingOnJobComplete', () => {
  it('no-ops when v2 flag is OFF', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_OFF, customerId: 42, lifecycleStatus: 'one_time', source: 't',
    })
    expect(res.enrolled).toBe(false)
    expect(res.reason).toBe('v2_disabled')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('skips recurring customers', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 42, lifecycleStatus: 'recurring', source: 't',
    })
    expect(res.enrolled).toBe(false)
    expect(res.reason).toBe('lifecycle_recurring_skip')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('skips active_membership customers', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 42, lifecycleStatus: 'active_membership', source: 't',
    })
    expect(res.enrolled).toBe(false)
  })

  it('enrolls one_time customers (schedules a single retargeting.win_back at +24h)', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 42, lifecycleStatus: 'one_time', source: 'complete_job',
    })
    expect(res.enrolled).toBe(true)
    // ONE retargeting.win_back row scheduled
    const winBackCalls = mockScheduleTask.mock.calls.filter(c => c[0]?.taskType === 'retargeting.win_back')
    expect(winBackCalls).toHaveLength(1)
    const call = winBackCalls[0][0]
    expect(call.payload.customer_id).toBe(42)
    expect(call.payload.step_index).toBe(1)
    expect(call.payload.phase).toBe('structured')
    // ~24h offset
    const deltaMs = call.scheduledFor.getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(deltaMs).toBeLessThan(25 * 60 * 60 * 1000)
  })

  it('enrolls lapsed customers (re-engagement target)', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 42, lifecycleStatus: 'lapsed', source: 'complete_job',
    })
    expect(res.enrolled).toBe(true)
  })

  it('enrolls when lifecycleStatus is null (treat as one_time)', async () => {
    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 42, lifecycleStatus: null, source: 'complete_job',
    })
    expect(res.enrolled).toBe(true)
  })
})

// ─── getActiveLeadIdForCustomer / getActiveQuoteIdForCustomer ───────────

describe('getActiveLeadIdForCustomer', () => {
  it('returns the most recent active lead id', async () => {
    tables.leads = [{ id: 1, tenant_id: 't1', customer_id: 42, status: 'contacted' }]
    const id = await getActiveLeadIdForCustomer('t1', 42)
    expect(id).toBe(1)
  })

  it('returns null when no active lead exists', async () => {
    tables.leads = [{ id: 1, tenant_id: 't1', customer_id: 42, status: 'completed' }]
    const id = await getActiveLeadIdForCustomer('t1', 42)
    expect(id).toBeNull()
  })
})

describe('getActiveQuoteIdForCustomer', () => {
  it('returns the most recent sent/viewed quote', async () => {
    tables.quotes = [{ id: 555, tenant_id: 't1', customer_id: 42, status: 'sent' }]
    const id = await getActiveQuoteIdForCustomer('t1', 42)
    expect(id).toBe(555)
  })

  it('returns null for booked or closed quotes', async () => {
    tables.quotes = [{ id: 555, tenant_id: 't1', customer_id: 42, status: 'booked' }]
    const id = await getActiveQuoteIdForCustomer('t1', 42)
    expect(id).toBeNull()
  })
})
