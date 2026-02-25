/**
 * Test: Webhook deduplication — same payload processed only once.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAllMocks, mockClient, resetMockClient } from '../mocks/modules'
import { CEDAR_RAPIDS_ID, makeSeedData } from '../fixtures/cedar-rapids'

describe('Webhook dedup', () => {
  beforeEach(() => {
    resetAllMocks()
    resetMockClient(makeSeedData())
  })

  it('inserting same message twice creates two records (no DB-level dedup)', async () => {
    // This tests the mock, but also documents that dedup is app-level, not DB-level
    const msg = {
      id: 'msg-dup-001',
      tenant_id: CEDAR_RAPIDS_ID,
      phone_number: '+13195550001',
      content: 'Hello there',
      role: 'client',
      direction: 'inbound',
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    await mockClient.from('messages').insert(msg)
    await mockClient.from('messages').insert({ ...msg, id: 'msg-dup-002' })

    const messages = mockClient.getTableData('messages')
      .filter((m: any) => m.content === 'Hello there')
    expect(messages.length).toBe(2)
  })

  it('app-level dedup: finding recent message with same content prevents re-processing', async () => {
    // Simulate the dedup check from OpenPhone webhook handler:
    // "Is there already a message with this content in the last 30 seconds?"
    const now = new Date()
    const msg = {
      id: 'msg-dedup-check',
      tenant_id: CEDAR_RAPIDS_ID,
      content: 'Yes confirm!',
      role: 'client',
      direction: 'inbound',
      phone_number: '+13195550001',
      timestamp: now.toISOString(),
      created_at: now.toISOString(),
    }

    await mockClient.from('messages').insert(msg)

    // Check if duplicate exists (simulating the webhook's dedup logic)
    const cutoff = new Date(now.getTime() - 30000).toISOString()
    const result = await mockClient.from('messages')
      .select('id')
      .eq('content', 'Yes confirm!')
      .gte('timestamp', cutoff)
      .limit(1)
      .maybeSingle()

    expect(result.data).not.toBeNull()
    expect(result.data?.id).toBe('msg-dedup-check')
    // In the real handler, this would cause early return with "duplicate_webhook_skipped"
  })

  it('messages older than 30 seconds are NOT caught by dedup', async () => {
    const oldTime = new Date(Date.now() - 60000) // 60 seconds ago
    const msg = {
      id: 'msg-old',
      tenant_id: CEDAR_RAPIDS_ID,
      content: 'Old message',
      role: 'client',
      direction: 'inbound',
      phone_number: '+13195550001',
      timestamp: oldTime.toISOString(),
      created_at: oldTime.toISOString(),
    }

    await mockClient.from('messages').insert(msg)

    // Check with 30-second cutoff — should NOT find it
    const cutoff = new Date(Date.now() - 30000).toISOString()
    const result = await mockClient.from('messages')
      .select('id')
      .eq('content', 'Old message')
      .gte('timestamp', cutoff)
      .limit(1)
      .maybeSingle()

    expect(result.data).toBeNull() // Old message not found = not a duplicate
  })
})
