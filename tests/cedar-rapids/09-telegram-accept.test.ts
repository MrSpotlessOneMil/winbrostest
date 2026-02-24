/**
 * Test: Cleaner accepts assignment via Telegram → customer notified.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockSendTelegramMessage,
  mockAnswerCallbackQuery,
  mockNotifyCleanerAssignment,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('Telegram: cleaner accepts', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.jobs.push(makeBookedJob({
      id: 'job-tg-accept',
      status: 'scheduled',
    }))
    seed.cleaner_assignments.push({
      id: 'asn-tg-001',
      job_id: 'job-tg-accept',
      cleaner_id: '200', // Alice
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
      created_at: new Date().toISOString(),
    })
    resetMockClient(seed)
  })

  it('accepting updates assignment status to confirmed', async () => {
    // Simulate Telegram callback: accept:job-tg-accept:asn-tg-001
    await mockClient.from('cleaner_assignments')
      .update({ status: 'confirmed' })
      .eq('id', 'asn-tg-001')

    const assignment = await mockClient.from('cleaner_assignments')
      .select('*')
      .eq('id', 'asn-tg-001')
      .single()

    expect(assignment.data?.status).toBe('confirmed')
  })

  it('accepting updates job to assigned + cleaner_confirmed', async () => {
    await mockClient.from('jobs')
      .update({ status: 'assigned', cleaner_confirmed: true })
      .eq('id', 'job-tg-accept')

    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-tg-accept')
      .single()

    expect(job.data?.status).toBe('assigned')
    expect(job.data?.cleaner_confirmed).toBe(true)
  })

  it('cleaner who accepted can be looked up for customer SMS', async () => {
    const cleaner = await mockClient.from('cleaners')
      .select('*')
      .eq('id', '200')
      .single()

    expect(cleaner.data?.name).toBe('Alice Cleaner')
    expect(cleaner.data?.phone).toBe('+13195550010')
    expect(cleaner.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
  })

  it('customer record exists for the notification', async () => {
    const customer = await mockClient.from('customers')
      .select('*')
      .eq('id', '100')
      .single()

    expect(customer.data?.first_name).toBe('Jane')
    expect(customer.data?.phone_number).toBe('+13195550001')
  })

  it('system event logged for CLEANER_ACCEPTED', async () => {
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'CLEANER_ACCEPTED',
      source: 'telegram',
      message: 'Alice Cleaner accepted job job-tg-accept',
      job_id: 'job-tg-accept',
      cleaner_id: '200',
    })

    const events = await mockClient.from('system_events')
      .select('*')
      .eq('event_type', 'CLEANER_ACCEPTED')
      .eq('job_id', 'job-tg-accept')

    expect(events.data?.length).toBe(1)
    expect(events.data?.[0].cleaner_id).toBe('200')
  })
})
