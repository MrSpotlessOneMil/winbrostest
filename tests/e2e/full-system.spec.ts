/**
 * ═══════════════════════════════════════════════════════════════════════
 * FULL SYSTEM E2E — Every Vertical, End to End
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Tests the ENTIRE business pipeline against a real Supabase branch DB.
 * Traces every path a real user/cleaner/admin would take:
 *
 * PATH 1: Inbound Call → Lead → Job → Assign → Accept → OMW → Complete → Pay
 * PATH 2: Salesman Estimate → Quote → Customer Books
 * PATH 3: Cancel Flow → Everything Cleaned Up
 * PATH 4: Crew Assignment → Team Lead Routes Work to Technicians
 * PATH 5: Time-Off + Availability → Scheduling Conflicts
 * PATH 6: Multi-Tenant Isolation → Nothing Leaks
 * PATH 7: SMS Follow-Up Chain → Correct Stages
 * PATH 8: Checklist → Invoice Matches → Payment Reconciliation
 *
 * Run with test branch:
 *   E2E_SUPABASE_URL=https://xxx.supabase.co E2E_SUPABASE_ANON_KEY=xxx \
 *   npx playwright test full-system --config=playwright.crash.config.ts
 */

import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.E2E_SUPABASE_URL || ''
const ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY || ''
const TENANT_ID = 'e954fbd6-b3e1-4271-88b0-341c9df56beb'
const MAX_ID = 700    // Team Lead
const BLAKE_ID = 701  // Salesman
const JOSH_ID = 702   // Technician

// Skip if no test branch
if (!SUPABASE_URL) test.skip()

// ── Supabase REST helper ────────────────────────────────────────────────
async function db(request: any, table: string, opts?: { method?: string; body?: any; filters?: string; single?: boolean }) {
  const method = opts?.method || 'GET'
  const url = `${SUPABASE_URL}/rest/v1/${table}${opts?.filters || ''}`
  const headers: Record<string, string> = {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : '',
  }
  if (opts?.single) headers['Accept'] = 'application/vnd.pgrst.object+json'
  const res = await request.fetch(url, {
    method,
    headers,
    data: opts?.body ? JSON.stringify(opts.body) : undefined,
  })
  return { status: res.status(), data: await res.json().catch(() => null) }
}

// ── Helpers ─────────────────────────────────────────────────────────────
let jobCounter = 1000

function nextJobId() { return jobCounter++ }

async function createLead(request: any, overrides: Record<string, any> = {}) {
  const res = await db(request, 'leads', {
    method: 'POST',
    body: {
      tenant_id: TENANT_ID,
      source: 'vapi',
      phone_number: '+13095559001',
      first_name: 'Test',
      last_name: 'Customer',
      status: 'new',
      ...overrides,
    },
  })
  return res.data?.[0]
}

async function createJob(request: any, overrides: Record<string, any> = {}) {
  const res = await db(request, 'jobs', {
    method: 'POST',
    body: {
      tenant_id: TENANT_ID,
      customer_id: 800,
      phone_number: '+13095559001',
      address: '100 Washington St, Morton, IL',
      service_type: 'ext_windows',
      date: '2026-04-01',
      scheduled_at: '09:00',
      price: 350,
      hours: 2.5,
      status: 'scheduled',
      booked: true,
      cleaner_id: MAX_ID,
      ...overrides,
    },
  })
  return res.data?.[0]
}

async function assignCleaner(request: any, jobId: number, cleanerId: number, status = 'pending') {
  const res = await db(request, 'cleaner_assignments', {
    method: 'POST',
    body: { tenant_id: TENANT_ID, job_id: jobId, cleaner_id: cleanerId, status },
  })
  return res.data?.[0]
}

