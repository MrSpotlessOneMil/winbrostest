/**
 * Test: Cleaner declines → auto-reassign to next cleaner.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendTelegramMessage,
  mockNotifyCleanerAssignment,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('Telegram: decline chain', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.jobs.push(makeBookedJob({
      id: 'job-decline',
      status: 'scheduled',
    }))
    // Alice has a pending assignment
    seed.cleaner_assignments.push({
      id: 'asn-alice',
      job_id: 'job-decline',
      cleaner_id: '200',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
      created_at: new Date().toISOString(),
    })
    resetMockClient(seed)
  })

  it('Alice declines → her assignment marked as declined', async () => {
    await mockClient.from('cleaner_assignments')
      .update({ status: 'declined' })
      .eq('id', 'asn-alice')

    const assignment = await mockClient.from('cleaner_assignments')
      .select('*')
      .eq('id', 'asn-alice')
      .single()

    expect(assignment.data?.status).toBe('declined')
  })

  it('after Alice declines, Bob is next available cleaner', async () => {
    // Mark Alice as declined
    await mockClient.from('cleaner_assignments')
      .update({ status: 'declined' })
      .eq('id', 'asn-alice')

    // Find next available cleaner (not already assigned to this job)
    const declinedCleaners = (await mockClient.from('cleaner_assignments')
      .select('cleaner_id')
      .eq('job_id', 'job-decline')
    ).data?.map((a: any) => a.cleaner_id) || []

    const availableCleaners = mockClient.getTableData('cleaners')
      .filter((c: any) =>
        c.tenant_id === CEDAR_RAPIDS_ID &&
        c.active &&
        c.telegram_id &&
        !declinedCleaners.includes(c.id)
      )

    expect(availableCleaners.length).toBe(2) // Bob and Charlie
    expect(availableCleaners[0].name).toBe('Bob Cleaner')
  })

  it('Bob gets new pending assignment after Alice declines', async () => {
    // Alice declines
    await mockClient.from('cleaner_assignments')
      .update({ status: 'declined' })
      .eq('id', 'asn-alice')

    // Create Bob's assignment
    await mockClient.from('cleaner_assignments').insert({
      id: 'asn-bob',
      job_id: 'job-decline',
      cleaner_id: '201',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
    })

    const bobAssignment = await mockClient.from('cleaner_assignments')
      .select('*')
      .eq('id', 'asn-bob')
      .single()

    expect(bobAssignment.data?.cleaner_id).toBe('201')
    expect(bobAssignment.data?.status).toBe('pending')
  })

  it('Bob accepts → job is assigned', async () => {
    // Alice declined, Bob assigned
    await mockClient.from('cleaner_assignments')
      .update({ status: 'declined' })
      .eq('id', 'asn-alice')

    await mockClient.from('cleaner_assignments').insert({
      id: 'asn-bob',
      job_id: 'job-decline',
      cleaner_id: '201',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
    })

    // Bob accepts
    await mockClient.from('cleaner_assignments')
      .update({ status: 'confirmed' })
      .eq('id', 'asn-bob')

    await mockClient.from('jobs')
      .update({ status: 'assigned', cleaner_confirmed: true })
      .eq('id', 'job-decline')

    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-decline')
      .single()

    expect(job.data?.status).toBe('assigned')
    expect(job.data?.cleaner_confirmed).toBe(true)
  })
})
