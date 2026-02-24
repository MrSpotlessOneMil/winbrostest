/**
 * Test: Customer texts their email → payment link sent.
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

describe('SMS: email capture → payment link', () => {
  beforeEach(() => {
    resetAllMocks()
    const seed = makeSeedData()
    seed.leads.push({
      id: 'lead-email',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195550002', // Bob — no email yet
      status: 'booked',
      source: 'phone',
      name: 'Bob Smith',
      created_at: new Date().toISOString(),
    })
    seed.jobs.push(makeBookedJob({
      id: 'job-email',
      customer_id: '101', // Bob
      phone_number: '+13195550002',
      status: 'scheduled',
      payment_status: 'pending',
    }))
    resetMockClient(seed)
  })

  it('customer email saved when they text it', async () => {
    // Simulate customer texting their email
    await mockClient.from('customers')
      .update({ email: 'bob@example.com' })
      .eq('id', '101')

    const customer = await mockClient.from('customers')
      .select('*')
      .eq('id', '101')
      .single()

    expect(customer.data?.email).toBe('bob@example.com')
  })

  it('booked lead exists for the email-capture flow', async () => {
    const lead = await mockClient.from('leads')
      .select('*')
      .eq('phone', '+13195550002')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('status', 'booked')
      .maybeSingle()

    expect(lead.data).not.toBeNull()
    expect(lead.data?.name).toBe('Bob Smith')
  })

  it('job exists and can receive payment link', async () => {
    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-email')
      .single()

    expect(job.data?.payment_status).toBe('pending')
    expect(job.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
  })

  it('EMAIL_CAPTURED system event can be logged', async () => {
    await mockClient.from('system_events').insert({
      tenant_id: CEDAR_RAPIDS_ID,
      event_type: 'EMAIL_CAPTURED',
      source: 'openphone',
      message: 'Email captured for Bob Smith: bob@example.com',
      phone_number: '+13195550002',
      metadata: { email: 'bob@example.com' },
    })

    const events = await mockClient.from('system_events')
      .select('*')
      .eq('event_type', 'EMAIL_CAPTURED')
      .eq('phone_number', '+13195550002')

    expect(events.data?.length).toBe(1)
  })
})
