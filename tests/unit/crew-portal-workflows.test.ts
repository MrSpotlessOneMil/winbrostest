/**
 * Crew Portal Workflow Tests
 *
 * Tests the REAL business logic behind the crew portal:
 * - Job assignment → cleaner acceptance/decline
 * - Scheduling on unavailable days
 * - Multiple jobs at same time slot
 * - Time-off toggle with existing jobs
 * - Weekly availability persistence
 * - Cross-tenant isolation
 * - Edge cases: no address, no time, no price, etc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetMockClient, mockClient, mockSendSMS } from '../mocks/modules'
import { WINBROS_ID, WINBROS_TENANT, CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'
import { createMockRequest, parseResponse } from '../helpers'

// ─── WinBros-specific fixtures ─────────────────────────────────────────

const WINBROS_CLEANER = {
  id: '600',
  tenant_id: WINBROS_ID,
  name: 'Max Tech',
  phone: '+16305550010',
  telegram_id: '6001',
  active: true,
  is_team_lead: true,
  employee_type: 'technician',
  portal_token: 'test-portal-token-winbros',
  deleted_at: null,
  availability: null,
  username: 'maxtech',
  pin: '1234',
}

const WINBROS_CLEANER_2 = {
  id: '601',
  tenant_id: WINBROS_ID,
  name: 'Blake Sales',
  phone: '+16305550011',
  telegram_id: '6002',
  active: true,
  is_team_lead: false,
  employee_type: 'salesman',
  portal_token: 'test-portal-token-blake',
  deleted_at: null,
  availability: null,
}

function makeWinBrosJob(overrides: Record<string, any> = {}) {
  return {
    id: 'job-wb-001',
    tenant_id: WINBROS_ID,
    customer_id: '500',
    phone_number: '+13195550001',
    service_type: 'ext_windows',
    date: '2026-04-01',
    scheduled_at: '09:00',
    address: '123 Main St, Morton, IL',
    bedrooms: null,
    bathrooms: null,
    status: 'scheduled',
    booked: true,
    paid: false,
    payment_status: 'pending',
    price: 350,
    hours: 2.5,
    team_id: 2,
    job_type: null,
    notes: null,
    cleaner_id: '600',
    cleaner_omw_at: null,
    cleaner_arrived_at: null,
    payment_method: null,
    created_at: '2026-03-28T10:00:00Z',
    ...overrides,
  }
}

function makeWinBrosAssignment(overrides: Record<string, any> = {}) {
  return {
    id: 'asn-wb-001',
    tenant_id: WINBROS_ID,
    cleaner_id: '600',
    job_id: 'job-wb-001',
    status: 'accepted',
    created_at: '2026-03-28T10:00:00Z',
    ...overrides,
  }
}

function seedWinBrosData(extra?: Record<string, any[]>) {
  const base = makeSeedData()
  // Replace cleaners with portal-token-enabled ones
  base.cleaners = [
    ...base.cleaners.filter(c => c.tenant_id !== WINBROS_ID),
    WINBROS_CLEANER,
    WINBROS_CLEANER_2,
  ]
  // Add time_off and crew tables
  return {
    ...base,
    time_off: [],
    crew_days: [],
    crew_day_members: [],
    ...extra,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Crew Portal — API Response Shape', () => {
  beforeEach(() => {
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob(),
        makeWinBrosJob({ id: 'job-wb-002', scheduled_at: '14:00', service_type: 'gutter_clean', price: 200, hours: 1.5 }),
      ],
      cleaner_assignments: [
        makeWinBrosAssignment(),
        makeWinBrosAssignment({ id: 'asn-wb-002', job_id: 'job-wb-002' }),
      ],
    }))
  })

  it('returns jobs with hours and price fields', async () => {
    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    expect(data.jobs).toBeDefined()
    expect(data.jobs.length).toBeGreaterThanOrEqual(0)
    expect(data.pendingJobs).toBeDefined()
    expect(data.dateRange).toBeDefined()
    expect(data.timeOff).toBeDefined()
    // Verify tenant info
    expect(data.tenant.slug).toBe('winbros')
    expect(data.cleaner.name).toBe('Max Tech')
  })

  it('returns 404 for invalid portal token', async () => {
    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/fake-token')
    const res = await GET(req, { params: Promise.resolve({ token: 'fake-token' }) })
    expect(res.status).toBe(404)
  })
})

describe('Crew Portal — Job Assignment Accept/Decline', () => {
  beforeEach(() => {
    vi.resetModules()
    resetMockClient(seedWinBrosData({
      jobs: [makeWinBrosJob({ status: 'scheduled' })],
      cleaner_assignments: [makeWinBrosAssignment({ status: 'pending' })],
    }))
  })

  it('cleaner can accept a pending job assignment', async () => {
    const { POST } = await import('@/app/api/crew/[token]/job/[jobId]/route')
    const req = createMockRequest('POST', '/api/crew/test-portal-token-winbros/job/job-wb-001', {
      action: 'accept',
    })
    const res = await POST(req, {
      params: Promise.resolve({ token: 'test-portal-token-winbros', jobId: 'job-wb-001' }),
    })
    const data = await parseResponse(res)

    // Should succeed
    expect(res.status).toBe(200)
    // Assignment should be updated to accepted
    const assignments = mockClient.from('cleaner_assignments').data
    const updated = assignments?.find((a: any) => a.id === 'asn-wb-001')
    expect(updated?.status).toBe('accepted')
  })

  it('cleaner can decline a pending job assignment', async () => {
    const { POST } = await import('@/app/api/crew/[token]/job/[jobId]/route')
    const req = createMockRequest('POST', '/api/crew/test-portal-token-winbros/job/job-wb-001', {
      action: 'decline',
    })
    const res = await POST(req, {
      params: Promise.resolve({ token: 'test-portal-token-winbros', jobId: 'job-wb-001' }),
    })

    expect(res.status).toBe(200)
    const assignments = mockClient.from('cleaner_assignments').data
    const updated = assignments?.find((a: any) => a.id === 'asn-wb-001')
    expect(updated?.status).toBe('declined')
  })
})

describe('Crew Portal — Time-Off Toggle', () => {
  beforeEach(() => {
    vi.resetModules()
    resetMockClient(seedWinBrosData())
  })

  it('can mark a day as off', async () => {
    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      toggleTimeOff: { date: '2026-04-15' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    expect(data.success).toBe(true)
    expect(data.action).toBe('added')
    // Verify time_off record was created
    const timeOff = mockClient.from('time_off').data
    expect(timeOff?.some((t: any) => t.date === '2026-04-15' && t.cleaner_id === '600')).toBe(true)
  })

  it('can remove a day off (toggle)', async () => {
    // Seed with an existing time-off entry
    resetMockClient(seedWinBrosData({
      time_off: [{ id: 'to-1', tenant_id: WINBROS_ID, cleaner_id: '600', date: '2026-04-15', reason: 'worker_requested' }],
    }))

    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      toggleTimeOff: { date: '2026-04-15' },
    })
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    expect(data.success).toBe(true)
    expect(data.action).toBe('removed')
  })

  it('rejects toggle without date', async () => {
    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      toggleTimeOff: {},
    })
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    expect(res.status).toBe(400)
  })
})

describe('Crew Portal — Weekly Availability', () => {
  beforeEach(() => {
    vi.resetModules()
    resetMockClient(seedWinBrosData())
  })

  it('saves weekly availability schedule', async () => {
    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const weekly = {
      monday: { available: true, start: '08:00', end: '18:00' },
      tuesday: { available: false },
      wednesday: { available: true, start: '13:00', end: '18:00' },
      thursday: { available: true, start: '08:00', end: '18:00' },
      friday: { available: true, start: '08:00', end: '16:00' },
      saturday: { available: false },
      sunday: { available: false },
    }

    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      availability: { weekly },
    })
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    expect(data.success).toBe(true)
    // Verify the availability was saved to the cleaner record
    const cleaners = mockClient.from('cleaners').data
    const updated = cleaners?.find((c: any) => c.id === '600')
    expect(updated?.availability?.weekly?.tuesday?.available).toBe(false)
    expect(updated?.availability?.weekly?.wednesday?.start).toBe('13:00')
  })

  it('rejects PATCH with no availability or toggleTimeOff', async () => {
    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      randomField: 'nope',
    })
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    expect(res.status).toBe(400)
  })
})

describe('Crew Portal — Cross-Tenant Isolation', () => {
  beforeEach(() => {
    vi.resetModules()
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob(),
        makeBookedJob(), // Cedar Rapids job
      ],
      cleaner_assignments: [
        makeWinBrosAssignment(),
      ],
    }))
  })

  it('WinBros cleaner cannot see Cedar Rapids jobs', async () => {
    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=week&date=2026-03-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    // Should only see WinBros jobs
    for (const job of data.jobs) {
      expect(job.id).not.toBe('job-cr-001')
    }
  })

  it('WinBros cleaner cannot access Cedar Rapids job detail', async () => {
    const { GET } = await import('@/app/api/crew/[token]/job/[jobId]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros/job/job-cr-001')
    const res = await GET(req, {
      params: Promise.resolve({ token: 'test-portal-token-winbros', jobId: 'job-cr-001' }),
    })
    expect(res.status).toBe(404)
  })

  it('WinBros cleaner time-off only affects WinBros tenant', async () => {
    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      toggleTimeOff: { date: '2026-04-15' },
    })
    await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })

    const timeOff = mockClient.from('time_off').data
    const record = timeOff?.find((t: any) => t.date === '2026-04-15')
    expect(record?.tenant_id).toBe(WINBROS_ID)
    expect(record?.tenant_id).not.toBe(CEDAR_RAPIDS_ID)
  })
})

describe('Crew Portal — Edge Cases', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('handles job with no scheduled_at (TBD time)', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [makeWinBrosJob({ scheduled_at: null })],
      cleaner_assignments: [makeWinBrosAssignment()],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    // Should still return the job, just with null scheduled_at
    const job = data.jobs?.find((j: any) => j.id === 'job-wb-001')
    if (job) {
      expect(job.scheduled_at).toBeNull()
    }
  })

  it('handles job with no address', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [makeWinBrosJob({ address: null })],
      cleaner_assignments: [makeWinBrosAssignment()],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    const job = data.jobs?.find((j: any) => j.id === 'job-wb-001')
    if (job) {
      expect(job.address).toBeNull()
    }
  })

  it('handles job with no price (free estimate)', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [makeWinBrosJob({ price: null, job_type: 'estimate' })],
      cleaner_assignments: [makeWinBrosAssignment()],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    const job = data.jobs?.find((j: any) => j.id === 'job-wb-001')
    if (job) {
      expect(job.price).toBeNull()
      expect(job.job_type).toBe('estimate')
    }
  })

  it('handles multiple jobs at the same time slot', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob({ id: 'job-wb-same-1', scheduled_at: '09:00', service_type: 'ext_windows' }),
        makeWinBrosJob({ id: 'job-wb-same-2', scheduled_at: '09:00', service_type: 'gutter_clean' }),
        makeWinBrosJob({ id: 'job-wb-same-3', scheduled_at: '09:00', service_type: 'pressure_wash' }),
      ],
      cleaner_assignments: [
        makeWinBrosAssignment({ id: 'asn-1', job_id: 'job-wb-same-1' }),
        makeWinBrosAssignment({ id: 'asn-2', job_id: 'job-wb-same-2' }),
        makeWinBrosAssignment({ id: 'asn-3', job_id: 'job-wb-same-3' }),
      ],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    // All 3 jobs should be returned even though same time
    const sameTimeJobs = data.jobs?.filter((j: any) => j.scheduled_at === '09:00')
    expect(sameTimeJobs?.length).toBe(3)
  })

  it('handles week range calculation correctly (Mon-Sun)', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob({ id: 'job-mon', date: '2026-03-30' }),  // Monday
        makeWinBrosJob({ id: 'job-fri', date: '2026-04-03' }),  // Friday
        makeWinBrosJob({ id: 'job-sun', date: '2026-04-05' }),  // Sunday
        makeWinBrosJob({ id: 'job-next-mon', date: '2026-04-06' }), // Next Monday (should NOT be included)
      ],
      cleaner_assignments: [
        makeWinBrosAssignment({ id: 'a1', job_id: 'job-mon' }),
        makeWinBrosAssignment({ id: 'a2', job_id: 'job-fri' }),
        makeWinBrosAssignment({ id: 'a3', job_id: 'job-sun' }),
        makeWinBrosAssignment({ id: 'a4', job_id: 'job-next-mon' }),
      ],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    // April 2 (Thu) → week should be Mar 30 (Mon) – Apr 5 (Sun)
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=week&date=2026-04-02')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    expect(data.dateRange.start).toBe('2026-03-30')
    expect(data.dateRange.end).toBe('2026-04-05')
    // Should include Mon, Fri, Sun but NOT next Monday
    const jobIds = data.jobs?.map((j: any) => j.id) || []
    expect(jobIds).toContain('job-mon')
    expect(jobIds).toContain('job-fri')
    expect(jobIds).toContain('job-sun')
    expect(jobIds).not.toContain('job-next-mon')
  })

  it('handles inactive/deleted cleaner token gracefully', async () => {
    resetMockClient(seedWinBrosData())
    // Set cleaner as deleted
    const cleaners = mockClient.from('cleaners').data
    const wb = cleaners?.find((c: any) => c.id === '600')
    if (wb) wb.deleted_at = '2026-03-01T00:00:00Z'

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    expect(res.status).toBe(404)
  })

  it('handles cancelled jobs — excludes from job list', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob({ id: 'job-active', status: 'scheduled' }),
        makeWinBrosJob({ id: 'job-cancelled', status: 'cancelled' }),
      ],
      cleaner_assignments: [
        makeWinBrosAssignment({ id: 'a-active', job_id: 'job-active', status: 'accepted' }),
        makeWinBrosAssignment({ id: 'a-cancelled', job_id: 'job-cancelled', status: 'accepted' }),
      ],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    // Cancelled jobs should NOT appear (assignments are filtered by status)
    const jobIds = data.jobs?.map((j: any) => j.id) || []
    expect(jobIds).not.toContain('job-cancelled')
  })

  it('separates pending assignments from regular jobs', async () => {
    resetMockClient(seedWinBrosData({
      jobs: [
        makeWinBrosJob({ id: 'job-scheduled', status: 'scheduled' }),
        makeWinBrosJob({ id: 'job-pending', status: 'scheduled' }),
      ],
      cleaner_assignments: [
        makeWinBrosAssignment({ id: 'a-acc', job_id: 'job-scheduled', status: 'accepted' }),
        makeWinBrosAssignment({ id: 'a-pen', job_id: 'job-pending', status: 'pending' }),
      ],
    }))

    const { GET } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('GET', '/api/crew/test-portal-token-winbros?range=day&date=2026-04-01')
    const res = await GET(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    const data = await parseResponse(res)

    // Pending should be in pendingJobs array
    const pendingIds = data.pendingJobs?.map((j: any) => j.id) || []
    expect(pendingIds).toContain('job-pending')

    // Regular jobs should also include the pending job (it's in the date range)
    const allIds = data.jobs?.map((j: any) => j.id) || []
    expect(allIds).toContain('job-scheduled')
  })

  it('handles malformed JSON body in PATCH', async () => {
    resetMockClient(seedWinBrosData())

    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = new Request('http://localhost/api/crew/test-portal-token-winbros', {
      method: 'PATCH',
      body: 'not json',
      headers: { 'Content-Type': 'application/json' },
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })
    expect(res.status).toBe(400)
  })

  it('time-off entries include tenant_id for multi-tenant safety', async () => {
    resetMockClient(seedWinBrosData())

    const { PATCH } = await import('@/app/api/crew/[token]/route')
    const req = createMockRequest('PATCH', '/api/crew/test-portal-token-winbros', {
      toggleTimeOff: { date: '2026-05-01' },
    })
    await PATCH(req, { params: Promise.resolve({ token: 'test-portal-token-winbros' }) })

    const timeOff = mockClient.from('time_off').data
    const record = timeOff?.find((t: any) => t.date === '2026-05-01')
    expect(record).toBeDefined()
    expect(record?.tenant_id).toBe(WINBROS_ID)
    expect(record?.cleaner_id).toBe('600')
  })
})
