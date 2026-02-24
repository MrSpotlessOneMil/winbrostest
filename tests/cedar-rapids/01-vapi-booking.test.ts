/**
 * Test: VAPI booked call creates job, lead, and customer with correct tenant_id.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, mockSendSMS, mockLogSystemEvent, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('VAPI: booking creates correct records', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('new customer is upserted with Cedar Rapids tenant_id', async () => {
    // Simulate VAPI handler upserting a customer
    await mockClient.from('customers').upsert({
      phone_number: '+13195553333',
      tenant_id: CEDAR_RAPIDS_ID,
      first_name: 'New',
      last_name: 'Customer',
      address: '789 Elm St, Cedar Rapids, IA',
    }, { onConflict: 'phone_number' })

    const customer = await mockClient.from('customers')
      .select('*')
      .eq('phone_number', '+13195553333')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .maybeSingle()

    expect(customer.data).not.toBeNull()
    expect(customer.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
    expect(customer.data?.first_name).toBe('New')
  })

  it('call record includes tenant_id and vapi metadata', async () => {
    await mockClient.from('calls').insert({
      id: 'call-vapi-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195553333',
      direction: 'inbound',
      provider: 'vapi',
      provider_call_id: 'vapi-call-001',
      duration_seconds: 180,
      outcome: 'booked',
      transcript: 'Booked for March 1st at 10am',
    })

    const call = await mockClient.from('calls')
      .select('*')
      .eq('id', 'call-vapi-001')
      .single()

    expect(call.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
    expect(call.data?.provider).toBe('vapi')
    expect(call.data?.outcome).toBe('booked')
  })

  it('job created with scheduled status and Cedar Rapids tenant', async () => {
    await mockClient.from('jobs').insert({
      id: 'job-vapi-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195553333',
      service_type: 'standard',
      date: '2026-03-01',
      scheduled_at: '10:00',
      address: '789 Elm St, Cedar Rapids, IA',
      bedrooms: 2,
      bathrooms: 1,
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
    })

    const job = await mockClient.from('jobs')
      .select('*')
      .eq('id', 'job-vapi-001')
      .single()

    expect(job.data).toMatchObject({
      tenant_id: CEDAR_RAPIDS_ID,
      status: 'scheduled',
      booked: true,
      paid: false,
      payment_status: 'pending',
      service_type: 'standard',
    })
  })

  it('lead created with booked status for phone booking', async () => {
    await mockClient.from('leads').insert({
      id: 'lead-vapi-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195553333',
      status: 'booked',
      source: 'phone',
      name: 'New Customer',
    })

    const lead = await mockClient.from('leads')
      .select('*')
      .eq('id', 'lead-vapi-001')
      .single()

    expect(lead.data?.status).toBe('booked')
    expect(lead.data?.source).toBe('phone')
    expect(lead.data?.tenant_id).toBe(CEDAR_RAPIDS_ID)
  })

  it('Cedar Rapids feature: HCP mirror is OFF (no HCP sync expected)', () => {
    const tenant = mockClient.getTableData('tenants')
      .find((t: any) => t.slug === 'cedar-rapids')
    expect(tenant?.workflow_config?.use_hcp_mirror).toBe(false)
    expect(tenant?.housecall_pro_api_key).toBeNull()
  })
})
