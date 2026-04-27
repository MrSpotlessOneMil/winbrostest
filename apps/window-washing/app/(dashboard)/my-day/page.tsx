"use client"

/**
 * /my-day — Field Command Center
 *
 * Default landing for techs / salesmen / team leads after login. Surfaces:
 *   - Clock-in widget (dark theme)
 *   - Today's jobs (own jobs only) → JobDetailDrawer on click
 *   - "+ New Quote" pill → QuoteBuilderSheet popup, no nav away
 *   - Salesman-only pending-commission chip
 *   - Tomorrow strip (collapsed by default)
 *
 * Re-uses /api/crew/<token>?range=day&date=YYYY-MM-DD which already returns
 * jobs scoped to the cleaner (assignments + crew_day_members + TL fallback).
 * Owners hitting /my-day fall through to a friendly empty-state — they should
 * be on /overview instead.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { ClockWidget } from "@/components/winbros/clock-widget"
import { QuoteBuilderSheet } from "@/components/winbros/quote-builder-sheet"
import { JobDetailDrawer } from "@/components/winbros/job-detail-drawer"
import { useStartNewQuote } from "@/hooks/use-start-new-quote"
import {
  Plus,
  Loader2,
  ChevronRight,
  ChevronDown,
  Calendar as CalendarIcon,
  MapPin,
  Sparkles,
} from "lucide-react"

interface MyDayJob {
  id: number
  date: string
  scheduled_at: string | null
  address: string | null
  service_type: string | null
  status: string
  job_type: string | null
  price: number | null
  customer_first_name: string | null
  visit_status?: string | null
}

interface CrewDayResponse {
  jobs?: MyDayJob[]
}

function formatTime(iso: string | null): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return "—"
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  } catch {
    return "—"
  }
}

function formatPrice(price: number | null): string {
  if (price == null) return ""
  return `$${Math.round(price)}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function MyDayPage() {
  const { user, isAdmin, isTeamLead, employeeType, portalToken, roleLabel } = useAuth()
  const isSalesman = employeeType === "salesman"
  const showClockWidget = !!portalToken && (employeeType === "technician" || isTeamLead)
  const showCommissionChip = !!portalToken && isSalesman

  const [todayJobs, setTodayJobs] = useState<MyDayJob[]>([])
  const [tomorrowJobs, setTomorrowJobs] = useState<MyDayJob[]>([])
  const [loading, setLoading] = useState(true)
  const [tomorrowOpen, setTomorrowOpen] = useState(false)
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null)
  const [quoteSheetId, setQuoteSheetId] = useState<string | null>(null)
  const [commissionPending, setCommissionPending] = useState<number | null>(null)

  const { start: startNewQuote, creating } = useStartNewQuote(portalToken)

  const today = useMemo(() => todayIso(), [])
  const tomorrow = useMemo(() => tomorrowIso(), [])

  const fetchDay = useCallback(async (date: string): Promise<MyDayJob[]> => {
    if (!portalToken) return []
    try {
      const res = await fetch(`/api/crew/${portalToken}?range=day&date=${date}`)
      if (!res.ok) return []
      const body = (await res.json()) as CrewDayResponse
      return Array.isArray(body.jobs) ? body.jobs : []
    } catch {
      return []
    }
  }, [portalToken])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [t, n] = await Promise.all([fetchDay(today), fetchDay(tomorrow)])
      setTodayJobs(t)
      setTomorrowJobs(n)
    } finally {
      setLoading(false)
    }
  }, [fetchDay, today, tomorrow])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Salesman pending commission — same source the legacy /jobs header used.
  useEffect(() => {
    if (!showCommissionChip || !portalToken) return
    fetch(`/api/crew/${portalToken}/commission-summary`)
      .then(r => r.ok ? r.json() : null)
      .then(b => { if (b?.success) setCommissionPending(Number(b.data.total_pay) || 0) })
      .catch(() => {})
  }, [portalToken, showCommissionChip])

  const handleNewQuote = useCallback(async () => {
    const id = await startNewQuote()
    if (id) setQuoteSheetId(id)
  }, [startNewQuote])

  const firstName = (user?.display_name || user?.username || "").split(" ")[0]
  const headingLabel = firstName ? `${firstName}'s Day` : "Today"

  // Owners / admins get a soft nudge — they should be on /overview not /my-day.
  if (isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-xl font-semibold mb-2">Command Center</h1>
          <p className="text-sm text-zinc-400">
            This view is built for technicians, salesmen, and team leads. Your
            owner Command Center is at <a href="/overview" className="text-teal-400 hover:underline">/overview</a>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">

          {/* Header */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {headingLabel}
              </h1>
              {roleLabel && (
                <p className="mt-0.5 text-xs uppercase tracking-wider text-teal-400 font-semibold">
                  {roleLabel}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showCommissionChip && commissionPending != null && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  ${commissionPending.toFixed(0)} pending
                </div>
              )}
              <button
                onClick={handleNewQuote}
                disabled={creating}
                data-testid="my-day-new-quote"
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-500 hover:bg-teal-400 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-zinc-900 transition-colors"
              >
                {creating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                New Quote
              </button>
            </div>
          </div>

          {/* Clock-in widget */}
          {showClockWidget && portalToken && (
            <ClockWidget token={portalToken} accent="#14b8a6" theme="dark" />
          )}

          {/* Today's jobs */}
          <section data-testid="my-day-today">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Today · {todayJobs.length} {todayJobs.length === 1 ? "job" : "jobs"}
              </h2>
              <span className="text-xs text-zinc-500">
                {new Date(today + "T12:00:00").toLocaleDateString([], {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            {loading ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
                <Loader2 className="w-4 h-4 inline animate-spin mr-2" />
                Loading…
              </div>
            ) : todayJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center">
                <CalendarIcon className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-400">Nothing on the books today.</p>
                <p className="mt-1 text-xs text-zinc-500">Tap + New Quote to start one.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayJobs.map((job) => (
                  <button
                    key={job.id}
                    onClick={() => setDrawerJobId(String(job.id))}
                    data-testid="my-day-job-card"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 p-4 text-left transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
                          <span className="tabular-nums">{formatTime(job.scheduled_at)}</span>
                          {job.service_type && (
                            <>
                              <span className="text-zinc-700">·</span>
                              <span>{job.service_type}</span>
                            </>
                          )}
                        </div>
                        <div className="font-semibold text-zinc-100 truncate">
                          {job.customer_first_name || "Customer"}
                        </div>
                        {job.address && (
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{job.address}</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {job.price != null && (
                          <div className="text-sm font-semibold text-zinc-200 tabular-nums">
                            {formatPrice(job.price)}
                          </div>
                        )}
                        <ChevronRight className="w-4 h-4 text-zinc-600 ml-auto mt-1" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Tomorrow strip — collapsed by default */}
          <section data-testid="my-day-tomorrow">
            <button
              onClick={() => setTomorrowOpen(v => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300">
                Tomorrow · {tomorrowJobs.length} {tomorrowJobs.length === 1 ? "job" : "jobs"}
              </h2>
              {tomorrowOpen ? (
                <ChevronDown className="w-4 h-4 text-zinc-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-500" />
              )}
            </button>
            {tomorrowOpen && (
              <div className="mt-3 space-y-2">
                {tomorrowJobs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-4 text-center text-xs text-zinc-500">
                    Nothing scheduled for tomorrow.
                  </div>
                ) : (
                  tomorrowJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => setDrawerJobId(String(job.id))}
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900 p-3 text-left transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-zinc-500 mb-0.5 tabular-nums">
                            {formatTime(job.scheduled_at)}
                          </div>
                          <div className="text-sm text-zinc-200 truncate">
                            {job.customer_first_name || "Customer"}
                            {job.service_type ? ` · ${job.service_type}` : ""}
                          </div>
                        </div>
                        {job.price != null && (
                          <div className="text-xs text-zinc-400 tabular-nums shrink-0">
                            {formatPrice(job.price)}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <JobDetailDrawer
        jobId={drawerJobId}
        open={drawerJobId !== null}
        onClose={() => setDrawerJobId(null)}
        onJobUpdated={refresh}
      />

      <QuoteBuilderSheet
        quoteId={quoteSheetId}
        open={quoteSheetId !== null}
        onClose={() => setQuoteSheetId(null)}
        onSaved={refresh}
      />
    </>
  )
}
