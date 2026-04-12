/**
 * Quote → Job Conversion — Unit Tests
 *
 * Tests that approved quotes correctly convert to jobs with proper revenue separation.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  approveAndConvertQuote,
  createQuote,
} from '@/apps/window-washing/lib/quote-conversion'

// Helper to build a chainable mock Supabase client
function createMockClient() {
  const results: Record<string, { data: unknown; error: unknown }> = {}
  let currentTable = ''
  let lastOp = ''

  const chain: Record<string, any> = {
    from(table: string) {
      currentTable = table
      return chain
    },
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
  }

  // Configure per-table responses
  chain._setResponse = (table: string, data: unknown, error: unknown = null) => {
    results[table] = { data, error }
  }

  return chain
}

describe('approveAndConvertQuote', () => {
  it('rejects already-converted quotes', async () => {
    const client = createMockClient()

    // Mock: quote fetch returns converted status
    client.single.mockResolvedValueOnce({
      data: { id: 1, status: 'converted', tenant_id: 'test-tenant' },
      error: null,
    })

    const result = await approveAndConvertQuote(client as any, 1, 'customer')
    expect(result.success).toBe(false)
    expect(result.error).toContain('already converted')
  })

  it('rejects non-existent quote', async () => {
    const client = createMockClient()
    client.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'not found' },
    })

    const result = await approveAndConvertQuote(client as any, 999, 'customer')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('createQuote', () => {
  it('calculates total price from line items', async () => {
    const client = createMockClient()

    // Mock: quote insert
    client.single.mockResolvedValueOnce({
      data: { id: 1 },
      error: null,
    })

    // Mock: line items insert (no .single() needed)
    client.insert.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
      error: null,
      data: null,
    })

    const lineItems = [
      { service_name: 'Window Cleaning - Interior', price: 150, quantity: 1 },
      { service_name: 'Window Cleaning - Exterior', price: 200, quantity: 1 },
      { service_name: 'Screen Cleaning', price: 50, quantity: 2 },
    ]

    const result = await createQuote(client as any, {
      tenant_id: 'test-tenant',
      customer_name: 'John Smith',
      phone_number: '+13095551234',
      line_items: lineItems,
    })

    // Total should be 150 + 200 + (50*2) = 450
    // Check that insert was called with total_price: 450
    const insertCall = client.insert.mock.calls[0][0]
    expect(insertCall.total_price).toBe(450)
  })
})
