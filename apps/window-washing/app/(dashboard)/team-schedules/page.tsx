"use client"

/**
 * /team-schedules — Read-only weekly view of all team-lead crews.
 *
 * Salesman use case: before promising a customer a date, glance at the
 * week to see which crews are open and which are stacked. No drag-drop,
 * no edits — pure visibility.
 *
 * Reuses the existing /api/actions/schedule-day endpoint (one fetch per
 * day, all 7 days in parallel).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { ChevronLeft, ChevronRight, Loader2, Clock, MapPin } from "lucide-react"
import Link from "next/link"
import { parseCityZip } from "@/lib/address-utils"

interface ScheduleJob {
  id: number
  customer_name: string
  address: string
  time: string | null
  services: string[]
  price: number
  status: string
}

interface CrewSchedule {
  team_lead_id: number | null
  team_lead_name: string
  first_job_town: string
  daily_revenue: number
  jobs: ScheduleJob[]
  members?: string[]
}

interface DaySchedule {
  date: string
  crews: CrewSchedule[]
  totalRevenue: number
  totalJobs: number
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function startOfWeek(d: Date): Date {
  const day = d.getDay() // Sunday = 0
  const diff = d.getDate() - day
  const start = new Date(d)
  start.setDate(diff)
  start.setHours(0, 0, 0, 0)
  return start
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(d.getDate() + n)
  return next
}

function formatMoney(n: number): string {
  if (!n) return "$0"
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function formatDayHeader(d: Date): { day: string; date: string } {
  return {
    day: d.toLocaleDateString(undefined, { weekday: "short" }),
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }
}

export default function TeamSchedulesPage() {
  const { authenticated } = useAuth()
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [weekData, setWeekData] = useState<DaySchedule[]>([])
  const [loading, setLoading] = useState(true)

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  )
  const todayStr = toDateStr(new Date())

  const fetchWeek = useCallback(async () => {
    setLoading(true)
    try {
      const fetches = weekDays.map(async (d) => {
        const dateStr = toDateStr(d)
        try {
          const res = await fetch(`/api/actions/schedule-day?date=${dateStr}`)
          if (res.ok) {
            const body = await res.json()
            const crews: CrewSchedule[] = body.crews || []
            return {
              date: dateStr,
              crews,
              totalRevenue: crews.reduce((s, c) => s + (c.daily_revenue || 0), 0),
              totalJobs: crews.reduce((s, c) => s + (c.jobs?.length || 0), 0),
            }
          }
        } catch {
          // soft-fail per day
        }
        return { date: dateStr, crews: [], totalRevenue: 0, totalJobs: 0 }
      })
      setWeekData(await Promise.all(fetches))
    } catch {
      setWeekData([])
    } finally {
      setLoading(false)
    }
  }, [weekDays])

  useEffect(() => {
    if (authenticated) fetchWeek()
  }, [authenticated, fetchWeek])

  const goPrev = () => setWeekStart((w) => addDays(w, -7))
  const goNext = () => setWeekStart((w) => addDays(w, 7))
  const goToday = () => setWeekStart(startOfWeek(new Date()))

  const weekRevenue = weekData.reduce((s, d) => s + d.totalRevenue, 0)
  const weekJobs = weekData.reduce((s, d) => s + d.totalJobs, 0)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Schedules</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Read-only week view of every team lead. Use it to spot open
              days before booking a customer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goPrev}
              className="p-2 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToday}
              className="px-3 py-2 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300"
            >
              Today
            </button>
            <button
              onClick={goNext}
              className="p-2 rounded-md border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Week summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="text-zinc-500">Week of</span>
          <span className="font-semibold text-zinc-200">
            {weekStart.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </span>
          <span className="text-zinc-500">·</span>
          <span><span className="text-zinc-400">Jobs:</span> <span className="font-semibold text-zinc-200">{weekJobs}</span></span>
          <span><span className="text-zinc-400">Revenue:</span> <span className="font-semibold text-emerald-300">{formatMoney(weekRevenue)}</span></span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {weekData.map((day, i) => {
              const date = weekDays[i]
              const head = formatDayHeader(date)
              const isToday = day.date === todayStr
              // PRD #13 — fully empty day = green-fill, signals "open slot, book here".
              const isOpen = day.totalJobs === 0
              const dayClass = isOpen
                ? "border-emerald-500/40 bg-emerald-500/10"
                : isToday
                  ? "border-teal-500/40 bg-teal-500/5"
                  : "border-zinc-800 bg-zinc-900/40"
              return (
                <div
                  key={day.date}
                  data-testid="team-schedule-day"
                  data-open={isOpen ? "true" : "false"}
                  className={`rounded-xl border ${dayClass} p-3 min-h-[200px]`}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <div className={`text-xs uppercase tracking-wider font-bold ${
                        isOpen ? "text-emerald-300" : isToday ? "text-teal-300" : "text-zinc-400"
                      }`}>
                        {head.day}
                      </div>
                      <div className="text-sm font-semibold text-zinc-200">{head.date}</div>
                    </div>
                    <div className="text-right text-[10px] text-zinc-500">
                      {day.totalJobs} job{day.totalJobs === 1 ? "" : "s"}
                      {day.totalRevenue > 0 && (
                        <div className="text-emerald-300 font-semibold">{formatMoney(day.totalRevenue)}</div>
                      )}
                    </div>
                  </div>

                  {isOpen ? (
                    <div
                      data-testid="team-schedule-open-slot"
                      className="rounded-md border border-dashed border-emerald-500/40 bg-emerald-500/5 p-4 text-center"
                    >
                      <div className="text-emerald-300 text-xs font-semibold uppercase tracking-wider">
                        Open
                      </div>
                      <div className="text-[11px] text-emerald-200/70 mt-1">
                        No crews booked — safe to promise this day.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {day.crews.map((crew) => (
                        <div
                          key={`${day.date}-${crew.team_lead_id ?? "unassigned"}`}
                          className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-zinc-200 truncate">
                              {crew.team_lead_name || "Unassigned"}
                            </span>
                            {crew.daily_revenue > 0 && (
                              <span className="text-[10px] font-semibold text-emerald-300 shrink-0">
                                {formatMoney(crew.daily_revenue)}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1">
                            {(crew.jobs || []).slice(0, 4).map((job) => {
                              const { city, zip } = parseCityZip(job.address)
                              const cityZip = [city, zip].filter(Boolean).join(" ")
                              return (
                                <div
                                  key={job.id}
                                  data-testid="team-schedule-job-card"
                                  className="text-[11px] text-zinc-300 leading-tight rounded px-1 py-0.5 hover:bg-zinc-800/50"
                                >
                                  <div className="flex items-center gap-1">
                                    {job.time && (
                                      <span className="text-zinc-500 shrink-0">
                                        <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                                        {job.time}
                                      </span>
                                    )}
                                    <span className="truncate">{job.customer_name}</span>
                                  </div>
                                  {cityZip && (
                                    <div className="flex items-center gap-1 text-[10px] text-zinc-500 truncate">
                                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                                      <span className="truncate">{cityZip}</span>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            {(crew.jobs?.length ?? 0) > 4 && (
                              <div className="text-[10px] text-zinc-500">
                                +{(crew.jobs?.length ?? 0) - 4} more
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[10px] text-zinc-600 text-center pt-2">
          Read-only. To book a job onto a crew, see your <Link href="/my-pipeline" className="text-teal-400 hover:underline">pipeline</Link>.
        </p>
      </div>
    </div>
  )
}
