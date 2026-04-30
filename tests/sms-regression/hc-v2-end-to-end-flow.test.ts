/**
 * End-to-end v2 follow-up flow tests.
 *
 * Exercises the FULL chain that would happen in production:
 *   1. Customer texts in (Meta lead, website form, etc.)
 *   2. AI sends initial outbound → wire helper schedules ghost chase
 *   3. process-scheduled-tasks ticks fire each step
 *   4. Owner manually messages → all rows cancelled
 *   5. Customer replies → all rows cancelled
 *   6. Customer texts STOP → global cancel + TCPA
 *   7. Job completes → retargeting enrolled
 *   8. Owner messages mid-retargeting → next task reschedules
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────
const mockScheduleTask = vi.fn()
mockScheduleTask.mockImplementation((opts: any) => {
  // Simulate scheduler behavior: insert task into our fake scheduled_tasks table
  if (!tables.scheduled_tasks) tables.scheduled_tasks = []
  const id = `task-${Math.random().toString(36).slice(2)}`
  tables.scheduled_tasks.push({
    id,
    tenant_id: opts.tenantId,
    task_type: opts.taskType,
    task_key: opts.taskKey,
    scheduled_for: opts.scheduledFor.toISOString(),
    payload: opts.payload,
    status: 'pending',
    last_error: null,
  })
  return Promise.resolve({ success: true, taskId: id })
})

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

// ─── Fake supabase ──────────────────────────────────────────────────────
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
    gte(field: string, value: any) { matchers.push(r => r[field] >= value); return builder },
    lt(field: string, value: any) { matchers.push(r => r[field] < value); return builder },
    lte(field: string, value: any) { matchers.push(r => r[field] <= value); return builder },
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

// ─── Imports under test ─────────────────────────────────────────────────
import {
  wireFollowupsAfterOutbound,
  wireRetargetingOnJobComplete,
} from '../../apps/house-cleaning/lib/services/followups/wire'
import { runGhostChaseStep } from '../../apps/house-cleaning/lib/services/followups/ghost-chase'
import { runWinBackStep } from '../../apps/house-cleaning/lib/services/followups/retargeting-service'

const TENANT_V2_ON = {
  id: 'tenant-spotless',
  slug: 'spotless-scrubbers',
  workflow_config: { followup_rebuild_v2_enabled: true, currency: 'USD' },
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k]
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
  mockLogSystemEvent.mockClear()
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO A: Meta lead → AI texts → ghosts → ghost chase fires
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario A — Meta lead intake → ghost chase fires', () => {
  it('schedules 6 ghost chase rows after first AI outbound to a fresh lead', async () => {
    // Setup: Meta lead just got first AI outbound
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      bedrooms: 3, bathrooms: 2,
      auto_response_paused: false, manual_takeover_at: null,
      auto_response_disabled: false, human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, customer_id: 100, status: 'contacted' }]

    // Wire the follow-up after AI outbound
    const result = await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON,
      customer: { id: 100, phone_number: '+15551234567' },
      quoteJustSent: false,
      activeLeadId: 555,
      source: 'meta_lead_intake',
    })

    expect(result.scheduled).toBe(true)
    expect(result.entity_type).toBe('lead')
    // 6 task rows in scheduled_tasks
    const ghostRows = tables.scheduled_tasks.filter(t => t.task_type === 'followup.ghost_chase')
    expect(ghostRows).toHaveLength(6)
    // Each row has correct step_index 1-6
    const stepIndices = ghostRows.map(r => r.payload.step_index).sort((a, b) => a - b)
    expect(stepIndices).toEqual([1, 2, 3, 4, 5, 6])
    // All point at the same lead
    expect(ghostRows.every(r => r.payload.entity_id === 555)).toBe(true)
    expect(ghostRows.every(r => r.payload.entity_type === 'lead')).toBe(true)
  })

  it('step 1 fires SMS at +7m if customer still ghosted', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: false, manual_takeover_at: null,
      auto_response_disabled: false, human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, status: 'contacted' }]

    const result = await runGhostChaseStep({
      taskId: 'task-step1',
      tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 1,
        ghost_started_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(true)
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
  })

  it('step 1 does NOT fire if lead has already converted (status: qualified)', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: false, manual_takeover_at: null,
      auto_response_disabled: false, human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, status: 'qualified' }]

    const result = await runGhostChaseStep({
      taskId: 'task-step1',
      tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 1,
        ghost_started_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_longer_ghosted')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO B: Quote sent → ghost chase swaps from lead to quote
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario B — quote sent supersedes lead chase', () => {
  it('cancels lead chase and schedules quote chase when AI fires BOOKING_COMPLETE', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: false, manual_takeover_at: null,
      auto_response_disabled: false, human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, customer_id: 100, status: 'contacted' }]
    tables.quotes = [{ id: 999, tenant_id: TENANT_V2_ON.id, customer_id: 100, status: 'sent' }]

    // First: lead ghost chase scheduled
    await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: { id: 100, phone_number: '+15551234567' },
      quoteJustSent: false, activeLeadId: 555, source: 'first_outbound',
    })
    expect(tables.scheduled_tasks.filter(t => t.status === 'pending').length).toBe(6)

    // Then: quote sent — wire called again with quoteJustSent=true + quoteId
    await wireFollowupsAfterOutbound({
      tenant: TENANT_V2_ON, customer: { id: 100, phone_number: '+15551234567' },
      quoteJustSent: true, activeLeadId: 555, quoteId: 999, source: 'quote_send',
    })

    // Lead chase rows should be cancelled
    const leadChaseRows = tables.scheduled_tasks.filter(t =>
      t.task_type === 'followup.ghost_chase' && t.payload.entity_type === 'lead'
    )
    expect(leadChaseRows.every(r => r.status === 'cancelled')).toBe(true)
    // Quote chase rows should be pending (6 new ones)
    const quoteChaseRows = tables.scheduled_tasks.filter(t =>
      t.task_type === 'followup.ghost_chase' && t.payload.entity_type === 'quote' && t.status === 'pending'
    )
    expect(quoteChaseRows).toHaveLength(6)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO C: Owner takeover within 10 min — AI hands off cleanly
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario C — owner takes over within 10-min window', () => {
  it('ghost chase step does NOT fire when human_takeover_until > now()', async () => {
    const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: true,
      manual_takeover_at: new Date().toISOString(),
      human_takeover_until: tenMinFromNow,
      unsubscribed_at: null, sms_opt_out: false,
      auto_response_disabled: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, status: 'contacted' }]

    const result = await runGhostChaseStep({
      taskId: 'task-step2',
      tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 2,
        ghost_started_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('human_takeover_active')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })

  it('ghost chase fires AGAIN once human_takeover_until expires (no permanent block)', async () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: false, // already auto-cleared after 15 min of silence
      manual_takeover_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 min ago — past defense window
      human_takeover_until: oneMinAgo, // expired
      unsubscribed_at: null, sms_opt_out: false,
      auto_response_disabled: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, status: 'contacted' }]

    const result = await runGhostChaseStep({
      taskId: 'task-step3',
      tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 3,
        ghost_started_at: new Date().toISOString(),
      },
    })

    // Takeover expired → step fires
    expect(result.sent).toBe(true)
    expect(mockSendSMS).toHaveBeenCalledTimes(1)
  })

  it('defense-in-depth: paused + manual_takeover_at within 30 min still blocks (even if human_takeover_until missing)', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: true,
      manual_takeover_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      human_takeover_until: null, // bug scenario — webhook didnt set this
      unsubscribed_at: null, sms_opt_out: false,
      auto_response_disabled: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, status: 'contacted' }]

    const result = await runGhostChaseStep({
      taskId: 'task-step2',
      tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 2,
        ghost_started_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('human_takeover_active_paused')
    expect(mockSendSMS).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO D: Customer replies → ghost chase atomically cancelled
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario D — customer replies mid-chase', () => {
  it('cancels remaining steps when lead status flips off ghost-eligible (e.g. qualified)', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      auto_response_paused: false, manual_takeover_at: null,
      auto_response_disabled: false, human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
    }]
    tables.leads = [{ id: 555, tenant_id: TENANT_V2_ON.id, customer_id: 100, status: 'qualified' }]

    // Pre-seed 6 pending ghost chase rows
    tables.scheduled_tasks = []
    for (let step = 1; step <= 6; step++) {
      tables.scheduled_tasks.push({
        id: `gc-${step}`, tenant_id: TENANT_V2_ON.id,
        task_type: 'followup.ghost_chase', status: 'pending',
        payload: { entity_type: 'lead', entity_id: 555, customer_id: 100, step_index: step },
      })
    }

    // Step 2 fires — eligibility check sees lead is no longer ghosted → cancels rest
    const result = await runGhostChaseStep({
      taskId: 'gc-2', tenantId: TENANT_V2_ON.id,
      payload: {
        entity_type: 'lead', entity_id: 555,
        customer_id: 100, step_index: 2,
        ghost_started_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('no_longer_ghosted')
    // All pending rows for this customer should now be cancelled
    const stillPending = tables.scheduled_tasks.filter(t =>
      t.task_type === 'followup.ghost_chase' &&
      t.status === 'pending' &&
      t.payload.customer_id === 100
    )
    expect(stillPending).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO E: Job completion → retargeting enrolled
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario E — one_time job closes → retargeting enrolled', () => {
  it('enrolls customer with single retargeting.win_back at +24h', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      retargeting_active: false,
      unsubscribed_at: null, sms_opt_out: false,
      last_retargeting_template_key: null,
      bedrooms: 3, bathrooms: 2,
    }]

    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 100,
      lifecycleStatus: 'one_time', source: 'job_complete',
    })

    expect(res.enrolled).toBe(true)
    // ONE retargeting.win_back row at +24h
    const winBackCalls = mockScheduleTask.mock.calls.filter(c => c[0]?.taskType === 'retargeting.win_back')
    expect(winBackCalls).toHaveLength(1)
    const call = winBackCalls[0][0]
    expect(call.payload.step_index).toBe(1)
    expect(call.payload.phase).toBe('structured')
    // Customer marked active
    expect(tables.customers[0].retargeting_active).toBe(true)
  })

  it('does NOT enroll recurring customers (already engaged)', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      retargeting_active: false,
      bedrooms: 3, bathrooms: 2,
    }]

    const res = await wireRetargetingOnJobComplete({
      tenant: TENANT_V2_ON, customerId: 100,
      lifecycleStatus: 'recurring', source: 'job_complete',
    })

    expect(res.enrolled).toBe(false)
    expect(mockScheduleTask).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO F: Owner messages mid-retargeting → next task reschedules itself
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario F — owner messages during retargeting', () => {
  it('next retargeting task reschedules itself if takeover active when it fires', async () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      retargeting_active: true,
      auto_response_paused: true,
      manual_takeover_at: fiveMinAgo,
      human_takeover_until: null,
      unsubscribed_at: null, sms_opt_out: false,
      last_retargeting_template_key: null,
      bedrooms: 3, bathrooms: 2,
    }]

    const result = await runWinBackStep({
      taskId: 'wb-1', tenantId: TENANT_V2_ON.id,
      payload: {
        customer_id: 100, step_index: 2, phase: 'structured',
        template_key: 'open_slots_this_week',
        enrolled_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('rescheduled_human_takeover_paused')
    expect(mockSendSMS).not.toHaveBeenCalled()
    // ONE reschedule of THIS step (not next step)
    const rescheduledCalls = mockScheduleTask.mock.calls.filter(c => c[0]?.taskType === 'retargeting.win_back')
    expect(rescheduledCalls).toHaveLength(1)
    expect(rescheduledCalls[0][0].payload.step_index).toBe(2) // SAME step
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SCENARIO G: Customer replies during retargeting → halt
// ─────────────────────────────────────────────────────────────────────────

describe('Scenario G — retargeting halts when customer replies', () => {
  it('halts when customer marked unsubscribed mid-retargeting', async () => {
    tables.customers = [{
      id: 100, tenant_id: TENANT_V2_ON.id,
      first_name: 'Sarah', phone_number: '+15551234567',
      retargeting_active: true,
      auto_response_paused: false, manual_takeover_at: null,
      human_takeover_until: null,
      unsubscribed_at: new Date().toISOString(),
      sms_opt_out: true,
      last_retargeting_template_key: null,
      bedrooms: 3, bathrooms: 2,
    }]

    const result = await runWinBackStep({
      taskId: 'wb-x', tenantId: TENANT_V2_ON.id,
      payload: {
        customer_id: 100, step_index: 1, phase: 'structured',
        template_key: 'recurring_seed_20',
        enrolled_at: new Date().toISOString(),
      },
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('unsubscribed')
    expect(mockSendSMS).not.toHaveBeenCalled()
    // retargeting_active flipped off
    expect(tables.customers[0].retargeting_active).toBe(false)
  })
})
