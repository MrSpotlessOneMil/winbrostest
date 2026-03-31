"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, DollarSign, CalendarCheck, Users, Phone, ChevronDown, MapPin, Clock, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState } from "react"
import type { ApiResponse, DailyMetrics } from "@/lib/types"
import { SlidingNumber } from "@/components/ui/sliding-number"
import { CustomerThreadDrawer } from "./customer-thread-drawer"

function pct(n: number, d: number): number {
  if (!d) return 0
  return Math.round((n / d) * 100)
}

function computeChange(today: number, yesterday: number): { change: string; trend: "up" | "down" | "neutral" } {
  if (yesterday === 0 && today === 0) return { change: "No change", trend: "neutral" }
  if (yesterday === 0) return { change: "New", trend: "up" }
  const pctChange = Math.round(((today - yesterday) / yesterday) * 100)
  if (pctChange === 0) return { change: "0% vs yesterday", trend: "neutral" }
  if (pctChange > 0) return { change: `+${pctChange}% vs yesterday`, trend: "up" }
  return { change: `${pctChange}% vs yesterday`, trend: "down" }
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

// Parse name from lead form_data
function getLeadName(lead: any): string {
  let fd = lead.form_data
  if (typeof fd === "string") {
    try { fd = JSON.parse(fd) } catch { fd = null }
  }
  if (fd) {
    const first = fd.first_name || fd.firstName || fd.name || ""
    const last = fd.last_name || fd.lastName || ""
    if (first || last) return `${first} ${last}`.trim()
  }
  return lead.phone_number ? formatPhone(lead.phone_number) : "Unknown"
}

type DetailItems = {
  completed_jobs: any[]
  scheduled_jobs: any[]
  leads: any[]
  calls: any[]
}

export function StatsCards() {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null)
  const [prevMetrics, setPrevMetrics] = useState<DailyMetrics | null>(null)
  const [items, setItems] = useState<DetailItems | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const [threadPhone, setThreadPhone] = useState<string | null>(null)
  const [threadName, setThreadName] = useState<string>("")
  const [threadContext, setThreadContext] = useState<{ label: string; value: string }[]>([])

  function openThread(phone: string | null, name: string, context: { label: string; value: string }[]) {
    if (!phone) return
    setThreadPhone(phone)
    setThreadName(name)
    setThreadContext(context)
    setThreadOpen(true)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayISO = yesterday.toISOString().split("T")[0]

        const [mRes, pRes] = await Promise.all([
          fetch("/api/metrics?range=today&details=true", { cache: "no-store" }),
          fetch(`/api/metrics?date=${yesterdayISO}&range=specific`, { cache: "no-store" }),
        ])

        const mJson = await mRes.json()
        const pJson = await pRes.json()

        if (!cancelled) {
          setMetrics(mJson.data || null)
          setPrevMetrics(pJson.data || null)
          setItems(mJson.items || null)
        }
      } catch {
        if (!cancelled) {
          setMetrics(null)
          setPrevMetrics(null)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  type StatTrend = "up" | "down" | "neutral"
  type StatItem = {
    key: string
    name: string
    numericValue: number
    numericTarget: number
    prefix?: string
    suffix?: string
    useCommas?: boolean
    change: string
    trend: StatTrend
    icon: typeof DollarSign
    progress: number
  }

  const stats = useMemo((): StatItem[] => {
    const revenue = Number(metrics?.total_revenue || 0)
    const targetRevenue = Number(metrics?.target_revenue || 0)
    const jobsCompleted = Number(metrics?.jobs_completed || 0)
    const jobsScheduled = Number(metrics?.jobs_scheduled || 0)
    const callsHandled = Number(metrics?.calls_handled || 0)
    const leadsIn = Number(metrics?.leads_in || 0)

    const prevRevenue = Number(prevMetrics?.total_revenue || 0)
    const prevJobsCompleted = Number(prevMetrics?.jobs_completed || 0)
    const prevCallsHandled = Number(prevMetrics?.calls_handled || 0)
    const prevLeadsIn = Number(prevMetrics?.leads_in || 0)

    const revenueChange = computeChange(revenue, prevRevenue)
    const jobsChange = computeChange(jobsCompleted, prevJobsCompleted)
    const leadsChange = computeChange(leadsIn, prevLeadsIn)
    const callsChange = computeChange(callsHandled, prevCallsHandled)

    return [
      {
        key: "revenue",
        name: "Today's Revenue",
        numericValue: revenue,
        numericTarget: targetRevenue,
        prefix: "$",
        useCommas: true,
        change: revenueChange.change,
        trend: revenueChange.trend,
        icon: DollarSign,
        progress: pct(revenue, targetRevenue),
      },
      {
        key: "jobs",
        name: "Jobs Completed",
        numericValue: jobsCompleted,
        numericTarget: jobsScheduled || 0,
        change: jobsChange.change,
        trend: jobsChange.trend,
        icon: CalendarCheck,
        progress: pct(jobsCompleted, jobsScheduled || 0),
      },
      {
        key: "leads",
        name: "New Leads",
        numericValue: leadsIn,
        numericTarget: prevLeadsIn || leadsIn,
        change: leadsChange.change,
        trend: leadsChange.trend,
        icon: Users,
        progress: prevLeadsIn > 0 ? pct(leadsIn, prevLeadsIn) : (leadsIn > 0 ? 100 : 0),
      },
    ]
  }, [metrics, prevMetrics])

  const toggle = (key: string) => setExpanded(prev => prev === key ? null : key)

  return (
    <>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((stat, i) => {
        const isExpanded = expanded === stat.key
        return (
          <Card
            key={stat.key}
            className={cn(
              `relative overflow-hidden stat-card-border hover-glow-border stagger-${i + 1} transition-all duration-200`,
              isExpanded && "ring-1 ring-primary/30",
            )}
          >
            <CardContent className="p-0">
              {/* Clickable stat header */}
              <button
                onClick={() => toggle(stat.key)}
                className="w-full p-4 text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-400">{stat.name}</p>
                    <span className="text-2xl font-bold text-violet-300 flex items-center">
                      {stat.prefix}<SlidingNumber value={stat.numericValue} useCommas={stat.useCommas} />{stat.suffix}
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 icon-glow text-primary">
                      <stat.icon className="h-5 w-5" />
                    </div>
                    {stat.numericValue > 0 && (
                      <ChevronDown className={cn(
                        "h-3.5 w-3.5 text-zinc-600 transition-transform duration-200",
                        isExpanded && "rotate-180 text-zinc-400"
                      )} />
                    )}
                  </div>
                </div>

              </button>

              {/* Expanded detail list */}
              {isExpanded && items && (
                <div className="border-t border-zinc-800/60 max-h-[240px] overflow-y-auto">
                  {stat.key === "revenue" && (
                    items.completed_jobs.length > 0 ? (
                      <div className="divide-y divide-zinc-800/30">
                        {items.completed_jobs.map((job: any, j: number) => (
                          <button
                            key={job.id || j}
                            onClick={(e) => { e.stopPropagation(); openThread(job.phone_number, job.service_type || "Cleaning", [
                              ...(job.address ? [{ label: "Address", value: job.address }] : []),
                              { label: "Price", value: `$${job.price || 0}` },
                              { label: "Status", value: job.status || "completed" },
                            ]) }}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-800/40 transition-colors text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-200 truncate">{job.service_type || "Cleaning"}</p>
                              {job.address && (
                                <p className="text-[11px] text-zinc-500 truncate flex items-center gap-1">
                                  <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                                  {job.address}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-semibold text-emerald-400">${job.price || 0}</span>
                              <MessageSquare className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 py-3 text-xs text-zinc-600">No completed jobs yet today</p>
                    )
                  )}

                  {stat.key === "jobs" && (
                    [...(items.completed_jobs || []), ...(items.scheduled_jobs || [])].length > 0 ? (
                      <div className="divide-y divide-zinc-800/30">
                        {[...(items.completed_jobs || []), ...(items.scheduled_jobs || [])].map((job: any, j: number) => (
                          <button
                            key={job.id || j}
                            onClick={(e) => { e.stopPropagation(); openThread(job.phone_number, job.service_type || "Cleaning", [
                              ...(job.address ? [{ label: "Address", value: job.address }] : []),
                              { label: "Price", value: `$${job.price || 0}` },
                              { label: "Status", value: job.status || "scheduled" },
                            ]) }}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-800/40 transition-colors text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-200 truncate">{job.service_type || "Cleaning"}</p>
                              {job.address && (
                                <p className="text-[11px] text-zinc-500 truncate flex items-center gap-1">
                                  <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                                  {job.address}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                job.status === "completed" ? "bg-emerald-400/10 text-emerald-400"
                                  : job.status === "in_progress" ? "bg-blue-400/10 text-blue-400"
                                  : "bg-yellow-400/10 text-yellow-400"
                              )}>
                                {job.status}
                              </span>
                              <span className="text-xs text-zinc-400">${job.price || 0}</span>
                              <MessageSquare className="h-3 w-3 text-zinc-600" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 py-3 text-xs text-zinc-600">No jobs scheduled today</p>
                    )
                  )}

                  {stat.key === "leads" && (
                    items.leads.length > 0 ? (
                      <div className="divide-y divide-zinc-800/30">
                        {items.leads.map((lead: any, j: number) => (
                          <button
                            key={lead.id || j}
                            onClick={(e) => { e.stopPropagation(); openThread(lead.phone_number, getLeadName(lead), [
                              ...(lead.source ? [{ label: "Source", value: lead.source }] : []),
                              { label: "Status", value: lead.status || "new" },
                            ]) }}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-800/40 transition-colors text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-200 truncate">{getLeadName(lead)}</p>
                              {lead.phone_number && (
                                <p className="text-[11px] text-zinc-500">{formatPhone(lead.phone_number)}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {lead.source && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400 font-medium">
                                  {lead.source}
                                </span>
                              )}
                              <span className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                lead.status === "booked" ? "bg-emerald-400/10 text-emerald-400"
                                  : lead.status === "qualified" ? "bg-cyan-400/10 text-cyan-400"
                                  : lead.status === "contacted" ? "bg-yellow-400/10 text-yellow-400"
                                  : "bg-blue-400/10 text-blue-400"
                              )}>
                                {lead.status || "new"}
                              </span>
                              <MessageSquare className="h-3 w-3 text-zinc-600" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 py-3 text-xs text-zinc-600">No new leads today</p>
                    )
                  )}

                  {stat.key === "calls" && (
                    items.calls.length > 0 ? (
                      <div className="divide-y divide-zinc-800/30">
                        {items.calls.map((call: any, j: number) => (
                          <button
                            key={call.id || j}
                            onClick={(e) => { e.stopPropagation(); openThread(call.phone_number, call.caller_name || (call.phone_number ? formatPhone(call.phone_number) : "Unknown"), [
                              { label: "Direction", value: call.direction === "inbound" ? "Inbound" : "Outbound" },
                              ...(call.duration_seconds != null ? [{ label: "Duration", value: formatDuration(call.duration_seconds) }] : []),
                            ]) }}
                            className="w-full px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-zinc-800/40 transition-colors text-left"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-zinc-200 truncate">
                                {call.caller_name || (call.phone_number ? formatPhone(call.phone_number) : "Unknown")}
                              </p>
                              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                                <span className={call.direction === "inbound" ? "text-blue-400" : "text-amber-400"}>
                                  {call.direction === "inbound" ? "Inbound" : "Outbound"}
                                </span>
                                {call.duration_seconds != null && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="h-2.5 w-2.5" />
                                    {formatDuration(call.duration_seconds)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[11px] text-zinc-600">
                                {call.created_at
                                  ? new Date(call.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                                  : ""}
                              </span>
                              <MessageSquare className="h-3 w-3 text-zinc-600" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 py-3 text-xs text-zinc-600">No calls today</p>
                    )
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
    <CustomerThreadDrawer
      open={threadOpen}
      onClose={() => setThreadOpen(false)}
      phoneNumber={threadPhone}
      displayName={threadName}
      context={threadContext}
    />
    </>
  )
}
