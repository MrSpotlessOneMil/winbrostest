"use client"

import { useCallback, useState } from "react"

/**
 * Pick the right draft endpoint based on whether we have a portal token.
 * Crew (technician / salesman / team-lead) → commission-attributing crew
 * route. Owner / admin → session-auth admin route.
 *
 * Exported so unit tests can lock the URL contract without spinning up
 * a React renderer.
 */
export function quoteDraftUrl(portalToken: string | null): string {
  return portalToken
    ? `/api/crew/${portalToken}/quote-draft`
    : `/api/actions/quotes/draft`
}

/**
 * POST to the right draft endpoint and return the new quote id, or null on
 * any failure (network, success:false, missing id). Pure async — no React.
 */
export async function fetchNewQuoteDraft(
  portalToken: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(quoteDraftUrl(portalToken), { method: "POST" })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as
      | { success: boolean; quoteId?: string | number }
      | null
    if (body?.success && body.quoteId != null) {
      return String(body.quoteId)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Mints a draft quote and returns its id so the caller can open the
 * QuoteBuilderSheet popup on the same URL. Concurrent calls are debounced —
 * a second call while one is in flight returns null without firing a
 * duplicate POST.
 *
 * Used by /my-day Command Center and /jobs Calendar so both flows stay in
 * sync — there is no "old style of quoting" path lurking somewhere else.
 */
export function useStartNewQuote(portalToken: string | null) {
  const [creating, setCreating] = useState(false)

  const start = useCallback(async (): Promise<string | null> => {
    if (creating) return null
    setCreating(true)
    try {
      return await fetchNewQuoteDraft(portalToken)
    } finally {
      setCreating(false)
    }
  }, [portalToken, creating])

  return { start, creating }
}
