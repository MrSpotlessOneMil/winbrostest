"use client"

/**
 * /my-pipeline — Salesman pipeline.
 *
 * Three columns: Leads (assigned to me, not closed), Quotes (mine, not
 * converted/declined/expired), Jobs (mine, not completed/closed/cancelled).
 *
 * Tap a card → opens the per-customer chat drawer (same component as
 * /my-customers). Quote cards also link out to the quote builder so the
 * salesman can keep working it. Jobs cards show the scheduled date so the
 * salesman knows when the customer is on the calendar.
 */

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { CustomerThreadDrawer } from "@/components/dashboard/customer-thread-drawer"
import { Loader2, MessageSquare, MapPin, ExternalLink, DollarSign, Clock } from "lucide-react"
import Link from "next/link"

interface PipelineLead {
  id: number
  customer_id: number | null
  name: string | null
  phone_number: string | null
  status: string | null
  updated_at: string | null
  source: string | null
}

interface PipelineQuote {
  id: number
  customer_id: number | null
  customer_name: string | null
  phone_number: string | null
  address: string | null
  status: string | null
  total_price: number | null
  updated_at: string | null
  appointment_job_id: number | null
}

interface PipelineJob {
  id: number
  customer_id: number | null
  customer_name: string | null
  phone_number: string | null
  address: string | null
  service_type: string | null
  status: string | null
  date: string | null
  scheduled_at: string | null
  total_price: number | null
}

interface PipelineResponse {
  leads: PipelineLead[]
  quotes: PipelineQuote[]
  jobs: PipelineJob[]
}

interface ChatTarget {
  phoneNumber: string
  displayName: string | undefined
  context: { label: string; value: string }[]
}

