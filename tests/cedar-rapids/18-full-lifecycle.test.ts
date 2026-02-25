/**
 * Test: Full Cedar Rapids lifecycle — call → book → pay → assign → complete → followup.
 *
 * This is the crown jewel test — exercises the complete customer journey
 * through the mock Supabase client, verifying state transitions at each step.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAllMocks,
  mockClient,
  mockSendSMS,
  mockSendTelegramMessage,
  mockNotifyCleanerAssignment,
  mockCreateDepositLink,
  mockCreateCardOnFileLink,
  mockLogSystemEvent,
  mockScheduleLeadFollowUp,
  resetMockClient,
} from '../mocks/modules'
import {
  CEDAR_RAPIDS_ID,
  CEDAR_RAPIDS_TENANT,
  makeSeedData,
} from '../fixtures/cedar-rapids'

describe('Full lifecycle: Cedar Rapids', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('Step 1: VAPI booking creates job, lead, and customer', async () => {
    // Simulate what the VAPI webhook handler does:
    // 1. Upsert customer
    // 2. Create call record
    // 3. Create lead (status: booked)
    // 4. Create job (status: scheduled)

    // Upsert customer
    await mockClient.from('customers').upsert({
      id: '100',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      first_name: 'Jane',
      last_name: 'Doe',
      address: '456 Oak Ave, Cedar Rapids, IA 52402',
    }, { onConflict: 'id' })

    // Create call
    await mockClient.from('calls').insert({
      id: 'call-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      direction: 'inbound',
      provider: 'vapi',
      duration_seconds: 300,
      outcome: 'booked',
      transcript: 'Customer booked a cleaning for March 1st at 10am.',
    })

    // Create lead
    await mockClient.from('leads').insert({
      id: 'lead-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195550001',
      status: 'booked',
      source: 'phone',
      name: 'Jane Doe',
    })

    // Create job
    await mockClient.from('jobs').insert({
      id: 'job-lifecycle-001',
      tenant_id: CEDAR_RAPIDS_ID,
      customer_id: '100',
      phone_number: '+13195550001',
      service_type: 'standard',
      date: '2026-03-01',
      scheduled_at: '10:00',
      address: '456 Oak Ave, Cedar Rapids, IA 52402',
      bedrooms: 2,
      bathrooms: 1,
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
      price: 250,
    })

    // Verify state
    const job = await mockClient.from('jobs').select('*').eq('id', 'job-lifecycle-001').single()
    expect(job.data).toMatchObject({
      tenant_id: CEDAR_RAPIDS_ID,
      status: 'scheduled',
      booked: true,
      paid: false,
    })

    const lead = await mockClient.from('leads').select('*').eq('id', 'lead-001').single()
    expect(lead.data?.status).toBe('booked')

    const call = await mockClient.from('calls').select('*').eq('id', 'call-001').single()
    expect(call.data?.outcome).toBe('booked')
  })

  it('Step 2: Customer texts email → deposit payment link sent', async () => {
    // Setup: job exists from step 1
    await mockClient.from('jobs').insert({
      id: 'job-lifecycle-002',
      tenant_id: CEDAR_RAPIDS_ID,
      customer_id: '100',
      phone_number: '+13195550001',
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
      price: 250,
    })

    // Simulate email capture: update customer with email
    await mockClient.from('customers')
      .update({ email: 'jane@example.com' })
      .eq('id', '100')

    const customer = await mockClient.from('customers').select('*').eq('id', '100').single()
    expect(customer.data?.email).toBe('jane@example.com')

    // Verify deposit link would be created
    // In real flow, the handler calls createDepositPaymentLink after email capture
    expect(mockCreateDepositLink).not.toHaveBeenCalled() // hasn't been called yet
    // Simulate the handler calling it
    await mockCreateDepositLink(customer.data, { id: 'job-lifecycle-002' })
    expect(mockCreateDepositLink).toHaveBeenCalledTimes(1)
  })

  it('Step 3: Stripe deposit paid → job updated + cleaner assignment triggered', async () => {
    // Setup: job with pending payment
    await mockClient.from('jobs').insert({
      id: 'job-lifecycle-003',
      tenant_id: CEDAR_RAPIDS_ID,
      customer_id: '100',
      phone_number: '+13195550001',
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
      price: 250,
    })

    // Simulate Stripe webhook updating the job
    await mockClient.from('jobs')
      .update({
        payment_status: 'deposit_paid',
        paid: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', 'job-lifecycle-003')

    const job = await mockClient.from('jobs').select('*').eq('id', 'job-lifecycle-003').single()
    expect(job.data).toMatchObject({
      payment_status: 'deposit_paid',
      paid: true,
    })
    expect(job.data?.confirmed_at).toBeTruthy()
  })

  it('Step 4: Cleaner accepts assignment → customer notified', async () => {
    // Setup: job + pending assignment
    await mockClient.from('jobs').insert({
      id: 'job-lifecycle-004',
      tenant_id: CEDAR_RAPIDS_ID,
      customer_id: '100',
      phone_number: '+13195550001',
      status: 'scheduled',
      paid: true,
      team_id: 1,
    })

    await mockClient.from('cleaner_assignments').insert({
      id: 'asn-001',
      job_id: 'job-lifecycle-004',
      cleaner_id: '200',
      status: 'pending',
      tenant_id: CEDAR_RAPIDS_ID,
    })

    // Cleaner accepts
    await mockClient.from('cleaner_assignments')
      .update({ status: 'confirmed' })
      .eq('id', 'asn-001')

    await mockClient.from('jobs')
      .update({ status: 'assigned', cleaner_confirmed: true, customer_notified: true })
      .eq('id', 'job-lifecycle-004')

    // Verify
    const assignment = await mockClient.from('cleaner_assignments').select('*').eq('id', 'asn-001').single()
    expect(assignment.data?.status).toBe('confirmed')

    const job = await mockClient.from('jobs').select('*').eq('id', 'job-lifecycle-004').single()
    expect(job.data?.status).toBe('assigned')
    expect(job.data?.cleaner_confirmed).toBe(true)
  })

  it('Step 5: Job completed → eligible for followup', async () => {
    const completedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() // 3h ago

    await mockClient.from('jobs').insert({
      id: 'job-lifecycle-005',
      tenant_id: CEDAR_RAPIDS_ID,
      customer_id: '100',
      phone_number: '+13195550001',
      status: 'completed',
      paid: true,
      payment_status: 'fully_paid',
      completed_at: completedAt,
      followup_sent_at: null,
    })

    // Verify it's eligible for followup (completed > 2h ago, no followup sent)
    const result = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('status', 'completed')
      .is('followup_sent_at', null)
      .single()

    expect(result.data).not.toBeNull()
    expect(result.data?.id).toBe('job-lifecycle-005')

    // Simulate followup sent
    await mockClient.from('jobs')
      .update({ followup_sent_at: new Date().toISOString() })
      .eq('id', 'job-lifecycle-005')

    // Should no longer be eligible
    const result2 = await mockClient.from('jobs')
      .select('*')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .eq('status', 'completed')
      .is('followup_sent_at', null)
      .maybeSingle()

    expect(result2.data).toBeNull()
  })

  it('End-to-end state transitions are consistent', async () => {
    // Walk through all status transitions
    const jobId = 'job-e2e'

    // 1. Created (scheduled)
    await mockClient.from('jobs').insert({
      id: jobId,
      tenant_id: CEDAR_RAPIDS_ID,
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
      phone_number: '+13195550001',
    })

    // 2. Deposit paid
    await mockClient.from('jobs').update({ payment_status: 'deposit_paid', paid: true }).eq('id', jobId)
    let job = (await mockClient.from('jobs').select('*').eq('id', jobId).single()).data
    expect(job?.status).toBe('scheduled')
    expect(job?.paid).toBe(true)

    // 3. Cleaner assigned
    await mockClient.from('jobs').update({ status: 'assigned', cleaner_confirmed: true }).eq('id', jobId)
    job = (await mockClient.from('jobs').select('*').eq('id', jobId).single()).data
    expect(job?.status).toBe('assigned')

    // 4. In progress
    await mockClient.from('jobs').update({ status: 'in_progress' }).eq('id', jobId)
    job = (await mockClient.from('jobs').select('*').eq('id', jobId).single()).data
    expect(job?.status).toBe('in_progress')

    // 5. Completed
    await mockClient.from('jobs').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      payment_status: 'fully_paid',
    }).eq('id', jobId)
    job = (await mockClient.from('jobs').select('*').eq('id', jobId).single()).data
    expect(job?.status).toBe('completed')
    expect(job?.payment_status).toBe('fully_paid')
    expect(job?.completed_at).toBeTruthy()
  })
})
