/**
 * Visit Flow State Machine — Unit Tests
 *
 * Tests the sequential visit execution flow:
 * not_started → on_my_way → in_progress → stopped → completed → checklist_done → payment_collected → closed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  isValidTransition,
  getNextStatus,
  canAddUpsell,
  transitionVisit,
  addUpsell,
  recordPayment,
  type VisitStatus,
} from '@/apps/window-washing/lib/visit-flow'

// Mock Supabase client
function createMockClient(overrides: Record<string, unknown> = {}) {
  const mockSelect = vi.fn().mockReturnThis()
  const mockEq = vi.fn().mockReturnThis()
  const mockSingle = vi.fn()
  const mockInsert = vi.fn().mockReturnThis()
  const mockUpdate = vi.fn().mockReturnThis()
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    eq: mockEq,
    single: mockSingle,
  })

  // Chain eq().eq().single() properly
  mockEq.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    select: mockSelect,
  })

  mockSelect.mockReturnValue({
    eq: mockEq,
    single: mockSingle,
    order: vi.fn().mockReturnValue({
      data: [],
      error: null,
    }),
  })

  mockInsert.mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
    }),
  })

  return {
    from: mockFrom,
    _mockSingle: mockSingle,
    _mockEq: mockEq,
    _mockInsert: mockInsert,
    _mockUpdate: mockUpdate,
    ...overrides,
  }
}

describe('isValidTransition', () => {
  it('allows the correct sequential transitions', () => {
    expect(isValidTransition('not_started', 'on_my_way')).toBe(true)
    expect(isValidTransition('on_my_way', 'in_progress')).toBe(true)
    expect(isValidTransition('in_progress', 'stopped')).toBe(true)
    expect(isValidTransition('stopped', 'completed')).toBe(true)
    expect(isValidTransition('completed', 'checklist_done')).toBe(true)
    expect(isValidTransition('checklist_done', 'payment_collected')).toBe(true)
    expect(isValidTransition('payment_collected', 'closed')).toBe(true)
  })

  it('rejects skipping steps', () => {
    expect(isValidTransition('not_started', 'in_progress')).toBe(false)
    expect(isValidTransition('not_started', 'closed')).toBe(false)
    expect(isValidTransition('on_my_way', 'completed')).toBe(false)
    expect(isValidTransition('in_progress', 'closed')).toBe(false)
  })

  it('rejects going backwards', () => {
    expect(isValidTransition('in_progress', 'on_my_way')).toBe(false)
    expect(isValidTransition('completed', 'in_progress')).toBe(false)
    expect(isValidTransition('closed', 'not_started')).toBe(false)
  })

  it('rejects staying in same state', () => {
    expect(isValidTransition('in_progress', 'in_progress')).toBe(false)
    expect(isValidTransition('closed', 'closed')).toBe(false)
  })
})

describe('getNextStatus', () => {
  it('returns correct next status for each step', () => {
    expect(getNextStatus('not_started')).toBe('on_my_way')
    expect(getNextStatus('on_my_way')).toBe('in_progress')
    expect(getNextStatus('in_progress')).toBe('stopped')
    expect(getNextStatus('stopped')).toBe('completed')
    expect(getNextStatus('completed')).toBe('checklist_done')
    expect(getNextStatus('checklist_done')).toBe('payment_collected')
    expect(getNextStatus('payment_collected')).toBe('closed')
  })

  it('returns null for terminal state', () => {
    expect(getNextStatus('closed')).toBeNull()
  })
})

describe('canAddUpsell', () => {
  // Round 2 (2026-04-23): timer gating removed. Upsells allowed any time the visit is active
  // (not before start, not after close). Commission attribution comes from the catalog picker,
  // not the visit state.
  it('variant 1: allows upsells during active visit states', () => {
    expect(canAddUpsell('on_my_way')).toBe(true)
    expect(canAddUpsell('in_progress')).toBe(true)
    expect(canAddUpsell('stopped')).toBe(true)
    expect(canAddUpsell('completed')).toBe(true)
    expect(canAddUpsell('checklist_done')).toBe(true)
    expect(canAddUpsell('payment_collected')).toBe(true)
  })

  it('variant 2: blocks upsells before start', () => {
    expect(canAddUpsell('not_started')).toBe(false)
  })

  it('variant 3: blocks upsells after close', () => {
    expect(canAddUpsell('closed')).toBe(false)
  })
})

describe('transitionVisit', () => {
  it('rejects invalid transition', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: { id: 1, status: 'not_started', tenant_id: 'test' },
      error: null,
    })

    const result = await transitionVisit(client as any, 1, 'in_progress')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid transition')
  })

  it('rejects closing without checklist', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: {
        id: 1,
        status: 'payment_collected',
        checklist_completed: false,
        payment_recorded: true,
      },
      error: null,
    })

    const result = await transitionVisit(client as any, 1, 'closed')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Checklist must be completed')
  })

  it('rejects closing without payment', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: {
        id: 1,
        status: 'payment_collected',
        checklist_completed: true,
        payment_recorded: false,
      },
      error: null,
    })

    const result = await transitionVisit(client as any, 1, 'closed')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Payment must be recorded')
  })
})

describe('addUpsell', () => {
  // Round 2: rejects only when visit is not yet active or already closed.
  it('variant 1: rejects upsell when visit is not_started', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: { id: 1, job_id: 1, tenant_id: 'test', status: 'not_started' },
      error: null,
    })

    const result = await addUpsell(client as any, 1, {
      service_name: 'Screen Rewash',
      price: 15,
      added_by_cleaner_id: 1,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('variant 2: rejects upsell when visit is closed', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: { id: 1, job_id: 1, tenant_id: 'test', status: 'closed' },
      error: null,
    })

    const result = await addUpsell(client as any, 1, {
      service_name: 'Screen Rewash',
      price: 15,
      added_by_cleaner_id: 1,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('recordPayment', () => {
  it('rejects payment before completion', async () => {
    const client = createMockClient()
    client._mockSingle.mockResolvedValue({
      data: { id: 1, status: 'in_progress' },
      error: null,
    })

    const result = await recordPayment(client as any, 1, {
      payment_type: 'card',
      payment_amount: 350,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('after job completion')
  })
})
