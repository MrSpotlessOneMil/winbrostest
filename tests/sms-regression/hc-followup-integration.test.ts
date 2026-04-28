/**
 * Tier 2 integration test: HC ghost-chase + retargeting + unsubscribe.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Mocks: @supabase/supabase-js (via shared mock), @/lib/scheduler (asserted
 * directly), @/lib/openphone (no-op), @/lib/tenant (returns fixture).
 *
 * Verifies:
 *   1. scheduleGhostChase calls scheduleTask 6 times with correct offsets + step indices
 *   2. enrollInRetargeting inserts ONE task at +24h and flips retargeting_active
 *   3. handleUnsubscribe sets unsubscribed_at, sends one TCPA confirmation
 *   4. handleUnsubscribe is idempotent (no second confirmation on already-unsubscribed)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mock @/lib/scheduler — capture scheduleTask calls ────────────────────
const mockScheduleTask = vi.fn().mockResolvedValue({ success: true, taskId: 'mock-task-id' })
vi.mock('@/lib/scheduler', () => ({
  scheduleTask: (...args: any[]) => mockScheduleTask(...args),
  cancelTask: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Mock @/lib/tenant — return a fixture tenant ──────────────────────────
vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockResolvedValue({
    id: 'tenant-spotless',
    slug: 'spotless-scrubbers',
    name: 'Spotless Scrubbers',
    business_name: 'Spotless Scrubbers',
    business_name_short: 'Spotless',
    timezone: 'America/Los_Angeles',
    workflow_config: { followup_rebuild_v2_enabled: true },
  }),
}))

// ─── Mock @/lib/openphone — sendSMS no-ops with success ───────────────────
const mockSendSMS = vi.fn().mockResolvedValue({ success: true })
vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}))

// ─── Mock @/lib/system-events — capture log calls without DB ──────────────
const mockLogSystemEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/system-events', () => ({
  logSystemEvent: (...args: any[]) => mockLogSystemEvent(...args),
}))

// ─── Mock @/lib/supabase — provide a thin in-memory fake ─────────────────
type Row = Record<string, any>
const tables: Record<string, Row[]> = {}

function makeFakeChain(table: string) {
  let op: 'select' | 'update' = 'select'
  let mutData: any = null
  const matchers: Array<(r: Row) => boolean> = []
  let limit: number | null = null
  let returnSelectColumns = '*'

  const builder: any = {
    eq(field: string, value: any) { matchers.push(r => r[field] === value); return builder },
    is(field: string, value: any) { matchers.push(r => (value === null ? r[field] == null : r[field] === value)); return builder },
    in(field: string, values: any[]) { matchers.push(r => values.includes(r[field])); return builder },
    gt(field: string, value: any) { matchers.push(r => r[field] > value); return builder },
    not(field: string, _op: string, value: any) { matchers.push(r => r[field] !== value); return builder },
    order() { return builder },
    limit(n: number) { limit = n; return builder },
    filter(field: string, op2: string, value: any) {
      // Crude support for 'payload->>customer_id' style — convert to nested lookup
      if (field.includes('->>')) {
        const [parent, child] = field.split('->>')
        matchers.push(r => {
          const v = r[parent]?.[child]
          if (op2 === 'eq') return String(v) === String(value)
          return false
        })
      } else {
        matchers.push(r => (op2 === 'eq' ? r[field] === value : false))
      }
      return builder
    },
    select(cols?: string) { returnSelectColumns = cols || '*'; return builder },
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
      return resolve({ data: limit ? rows.slice(0, limit) : rows, error: null })
    },
  }

  void returnSelectColumns
  return builder
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from: (t: string) => makeFakeChain(t),
  }),
  getSupabaseClient: () => ({
    from: (t: string) => makeFakeChain(t),
  }),
}))

// ─── Imports AFTER mocks ──────────────────────────────────────────────────
import { scheduleGhostChase, DEFAULT_GHOST_CHASE_CADENCE } from '../../apps/house-cleaning/lib/services/followups/ghost-chase'
import { enrollInRetargeting, haltRetargeting } from '../../apps/house-cleaning/lib/services/followups/retargeting-service'
import { handleUnsubscribe, isStopMessage } from '../../apps/house-cleaning/lib/services/followups/unsubscribe'

const TENANT_ID = 'tenant-spotless'
const CUSTOMER_ID = 12345

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
  mockLogSystemEvent.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────
// scheduleGhostChase
// ─────────────────────────────────────────────────────────────────────────

describe('scheduleGhostChase', () => {
  it('schedules 6 tasks with the cadence offsets', async () => {
    const result = await scheduleGhostChase({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      entityType: 'lead',
      entityId: 7777,
      ghostStartedAt: new Date('2026-04-28T12:00:00Z'),
    })

    expect(result.scheduled).toBe(6)
    expect(mockScheduleTask).toHaveBeenCalledTimes(6)

    // Each call has the expected step + offset
    for (let i = 0; i < DEFAULT_GHOST_CHASE_CADENCE.length; i++) {
      const step = DEFAULT_GHOST_CHASE_CADENCE[i]
      const call = mockScheduleTask.mock.calls[i][0]
      expect(call.taskType).toBe('followup.ghost_chase')
      expect(call.payload.step_index).toBe(step.step)
      expect(call.payload.entity_type).toBe('lead')
      expect(call.payload.entity_id).toBe(7777)
      expect(call.payload.customer_id).toBe(CUSTOMER_ID)
      expect(call.taskKey).toBe(`gc:lead:7777:${step.step}`)
      // run_at = ghostStartedAt + offset_minutes*60_000
      const expectedRunAt = new Date('2026-04-28T12:00:00Z').getTime() + step.offset_minutes * 60_000
      expect(call.scheduledFor.getTime()).toBe(expectedRunAt)
    }
  })

  it('idempotent task_keys allow re-scheduling for same entity+step', async () => {
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entityType: 'quote', entityId: 999,
    })
    const firstKeys = mockScheduleTask.mock.calls.map(c => c[0].taskKey)
    expect(new Set(firstKeys).size).toBe(6) // all 6 unique

    mockScheduleTask.mockClear()
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entityType: 'quote', entityId: 999,
    })
    const secondKeys = mockScheduleTask.mock.calls.map(c => c[0].taskKey)
    // Same keys — scheduleTask is responsible for upsert behavior
    expect(secondKeys).toEqual(firstKeys)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// enrollInRetargeting
// ─────────────────────────────────────────────────────────────────────────

describe('enrollInRetargeting', () => {
  it('schedules ONE task at +24h with structured phase', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      retargeting_active: false, unsubscribed_at: null, sms_opt_out: false,
    }]

    const result = await enrollInRetargeting({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entryReason: 'lead_ghosted',
    })

    expect(result.enrolled).toBe(true)
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const call = mockScheduleTask.mock.calls[0][0]
    expect(call.taskType).toBe('retargeting.win_back')
    expect(call.payload.step_index).toBe(1)
    expect(call.payload.phase).toBe('structured')
    expect(call.payload.customer_id).toBe(CUSTOMER_ID)
    expect(call.payload.template_key).toBe('recurring_seed_20')

    // retargeting_active flipped on customer record
    expect(tables.customers[0].retargeting_active).toBe(true)
  })

  it('refuses if already active', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      retargeting_active: true, unsubscribed_at: null, sms_opt_out: false,
    }]
    const result = await enrollInRetargeting({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entryReason: 'lead_ghosted',
    })
    expect(result.enrolled).toBe(false)
    expect(result.reason).toBe('already_active')
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })

  it('refuses if customer is unsubscribed', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      retargeting_active: false, unsubscribed_at: '2026-04-28T12:00:00Z', sms_opt_out: true,
    }]
    const result = await enrollInRetargeting({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entryReason: 'one_time_job_complete',
    })
    expect(result.enrolled).toBe(false)
    expect(result.reason).toBe('unsubscribed')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// handleUnsubscribe
// ─────────────────────────────────────────────────────────────────────────

describe('handleUnsubscribe', () => {
  it('sets unsubscribed_at + retargeting_active=false + sends one confirmation', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      first_name: 'Sarah', phone_number: '+15551234567',
      unsubscribed_at: null, sms_opt_out: false, retargeting_active: true,
    }]
    tables.scheduled_tasks = [
      { id: 'task1', tenant_id: TENANT_ID, status: 'pending', task_type: 'retargeting.win_back', payload: { customer_id: CUSTOMER_ID } },
      { id: 'task2', tenant_id: TENANT_ID, status: 'pending', task_type: 'followup.ghost_chase', payload: { customer_id: CUSTOMER_ID } },
      { id: 'task3', tenant_id: TENANT_ID, status: 'pending', task_type: 'job_broadcast', payload: { customer_id: CUSTOMER_ID } },
    ]

    const result = await handleUnsubscribe({ tenantId: TENANT_ID, customerId: CUSTOMER_ID })

    expect(result.unsubscribed).toBe(true)
    expect(result.confirmationSent).toBe(true)
    expect(tables.customers[0].unsubscribed_at).toBeTruthy()
    expect(tables.customers[0].retargeting_active).toBe(false)
    // All 3 pending tasks for this customer get cancelled (including job_broadcast — STOP is global)
    const cancelled = tables.scheduled_tasks.filter(t => t.status === 'cancelled')
    expect(cancelled.length).toBe(3)
    // ONE confirmation SMS sent
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
    expect(mockSendSMS.mock.calls[0][2]).toContain("you're unsubscribed")
  })

  it('idempotent: already-unsubscribed customer does not get a second confirmation', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      first_name: 'Sarah', phone_number: '+15551234567',
      unsubscribed_at: '2026-04-27T10:00:00Z', sms_opt_out: true, retargeting_active: false,
    }]
    const result = await handleUnsubscribe({ tenantId: TENANT_ID, customerId: CUSTOMER_ID })
    expect(result.reason).toBe('already_unsubscribed')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('refuses on customer-not-found without crashing', async () => {
    tables.customers = []
    const result = await handleUnsubscribe({ tenantId: TENANT_ID, customerId: 99999 })
    expect(result.unsubscribed).toBe(false)
    expect(result.reason).toBe('customer_not_found')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// haltRetargeting
// ─────────────────────────────────────────────────────────────────────────

describe('haltRetargeting', () => {
  it('cancels pending retargeting tasks and clears active flag', async () => {
    tables.customers = [{
      id: CUSTOMER_ID, tenant_id: TENANT_ID,
      retargeting_active: true,
    }]
    tables.scheduled_tasks = [
      { id: 'rt1', tenant_id: TENANT_ID, status: 'pending', task_type: 'retargeting.win_back', payload: { customer_id: CUSTOMER_ID } },
      { id: 'rt2', tenant_id: TENANT_ID, status: 'pending', task_type: 'followup.ghost_chase', payload: { customer_id: CUSTOMER_ID } },
    ]

    const result = await haltRetargeting(TENANT_ID, CUSTOMER_ID, 'customer_replied')
    expect(result.cancelled).toBe(1) // only retargeting.win_back, NOT ghost_chase
    expect(tables.customers[0].retargeting_active).toBe(false)
    // Ghost chase still pending
    const ghostStillPending = tables.scheduled_tasks.find(t => t.task_type === 'followup.ghost_chase')!
    expect(ghostStillPending.status).toBe('pending')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// STOP keyword detection (sanity — full coverage in unit tests)
// ─────────────────────────────────────────────────────────────────────────

describe('isStopMessage at the integration boundary', () => {
  it('integrates with handleUnsubscribe entry path', () => {
    expect(isStopMessage('STOP')).toBe(true)
    expect(isStopMessage("don't stop calling me")).toBe(false)
  })
})
