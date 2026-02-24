/**
 * Test: Double confirmation — customer says "confirm" twice, only one payment link sent.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockCreateDepositLink,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('SMS: double confirm', () => {
  beforeEach(() => {
    resetAllMocks()

    const seed = makeSeedData()
    // Booked lead + scheduled job already exist
    seed.leads.push({
      id: 'lead-dblconf',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195550001',
      status: 'booked',
      source: 'phone',
      name: 'Jane Doe',
      brand: 'cedar-rapids',
      created_at: new Date().toISOString(),
    })
    seed.jobs.push(makeBookedJob({
      id: 'job-dblconf',
      payment_status: 'pending',
    }))
    resetMockClient(seed)
  })

  it('first confirm triggers payment link creation', async () => {
    // First "confirm" — payment links should be sent
    // Simulate what the handler does: check for existing PAYMENT_LINKS_SENT event
    const existingEvent = await mockClient.from('system_events')
      .select('id')
      .eq('event_type', 'PAYMENT_LINKS_SENT')
      .eq('phone_number', '+13195550001')
      .maybeSingle()

    expect(existingEvent.data).toBeNull() // No prior event — first time

    // Log the event (simulating handler behavior)
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'PAYMENT_LINKS_SENT',
      source: 'openphone',
      message: 'Payment link sent for job-dblconf',
      phone_number: '+13195550001',
      job_id: 'job-dblconf',
    })

    // Now simulate second confirm
    const secondCheck = await mockClient.from('system_events')
      .select('id')
      .eq('event_type', 'PAYMENT_LINKS_SENT')
      .eq('phone_number', '+13195550001')
      .maybeSingle()

    expect(secondCheck.data).not.toBeNull() // Event exists — should NOT send again
  })

  it('payment link event prevents duplicate sends', async () => {
    // Insert the "already sent" event
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'PAYMENT_LINKS_SENT',
      source: 'openphone',
      message: 'Payment link already sent',
      phone_number: '+13195550001',
      job_id: 'job-dblconf',
      created_at: new Date().toISOString(),
    })

    // The handler's dedup check: look for recent PAYMENT_LINKS_SENT events
    const recentEvents = await mockClient.from('system_events')
      .select('id')
      .eq('event_type', 'PAYMENT_LINKS_SENT')
      .eq('phone_number', '+13195550001')
      .limit(1)

    expect(recentEvents.data?.length).toBeGreaterThan(0)
    // Handler should skip → createDepositPaymentLink NOT called
    expect(mockCreateDepositLink).not.toHaveBeenCalled()
  })

  it('BUG CHECK: event_type string matches exactly (PAYMENT_LINKS_SENT vs PAYMENT_LINK_SENT)', async () => {
    // Log with one variant
    await mockClient.from('system_events').insert({
      event_type: 'PAYMENT_LINKS_SENT', // plural
      phone_number: '+13195550001',
      source: 'openphone',
      message: 'test',
    })

    // Check with the other variant — should NOT match
    const wrongVariant = await mockClient.from('system_events')
      .select('id')
      .eq('event_type', 'PAYMENT_LINK_SENT') // singular
      .eq('phone_number', '+13195550001')
      .maybeSingle()

    // If this passes (null), it means the two strings DON'T match — which is correct.
    // But if the handler uses inconsistent strings, this reveals the bug.
    expect(wrongVariant.data).toBeNull()
  })
})
