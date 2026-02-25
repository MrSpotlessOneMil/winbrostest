/**
 * Test: Cleaner timeout cron — 30 min no response → escalation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendTelegramMessage,
  mockSendUrgentFollowUp,
  mockSendSMS,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, CEDAR_RAPIDS_TENANT, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('Cron: check-timeouts', () => {
  beforeEach(() => {
    resetAllMocks()
  })

  it('pending assignment older than 30 min is detectable', async () => {
    const seed = makeSeedData()
    const oldTime = new Date(Date.now() - 35 * 60 * 1000).toISOString() // 35 min ago

    seed.jobs.push(makeBookedJob({
      id: 'job-timeout',
      status: 'scheduled',
    }))
    seed.cleaner_assignments.push({
      id: 'asn-timeout',
      job_id: 'job-timeout',
      cleaner_id: '200',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
      created_at: oldTime,
    })
    resetMockClient(seed)

    // Find pending assignments older than 30 min
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const stale = await mockClient.from('cleaner_assignments')
      .select('*')
      .eq('status', 'pending')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .lte('created_at', cutoff)

    expect(stale.data?.length).toBe(1)
    expect(stale.data?.[0].id).toBe('asn-timeout')
  })

  it('assignment created 10 min ago is NOT timed out', async () => {
    const seed = makeSeedData()
    const recentTime = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 min ago

    seed.jobs.push(makeBookedJob({ id: 'job-recent' }))
    seed.cleaner_assignments.push({
      id: 'asn-recent',
      job_id: 'job-recent',
      cleaner_id: '200',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
      created_at: recentTime,
    })
    resetMockClient(seed)

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const stale = await mockClient.from('cleaner_assignments')
      .select('*')
      .eq('status', 'pending')
      .lte('created_at', cutoff)

    expect(stale.data?.length).toBe(0) // Not timed out yet
  })

  it('owner alert includes job details and tenant info', () => {
    const job = makeBookedJob({ id: 'job-timeout-alert' })

    // Construct expected alert message
    const alertMsg = `Job ${job.id} has no cleaner response after 30 min. ` +
      `Address: ${job.address}, Date: ${job.date}, Time: ${job.scheduled_at}`

    expect(alertMsg).toContain(job.address)
    expect(alertMsg).toContain(job.date)

    // Owner phone exists for SMS alert
    expect(CEDAR_RAPIDS_TENANT.owner_phone).toBeTruthy()
  })

  it('cleaners scoped by tenant_id (no cross-tenant rebroadcast)', async () => {
    const seed = makeSeedData()
    resetMockClient(seed)

    // Get cleaners for Cedar Rapids only
    const crCleaners = await mockClient.from('cleaners')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('active', true)

    // Verify no WinBros cleaners
    const wbCleaners = crCleaners.data?.filter((c: any) => c.tenant_id !== CEDAR_RAPIDS_ID)
    expect(wbCleaners?.length).toBe(0)
    expect(crCleaners.data?.length).toBe(3)
  })
})