function formatPhone(phone: string | null): string {
  if (!phone) return "—"
  const digits = phone.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function formatMoney(n: number | null): string {
  if (n == null) return "—"
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function MyPipelinePage() {
  const { isAdmin, isSalesman, portalToken } = useAuth()
  const [data, setData] = useState<PipelineResponse>({ leads: [], quotes: [], jobs: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatTarget, setChatTarget] = useState<ChatTarget | null>(null)

  const fetchPipeline = useCallback(async () => {
    if (!portalToken) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crew/${portalToken}/pipeline`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || `HTTP ${res.status}`)
        setData({ leads: [], quotes: [], jobs: [] })
        return
      }
      const body = (await res.json()) as PipelineResponse
      setData({
        leads: body.leads ?? [],
        quotes: body.quotes ?? [],
        jobs: body.jobs ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
    } finally {
      setLoading(false)
    }
  }, [portalToken])

  useEffect(() => { fetchPipeline() }, [fetchPipeline])

  if (isAdmin) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-xl font-semibold mb-2">My Pipeline</h1>
          <p className="text-sm text-zinc-400">
            This view is for salesmen. As an owner, see <Link href="/quotes" className="text-teal-400 hover:underline">/quotes</Link> for the full pipeline.
          </p>
        </div>
      </div>
    )
  }

  if (!isSalesman) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-xl font-semibold mb-2">My Pipeline</h1>
          <p className="text-sm text-zinc-400">
            Only salesmen have a pipeline view. Go back to <Link href="/my-day" className="text-teal-400 hover:underline">your dashboard</Link>.
          </p>
        </div>
      </div>
    )
  }

  const total = data.leads.length + data.quotes.length + data.jobs.length

  const openChatForLead = (l: PipelineLead) => {
    if (!l.phone_number) return
    setChatTarget({
      phoneNumber: l.phone_number,
      displayName: l.name || undefined,
      context: [{ label: "Status", value: `LEAD · ${l.status ?? "open"}` }],
    })
  }

  const openChatForQuote = (q: PipelineQuote) => {
    if (!q.phone_number) return
    setChatTarget({
      phoneNumber: q.phone_number,
      displayName: q.customer_name || undefined,
      context: [
        ...(q.address ? [{ label: "Address", value: q.address }] : []),
        { label: "Status", value: `QUOTE · ${q.status ?? "open"}` },
        ...(q.total_price != null ? [{ label: "Price", value: formatMoney(q.total_price) }] : []),
      ],
    })
  }

  const openChatForJob = (j: PipelineJob) => {
    if (!j.phone_number) return
    setChatTarget({
      phoneNumber: j.phone_number,
      displayName: j.customer_name || undefined,
      context: [
        ...(j.address ? [{ label: "Address", value: j.address }] : []),
        { label: "Status", value: `JOB · ${j.status ?? "open"}` },
        ...(j.date ? [{ label: "Date", value: formatDate(j.date) }] : []),
        ...(j.total_price != null ? [{ label: "Price", value: formatMoney(j.total_price) }] : []),
      ],
    })
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">My Pipeline</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Every active lead, quote, and job you own. {total} open.
            </p>
          </div>
          <button
            onClick={fetchPipeline}
            disabled={loading}
            className="text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Leads column */}
            <section className="space-y-2">
              <header className="flex items-center justify-between px-1">
                <h2 className="text-xs uppercase tracking-wider text-purple-300 font-bold">
                  Leads · {data.leads.length}
                </h2>
              </header>
              {data.leads.length === 0 ? (
                <EmptyColumn label="No open leads tagged to you." />
              ) : (
                data.leads.map((l) => (
                  <button
                    key={`lead-${l.id}`}
                    data-testid="pipeline-lead"
                    onClick={() => openChatForLead(l)}
                    disabled={!l.phone_number}
                    className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 p-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{l.name || "Unnamed lead"}</span>
                      <span className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/15 text-purple-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        {l.status || "lead"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{formatPhone(l.phone_number)}</div>
                    {l.source && (
                      <div className="mt-1 text-[10px] text-zinc-600 uppercase tracking-wider">via {l.source}</div>
                    )}
                  </button>
                ))
              )}
            </section>

            {/* Quotes column */}
            <section className="space-y-2">
              <header className="flex items-center justify-between px-1">
                <h2 className="text-xs uppercase tracking-wider text-amber-300 font-bold">
                  Quotes · {data.quotes.length}
                </h2>
              </header>
              {data.quotes.length === 0 ? (
                <EmptyColumn label="No open quotes." />
              ) : (
                data.quotes.map((q) => (
                  <div
                    key={`quote-${q.id}`}
                    data-testid="pipeline-quote"
                    className="rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 p-3 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => openChatForQuote(q)}
                        disabled={!q.phone_number}
                        className="font-semibold truncate text-left flex-1 hover:underline disabled:no-underline disabled:opacity-60"
                      >
                        {q.customer_name || "Customer"}
                      </button>
                      <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 text-amber-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        {q.status || "quote"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                      {q.total_price != null && (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <DollarSign className="w-3 h-3" />
                          {formatMoney(q.total_price)}
                        </span>
                      )}
                      <span>{formatPhone(q.phone_number)}</span>
                    </div>
                    {q.address && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{q.address}</span>
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        onClick={() => openChatForQuote(q)}
                        disabled={!q.phone_number}
                        className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-60"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Text
                      </button>
                      <Link
                        href={`/quotes/${q.id}`}
                        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                      >
                        Open Quote
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </section>

            {/* Jobs column */}
            <section className="space-y-2">
              <header className="flex items-center justify-between px-1">
                <h2 className="text-xs uppercase tracking-wider text-teal-300 font-bold">
                  Jobs · {data.jobs.length}
                </h2>
              </header>
              {data.jobs.length === 0 ? (
                <EmptyColumn label="No open jobs assigned to you yet." />
              ) : (
                data.jobs.map((j) => (
                  <button
                    key={`job-${j.id}`}
                    data-testid="pipeline-job"
                    onClick={() => openChatForJob(j)}
                    disabled={!j.phone_number}
                    className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 p-3 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold truncate">{j.customer_name || "Customer"}</span>
                      <span className="shrink-0 rounded-full border border-teal-500/30 bg-teal-500/15 text-teal-300 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        {j.status || "job"}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(j.date)}
                      </span>
                      {j.total_price != null && (
                        <span className="inline-flex items-center gap-1 text-emerald-300">
                          <DollarSign className="w-3 h-3" />
                          {formatMoney(j.total_price)}
                        </span>
                      )}
                    </div>
                    {j.address && (
                      <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{j.address}</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </section>
          </div>
        )}
      </div>

      <CustomerThreadDrawer
        open={chatTarget !== null}
        onClose={() => setChatTarget(null)}
        phoneNumber={chatTarget?.phoneNumber}
        displayName={chatTarget?.displayName}
        context={chatTarget?.context ?? []}
      />
    </div>
  )
}

function EmptyColumn({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center">
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  )
}
