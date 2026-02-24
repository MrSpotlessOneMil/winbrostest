/**
 * Test: Multiple customers texting simultaneously — no cross-contamination.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('SMS: concurrent customers', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('two customers have separate message histories', async () => {
    // Customer A sends message
    await mockClient.from('messages').insert({
      id: 'msg-a-1',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001', // Jane
      content: 'I need a cleaning on Friday',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date().toISOString(),
    })

    // Customer B sends message at same time
    await mockClient.from('messages').insert({
      id: 'msg-b-1',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550002', // Bob
      content: 'How much for 3 bedrooms?',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date().toISOString(),
    })

    // Query Customer A's messages — should not include B's
    const aMessages = await mockClient.from('messages')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    expect(aMessages.data?.length).toBe(1)
    expect(aMessages.data?.[0].content).toBe('I need a cleaning on Friday')
    expect(aMessages.data?.[0].content).not.toContain('3 bedrooms')

    // Query Customer B's messages — should not include A's
    const bMessages = await mockClient.from('messages')
      .select('*')
      .eq('phone_number', '+13195550002')
      .eq('tenant_id', CEDAR_RAPIDS_ID)

    expect(bMessages.data?.length).toBe(1)
    expect(bMessages.data?.[0].content).toBe('How much for 3 bedrooms?')
  })

  it('leads are separate per customer phone', async () => {
    // Create leads for both customers
    await mockClient.from('leads').insert({
      id: 'lead-a',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195550001',
      status: 'new',
      name: 'Jane Doe',
    })

    await mockClient.from('leads').insert({
      id: 'lead-b',
      tenant_id: CEDAR_RAPIDS_ID,
      phone: '+13195550002',
      status: 'new',
      name: 'Bob Smith',
    })

    // Query lead A
    const leadA = await mockClient.from('leads')
      .select('*')
      .eq('phone', '+13195550001')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .maybeSingle()

    expect(leadA.data?.name).toBe('Jane Doe')

    // Query lead B
    const leadB = await mockClient.from('leads')
      .select('*')
      .eq('phone', '+13195550002')
      .eq('tenant_id', CEDAR_RAPIDS_ID)
      .maybeSingle()

    expect(leadB.data?.name).toBe('Bob Smith')
  })

  it('outbound responses stored with correct phone numbers', async () => {
    // AI response for Customer A
    await mockClient.from('messages').insert({
      id: 'msg-a-resp',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'We have Friday available! What time works?',
      role: 'assistant',
      direction: 'outbound',
      ai_generated: true,
      timestamp: new Date().toISOString(),
    })

    // AI response for Customer B
    await mockClient.from('messages').insert({
      id: 'msg-b-resp',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550002',
      content: 'A 3-bedroom cleaning starts at $375.',
      role: 'assistant',
      direction: 'outbound',
      ai_generated: true,
      timestamp: new Date().toISOString(),
    })

    // Verify no cross-contamination
    const aOutbound = await mockClient.from('messages')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('role', 'assistant')

    expect(aOutbound.data?.length).toBe(1)
    expect(aOutbound.data?.[0].content).toContain('Friday')

    const bOutbound = await mockClient.from('messages')
      .select('*')
      .eq('phone_number', '+13195550002')
      .eq('role', 'assistant')

    expect(bOutbound.data?.length).toBe(1)
    expect(bOutbound.data?.[0].content).toContain('$375')
  })
})
