"use client"

/**
 * Quote builder page — thin wrapper around the shared QuoteBuilder component.
 *
 * Direct URL access (admin clicks a quote in the list, customer hits a
 * shared link, etc.) renders the page variant. The same component also
 * renders inside a Sheet on /jobs Calendar via QuoteBuilderSheet — same UI,
 * no navigation away from the calendar.
 *
 * `?from=jobs` returns to /jobs Calendar after Close. Anything else returns
 * to the admin /quotes list. Legacy `from=crew:<token>` is treated as
 * /jobs since the dashboard now hosts the salesman flow.
 */

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { QuoteBuilder } from "@/components/winbros/quote-builder"

export default function QuoteBuilderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const quoteId = params?.id

  const fromParam = searchParams?.get('from') ?? null
  const isJobsBack = fromParam === 'jobs' || (fromParam?.startsWith('crew:') ?? false)
  const backHref = isJobsBack ? '/jobs' : '/quotes'
  const backLabel = isJobsBack ? 'Back to Calendar' : 'Back to quotes'

  if (!quoteId) {
    return (
      <div className="min-h-screen bg-zinc-950 p-6 text-sm text-zinc-400">
        Loading quote…
      </div>
    )
  }

  return (
    <QuoteBuilder
      quoteId={quoteId}
      variant="page"
      backLabel={backLabel}
      onClose={() => router.push(backHref)}
    />
  )
}
