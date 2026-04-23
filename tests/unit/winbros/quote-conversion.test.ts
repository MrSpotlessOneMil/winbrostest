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

describe('createQuote — is_upsell flag (Round 2)', () => {
  it('variant 1: defaults is_upsell to false when omitted', async () => {
    const client = createMockClient()
    client.single.mockResolvedValueOnce({ data: { id: 1 }, error: null })
    client.insert.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
      error: null,
      data: null,
    })

    await createQuote(client as any, {
      tenant_id: 't',
      line_items: [{ service_name: 'Windows', price: 100 }],
    })

    // Second insert call is the line items insert
    const lineItemInsert = client.insert.mock.calls[1][0]
    expect(Array.isArray(lineItemInsert)).toBe(true)
    expect(lineItemInsert[0].is_upsell).toBe(false)
  })

  it('variant 2: preserves is_upsell=true when supplied', async () => {
    const client = createMockClient()
    client.single.mockResolvedValueOnce({ data: { id: 2 }, error: null })
    client.insert.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 2 }, error: null }),
      error: null,
      data: null,
    })

    await createQuote(client as any, {
      tenant_id: 't',
      line_items: [
        { service_name: 'Base service', price: 100, is_upsell: false },
        { service_name: 'Upsold extra', price: 50, is_upsell: true },
      ],
    })

    const lineItemInsert = client.insert.mock.calls[1][0]
    expect(lineItemInsert[0].is_upsell).toBe(false)
    expect(lineItemInsert[1].is_upsell).toBe(true)
  })

  it('variant 3: is_upsell lines still contribute to total_price', async () => {
    const client = createMockClient()
    client.single.mockResolvedValueOnce({ data: { id: 3 }, error: null })

    await createQuote(client as any, {
      tenant_id: 't',
      line_items: [
        { service_name: 'Base', price: 100, is_upsell: false },
        { service_name: 'Upsold', price: 50, is_upsell: true },
      ],
    })

    const quoteInsert = client.insert.mock.calls[0][0]
    expect(quoteInsert.total_price).toBe(150)
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
