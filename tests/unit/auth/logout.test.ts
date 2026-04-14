/**
 * Logout Route Tests
 *
 * Tests POST /api/auth/logout:
 * - Deletes session and clears cookie
 * - Gracefully handles missing session
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest, parseResponse } from '../../helpers'

// ─── Mock state ─────────────────────────────────────────────────────────

const mockDeleteSession = vi.fn().mockResolvedValue(undefined)
const mockClearSessionCookie = vi.fn()

vi.mock('@/lib/auth', () => ({
  deleteSession: (...args: any[]) => mockDeleteSession(...args),
  clearSessionCookie: (...args: any[]) => mockClearSessionCookie(...args),
  SESSION_COOKIE_NAME: 'winbros_session',
}))

// ─── Tests ──────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes session and returns success', async () => {
    const { POST } = await import('@/app/api/auth/logout/route')
    const req = createMockRequest('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: 'winbros_session=token-to-delete' },
    })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1)
  })

  it('returns success even without a session cookie', async () => {
    const { POST } = await import('@/app/api/auth/logout/route')
    const req = createMockRequest('/api/auth/logout', { method: 'POST' })

    const res = await POST(req)
    const data = await parseResponse(res)

    expect(data.status).toBe(200)
    expect(data.body.success).toBe(true)
    expect(mockDeleteSession).not.toHaveBeenCalled()
    expect(mockClearSessionCookie).toHaveBeenCalledTimes(1)
  })
})