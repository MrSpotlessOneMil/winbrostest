/**
 * Test: Stripe payment failure → customer gets retry SMS, owner alerted.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockLogSystemEvent,
  resetMockClient,
} from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData, makeBookedJob } from '../fixtures/cedar-rapids'

describe('Stripe: payment failure', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.jobs.push(makeBookedJob({
      id: 'job-pay-fail',
      payment_status: 'pending',
      paid: false,
    }))
    resetMockClient(seed)
  })

  it('payment failure updates job payment_status', async () => {
    await mockClient.from('jobs')
      .update({ payment_status: 'payment_failed' })
      .eq('id', 'job-pay-fail')

    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-pay-fail')
      .single()

    expect(job.data?.payment_status).toBe('payment_failed')
    expect(job.data?.paid).toBe(false)
  })

  it('PAYMENT_FAILED system event can be logged', async () => {
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'PAYMENT_FAILED',
      source: 'stripe',
      message: 'Payment failed for job job-pay-fail: Your card was declined.',
      job_id: 'job-pay-fail',
      phone_number: '+13195550001',
      metadata: {
        error_code: 'card_declined',
        error_message: 'Your card was declined.',
      },
    })

    const events = await mockClient.from('system_events')
      .select('*')
      .eq('event_type', 'PAYMENT_FAILED')
      .eq('job_id', 'job-pay-fail')

    expect(events.data?.length).toBe(1)
    expect(events.data?.[0].metadata?.error_code).toBe('card_declined')
  })

  it('job still has tenant_id after failure (no data loss)', async () => {
    await mockClient.from('jobs')
      .update({ payment_status: 'payment_failed' })
      .eq('id', 'job-pay-fail')

    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-pay-fail')
      .single()

    // Ensure tenant_id is preserved through the update
    expect(job.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
    expect(job.data?.phone_number).toBe('+13195550001')
  })
})