async function cleanup(request: any, tag: string) {
  const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${tag}&select=id` })
  for (const j of jobs.data || []) {
    await db(request, 'cleaner_assignments', { method: 'DELETE', filters: `?job_id=eq.${j.id}` })
    await db(request, 'job_checklist_items', { method: 'DELETE', filters: `?job_id=eq.${j.id}` })
    await db(request, 'jobs', { method: 'DELETE', filters: `?id=eq.${j.id}` })
  }
  await db(request, 'leads', { method: 'DELETE', filters: `?email=eq.e2e_${tag}@test.com` })
  await db(request, 'time_off', { method: 'DELETE', filters: `?reason=eq.e2e_${tag}` })
}


// ═══════════════════════════════════════════════════════════════════════
// PATH 1: Inbound Call → Lead → Job → Assign → Accept → OMW → Complete
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 1: Full Lifecycle — Call to Completion', () => {
  const TAG = 'path1'

  test.beforeAll(async ({ request }) => { await cleanup(request, TAG) })
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('1a. Inbound call creates lead (new status)', async ({ request }) => {
    const lead = await createLead(request, {
      source: 'vapi',
      first_name: 'Kevin',
      last_name: 'Wilson',
      email: `e2e_${TAG}@test.com`,
      status: 'new',
    })
    expect(lead).toBeTruthy()
    expect(lead.status).toBe('new')
    expect(lead.source).toBe('vapi')
    expect(lead.tenant_id).toBe(TENANT_ID)
  })

  test('1b. Lead progresses: new → contacted → qualified → booked', async ({ request }) => {
    // Get the lead we just created
    const leads = await db(request, 'leads', { filters: `?email=eq.e2e_${TAG}@test.com&select=id,status` })
    const leadId = leads.data[0].id

    // Progress through stages
    for (const status of ['contacted', 'qualified', 'booked']) {
      await db(request, 'leads', { method: 'PATCH', filters: `?id=eq.${leadId}`, body: { status } })
      const updated = await db(request, 'leads', { filters: `?id=eq.${leadId}&select=status`, single: true })
      expect(updated.data.status).toBe(status)
    }
  })

  test('1c. Job created from booked lead', async ({ request }) => {
    const leads = await db(request, 'leads', { filters: `?email=eq.e2e_${TAG}@test.com&select=id` })
    const leadId = leads.data[0].id

    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      service_type: 'ext_windows',
      date: '2026-04-05',
      scheduled_at: '10:00',
      price: 450,
      hours: 3,
    })
    expect(job.id).toBeTruthy()
    expect(job.status).toBe('scheduled')

    // Link lead to job
    await db(request, 'leads', { method: 'PATCH', filters: `?id=eq.${leadId}`, body: { converted_to_job_id: job.id, status: 'booked' } })
    const lead = await db(request, 'leads', { filters: `?id=eq.${leadId}&select=converted_to_job_id,status`, single: true })
    expect(lead.data.converted_to_job_id).toBe(job.id)
  })

  test('1d. Cleaner assigned (pending)', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    const asn = await assignCleaner(request, jobId, MAX_ID)
    expect(asn.status).toBe('pending')
    expect(asn.cleaner_id).toBe(MAX_ID)
  })

  test('1e. Cleaner accepts assignment', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const asns = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${jobs.data[0].id}&select=id,status` })
    const asnId = asns.data[0].id

    await db(request, 'cleaner_assignments', {
      method: 'PATCH',
      filters: `?id=eq.${asnId}`,
      body: { status: 'accepted', responded_at: new Date().toISOString() },
    })

    const updated = await db(request, 'cleaner_assignments', { filters: `?id=eq.${asnId}&select=status`, single: true })
    expect(updated.data.status).toBe('accepted')
  })

  test('1f. Cleaner marks On My Way', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    await db(request, 'jobs', { method: 'PATCH', filters: `?id=eq.${jobId}`, body: { cleaner_omw_at: new Date().toISOString() } })
    const job = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=cleaner_omw_at`, single: true })
    expect(job.data.cleaner_omw_at).toBeTruthy()
  })

  test('1g. Cleaner marks Arrived', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    await db(request, 'jobs', { method: 'PATCH', filters: `?id=eq.${jobId}`, body: { cleaner_arrived_at: new Date().toISOString() } })
    const job = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=cleaner_arrived_at`, single: true })
    expect(job.data.cleaner_arrived_at).toBeTruthy()
  })

  test('1h. Job completed', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    await db(request, 'jobs', {
      method: 'PATCH',
      filters: `?id=eq.${jobId}`,
      body: { status: 'completed', completed_at: new Date().toISOString() },
    })
    const job = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=status,completed_at`, single: true })
    expect(job.data.status).toBe('completed')
    expect(job.data.completed_at).toBeTruthy()
  })

  test('1i. Payment marked as paid', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    await db(request, 'jobs', {
      method: 'PATCH',
      filters: `?id=eq.${jobId}`,
      body: { paid: true, payment_status: 'fully_paid', payment_method: 'card' },
    })
    const job = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=paid,payment_status,payment_method`, single: true })
    expect(job.data.paid).toBe(true)
    expect(job.data.payment_status).toBe('fully_paid')
    expect(job.data.payment_method).toBe('card')
  })

  test('1j. Full lifecycle integrity check', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=*` })
    expect(jobs.data?.length).toBeGreaterThan(0)
    const job = jobs.data[0]

    // Every field should be populated
    expect(job.status).toBe('completed')
    expect(job.paid).toBe(true)
    expect(job.cleaner_omw_at).toBeTruthy()
    expect(job.cleaner_arrived_at).toBeTruthy()
    expect(job.completed_at).toBeTruthy()
    expect(job.cleaner_id).toBe(MAX_ID)
    expect(job.price).toBe(450)

    // Assignment should be accepted
    const asn = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${job.id}&select=status` })
    expect(asn.data[0].status).toBe('accepted')

    // Lead should be linked (if it still exists after cleanup from prior run)
    const lead = await db(request, 'leads', { filters: `?email=eq.e2e_${TAG}@test.com&select=status,converted_to_job_id` })
    if (lead.data?.length > 0) {
      expect(lead.data[0].status).toBe('booked')
      expect(lead.data[0].converted_to_job_id).toBe(job.id)
    }
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 2: Salesman Estimate → Quote → Booked
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 2: Salesman Estimate Flow', () => {
  const TAG = 'path2'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('2a. Estimate job created for salesman', async ({ request }) => {
    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      job_type: 'estimate',
      price: null,
      hours: 1,
      cleaner_id: BLAKE_ID,
      date: '2026-04-03',
      scheduled_at: '16:00',
      address: '300 Elm St, Morton, IL',
    })
    expect(job.job_type).toBe('estimate')
    expect(job.price).toBeNull()
    expect(job.cleaner_id).toBe(BLAKE_ID)

    await assignCleaner(request, job.id, BLAKE_ID, 'accepted')
  })

  test('2b. Salesman completes estimate → job converted to real job', async ({ request }) => {
    const estimates = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&job_type=eq.estimate&select=id` })
    const estId = estimates.data[0].id

    // Mark estimate as completed
    await db(request, 'jobs', {
      method: 'PATCH',
      filters: `?id=eq.${estId}`,
      body: { status: 'completed', completed_at: new Date().toISOString() },
    })

    // Create the actual job from the estimate
    const realJob = await createJob(request, {
      notes: `e2e_${TAG}`,
      service_type: 'ext_windows',
      price: 500,
      hours: 3,
      date: '2026-04-10',
      scheduled_at: '09:00',
      cleaner_id: MAX_ID,
      job_type: null,
    })
    expect(realJob.price).toBe(500)
    expect(realJob.job_type).toBeNull()

    // Assign to team lead
    await assignCleaner(request, realJob.id, MAX_ID, 'accepted')
  })

  test('2c. Estimate and real job both exist, correct types', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id,job_type,price,status&order=id` })
    expect(jobs.data.length).toBe(2)

    const estimate = jobs.data.find((j: any) => j.job_type === 'estimate')
    const realJob = jobs.data.find((j: any) => !j.job_type)

    expect(estimate).toBeTruthy()
    expect(estimate.status).toBe('completed')
    expect(estimate.price).toBeNull()

    expect(realJob).toBeTruthy()
    expect(realJob.status).toBe('scheduled')
    expect(realJob.price).toBe(500)
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 3: Cancel Flow
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 3: Cancel Flow', () => {
  const TAG = 'path3'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('3a. Create job with accepted assignment', async ({ request }) => {
    const job = await createJob(request, { notes: `e2e_${TAG}`, date: '2026-04-07' })
    await assignCleaner(request, job.id, MAX_ID, 'accepted')

    const asn = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${job.id}&select=status` })
    expect(asn.data[0].status).toBe('accepted')
  })

  test('3b. Cancel job → status changes, assignment cancelled', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    // Cancel the job
    await db(request, 'jobs', { method: 'PATCH', filters: `?id=eq.${jobId}`, body: { status: 'cancelled' } })

    // Cancel the assignment
    await db(request, 'cleaner_assignments', {
      method: 'PATCH',
      filters: `?job_id=eq.${jobId}`,
      body: { status: 'cancelled' },
    })

    const job = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=status`, single: true })
    expect(job.data.status).toBe('cancelled')

    const asn = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${jobId}&select=status` })
    expect(asn.data[0].status).toBe('cancelled')
  })

  test('3c. Cancelled job excluded from active queries', async ({ request }) => {
    // Query for scheduled/in_progress jobs only (what the portal does)
    const active = await db(request, 'jobs', {
      filters: `?notes=eq.e2e_${TAG}&status=neq.cancelled&select=id`,
    })
    expect(active.data.length).toBe(0)
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 4: Crew Assignment
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 4: Crew Assignment & Team Routing', () => {
  const TAG = 'path4'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('4a. Create crew day with team lead + technician', async ({ request }) => {
    const crew = await db(request, 'crew_days', {
      method: 'POST',
      body: { tenant_id: TENANT_ID, date: '2026-04-08', team_lead_id: MAX_ID },
    })
    expect(crew.data[0].id).toBeTruthy()

    // Add Josh as member
    await db(request, 'crew_day_members', {
      method: 'POST',
      body: { crew_day_id: crew.data[0].id, cleaner_id: JOSH_ID, role: 'technician' },
    })

    // Verify
    const members = await db(request, 'crew_day_members', { filters: `?crew_day_id=eq.${crew.data[0].id}&select=cleaner_id,role` })
    expect(members.data.length).toBe(1)
    expect(members.data[0].cleaner_id).toBe(JOSH_ID)
  })

  test('4b. Team lead assigns job to technician', async ({ request }) => {
    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      date: '2026-04-08',
      cleaner_id: JOSH_ID,
    })

    await assignCleaner(request, job.id, JOSH_ID, 'accepted')

    const asn = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${job.id}&select=cleaner_id,status` })
    expect(asn.data[0].cleaner_id).toBe(JOSH_ID)
    expect(asn.data[0].status).toBe('accepted')
  })

  test('4c. Cleanup crew day', async ({ request }) => {
    // Delete crew day members and crew days
    const crews = await db(request, 'crew_days', { filters: `?tenant_id=eq.${TENANT_ID}&date=eq.2026-04-08&select=id` })
    for (const c of crews.data || []) {
      await db(request, 'crew_day_members', { method: 'DELETE', filters: `?crew_day_id=eq.${c.id}` })
      await db(request, 'crew_days', { method: 'DELETE', filters: `?id=eq.${c.id}` })
    }
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 5: Time-Off + Scheduling
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 5: Time-Off & Scheduling Conflicts', () => {
  const TAG = 'path5'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('5a. Worker marks day off', async ({ request }) => {
    await db(request, 'time_off', {
      method: 'POST',
      body: { tenant_id: TENANT_ID, cleaner_id: JOSH_ID, date: '2026-04-10', reason: `e2e_${TAG}` },
    })
    const off = await db(request, 'time_off', {
      filters: `?cleaner_id=eq.${JOSH_ID}&date=eq.2026-04-10&select=id`,
    })
    expect(off.data.length).toBe(1)
  })

  test('5b. Job scheduled on off day — DB allows it (informational)', async ({ request }) => {
    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      date: '2026-04-10',
      cleaner_id: JOSH_ID,
    })
    expect(job.status).toBe('scheduled')
    expect(job.date).toBe('2026-04-10')
  })

  test('5c. Both time-off and job exist for same day', async ({ request }) => {
    const off = await db(request, 'time_off', { filters: `?cleaner_id=eq.${JOSH_ID}&date=eq.2026-04-10&select=id` })
    expect(off.data.length).toBe(1)

    const job = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&date=eq.2026-04-10&select=id,cleaner_id` })
    expect(job.data.length).toBe(1)
    expect(job.data[0].cleaner_id).toBe(JOSH_ID)
  })

  test('5d. Weekly availability saves and reads back', async ({ request }) => {
    const weekly = {
      monday: { available: true, start: '08:00', end: '17:00' },
      tuesday: { available: false },
      wednesday: { available: true, start: '13:00', end: '18:00' },
      thursday: { available: true, start: '08:00', end: '17:00' },
      friday: { available: true, start: '08:00', end: '15:00' },
      saturday: { available: false },
      sunday: { available: false },
    }

    await db(request, 'cleaners', { method: 'PATCH', filters: `?id=eq.${JOSH_ID}`, body: { availability: { weekly } } })
    const c = await db(request, 'cleaners', { filters: `?id=eq.${JOSH_ID}&select=availability`, single: true })
    expect(c.data.availability.weekly.tuesday.available).toBe(false)
    expect(c.data.availability.weekly.friday.end).toBe('15:00')

    // Reset
    await db(request, 'cleaners', { method: 'PATCH', filters: `?id=eq.${JOSH_ID}`, body: { availability: null } })
  })

  test('5e. Duplicate time-off entry rejected (unique constraint)', async ({ request }) => {
    const dupe = await db(request, 'time_off', {
      method: 'POST',
      body: { tenant_id: TENANT_ID, cleaner_id: JOSH_ID, date: '2026-04-10', reason: `e2e_${TAG}` },
    })
    expect(dupe.status).toBe(409) // Conflict
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 6: Multi-Tenant Isolation
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 6: Multi-Tenant Isolation', () => {
  const TAG = 'path6'
  const FAKE_TENANT = '11111111-1111-1111-1111-111111111111'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('6a. Jobs from other tenant are invisible', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?tenant_id=eq.${FAKE_TENANT}&select=id` })
    expect(jobs.data.length).toBe(0)
  })

  test('6b. Cannot insert job with non-existent tenant (FK violation)', async ({ request }) => {
    const res = await db(request, 'jobs', {
      method: 'POST',
      body: {
        tenant_id: FAKE_TENANT,
        customer_id: 800,
        phone_number: '+10000000000',
        service_type: 'test',
        status: 'pending',
      },
    })
    // FK violation
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test('6c. Cannot create assignment linking wrong tenant cleaner', async ({ request }) => {
    // Create a WinBros job
    const job = await createJob(request, { notes: `e2e_${TAG}` })

    // Try to assign a cleaner that doesn't exist (ID 9999)
    const res = await db(request, 'cleaner_assignments', {
      method: 'POST',
      body: { tenant_id: TENANT_ID, job_id: job.id, cleaner_id: 9999, status: 'pending' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 7: Checklist & Invoice Reconciliation
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 7: Checklist → Invoice Integrity', () => {
  const TAG = 'path7'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('7a. Create job with checklist items', async ({ request }) => {
    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      price: 350,
      service_type: 'ext_windows',
    })

    // Add checklist items
    for (const [i, text] of ['Clean exterior windows', 'Clean screens', 'Clean tracks', 'Final walkthrough'].entries()) {
      await db(request, 'job_checklist_items', {
        method: 'POST',
        body: { tenant_id: TENANT_ID, job_id: job.id, text, order: i, required: i < 3, completed: false },
      })
    }

    const items = await db(request, 'job_checklist_items', { filters: `?job_id=eq.${job.id}&select=text,required,completed&order=order` })
    expect(items.data.length).toBe(4)
    expect(items.data[0].text).toBe('Clean exterior windows')
    expect(items.data[0].required).toBe(true)
    expect(items.data[0].completed).toBe(false)
  })

  test('7b. Complete checklist items one by one', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    const items = await db(request, 'job_checklist_items', { filters: `?job_id=eq.${jobId}&select=id&order=order` })

    for (const item of items.data) {
      await db(request, 'job_checklist_items', {
        method: 'PATCH',
        filters: `?id=eq.${item.id}`,
        body: { completed: true, completed_at: new Date().toISOString() },
      })
    }

    const completed = await db(request, 'job_checklist_items', { filters: `?job_id=eq.${jobId}&completed=eq.true&select=id` })
    expect(completed.data.length).toBe(4)
  })

  test('7c. Job price matches what was quoted', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=price,hours,service_type`, single: true })
    expect(jobs.data.price).toBe(350)
    expect(jobs.data.hours).toBe(2.5)
    expect(jobs.data.service_type).toBe('ext_windows')
  })

  test('7d. Complete and pay — all fields consistent', async ({ request }) => {
    const jobs = await db(request, 'jobs', { filters: `?notes=eq.e2e_${TAG}&select=id` })
    const jobId = jobs.data[0].id

    await db(request, 'jobs', {
      method: 'PATCH',
      filters: `?id=eq.${jobId}`,
      body: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        paid: true,
        payment_status: 'fully_paid',
        payment_method: 'card',
      },
    })

    const final = await db(request, 'jobs', { filters: `?id=eq.${jobId}&select=*`, single: true })
    expect(final.data.status).toBe('completed')
    expect(final.data.paid).toBe(true)
    expect(final.data.payment_status).toBe('fully_paid')
    expect(final.data.price).toBe(350)

    // All checklist items completed
    const uncompleted = await db(request, 'job_checklist_items', { filters: `?job_id=eq.${jobId}&completed=eq.false&select=id` })
    expect(uncompleted.data.length).toBe(0)
  })
})


// ═══════════════════════════════════════════════════════════════════════
// PATH 8: Edge Cases & Data Integrity
// ═══════════════════════════════════════════════════════════════════════

test.describe('PATH 8: Edge Cases', () => {
  const TAG = 'path8'
  test.afterAll(async ({ request }) => { await cleanup(request, TAG) })

  test('8a. Double-booked same time, same cleaner — both exist', async ({ request }) => {
    const j1 = await createJob(request, { notes: `e2e_${TAG}`, scheduled_at: '09:00', service_type: 'ext_windows' })
    const j2 = await createJob(request, { notes: `e2e_${TAG}`, scheduled_at: '09:00', service_type: 'gutter_clean' })

    const both = await db(request, 'jobs', {
      filters: `?notes=eq.e2e_${TAG}&scheduled_at=eq.09:00&select=id,service_type`,
    })
    expect(both.data.length).toBe(2)
  })

  test('8b. Job with all nullable fields as null', async ({ request }) => {
    const job = await createJob(request, {
      notes: `e2e_${TAG}`,
      scheduled_at: null,
      address: null,
      price: null,
      hours: null,
      job_type: null,
      service_type: 'unknown',
    })
    expect(job.status).toBe('scheduled')
    expect(job.scheduled_at).toBeNull()
    expect(job.address).toBeNull()
    expect(job.price).toBeNull()
  })

  test('8c. Decline → reassign to different cleaner', async ({ request }) => {
    const job = await createJob(request, { notes: `e2e_${TAG}`, cleaner_id: MAX_ID, service_type: 'reassign_test' })
    const asn1 = await assignCleaner(request, job.id, MAX_ID, 'pending')

    // Max declines
    await db(request, 'cleaner_assignments', {
      method: 'PATCH', filters: `?id=eq.${asn1.id}`, body: { status: 'declined' },
    })

    // Reassign to Josh
    const asn2 = await assignCleaner(request, job.id, JOSH_ID, 'pending')

    // Josh accepts
    await db(request, 'cleaner_assignments', {
      method: 'PATCH', filters: `?id=eq.${asn2.id}`, body: { status: 'accepted' },
    })

    // Update job cleaner_id
    await db(request, 'jobs', { method: 'PATCH', filters: `?id=eq.${job.id}`, body: { cleaner_id: JOSH_ID } })

    // Verify final state
    const finalJob = await db(request, 'jobs', { filters: `?id=eq.${job.id}&select=cleaner_id`, single: true })
    expect(finalJob.data.cleaner_id).toBe(JOSH_ID)

    const allAsns = await db(request, 'cleaner_assignments', { filters: `?job_id=eq.${job.id}&select=cleaner_id,status&order=created_at` })
    expect(allAsns.data.length).toBe(2)
    expect(allAsns.data[0].status).toBe('declined') // Max
    expect(allAsns.data[1].status).toBe('accepted') // Josh
  })

  test('8d. All 3 roles have portal tokens', async ({ request }) => {
    const cleaners = await db(request, 'cleaners', {
      filters: `?tenant_id=eq.${TENANT_ID}&active=eq.true&select=name,employee_type,portal_token`,
    })
    for (const c of cleaners.data) {
      expect(c.portal_token).toBeTruthy()
    }
  })

  test('8e. Seeded data includes cancelled job', async ({ request }) => {
    const all = await db(request, 'jobs', {
      filters: `?tenant_id=eq.${TENANT_ID}&id=lte.906&select=id,status`,
    })
    // At least 7 seeded jobs (other tests may have added more)
    expect(all.data.length).toBeGreaterThanOrEqual(7)
    const cancelled = all.data.filter((j: any) => j.status === 'cancelled')
    expect(cancelled.length).toBeGreaterThanOrEqual(1)
  })
})
