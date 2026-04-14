"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  Calendar, ChevronLeft, ChevronRight, Loader2,
  ChevronDown, Check, CalendarPlus, X, Users, DollarSign,
} from "lucide-react"

/* ══════════════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════════════ */

interface PlanJob {
  id: number
  customer_name: string
  address: string
  plan_type: string
  target_week: number
  status: string
  price?: number | null
}

interface CustomerRow {
  customerId: string
  customerName: string
  address: string
  planType: string
  jobs: Record<number, PlanJob[]>  // month -> jobs
}

/* ══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ══════════════════════════════════════════════════════════════════════════ */

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  quarterly: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/20" },
  triannual: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/20" },
  biannual: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20" },
  annual: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  monthly: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/20" },
}

function getPlanColor(planType: string) {
  const key = planType.toLowerCase().replace(/[-_\s]/g, "")
  return PLAN_COLORS[key] || { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/20" }
}

function humanizePlan(val: string): string {
  return val.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export default function ServicePlanSchedulePage() {
  const { user } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [jobsByMonth, setJobsByMonth] = useState<Record<number, PlanJob[]>>({})

  // Scheduling inline state
  const [schedulingId, setSchedulingId] = useState<number | null>(null)
  const [scheduleDate, setScheduleDate] = useState("")
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [scheduleMsg, setScheduleMsg] = useState<{ id: number; text: string; ok: boolean } | null>(null)

  // UI state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set(["quarterly", "triannual", "biannual", "annual", "monthly"]))

  // Current month for highlighting
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()

  /* ── Data fetch ── */
  useEffect(() => {
    async function loadJobs() {
      setLoading(true)
      try {
        const res = await fetch(`/api/actions/service-plan-jobs?year=${year}`)
        if (res.ok) {
          setJobsByMonth(await res.json())
        }
      } catch {
        setJobsByMonth({})
      }
      setLoading(false)
    }
    loadJobs()
  }, [year])

  const reloadJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/actions/service-plan-jobs?year=${year}`)
      if (res.ok) {
        setJobsByMonth(await res.json())
      }
    } catch {
      // silent
    }
  }, [year])

  /* ── Schedule action ── */
  async function handleSchedule(jobId: number) {
    if (!scheduleDate) return
    setSubmittingId(jobId)
    setScheduleMsg(null)
    try {
      const res = await fetch("/api/actions/service-plan-jobs/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planJobId: jobId, targetDate: scheduleDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to schedule")
      }
      setScheduleMsg({ id: jobId, text: `Scheduled! Job #${data.job_id}`, ok: true })
      setSchedulingId(null)
      setScheduleDate("")
      setTimeout(() => setScheduleMsg(null), 3000)
      reloadJobs()
    } catch (err: unknown) {
      setScheduleMsg({
        id: jobId,
        text: err instanceof Error ? err.message : "Schedule failed",
        ok: false,
      })
      setTimeout(() => setScheduleMsg(null), 4000)
    } finally {
      setSubmittingId(null)
    }
  }

  /* ── Build customer rows grouped by plan type ── */
  const { customerRows, planTypes, stats } = useMemo(() => {
    const rowMap = new Map<string, CustomerRow>()

    for (const [monthStr, jobs] of Object.entries(jobsByMonth)) {
      const month = Number(monthStr)
      for (const job of jobs) {
        const key = `${job.customer_name}|${job.plan_type}`
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            customerId: key,
            customerName: job.customer_name,
            address: job.address,
            planType: job.plan_type,
            jobs: {},
          })
        }
        const row = rowMap.get(key)!
        if (!row.jobs[month]) row.jobs[month] = []
        row.jobs[month].push(job)
      }
    }

    const rows = Array.from(rowMap.values()).sort((a, b) =>
      a.planType.localeCompare(b.planType) || a.customerName.localeCompare(b.customerName)
    )

    // Unique plan types
    const types = [...new Set(rows.map(r => r.planType))].sort()

    // Stats
    let totalUnscheduled = 0
    let totalScheduled = 0
    let totalRevenue = 0
    const revenueByMonth: Record<number, number> = {}
    const unscheduledByMonth: Record<number, number> = {}
    const scheduledByMonth: Record<number, number> = {}

    for (let m = 1; m <= 12; m++) {
      revenueByMonth[m] = 0
      unscheduledByMonth[m] = 0
      scheduledByMonth[m] = 0
    }

    for (const [monthStr, jobs] of Object.entries(jobsByMonth)) {
      const month = Number(monthStr)
      for (const job of jobs) {
        if (job.status === "unscheduled") {
          totalUnscheduled++
          unscheduledByMonth[month]++
        } else {
          totalScheduled++
          scheduledByMonth[month]++
        }
        const price = job.price || 0
        totalRevenue += price
        revenueByMonth[month] += price
      }
    }

    return {
      customerRows: rows,
      planTypes: types,
      stats: { totalUnscheduled, totalScheduled, totalRevenue, revenueByMonth, unscheduledByMonth, scheduledByMonth },
    }
  }, [jobsByMonth])

  /* ── Toggles ── */
  const toggleRow = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const togglePlan = (planType: string) => {
    setExpandedPlans(prev => {
      const next = new Set(prev)
      if (next.has(planType)) next.delete(planType)
      else next.add(planType)
      return next
    })
  }

  /* ── Render ── */
  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white">Service Plan Scheduling</h1>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
              Admin View
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            {stats.totalUnscheduled > 0 && (
              <span className="text-amber-400 font-medium">{stats.totalUnscheduled} unscheduled</span>
            )}
            {stats.totalUnscheduled > 0 && stats.totalScheduled > 0 && " / "}
            {stats.totalScheduled > 0 && (
              <span className="text-green-400 font-medium">{stats.totalScheduled} scheduled</span>
            )}
            {stats.totalRevenue > 0 && (
              <span className="text-zinc-500"> &middot; ${stats.totalRevenue.toLocaleString()} total</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setYear(currentYear); setExpandedRows(new Set()); }}
            className="text-xs text-blue-400 font-medium hover:underline cursor-pointer"
          >
            This Year
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear(y => y - 1)}
              className="size-7 rounded-md flex items-center justify-center hover:bg-zinc-800 text-zinc-400 cursor-pointer"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-bold text-white min-w-[3rem] text-center">{year}</span>
            <button
              onClick={() => setYear(y => y + 1)}
              className="size-7 rounded-md flex items-center justify-center hover:bg-zinc-800 text-zinc-400 cursor-pointer"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-6 animate-spin text-zinc-500" />
        </div>
      ) : customerRows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-zinc-500">
          <Calendar className="size-10 mb-3 text-zinc-600" />
          <p className="text-sm font-medium">No service plan jobs for {year}</p>
          <p className="text-xs text-zinc-600 mt-1">Service plan jobs will appear here once created</p>
        </div>
      ) : (
        /* ── Horizontal scrolling table ── */
        <div className="flex-1 overflow-auto">
          <div className="min-w-[1200px]">
            {/* ── Sticky month headers ── */}
            <div className="sticky top-0 z-20 bg-zinc-950 border-b border-zinc-800">
              <div className="flex">
                {/* Left column header */}
                <div className="w-[280px] shrink-0 px-3 py-2 border-r border-zinc-800">
                  <div className="flex items-center gap-2">
                    <Users className="size-3.5 text-zinc-500" />
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Customer / Plan</span>
                  </div>
                </div>
                {/* Month columns */}
                {MONTH_SHORT.map((name, i) => {
                  const month = i + 1
                  const isCurrentMonth = year === currentYear && month === currentMonth
                  const unscheduledCount = stats.unscheduledByMonth[month] || 0
                  const scheduledCount = stats.scheduledByMonth[month] || 0
                  return (
                    <div
                      key={month}
                      className={`flex-1 min-w-[90px] px-2 py-2 border-r border-zinc-800 text-center
                        ${isCurrentMonth ? "bg-blue-500/5 ring-1 ring-inset ring-blue-500/20" : ""}`}
                    >
                      <div className={`text-[11px] font-bold ${isCurrentMonth ? "text-blue-400" : "text-zinc-300"}`}>
                        {name}
                      </div>
                      <div className="flex items-center justify-center gap-1.5 mt-0.5">
                        {unscheduledCount > 0 && (
                          <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1 rounded">
                            {unscheduledCount}
                          </span>
                        )}
                        {scheduledCount > 0 && (
                          <span className="text-[9px] font-semibold text-green-400 bg-green-500/10 px-1 rounded">
                            {scheduledCount}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Plan type groups ── */}
            {planTypes.map(planType => {
              const planColor = getPlanColor(planType)
              const isPlanExpanded = expandedPlans.has(planType)
              const rowsForPlan = customerRows.filter(r => r.planType === planType)
              const planUnscheduled = rowsForPlan.reduce((sum, row) => {
                return sum + Object.values(row.jobs).flat().filter(j => j.status === "unscheduled").length
              }, 0)
              const planScheduled = rowsForPlan.reduce((sum, row) => {
                return sum + Object.values(row.jobs).flat().filter(j => j.status !== "unscheduled").length
              }, 0)

              return (
                <div key={planType}>
                  {/* Plan type group header */}
                  <button
                    onClick={() => togglePlan(planType)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 hover:bg-zinc-900/50 cursor-pointer ${planColor.bg}`}
                  >
                    <ChevronDown className={`size-3.5 text-zinc-500 transition-transform ${isPlanExpanded ? "rotate-0" : "-rotate-90"}`} />
                    <span className={`text-xs font-bold ${planColor.text}`}>
                      {humanizePlan(planType)}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      {rowsForPlan.length} customer{rowsForPlan.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex-1" />
                    {planUnscheduled > 0 && (
                      <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                        {planUnscheduled} unscheduled
                      </span>
                    )}
                    {planScheduled > 0 && (
                      <span className="text-[9px] font-semibold text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                        {planScheduled} scheduled
                      </span>
                    )}
                  </button>

                  {/* Customer rows within this plan type */}
                  {isPlanExpanded && rowsForPlan.map(row => {
                    const isRowExpanded = expandedRows.has(row.customerId)
                    const allJobs = Object.values(row.jobs).flat()
                    const hasUnscheduled = allJobs.some(j => j.status === "unscheduled")

                    return (
                      <div key={row.customerId} className="border-b border-zinc-800/50">
                        {/* Customer row */}
                        <div className="flex">
                          {/* Left: customer info */}
                          <div className="w-[280px] shrink-0 border-r border-zinc-800/50">
                            <button
                              onClick={() => toggleRow(row.customerId)}
                              className={`w-full text-left px-3 py-2 hover:bg-zinc-900/30 cursor-pointer flex items-center gap-2
                                ${hasUnscheduled ? "bg-amber-500/[0.03]" : ""}`}
                            >
                              <ChevronDown
                                className={`size-3 text-zinc-600 transition-transform shrink-0 ${isRowExpanded ? "rotate-0" : "-rotate-90"}`}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-semibold text-white truncate">
                                  {row.customerName}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">{row.address}</div>
                              </div>
                            </button>
                          </div>

                          {/* Month cells */}
                          {Array.from({ length: 12 }, (_, i) => {
                            const month = i + 1
                            const monthJobs = row.jobs[month] || []
                            const isCurrentMonth = year === currentYear && month === currentMonth
                            const unscheduled = monthJobs.filter(j => j.status === "unscheduled")
                            const scheduled = monthJobs.filter(j => j.status !== "unscheduled")

                            return (
                              <div
                                key={month}
                                className={`flex-1 min-w-[90px] px-1 py-1.5 border-r border-zinc-800/30
                                  ${isCurrentMonth ? "bg-blue-500/[0.03]" : ""}
                                  ${monthJobs.length === 0 ? "" : ""}`}
                              >
                                {monthJobs.length === 0 ? (
                                  <div className="h-full flex items-center justify-center">
                                    <span className="text-zinc-800 text-[10px]">&mdash;</span>
                                  </div>
                                ) : (
                                  <div className="space-y-0.5">
                                    {scheduled.map(job => (
                                      <div
                                        key={job.id}
                                        className="rounded px-1.5 py-1 bg-green-500/10 border border-green-500/20 text-[10px]"
                                      >
                                        <div className="flex items-center gap-1">
                                          <Check className="size-2.5 text-green-400 shrink-0" />
                                          <span className="text-green-400 font-medium truncate">Wk {job.target_week}</span>
                                        </div>
                                        {scheduleMsg?.id === job.id && (
                                          <p className={`text-[9px] mt-0.5 ${scheduleMsg.ok ? "text-green-400" : "text-red-400"}`}>
                                            {scheduleMsg.text}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                    {unscheduled.map(job => (
                                      <div key={job.id} className="space-y-0.5">
                                        <div className="rounded px-1.5 py-1 bg-amber-500/10 border border-amber-500/20 text-[10px]">
                                          <div className="flex items-center justify-between gap-0.5">
                                            <span className="text-amber-400 font-medium truncate">Wk {job.target_week}</span>
                                            {schedulingId !== job.id && (
                                              <button
                                                onClick={() => {
                                                  setSchedulingId(job.id)
                                                  const targetDay = ((job.target_week - 1) * 7) + 1
                                                  const d = new Date(year, month - 1, Math.min(targetDay, 28))
                                                  setScheduleDate(d.toISOString().split("T")[0])
                                                }}
                                                className="text-amber-400 hover:text-amber-300 shrink-0 cursor-pointer"
                                                title="Schedule"
                                              >
                                                <CalendarPlus className="size-3" />
                                              </button>
                                            )}
                                          </div>
                                        </div>

                                        {/* Inline scheduler */}
                                        {schedulingId === job.id && (
                                          <div className="flex items-center gap-1 px-0.5">
                                            <input
                                              type="date"
                                              value={scheduleDate}
                                              onChange={(e) => setScheduleDate(e.target.value)}
                                              className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-white focus:outline-none focus:border-zinc-500 w-full min-w-0"
                                            />
                                            <button
                                              onClick={() => handleSchedule(job.id)}
                                              disabled={submittingId === job.id || !scheduleDate}
                                              className="p-0.5 rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50 shrink-0 cursor-pointer"
                                              title="Confirm"
                                            >
                                              {submittingId === job.id ? (
                                                <Loader2 className="size-3 animate-spin" />
                                              ) : (
                                                <Check className="size-3" />
                                              )}
                                            </button>
                                            <button
                                              onClick={() => { setSchedulingId(null); setScheduleDate("") }}
                                              className="p-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white shrink-0 cursor-pointer"
                                              title="Cancel"
                                            >
                                              <X className="size-3" />
                                            </button>
                                          </div>
                                        )}

                                        {/* Status message */}
                                        {scheduleMsg?.id === job.id && (
                                          <p className={`text-[9px] px-1 ${scheduleMsg.ok ? "text-green-400" : "text-red-400"}`}>
                                            {scheduleMsg.text}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>

                        {/* Expanded row detail */}
                        {isRowExpanded && (
                          <div className="flex bg-zinc-900/30">
                            <div className="w-[280px] shrink-0 border-r border-zinc-800/50 px-3 py-2">
                              <div className="text-[10px] text-zinc-500 space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-semibold px-1.5 py-0.5 rounded border ${planColor.bg} ${planColor.text} ${planColor.border}`}>
                                    {humanizePlan(row.planType)}
                                  </span>
                                </div>
                                <div className="truncate">{row.address}</div>
                                <div className="text-zinc-600">
                                  {allJobs.length} total job{allJobs.length !== 1 ? "s" : ""}
                                  {" / "}
                                  {allJobs.filter(j => j.status === "unscheduled").length} unscheduled
                                </div>
                              </div>
                            </div>
                            {/* Expanded month cells with full details */}
                            {Array.from({ length: 12 }, (_, i) => {
                              const month = i + 1
                              const monthJobs = row.jobs[month] || []
                              const isCurrentMonth = year === currentYear && month === currentMonth
                              return (
                                <div
                                  key={month}
                                  className={`flex-1 min-w-[90px] px-1 py-1.5 border-r border-zinc-800/30
                                    ${isCurrentMonth ? "bg-blue-500/[0.03]" : ""}`}
                                >
                                  {monthJobs.length > 0 && (
                                    <div className="space-y-1">
                                      {monthJobs.map(job => (
                                        <div
                                          key={job.id}
                                          className={`rounded p-1.5 text-[9px] border ${
                                            job.status === "unscheduled"
                                              ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                                              : "bg-green-500/10 border-green-500/20 text-green-300"
                                          }`}
                                        >
                                          <div className="font-semibold">Week {job.target_week}</div>
                                          <div className="text-zinc-500 truncate">{job.address}</div>
                                          <div className={`font-bold mt-0.5 ${job.status === "unscheduled" ? "text-amber-400" : "text-green-400"}`}>
                                            {job.status === "unscheduled" ? "Needs scheduling" : "Scheduled"}
                                          </div>
                                          {job.price != null && job.price > 0 && (
                                            <div className="text-zinc-400">${job.price.toLocaleString()}</div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            {/* ── Revenue totals row ── */}
            <div className="sticky bottom-0 z-20 bg-zinc-950 border-t border-zinc-700">
              <div className="flex">
                <div className="w-[280px] shrink-0 px-3 py-2 border-r border-zinc-800">
                  <div className="flex items-center gap-2">
                    <DollarSign className="size-3.5 text-green-400" />
                    <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">Monthly Revenue</span>
                  </div>
                </div>
                {Array.from({ length: 12 }, (_, i) => {
                  const month = i + 1
                  const revenue = stats.revenueByMonth[month] || 0
                  const isCurrentMonth = year === currentYear && month === currentMonth
                  return (
                    <div
                      key={month}
                      className={`flex-1 min-w-[90px] px-2 py-2 border-r border-zinc-800/30 text-center
                        ${isCurrentMonth ? "bg-blue-500/[0.03]" : ""}`}
                    >
                      {revenue > 0 ? (
                        <span className="text-[11px] font-bold text-green-400">
                          ${revenue.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-700">&mdash;</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
