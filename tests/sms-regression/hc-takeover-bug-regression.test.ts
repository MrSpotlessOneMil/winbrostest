/**
 * Regression test: v2 follow-up handlers must respect manual takeover even
 * when human_takeover_until isn't set, by also gating on auto_response_paused
 * + recent manual_takeover_at.
 *
 * Bug discovered 2026-04-29: the OpenPhone outbound webhook stamps
 * auto_response_paused=true and manual_takeover_at=now() when an owner texts
 * manually. The v2 ghost-chase + retargeting handlers were only checking
 * human_takeover_until, which is never written by production code. Result:
 * after an owner manually messages, the next ghost-chase / retargeting step
 * would still fire on schedule, blasting the customer right after the owner's
 * personal touch.
 *
 * Fix: handlers now ALSO check auto_response_paused + manual_takeover_at
 * within last 30 min. Webhook now also sets human_takeover_until = now()+10min
 * proactively. This test pins the defense-in-depth path.
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
    id: 'tenant-spotless',
    slug: 'spotless-scrubbers',
    name: 'Spotless',
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

import { runGhostChaseStep } from '../../apps/house-cleaning/lib/services/followups/ghost-chase'
import { runWinBackStep, STRUCTURED_RETARGETING_CADENCE } from '../../apps/house-cleaning/lib/services/followups/retargeting-service'

const TENANT_ID = 'tenant-spotless'
const CUSTOMER_ID = 99001

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
})

function seedCustomer(extra: Partial<Row> = {}) {
  tables.customers = [{
    id: CUSTOMER_ID,
    tenant_id: TENANT_ID,
    first_name: 'Sarah',
    phone_number: '+15551234567',
    bedrooms: 3,
    bathrooms: 2,
    retargeting_active: true,
    unsubscribed_at: null,
    sms_opt_out: false,
    auto_response_disabled: false,
    auto_response_paused: false,
    manual_takeover_at: null,
    human_takeover_until: null,
    last_retargeting_template_key: null,
    ...extra,
  }]
  tables.leads = [{
    id: 555,
    tenant_id: TENANT_ID,
    status: 'contacted',
  }]
  tables.quotes = [{
    id: 777,
    tenant_id: TENANT_ID,
    status: 'sent',
  }]
}

// ─────────────────────────────────────────────────────────────────────────
// Ghost chase — defense-in-depth check on auto_response_paused
// ─────────────────────────────────────────────────────────────────────────

describe('runGhostChaseStep — manual takeover defense-in-depth', () => {
  it('does NOT send when auto_response_paused=true and manual_takeover_at is recent (5 min ago)', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    seedCustomer({
      auto_response_paused: true,
      manual_takeover_at: fiveMinAgo,
      // human_takeover_until INTENTIONALLY null — this is the bug scenario
      human_takeover_until: null,
    })

    const result = await runGhostChaseStep({
      taskId: 'task-1',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 2,
        entity_type: 'quote',
        entity_id: 777,
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('human_takeover_active_paused')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('does NOT send when manual_takeover_at is 29 min ago (just inside 30-min window)', async () => {
    const recentlyPast = new Date(Date.now() - 29 * 60 * 1000).toISOString()
    seedCustomer({
      auto_response_paused: true,
      manual_takeover_at: recentlyPast,
      human_takeover_until: null,
    })

    const result = await runGhostChaseStep({
      taskId: 'task-2',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 3,
        entity_type: 'quote',
        entity_id: 777,
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('human_takeover_active_paused')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('SENDS when manual_takeover_at is 31 min ago (just outside the window)', async () => {
    const oldTakeover = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    seedCustomer({
      auto_response_paused: true, // still flagged but stale
      manual_takeover_at: oldTakeover,
      human_takeover_until: null,
    })

    const result = await runGhostChaseStep({
      taskId: 'task-3',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        entity_type: 'quote',
        entity_id: 777,
      },
    })

    expect(result.sent).toBe(true)
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
  })

  it('SENDS when auto_response_paused is false (normal path, no bug regression)', async () => {
    seedCustomer({
      auto_response_paused: false,
      manual_takeover_at: null,
      human_takeover_until: null,
    })

    const result = await runGhostChaseStep({
      taskId: 'task-4',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        entity_type: 'quote',
        entity_id: 777,
      },
    })

    expect(result.sent).toBe(true)
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Retargeting — defense-in-depth check on auto_response_paused
// ─────────────────────────────────────────────────────────────────────────

describe('runWinBackStep — manual takeover defense-in-depth', () => {
  it('reschedules self instead of sending when auto_response_paused=true with recent takeover', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    seedCustomer({
      auto_response_paused: true,
      manual_takeover_at: fiveMinAgo,
      human_takeover_until: null,
    })

    const result = await runWinBackStep({
      taskId: 'task-r1',
      tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID,
        step_index: 1,
        phase: 'structured',
        template_key: STRUCTURED_RETARGETING_CADENCE[0].template_key,
        enrolled_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('rescheduled_human_takeover_paused')
    expect(mockSendSMS).not.toHaveBeenCalled()
    // Reschedule the SAME step (not next) for ~1 hour later
    expect(mockScheduleTask).toHaveBeenCalledTimes(1)
    const resched = mockScheduleTask.mock.calls[0][0]
    expect(resched.payload.step_index).toBe(1)
    const deltaMs = resched.scheduledFor.getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan(55 * 60 * 1000)
    expect(deltaMs).toBeLessThan(65 * 60 * 1000)
  })

  it('SENDS when manual_takeover_at is 31 min ago (stale takeover)', async () => {
    const oldTakeover = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    seedCustomer({
      auto_response_paused: true,
      manual_takeover_at: oldTakeover,
      human_takeover_until: null,
    })

    const result = await runWinBackStep({
      taskId: 'task-r2',
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
  })
})
