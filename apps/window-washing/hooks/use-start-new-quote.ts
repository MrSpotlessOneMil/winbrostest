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

export interface NewQuoteContext {
  /** Phase F linkage: when launching a quote from a sales appointment,
   * thread the appointment's jobs.id so quote-conversion can flip the
   * matching salesman_appointment_credits row from pending → earned. */
  appointment_job_id?: number
  /** Pre-populates the builder so the salesman doesn't re-pick the same
   * customer they just saw at the appointment. */
  customer_id?: number
}

/**
 * POST to the right draft endpoint and return the new quote id, or null on
 * any failure (network, success:false, missing id). Pure async — no React.
 *
 * The 2nd arg is overloaded for backwards compatibility with the unit
 * tests written before Phase F: passing a function in slot 2 is treated
 * as fetchImpl; passing an object is treated as the context payload.
 */
export async function fetchNewQuoteDraft(
  portalToken: string | null,
  contextOrFetchImpl?: NewQuoteContext | typeof fetch,
  maybeFetchImpl?: typeof fetch
): Promise<string | null> {
  const fetchImpl: typeof fetch =
    typeof contextOrFetchImpl === 'function'
      ? (contextOrFetchImpl as typeof fetch)
      : (maybeFetchImpl ?? fetch)
  const context: NewQuoteContext | undefined =
    typeof contextOrFetchImpl === 'function' ? undefined : contextOrFetchImpl

  try {
    const url = quoteDraftUrl(portalToken)
    const init: RequestInit =
      context && (context.appointment_job_id || context.customer_id)
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(context),
          }
        : { method: "POST" }
    const res = await fetchImpl(url, init)
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

  const start = useCallback(async (context?: NewQuoteContext): Promise<string | null> => {
    if (creating) return null
    setCreating(true)
    try {
      return await fetchNewQuoteDraft(portalToken, context)
    } finally {
      setCreating(false)
    }
  }, [portalToken, creating])

  return { start, creating }
}
