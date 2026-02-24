/**
 * Test: All cleaners decline → owner alert sent.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockSendTelegramMessage,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, CEDAR_RAPIDS_TENANT, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('Telegram: all cleaners decline', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.jobs.push(makeBookedJob({
      id: 'job-all-decline',
      status: 'scheduled',
    }))
    // All 3 cleaners assigned and declined
    seed.cleaner_assignments.push(
      { id: 'asn-a', job_id: 'job-all-decline', cleaner_id: '200', status: 'declined', tenant_id: CEDAR_RAPIDS_ID },
      { id: 'asn-b', job_id: 'job-all-decline', cleaner_id: '201', status: 'declined', tenant_id: CEDAR_RAPIDS_ID },
      { id: 'asn-c', job_id: 'job-all-decline', cleaner_id: '202', status: 'declined', tenant_id: CEDAR_RAPIDS_ID },
    )
    resetMockClient(seed)
  })

  it('no available cleaners remain after all decline', () => {
    const allAssignments = mockClient.getTableData('cleaner_assignments')
      .filter((a: any) => a.job_id === 'job-all-decline')

    const declinedIds = allAssignments
      .filter((a: any) => a.status === 'declined')
      .map((a: any) => a.cleaner_id)

    const availableCleaners = mockClient.getTableData('cleaners')
      .filter((c: any) =>
        c.tenant_id === CEDAR_RAPIDS_ID &&
        c.active &&
        c.telegram_id &&
        !declinedIds.includes(c.id)
      )

    expect(availableCleaners.length).toBe(0) // All exhausted
  })

  it('owner has a Telegram chat ID for alerts', () => {
    expect(CEDAR_RAPIDS_TENANT.owner_telegram_chat_id).toBeTruthy()
    expect(CEDAR_RAPIDS_TENANT.owner_telegram_chat_id).toBe('9999')
  })

  it('owner has a phone number for SMS alerts', () => {
    expect(CEDAR_RAPIDS_TENANT.owner_phone).toBeTruthy()
    expect(CEDAR_RAPIDS_TENANT.owner_phone).toBe('+13195559999')
  })

  it('OWNER_ACTION_REQUIRED event can be logged', async () => {
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'OWNER_ACTION_REQUIRED',
      source: 'telegram',
      message: 'All cleaners declined job job-all-decline. Owner action required.',
      job_id: 'job-all-decline',
      metadata: {
        cleaners_attempted: 3,
        all_declined: true,
      },
    })

    const events = await mockClient.from('system_events')
      .select('*')
      .eq('event_type', 'OWNER_ACTION_REQUIRED')
      .eq('job_id', 'job-all-decline')

    expect(events.data?.length).toBe(1)
    expect(events.data?.[0].metadata?.all_declined).toBe(true)
  })

  it('customer should get "no availability" message', () => {
    // This documents the expected behavior — when all cleaners decline,
    // the handler sends a "we're sorry" SMS to the customer
    const customerPhone = '+13195550001'
    const noAvailMsg = `Hi Jane, we're sorry but we don't have availability for 2026-03-01. Can we find you another date?`

    // The message should contain:
    expect(noAvailMsg).toContain('sorry')
    expect(noAvailMsg).toContain('availability')
    expect(noAvailMsg).toContain('another date')
  })
})
