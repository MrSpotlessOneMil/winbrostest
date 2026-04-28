/**
 * Tier 2 integration test: retargeting next-task-on-fire flow.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 * Source spec: clean_machine_rebuild/07_RETARGETING.md §4 (next-task-on-fire)
 *
 * Verifies:
 *   1. runWinBackStep on a structured-phase task fires SMS + schedules step 2
 *   2. After step 5, the next task is scheduled in evergreen phase, +4 weeks
 *   3. Evergreen → evergreen, ALWAYS schedules next, picks new template_key
 *   4. Halt-on-unsubscribed during run cancels, no further scheduling
 *   5. last_retargeting_template_key is recorded after each send
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks (same shape as hc-followup-integration) ────────────────────
const mockScheduleTask = vi.fn().mockResolvedValue({ success: true, taskId: 'mock-task-id' })
vi.mock('@/lib/scheduler', () => ({
  scheduleTask: (...args: any[]) => mockScheduleTask(...args),
  cancelTask: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantById: vi.fn().mockResolvedValue({
    id: 'tenant-spotless',
    slug: 'spotless-scrubbers',
    name: 'Spotless Scrubbers',
    business_name: 'Spotless Scrubbers',
    business_name_short: 'Spotless',
    timezone: 'America/Los_Angeles',
    workflow_config: { followup_rebuild_v2_enabled: true, currency: 'USD' },
  }),
}))

const mockSendSMS = vi.fn().mockResolvedValue({ success: true })
vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}))

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}))

type Row = Record<string, any>
const tables: Record<string, Row[]> = {}

function makeFakeChain(table: string) {
  let op: 'select' | 'update' = 'select'
  let mutData: any = null
  const matchers: Array<(r: Row) => boolean> = []

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

import { runWinBackStep, STRUCTURED_RETARGETING_CADENCE } from '../../apps/house-cleaning/lib/services/followups/retargeting-service'

const TENANT_ID = 'tenant-spotless'
const CUSTOMER_ID = 12345

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
})

function seedActiveRetargetingCustomer(extra: Partial<Row> = {}) {
  tables.customers = [{
    id: CUSTOMER_ID, tenant_id: TENANT_ID,
    first_name: 'Sarah', phone_number: '+15551234567',
    bedrooms: 3, bathrooms: 2,
    retargeting_active: true,
    unsubscribed_at: null, sms_opt_out: false,
    last_retargeting_template_key: null,
    human_takeover_until: null,
    ...extra,
  }]
}

// ─────────────────────────────────────────────────────────────────────────
// runWinBackStep — structured phase progression
// ─────────────────────────────────────────────────────────────────────────

describe('runWinBackStep — structured phase', () => {
  it('step 1 → sends SMS, schedules step 2 with correct delta offset', async () => {
    seedActiveRetargetingCustomer()
    const result = await runWinBackStep({
      taskId: 'task-step1',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        phase: 'structured',
        template_key: STRUCTURED_RETARGETING_CADENCE[0].template_key,
        enrolled_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(true)
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const next = mockScheduleTask.mock.calls[0][0]
    expect(next.taskType).toBe('retargeting.win_back')
    expect(next.payload.step_index).toBe(2)
    expect(next.payload.phase).toBe('structured')
    expect(next.payload.template_key).toBe(STRUCTURED_RETARGETING_CADENCE[1].template_key)
    // Delta from step 1 to step 2 = 3w*7*24*60 - 1*24*60 minutes
    const expectedDeltaMs = (STRUCTURED_RETARGETING_CADENCE[1].offset_minutes - STRUCTURED_RETARGETING_CADENCE[0].offset_minutes) * 60_000
    const actualDelta = next.scheduledFor.getTime() - Date.now()
    expect(Math.abs(actualDelta - expectedDeltaMs)).toBeLessThan(5_000) // within 5s
    // last_retargeting_template_key recorded
    expect(tables.customers[0].last_retargeting_template_key).toBe(STRUCTURED_RETARGETING_CADENCE[0].template_key)
  })

  it('step 5 (last structured) → next is evergreen at +4 weeks', async () => {
    seedActiveRetargetingCustomer()
    const result = await runWinBackStep({
      taskId: 'task-step5',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 5,
        phase: 'structured',
        template_key: STRUCTURED_RETARGETING_CADENCE[4].template_key,
        enrolled_at: new Date().toISOString(),
      },
    })
    expect(result.sent).toBe(true)
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const next = mockScheduleTask.mock.calls[0][0]
    expect(next.payload.phase).toBe('evergreen')
    expect(next.payload.step_index).toBe(6)
    // 4 weeks from now ± 5s
    const fourWeeksMs = 4 * 7 * 24 * 60 * 60 * 1000
    const actual = next.scheduledFor.getTime() - Date.now()
    expect(Math.abs(actual - fourWeeksMs)).toBeLessThan(5_000)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// runWinBackStep — evergreen phase
// ─────────────────────────────────────────────────────────────────────────

describe('runWinBackStep — evergreen phase', () => {
  it('evergreen → evergreen, schedules NEXT at +4 weeks with new template_key', async () => {
    seedActiveRetargetingCustomer({ last_retargeting_template_key: 'evergreen_dollar_20' })
    const result = await runWinBackStep({
      taskId: 'task-ev',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 7,
        phase: 'evergreen',
        template_key: 'evergreen_dollar_20',
        enrolled_at: new Date().toISOString(),
      },
    })
    expect(result.sent).toBe(true)
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const next = mockScheduleTask.mock.calls[0][0]
    expect(next.payload.phase).toBe('evergreen')
    expect(next.payload.step_index).toBe(8)
    // Picked template should NOT be the same as last (back-to-back exclusion)
    expect(next.payload.template_key).not.toBe('evergreen_dollar_20')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Halt-on-unsubscribe inside the run path
// ─────────────────────────────────────────────────────────────────────────

describe('runWinBackStep — eligibility halts', () => {
  it('halts and does NOT schedule next if customer unsubscribed', async () => {
    seedActiveRetargetingCustomer({ unsubscribed_at: '2026-04-28T10:00:00Z' })
    const result = await runWinBackStep({
      taskId: 'task-x',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        phase: 'structured',
        template_key: 'recurring_seed_20',
        enrolled_at: new Date().toISOString(),
      },
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('unsubscribed')
    expect(mockSendSMS).not.toHaveBeenCalled()
    // No next-task scheduled
    expect(mockScheduleTask).not.toHaveBeenCalled()
    // retargeting_active flipped off
    expect(tables.customers[0].retargeting_active).toBe(false)
  })

  it('does NOT send if customer no longer active in retargeting', async () => {
    seedActiveRetargetingCustomer({ retargeting_active: false })
    const result = await runWinBackStep({
      taskId: 'task-y',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 2,
        phase: 'structured',
        template_key: 'open_slots_this_week',
        enrolled_at: new Date().toISOString(),
      },
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('not_active')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('reschedules itself (does NOT send) when human takeover is active', async () => {
    const futureTakeover = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1h in future
    seedActiveRetargetingCustomer({ human_takeover_until: futureTakeover })

    const result = await runWinBackStep({
      taskId: 'task-z',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        phase: 'structured',
        template_key: 'recurring_seed_20',
        enrolled_at: new Date().toISOString(),
      },
    })
    expect(result.sent).toBe(false)
    expect(result.reason).toBe('rescheduled_human_takeover')
    expect(mockSendSMS).not.toHaveBeenCalled()
    // ONE reschedule task was created (not the next step — same step rescheduled)
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const resched = mockScheduleTask.mock.calls[0][0]
    expect(resched.payload.step_index).toBe(1) // SAME step
  })
})
