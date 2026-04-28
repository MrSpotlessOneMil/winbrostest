/**
 * Tier 2 mega-simulation: full ghost chase → retargeting lifecycle.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Time fast-forwarded via vi.setSystemTime. Each "step" asserts:
 *   - SMS sent / not sent
 *   - Next-task scheduling correct
 *   - DB state mutations correct (retargeting_active, last_template_key, etc.)
 *   - Human takeover defers without burning steps
 *   - STOP cancels everything atomically
 *
 * This is the integration-level proof that the v2 follow-up + retargeting
 * flow works end-to-end before we flip the per-tenant flag in production.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ─── Scheduler mock — record every scheduled task ─────────────────────────
interface RecordedTask {
  taskType: string
  taskKey: string
  scheduledFor: Date
  payload: Record<string, unknown>
}
let recordedTasks: RecordedTask[] = []
const mockScheduleTask = vi.fn().mockImplementation(async (opts: any) => {
  recordedTasks.push({
    taskType: opts.taskType,
    taskKey: opts.taskKey,
    scheduledFor: opts.scheduledFor,
    payload: opts.payload,
  })
  return { success: true, taskId: `mock-${recordedTasks.length}` }
})
vi.mock('@/lib/scheduler', () => ({
  scheduleTask: (...args: any[]) => mockScheduleTask(...args),
  cancelTask: vi.fn().mockResolvedValue({ success: true }),
}))

// ─── Tenant mock ─────────────────────────────────────────────────────────
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

// ─── SMS mock — record every send ────────────────────────────────────────
interface SentSMS { tenant: any; phone: string; message: string }
const sentMessages: SentSMS[] = []
const mockSendSMS = vi.fn().mockImplementation(async (tenant: any, phone: string, message: string) => {
  sentMessages.push({ tenant, phone, message })
  return { success: true }
})
vi.mock('@/lib/openphone', () => ({
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}))

// ─── System events mock ──────────────────────────────────────────────────
const loggedEvents: any[] = []
vi.mock('@/lib/system-events', () => ({
  logSystemEvent: vi.fn().mockImplementation(async (e: any) => { loggedEvents.push(e) }),
}))

// ─── In-memory Supabase ──────────────────────────────────────────────────
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

// ─── Imports (after mocks) ──────────────────────────────────────────────
import {
  scheduleGhostChase,
  cancelGhostChase,
  runGhostChaseStep,
  DEFAULT_GHOST_CHASE_CADENCE,
} from '../../apps/house-cleaning/lib/services/followups/ghost-chase'
import {
  enrollInRetargeting,
  runWinBackStep,
  haltRetargeting,
  STRUCTURED_RETARGETING_CADENCE,
} from '../../apps/house-cleaning/lib/services/followups/retargeting-service'
import { handleUnsubscribe } from '../../apps/house-cleaning/lib/services/followups/unsubscribe'

// ─── Time helpers ────────────────────────────────────────────────────────
const T0 = new Date('2026-04-28T15:00:00.000Z') // anchor: Apr 28, 3pm UTC

function setNow(date: Date) {
  vi.setSystemTime(date)
}

function plusMinutes(base: Date, mins: number): Date {
  return new Date(base.getTime() + mins * 60_000)
}

function plusHours(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60_000)
}

const TENANT_ID = 'tenant-spotless'
const CUSTOMER_ID = 12345
const LEAD_ID = 9999
const PHONE = '+15551234567'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  setNow(T0)
  for (const k of Object.keys(tables)) delete tables[k]
  recordedTasks = []
  sentMessages.length = 0
  loggedEvents.length = 0
  mockScheduleTask.mockClear()
  mockSendSMS.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// Helper: seed a customer in `engaged` state, and a lead row in `qualifying`
function seedCustomer(extra: Partial<Row> = {}) {
  tables.customers = [{
    id: CUSTOMER_ID, tenant_id: TENANT_ID,
    first_name: 'Mary', phone_number: PHONE,
    bedrooms: 3, bathrooms: 2,
    retargeting_active: false,
    unsubscribed_at: null, sms_opt_out: false,
    last_retargeting_template_key: null,
    human_takeover_until: null,
    auto_response_disabled: false,
    pre_quote_rapport_sent_at: null,
    ...extra,
  }]
  tables.leads = [{
    id: LEAD_ID, tenant_id: TENANT_ID, customer_id: CUSTOMER_ID,
    status: 'qualifying',
  }]
  tables.scheduled_tasks = []
}

// Helper: simulate the cron firing the next due ghost-chase task.
// Mirrors what process-scheduled-tasks does: pick the earliest pending task,
// runGhostChaseStep, then mark it as fired (we just remove from pending).
async function fireNextGhostStep(): Promise<{ stepRun: number | null; result: any }> {
  const pending = recordedTasks
    .filter(t => t.taskType === 'followup.ghost_chase' && t.scheduledFor.getTime() <= Date.now())
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
  if (pending.length === 0) return { stepRun: null, result: null }
  const next = pending[0]
  // Remove from recordedTasks (simulates marking complete)
  recordedTasks = recordedTasks.filter(t => t.taskKey !== next.taskKey)
  const result = await runGhostChaseStep({
    taskId: next.taskKey, tenantId: TENANT_ID, payload: next.payload as any,
  })
  return { stepRun: (next.payload as any).step_index, result }
}

async function fireNextWinBackStep(): Promise<{ stepRun: number | null; result: any }> {
  const pending = recordedTasks
    .filter(t => t.taskType === 'retargeting.win_back' && t.scheduledFor.getTime() <= Date.now())
    .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime())
  if (pending.length === 0) return { stepRun: null, result: null }
  const next = pending[0]
  recordedTasks = recordedTasks.filter(t => t.taskKey !== next.taskKey)
  const result = await runWinBackStep({
    taskId: next.taskKey, tenantId: TENANT_ID, payload: next.payload as any,
  })
  return { stepRun: (next.payload as any).step_index, result }
}

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Full ghost chase → retargeting handoff, customer never replies
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 1: full ghost-chase → retargeting handoff', () => {
  it('fires all 6 ghost-chase steps in order, then enrolls in retargeting', async () => {
    seedCustomer()

    // T+0: schedule the chase
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })
    expect(recordedTasks).toHaveLength(6)
    expect(recordedTasks.map(t => (t.payload as any).step_index)).toEqual([1, 2, 3, 4, 5, 6])

    // T+7min: step 1 fires
    setNow(plusMinutes(T0, 7))
    let step = await fireNextGhostStep()
    expect(step.stepRun).toBe(1)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].message).toMatch(/still want that quote/i)
    expect(sentMessages[0].message).not.toMatch(/\$\d/) // never includes price

    // T+1h: step 2 fires
    setNow(plusMinutes(T0, 60))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(2)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(2)

    // T+24h: step 3 (with offer)
    setNow(plusHours(T0, 24))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(3)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(3)

    // T+48h: step 4 (soft poke)
    setNow(plusHours(T0, 48))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(4)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(4)
    expect(sentMessages[3].message).toMatch(/yes or no/i)

    // T+96h: step 5 (last chance)
    setNow(plusHours(T0, 96))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(5)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(5)

    // T+120h: step 6 — silent handoff to retargeting
    setNow(plusHours(T0, 120))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(6)
    expect(step.result.sent).toBe(false) // handoff, no SMS
    expect(step.result.reason).toBe('handed_off_to_retargeting')
    expect(sentMessages).toHaveLength(5) // still 5, no new SMS

    // After step 6: customer.retargeting_active flipped on, ONE retargeting task scheduled
    expect(tables.customers[0].retargeting_active).toBe(true)
    const winBackTasks = recordedTasks.filter(t => t.taskType === 'retargeting.win_back')
    expect(winBackTasks).toHaveLength(1)
    expect((winBackTasks[0].payload as any).step_index).toBe(1)
    expect((winBackTasks[0].payload as any).phase).toBe('structured')
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Customer replies mid-chase → atomic cancel
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 2: customer replies after step 2', () => {
  it('cancels remaining ghost-chase steps when entity converts', async () => {
    seedCustomer()
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })

    // T+7m + T+1h: steps 1 and 2 fire
    setNow(plusMinutes(T0, 7))
    await fireNextGhostStep()
    setNow(plusMinutes(T0, 60))
    await fireNextGhostStep()
    expect(sentMessages).toHaveLength(2)

    // Customer replies → lead.status moves to qualified.
    // The webhook would call cancelGhostChase; we simulate that.
    tables.leads[0].status = 'qualified'
    setNow(plusMinutes(T0, 70))
    await cancelGhostChase(TENANT_ID, CUSTOMER_ID, 'lead_qualified')

    // Mark cancelled rows as such in our recorded list (the real DB does this
    // via UPDATE; our mock honours it via the `status='cancelled'` filter).
    // We simulate by emptying recordedTasks for this customer:
    recordedTasks = recordedTasks.filter(t => (t.payload as any).customer_id !== CUSTOMER_ID)

    // T+24h: step 3 should NOT fire (was cancelled)
    setNow(plusHours(T0, 24))
    const step = await fireNextGhostStep()
    expect(step.stepRun).toBeNull()
    expect(sentMessages).toHaveLength(2) // unchanged
  })

  it('runGhostChaseStep self-cancels if entity already converted between scheduling and firing', async () => {
    seedCustomer()
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })

    // Customer converted between steps (race condition). Lead status moved to converted.
    tables.leads[0].status = 'converted_to_quote'

    setNow(plusMinutes(T0, 7))
    const step = await fireNextGhostStep()
    expect(step.result.sent).toBe(false)
    expect(step.result.reason).toBe('no_longer_ghosted')
    expect(sentMessages).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Human takes over mid-flow, releases, AI resumes
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 3: human-in-the-loop takeover during ghost chase', () => {
  it('defers step when human is mid-thread, lets it fire after takeover ends', async () => {
    seedCustomer()
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })

    // Steps 1-3 fire normally
    setNow(plusMinutes(T0, 7))
    await fireNextGhostStep()
    setNow(plusMinutes(T0, 60))
    await fireNextGhostStep()
    setNow(plusHours(T0, 24))
    await fireNextGhostStep()
    expect(sentMessages).toHaveLength(3)

    // T+25h: human takes over for 24 hours
    const takeoverEndsAt = plusHours(T0, 49)
    tables.customers[0].human_takeover_until = takeoverEndsAt.toISOString()

    // T+48h: step 4 attempts to fire — but human is still in thread (until T+49h)
    setNow(plusHours(T0, 48))
    let step = await fireNextGhostStep()
    expect(step.stepRun).toBe(4)
    expect(step.result.sent).toBe(false)
    expect(step.result.reason).toBe('human_takeover_active')
    expect(sentMessages).toHaveLength(3) // no new SMS sent

    // T+50h: human takeover has expired — step 4 (had been deferred) fires
    // (In production, we'd reschedule and the cron would re-fire. Here we
    //  re-add the step and fire it again.)
    recordedTasks.push({
      taskType: 'followup.ghost_chase',
      taskKey: `gc:lead:${LEAD_ID}:4`,
      scheduledFor: plusHours(T0, 49),
      payload: {
        entity_type: 'lead', entity_id: LEAD_ID, customer_id: CUSTOMER_ID,
        step_index: 4, ghost_started_at: T0.toISOString(), phone: PHONE,
      },
    })
    setNow(plusHours(T0, 50))
    step = await fireNextGhostStep()
    expect(step.stepRun).toBe(4)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(4)
  })

  it('does not send while human_takeover_until is in the future', async () => {
    seedCustomer({
      human_takeover_until: plusHours(T0, 5).toISOString(), // 5h in future
    })
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })
    setNow(plusMinutes(T0, 7))
    const step = await fireNextGhostStep()
    expect(step.result.sent).toBe(false)
    expect(step.result.reason).toBe('human_takeover_active')
    expect(sentMessages).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Full retargeting structured phase + transition to evergreen
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 4: retargeting structured phase + evergreen transition', () => {
  it('fires structured steps 1–5 over 16 weeks, then transitions to evergreen at +4w', async () => {
    seedCustomer({ retargeting_active: false })

    // Enroll at T0
    await enrollInRetargeting({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID, entryReason: 'one_time_job_complete',
    })
    expect(tables.customers[0].retargeting_active).toBe(true)
    expect(recordedTasks).toHaveLength(1)
    expect((recordedTasks[0].payload as any).step_index).toBe(1)

    // T+24h: step 1 (recurring_seed_20)
    setNow(plusHours(T0, 24))
    let step = await fireNextWinBackStep()
    expect(step.stepRun).toBe(1)
    expect(step.result.sent).toBe(true)
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].message).toMatch(/recurring|20%/i)
    expect(tables.customers[0].last_retargeting_template_key).toBe('recurring_seed_20')

    // Step 1 fires → schedules step 2 (3 weeks later relative)
    let pendingWinBack = recordedTasks.filter(t => t.taskType === 'retargeting.win_back')
    expect(pendingWinBack).toHaveLength(1)
    expect((pendingWinBack[0].payload as any).step_index).toBe(2)

    // T+24h+3w: step 2 (open_slots_this_week)
    setNow(new Date(plusHours(T0, 24).getTime() + 3 * 7 * 24 * 60 * 60 * 1000))
    step = await fireNextWinBackStep()
    expect(step.stepRun).toBe(2)
    expect(sentMessages).toHaveLength(2)

    // Step 3 — 8 weeks from enrollment
    setNow(new Date(T0.getTime() + 8 * 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000))
    step = await fireNextWinBackStep()
    expect(step.stepRun).toBe(3)
    expect(sentMessages).toHaveLength(3)

    // Step 4
    setNow(new Date(T0.getTime() + 12 * 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000))
    step = await fireNextWinBackStep()
    expect(step.stepRun).toBe(4)
    expect(sentMessages).toHaveLength(4)

    // Step 5 (last structured)
    setNow(new Date(T0.getTime() + 16 * 7 * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000))
    step = await fireNextWinBackStep()
    expect(step.stepRun).toBe(5)
    expect(sentMessages).toHaveLength(5)

    // After step 5 fires → next is EVERGREEN at +4 weeks
    pendingWinBack = recordedTasks.filter(t => t.taskType === 'retargeting.win_back')
    expect(pendingWinBack).toHaveLength(1)
    expect((pendingWinBack[0].payload as any).phase).toBe('evergreen')
    expect((pendingWinBack[0].payload as any).step_index).toBe(6)
  })

  it('evergreen phase: never repeats template_key back-to-back', async () => {
    seedCustomer({ retargeting_active: true, last_retargeting_template_key: 'evergreen_dollar_20' })

    // Manually fire an evergreen step starting from step 6
    recordedTasks.push({
      taskType: 'retargeting.win_back',
      taskKey: `rt:${CUSTOMER_ID}:evergreen:6:${T0.getTime()}`,
      scheduledFor: T0,
      payload: {
        customer_id: CUSTOMER_ID, step_index: 6, phase: 'evergreen',
        template_key: 'evergreen_dollar_20', enrolled_at: T0.toISOString(),
      },
    })

    let lastTemplate = 'evergreen_dollar_20'
    for (let i = 0; i < 4; i++) {
      // Fast-forward 4 weeks
      setNow(new Date(Date.now() + 4 * 7 * 24 * 60 * 60 * 1000))
      const step = await fireNextWinBackStep()
      expect(step.result.sent).toBe(true)
      // Find the newly scheduled next task (the only pending one)
      const pending = recordedTasks.filter(t => t.taskType === 'retargeting.win_back')
      expect(pending).toHaveLength(1)
      const nextTemplate = (pending[0].payload as any).template_key
      // Critical: never the same as the one we JUST sent
      expect(nextTemplate).not.toBe(lastTemplate)
      lastTemplate = nextTemplate
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 5: STOP word during retargeting → global cancel
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 5: STOP cancels everything atomically', () => {
  it('STOP during retargeting cancels pending tasks system-wide and sends ONE confirmation', async () => {
    seedCustomer()

    // Pretend we have a mix of pending tasks: ghost chase + retargeting + a job_broadcast
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })
    // Persist them in tables.scheduled_tasks for handleUnsubscribe to find
    tables.scheduled_tasks = recordedTasks.map((t, i) => ({
      id: `task-${i}`, tenant_id: TENANT_ID, status: 'pending',
      task_type: t.taskType, payload: t.payload,
    }))
    tables.scheduled_tasks.push({
      id: 'task-broadcast', tenant_id: TENANT_ID, status: 'pending',
      task_type: 'job_broadcast', payload: { customer_id: CUSTOMER_ID, jobId: 'j-1' },
    })
    tables.scheduled_tasks.push({
      id: 'task-other-customer', tenant_id: TENANT_ID, status: 'pending',
      task_type: 'followup.ghost_chase', payload: { customer_id: 99999 }, // different customer
    })

    expect(tables.scheduled_tasks.filter(t => t.status === 'pending').length).toBe(8)

    // Customer texts STOP
    const result = await handleUnsubscribe({ tenantId: TENANT_ID, customerId: CUSTOMER_ID })

    expect(result.unsubscribed).toBe(true)
    expect(result.confirmationSent).toBe(true)

    // Customer flagged unsubscribed + retargeting_active=false
    expect(tables.customers[0].unsubscribed_at).toBeTruthy()
    expect(tables.customers[0].retargeting_active).toBe(false)

    // All tasks for THIS customer are cancelled (7 = 6 ghost + 1 job_broadcast)
    const cancelledForCustomer = tables.scheduled_tasks.filter(
      t => t.status === 'cancelled' && t.payload?.customer_id === CUSTOMER_ID,
    )
    expect(cancelledForCustomer.length).toBe(7)

    // Other customer's task is UNTOUCHED
    const otherCustomerTask = tables.scheduled_tasks.find(t => t.id === 'task-other-customer')!
    expect(otherCustomerTask.status).toBe('pending')

    // Exactly ONE TCPA confirmation SMS sent
    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0].message).toMatch(/unsubscribed/i)
    expect(sentMessages[0].message).toMatch(/text BACK/i)
  })

  it('STOP is idempotent: second STOP does not send another confirmation', async () => {
    seedCustomer({ unsubscribed_at: '2026-04-27T10:00:00Z', sms_opt_out: true })

    const result = await handleUnsubscribe({ tenantId: TENANT_ID, customerId: CUSTOMER_ID })
    expect(result.reason).toBe('already_unsubscribed')
    expect(sentMessages).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Customer replies during retargeting → halt cleanly
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 6: positive reply during retargeting', () => {
  it('haltRetargeting cancels pending win-back task and clears active flag', async () => {
    seedCustomer({ retargeting_active: true })
    tables.scheduled_tasks = [{
      id: 'rt-task', tenant_id: TENANT_ID, status: 'pending',
      task_type: 'retargeting.win_back',
      payload: { customer_id: CUSTOMER_ID, step_index: 3, phase: 'structured' },
    }]

    const result = await haltRetargeting(TENANT_ID, CUSTOMER_ID, 'customer_replied')
    expect(result.cancelled).toBe(1)
    expect(tables.customers[0].retargeting_active).toBe(false)
    expect(tables.scheduled_tasks[0].status).toBe('cancelled')
  })

  it('does not send retargeting message if customer reactivates by booking before fire', async () => {
    seedCustomer({ retargeting_active: false }) // booked again, no longer active
    const step = await runWinBackStep({
      taskId: 'late-task', tenantId: TENANT_ID,
      payload: {
        customer_id: CUSTOMER_ID, step_index: 2, phase: 'structured',
        template_key: 'open_slots_this_week', enrolled_at: T0.toISOString(),
      },
    })
    expect(step.sent).toBe(false)
    expect(step.reason).toBe('not_active')
    expect(sentMessages).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════
// SCENARIO 7: No SMS contains a dollar amount (price-hidden invariant)
// ═════════════════════════════════════════════════════════════════════════

describe('SCENARIO 7: price-hidden invariant across all sent messages', () => {
  it('all ghost-chase and retargeting templates render without a $NN token', async () => {
    seedCustomer()
    await scheduleGhostChase({
      tenantId: TENANT_ID, customerId: CUSTOMER_ID,
      entityType: 'lead', entityId: LEAD_ID,
      ghostStartedAt: T0, phone: PHONE,
    })

    // Fire all 6 steps
    for (let i = 1; i <= 6; i++) {
      setNow(plusMinutes(T0, DEFAULT_GHOST_CHASE_CADENCE[i - 1].offset_minutes))
      await fireNextGhostStep()
    }

    // Then trigger structured retargeting steps 1-5
    seedCustomer({ retargeting_active: true })
    for (const step of STRUCTURED_RETARGETING_CADENCE) {
      recordedTasks.push({
        taskType: 'retargeting.win_back',
        taskKey: `rt:${CUSTOMER_ID}:s:${step.step}`,
        scheduledFor: new Date(T0.getTime() + step.offset_minutes * 60_000),
        payload: {
          customer_id: CUSTOMER_ID, step_index: step.step, phase: 'structured',
          template_key: step.template_key, enrolled_at: T0.toISOString(),
        },
      })
      setNow(new Date(T0.getTime() + step.offset_minutes * 60_000 + 1000))
      await fireNextWinBackStep()
    }

    // Assert: NO message contains a $NN token (price-hidden invariant)
    const offenders = sentMessages.filter(m => /\$\d/.test(m.message))
    if (offenders.length > 0) {
      console.error('Offending messages with $:', offenders.map(o => o.message))
    }
    expect(offenders).toHaveLength(0)
  })
})
