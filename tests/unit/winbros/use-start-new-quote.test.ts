/**
 * useStartNewQuote — Unit Tests (Wave 2)
 *
 * Locks the endpoint selection: crew (with portal token) hits the
 * commission-attributing crew endpoint; admins/owners (no token) hit the
 * session-auth admin endpoint. Used by /my-day Command Center and /jobs
 * Calendar so both flows are guaranteed to mint drafts the same way.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  quoteDraftUrl,
  fetchNewQuoteDraft,
} from '@/apps/window-washing/hooks/use-start-new-quote'

describe('quoteDraftUrl — endpoint selection', () => {
  it('crew (portal token) → /api/crew/<token>/quote-draft', () => {
    expect(quoteDraftUrl('tok-abc')).toBe('/api/crew/tok-abc/quote-draft')
  })

  it('admin (null token) → /api/actions/quotes/draft', () => {
    expect(quoteDraftUrl(null)).toBe('/api/actions/quotes/draft')
  })

  it('crew encodes the token verbatim — server is the trust boundary, not us', () => {
    // Token is opaque from the dashboard's perspective; portal-exchange
    // already validates it. We don't double-escape.
    expect(quoteDraftUrl('tok with spaces')).toBe(
      '/api/crew/tok with spaces/quote-draft'
    )
  })
})

describe('fetchNewQuoteDraft', () => {
  it('crew flow returns the quoteId on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, quoteId: 'q-42' }),
    } as Response)

    const id = await fetchNewQuoteDraft('tok-abc', fetchImpl as unknown as typeof fetch)

    expect(id).toBe('q-42')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/crew/tok-abc/quote-draft',
      { method: 'POST' }
    )
  })

  it('admin flow returns the quoteId on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, quoteId: 'q-99' }),
    } as Response)

    const id = await fetchNewQuoteDraft(null, fetchImpl as unknown as typeof fetch)

    expect(id).toBe('q-99')
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/actions/quotes/draft',
      { method: 'POST' }
    )
  })

  it('coerces a numeric quoteId to string so callers can put it in a URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, quoteId: 1234 }),
    } as Response)

    const id = await fetchNewQuoteDraft('tok', fetchImpl as unknown as typeof fetch)

    expect(id).toBe('1234')
    expect(typeof id).toBe('string')
  })

  it('returns null when the server responds with success:false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'something broke' }),
    } as Response)

    const id = await fetchNewQuoteDraft('tok', fetchImpl as unknown as typeof fetch)

    expect(id).toBeNull()
  })

  it('returns null when fetch throws (network down), without re-raising', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))

    const id = await fetchNewQuoteDraft('tok', fetchImpl as unknown as typeof fetch)

    expect(id).toBeNull()
  })

  it('returns null on non-ok HTTP', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response)

    const id = await fetchNewQuoteDraft('tok', fetchImpl as unknown as typeof fetch)

    expect(id).toBeNull()
  })

  it('returns null when JSON parsing fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json') },
    } as Response)

    const id = await fetchNewQuoteDraft('tok', fetchImpl as unknown as typeof fetch)

    expect(id).toBeNull()
  })
})
