/**
 * Test: Debounce — rapid messages batched into single response.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('SMS: debounce behavior', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('multiple rapid messages stored separately in DB', async () => {
    const now = Date.now()

    // Customer sends 3 messages in rapid succession
    await mockClient.from('messages').insert({
      id: 'msg-rapid-1',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Yes',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date(now).toISOString(),
    })

    await mockClient.from('messages').insert({
      id: 'msg-rapid-2',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'jane@example.com',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date(now + 500).toISOString(), // 500ms later
    })

    await mockClient.from('messages').insert({
      id: 'msg-rapid-3',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: '456 Oak Ave Cedar Rapids',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date(now + 1200).toISOString(), // 1.2s later
    })

    // All 3 messages stored
    const msgs = await mockClient.from('messages')
      .select('*')
      .eq('phone_number', '+13195550001')
      .eq('role', 'client')
      .order('timestamp', { ascending: true })

    expect(msgs.data?.length).toBeGreaterThanOrEqual(3)
  })

  it('newer message check: newest message ID found correctly', async () => {
    const now = Date.now()

    await mockClient.from('messages').insert({
      id: 'msg-old',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'First',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date(now).toISOString(),
    })

    await mockClient.from('messages').insert({
      id: 'msg-new',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Second',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date(now + 2000).toISOString(),
    })

    // The debounce check: find the newest inbound message
    const newest = await mockClient.from('messages')
      .select('id')
      .eq('phone_number', '+13195550001')
      .eq('role', 'client')
      .eq('direction', 'inbound')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single()

    expect(newest.data?.id).toBe('msg-new')
    // If webhook #1 sees msg-new != msg-old, it should defer (debounce)
  })

  it('message combining: recent messages within 2-min window', async () => {
    const now = Date.now()

    await mockClient.from('messages').insert([
      {
        id: 'msg-comb-1',
        tenant_id: CEDAR_RAPIDS_ID,
        phone_number: '+13195550001',
        content: 'Yup',
        role: 'client',
        direction: 'inbound',
        timestamp: new Date(now - 60000).toISOString(), // 1 min ago
      },
      {
        id: 'msg-comb-2',
        tenant_id: CEDAR_RAPIDS_ID,
        phone_number: '+13195550001',
        content: 'jane@example.com',
        role: 'client',
        direction: 'inbound',
        timestamp: new Date(now - 30000).toISOString(), // 30s ago
      },
    ])

    // Combine all inbound messages from last 2 minutes
    const cutoff = new Date(now - 120000).toISOString()
    const recentMsgs = await mockClient.from('messages')
      .select('content')
      .eq('phone_number', '+13195550001')
      .eq('role', 'client')
      .eq('direction', 'inbound')
      .gte('timestamp', cutoff)
      .order('timestamp', { ascending: true })

    const combined = recentMsgs.data?.map((m: any) => m.content).join(' ')
    expect(combined).toBe('Yup jane@example.com')
  })

  it('AI response already sent prevents duplicate processing', async () => {
    const now = Date.now()
    const inboundTime = new Date(now - 5000).toISOString() // 5s ago

    // Inbound message
    await mockClient.from('messages').insert({
      id: 'msg-in',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Hi',
      role: 'client',
      direction: 'inbound',
      timestamp: inboundTime,
    })

    // AI response already sent (after inbound)
    await mockClient.from('messages').insert({
      id: 'msg-ai-resp',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Thanks for reaching out!',
      role: 'assistant',
      direction: 'outbound',
      ai_generated: true,
      timestamp: new Date(now - 2000).toISOString(), // 2s ago
    })

    // Check: is there an AI response after the inbound message?
    const aiResponse = await mockClient.from('messages')
      .select('id')
      .eq('role', 'assistant')
      .eq('ai_generated', true)
      .eq('phone_number', '+13195550001')
      .gte('timestamp', inboundTime)
      .limit(1)
      .maybeSingle()

    expect(aiResponse.data).not.toBeNull()
    // In the real handler, this means: skip — response already sent
  })
})
