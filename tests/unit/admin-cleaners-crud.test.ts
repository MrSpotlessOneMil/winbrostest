/**
 * Unit tests for the admin cleaners CRUD API (app/api/admin/cleaners/route.ts).
 *
 * Covers: POST create, PUT update, DELETE soft-delete, GET list,
 * plus validation / error cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockSupabaseClient, MockSupabaseClient } from '../mocks/supabase-mock'
import { createMockRequest, parseResponse } from '../helpers'

// ─── Mock state ──────────────────────────────────────────────────────────

let mockClient: MockSupabaseClient
const TENANT_ID = 'tenant-abc-123'

// ─── Mock @supabase/supabase-js ──────────────────────────────────────────

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => mockClient.from(table),
    rpc: (fn: string, params: any) => mockClient.rpc(fn, params),
  }),
}))

// ─── Mock @/lib/auth — requireAdmin always returns true ──────────────────

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn().mockResolvedValue(true),
  SESSION_COOKIE_NAME: 'winbros_session',
}))

// ─── Mock modules that get pulled in transitively via lib/supabase ───────

vi.mock('@/lib/system-events', () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
  getTelegramConversation: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/hubspot', () => ({
  syncHubSpotContact: vi.fn().mockResolvedValue(undefined),
  syncHubSpotDeal: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/telegram', () => ({
  notifyJobDetailsChange: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/client-config', () => ({
  getClientConfig: vi.fn().mockReturnValue({}),
}))

// ─── Import route handlers (after mocks are hoisted) ─────────────────────

import { GET, POST, PUT, DELETE } from '@/app/api/admin/cleaners/route'

// ─── Helpers ─────────────────────────────────────────────────────────────

function seedCleaners(extras?: any[]) {
  const base = [
    {
      id: 1,
      tenant_id: TENANT_ID,
      name: 'Alice',
      phone: '+15551110001',
      email: 'alice@test.com',
      telegram_id: null,
      telegram_username: null,
      is_team_lead: false,
      home_address: null,
      max_jobs_per_day: 4,
      active: true,
      deleted_at: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    ...(extras ?? []),
  ]
  return { cleaners: base }
}

function makeGetRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/admin/cleaners')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return createMockRequest(url.toString(), { method: 'GET' })
}

function makeDeleteRequest(params: Record<string, string>) {
  const url = new URL('http://localhost:3000/api/admin/cleaners')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return createMockRequest(url.toString(), { method: 'DELETE' })
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Admin Cleaners CRUD API', () => {
  beforeEach(() => {
    mockClient = createMockSupabaseClient(seedCleaners())
  })

  // 1. POST happy path — creates cleaner, returns 201
  it('POST creates a cleaner and returns 201', async () => {
    const req = createMockRequest('http://localhost:3000/api/admin/cleaners', {
      method: 'POST',
      body: {
        tenant_id: TENANT_ID,
        name: 'Bob',
        phone: '+15552220002',
        email: 'bob@test.com',
      },
    })

    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.cleaner).toBeDefined()
    expect(body.cleaner.name).toBe('Bob')
    expect(body.cleaner.phone).toBe('+15552220002')
    expect(body.cleaner.active).toBe(true)
    expect(body.cleaner.tenant_id).toBe(TENANT_ID)
  })

  // 2. PUT with empty name — returns 400
  it('PUT with empty name returns 400 "name cannot be empty"', async () => {
    const req = createMockRequest('http://localhost:3000/api/admin/cleaners', {
      method: 'PUT',
      body: {
        id: 1,
        tenant_id: TENANT_ID,
        name: '   ',
      },
    })

    const res = await PUT(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe('name cannot be empty')
  })

  // 3. PUT on soft-deleted cleaner — returns 404
  it('PUT on a soft-deleted cleaner returns 404', async () => {
    // Seed a deleted cleaner
    mockClient = createMockSupabaseClient(seedCleaners([
      {
        id: 2,
        tenant_id: TENANT_ID,
        name: 'Deleted Dan',
        phone: '+15553330003',
        active: false,
        deleted_at: '2025-06-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-06-01T00:00:00Z',
      },
    ]))

    const req = createMockRequest('http://localhost:3000/api/admin/cleaners', {
      method: 'PUT',
      body: {
        id: 2,
        tenant_id: TENANT_ID,
        name: 'Revived Dan',
      },
    })

    const res = await PUT(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(404)
    expect(body.error).toBe('Cleaner not found')
  })

  // 4. DELETE then GET — deleted cleaner not returned
  it('DELETE soft-deletes a cleaner so GET no longer returns it', async () => {
    // First, delete Alice (id=1)
    const delReq = makeDeleteRequest({ id: '1', tenant_id: TENANT_ID })
    const delRes = await DELETE(delReq)
    const delParsed = await parseResponse(delRes)
    expect(delParsed.status).toBe(200)
    expect(delParsed.body.success).toBe(true)

    // Now GET should not include Alice (she has deleted_at set)
    const getReq = makeGetRequest({ tenant_id: TENANT_ID })
    const getRes = await GET(getReq)
    const getParsed = await parseResponse(getRes)

    expect(getParsed.status).toBe(200)
    const names = (getParsed.body.cleaners ?? []).map((c: any) => c.name)
    expect(names).not.toContain('Alice')
  })

  // 5. POST duplicate phone — returns 409
  it('POST with duplicate phone returns 409', async () => {
    // Override the mock client insert to simulate a unique constraint violation.
    // The real Supabase returns error code 23505 on unique violation.
    const originalFrom = mockClient.from.bind(mockClient)
    vi.spyOn(mockClient, 'from').mockImplementation((table: string) => {
      const builder = originalFrom(table)
      if (table === 'cleaners') {
        const originalInsert = builder.insert.bind(builder)
        builder.insert = (data: any) => {
          originalInsert(data)
          // Override the terminal methods to return a 23505 error
          const errorResult = { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }
          builder.select = () => builder
          builder.single = async () => errorResult
          builder.then = (resolve: any) => Promise.resolve(errorResult).then(resolve)
          return builder
        }
      }
      return builder
    })

    const req = createMockRequest('http://localhost:3000/api/admin/cleaners', {
      method: 'POST',
      body: {
        tenant_id: TENANT_ID,
        name: 'Alice Duplicate',
        phone: '+15551110001', // same phone as seeded Alice
      },
    })

    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(409)
    expect(body.error).toContain('phone number already exists')
  })

  // 6. POST with invalid JSON — returns 400
  it('POST with invalid JSON body returns 400', async () => {
    // Create a request with a body that will fail JSON.parse
    const req = new (await import('next/server')).NextRequest(
      new URL('http://localhost:3000/api/admin/cleaners'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not valid json {{{',
      }
    )

    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe('Invalid JSON body')
  })
})
