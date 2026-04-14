"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, ChevronDown,
  Clock, MapPin,
} from "lucide-react"

/* ─── Types ─── */
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
  members: string[]
}

interface SalesmanAppointment {
  id: number
  salesman_name: string
  customer_name: string
  address: string
  time: string
  type: string
}

interface WeekDayData {
  date: string
  crews: CrewSchedule[]
  salesmanAppointments: SalesmanAppointment[]
  totalRevenue: number
  totalJobs: number
}

/* ─── Helpers ─── */
function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function extractTown(address: string): string {
  if (!address) return ""
  const parts = address.split(",")
  if (parts.length >= 2) return parts[parts.length - 2].trim()
  return address.split(" ").slice(-2).join(" ")
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  completed: { bg: "bg-green-500/15 border-green-500/30", text: "text-green-400" },
  in_progress: { bg: "bg-amber-500/15 border-amber-500/30", text: "text-amber-400" },
  scheduled: { bg: "bg-blue-500/15 border-blue-500/30", text: "text-blue-400" },
  confirmed: { bg: "bg-blue-500/15 border-blue-500/30", text: "text-blue-400" },
  pending: { bg: "bg-purple-500/15 border-purple-500/30", text: "text-purple-400" },
  quoted: { bg: "bg-purple-500/15 border-purple-500/30", text: "text-purple-400" },
}

function getJobColor(job: ScheduleJob): { card: string; accent: string } {
  // Service plan jobs = green
  if (job.services.some(s => s.toLowerCase().includes("service plan"))) {
    return { card: "bg-green-500/10 border-green-500/25", accent: "text-green-400" }
  }
  // Salesman/estimate = amber/orange
  if (job.services.some(s => s.toLowerCase().includes("estimate") || s.toLowerCase().includes("salesman"))) {
    return { card: "bg-amber-500/10 border-amber-500/25", accent: "text-amber-400" }
  }
  // Regular = teal/blue
  return { card: "bg-teal-500/10 border-teal-500/25", accent: "text-teal-400" }
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

/* ═══ MAIN PAGE ═══ */
export default function SchedulePage() {
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<"week" | "day">("week")
  const [selectedDay, setSelectedDay] = useState(() => toDateStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [weekData, setWeekData] = useState<WeekDayData[]>([])

  // UI state
  const [expandedTLs, setExpandedTLs] = useState<Set<string>>(new Set())

  // Week days
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayStr = toDateStr(new Date())

  // Fetch week data (7 parallel fetches)
  const fetchWeekData = useCallback(async () => {
    setLoading(true)
    try {
      const fetches = weekDays.map(async (day) => {
        const dateStr = toDateStr(day)
        try {
          const res = await fetch(`/api/actions/schedule-day?date=${dateStr}`)
          if (res.ok) {
            const data = await res.json()
            const dayCrews: CrewSchedule[] = data.crews || []
            return {
              date: dateStr,
              crews: dayCrews,
              salesmanAppointments: data.salesmanAppointments || [],
              totalRevenue: dayCrews.reduce((s, c) => s + (c.daily_revenue || 0), 0),
              totalJobs: dayCrews.reduce((s, c) => s + (c.jobs?.length || 0), 0),
            }
          }
        } catch {
          // ignore
        }
        return {
          date: dateStr,
          crews: [],
          salesmanAppointments: [],
          totalRevenue: 0,
          totalJobs: 0,
        }
      })
      setWeekData(await Promise.all(fetches))
    } catch {
      setWeekData([])
    }
    setLoading(false)
  }, [weekDays])

  useEffect(() => {
    fetchWeekData()
  }, [fetchWeekData])

  // Navigation
  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))
  const goToday = () => {
    setWeekStart(getMonday(new Date()))
    setSelectedDay(toDateStr(new Date()))
  }

  // Toggles
  const toggleTL = (key: string) =>
    setExpandedTLs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  // Weekly totals
  const weeklyTotal = useMemo(
    () => weekData.reduce((s, d) => s + d.totalRevenue, 0),
    [weekData]
  )

  // Collect all unique team leads across the week
  const allTeamLeads = useMemo(() => {
    const map = new Map<string, string>()
    for (const day of weekData) {
      for (const crew of day.crews) {
        const key = crew.team_lead_id != null ? String(crew.team_lead_id) : "unassigned"
        if (!map.has(key)) {
          map.set(key, crew.team_lead_name)
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [weekData])

  const monthName = weekStart.toLocaleString("en-US", { month: "long" })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const daysToShow = viewMode === "week" ? weekDays : [weekDays.find(d => toDateStr(d) === selectedDay) || weekDays[0]]

  return (
    <div className="h-full flex flex-col">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground">Scheduling</h1>
          <p className="text-xs text-muted-foreground">{monthName} {weekStart.getFullYear()}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToday} className="text-xs text-primary font-medium hover:underline">Today</button>
          <div className="flex items-center gap-1">
            <button onClick={prevWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted">
              <ChevronLeft className="size-4" />
            </button>
            <button onClick={nextWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden">
            {(["day", "week"] as const).map(v => (
              <button
                key={v}
                onClick={() => { setViewMode(v); if (v === "day" && !selectedDay) setSelectedDay(todayStr) }}
                className={`px-3 py-1 text-[10px] font-bold uppercase ${viewMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >{v}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ CALENDAR GRID ═══ */}
      <div className={`flex-1 overflow-auto grid ${viewMode === "week" ? "grid-cols-7" : "grid-cols-1"} gap-px bg-border`}>
        {daysToShow.map(day => {
          const dateStr = toDateStr(day)
          const isToday = dateStr === todayStr
          const dayData = weekData.find(d => d.date === dateStr)
          const dayCrews = dayData?.crews || []
          const dayAppts = dayData?.salesmanAppointments || []
          const dayTotal = dayData?.totalRevenue || 0
          const dayJobCount = dayData?.totalJobs || 0

          return (
            <div key={dateStr} className={`bg-background flex flex-col ${isToday ? "ring-1 ring-primary/30 ring-inset" : ""}`}>
              {/* Day header */}
              <div className={`px-2 py-1.5 border-b border-border flex items-center justify-between shrink-0 ${isToday ? "bg-primary/5" : ""}`}>
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className={`ml-1 text-sm font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
                    {day.getDate()}
                  </span>
                </div>
                {dayJobCount > 0 && (
                  <span className="text-[9px] text-muted-foreground">{dayJobCount}j</span>
                )}
              </div>

              {/* Day content */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {/* Team Leads */}
                {dayCrews.filter(c => c.team_lead_id != null).map(crew => {
                  const tlKey = `${dateStr}-${crew.team_lead_id}`
                  const isExpanded = expandedTLs.has(tlKey)
                  const crewJobs = crew.jobs || []
                  const crewTotal = crew.daily_revenue || 0

                  return (
                    <div key={tlKey} className="rounded-md">
                      {/* TL Header */}
                      <button
                        onClick={() => toggleTL(tlKey)}
                        className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left"
                      >
                        <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1 rounded">TL</span>
                        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
                          {crew.team_lead_name.split(" ")[0]}
                        </span>
                        {crewJobs.length > 0 && <span className="text-[9px] text-muted-foreground">{crewJobs.length}</span>}
                        <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>

                      {/* Expanded: Job cards */}
                      {isExpanded && (
                        <div className="ml-1 pl-2 border-l border-border space-y-1 mt-1">
                          {crewJobs.map(job => {
                            const colors = getJobColor(job)
                            const statusStyle = STATUS_STYLE[job.status] || STATUS_STYLE.scheduled
                            return (
                              <div
                                key={job.id}
                                onClick={() => { window.location.href = `/jobs?job=${job.id}` }}
                                className={`rounded px-1.5 py-1 border text-[10px] cursor-pointer hover:opacity-80 transition-opacity ${colors.card}`}
                              >
                                <div className="font-bold text-foreground truncate">
                                  {job.customer_name}
                                </div>
                                <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                  <MapPin className="size-2 shrink-0" />
                                  <span className="truncate">{extractTown(job.address)}</span>
                                </div>
                                {job.time && (
                                  <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                    <Clock className="size-2 shrink-0" />
                                    <span>{job.time}</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className={`truncate ${colors.accent}`}>
                                    {job.services[0] || "Job"}
                                  </span>
                                  <span className="font-bold text-foreground">${job.price}</span>
                                </div>
                                <div className={`inline-block mt-0.5 px-1 rounded border text-[8px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
                                  {humanizeStatus(job.status)}
                                </div>
                              </div>
                            )
                          })}
                          {crewJobs.length === 0 && (
                            <p className="text-[9px] text-muted-foreground italic px-1">No jobs</p>
                          )}
                          {crewTotal > 0 && (
                            <p className="text-[9px] font-medium text-muted-foreground pt-1">
                              ${Math.round(crewTotal).toLocaleString()} scheduled
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Salesman Appointments */}
                {dayAppts.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 px-1.5 py-1">
                      <span className="text-[9px] font-bold text-amber-400 bg-amber-500/15 px-1 rounded">S</span>
                      <span className="text-[10px] text-muted-foreground">Appointments</span>
                      <span className="text-[9px] text-muted-foreground ml-auto">{dayAppts.length}</span>
                    </div>
                    <div className="ml-1 pl-2 border-l border-amber-500/20 space-y-1">
                      {dayAppts.map(apt => (
                        <div key={apt.id} className="rounded px-1.5 py-1 border bg-amber-500/10 border-amber-500/25 text-[10px]">
                          <div className="font-bold text-foreground truncate">{apt.customer_name}</div>
                          <div className="text-muted-foreground truncate">{apt.salesman_name}</div>
                          <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                            <Clock className="size-2" />
                            <span>{apt.time}</span>
                            <span className="ml-auto text-amber-400 text-[8px] font-semibold uppercase">{apt.type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unassigned section */}
                {dayCrews.filter(c => c.team_lead_id == null).map(crew => {
                  const uKey = `${dateStr}-unassigned`
                  const isExpanded = expandedTLs.has(uKey)
                  const unJobs = crew.jobs || []

                  if (unJobs.length === 0) return null

                  return (
                    <div key={uKey} className="rounded-md">
                      <button
                        onClick={() => toggleTL(uKey)}
                        className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left"
                      >
                        <span className="text-[9px] font-bold text-red-400 bg-red-500/15 px-1 rounded">!</span>
                        <span className="text-[11px] font-semibold text-red-400 truncate flex-1">Unassigned</span>
                        <span className="text-[9px] text-muted-foreground">{unJobs.length}</span>
                        <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {isExpanded && (
                        <div className="ml-1 pl-2 border-l border-red-500/20 space-y-1 mt-1">
                          {unJobs.map(job => {
                            const colors = getJobColor(job)
                            return (
                              <div
                                key={job.id}
                                onClick={() => { window.location.href = `/jobs?job=${job.id}` }}
                                className={`rounded px-1.5 py-1 border text-[10px] cursor-pointer hover:opacity-80 ${colors.card}`}
                              >
                                <div className="font-bold text-foreground truncate">{job.customer_name}</div>
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <MapPin className="size-2 shrink-0" />
                                  <span className="truncate">{extractTown(job.address)}</span>
                                </div>
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className={`truncate ${colors.accent}`}>{job.services[0] || "Job"}</span>
                                  <span className="font-bold text-foreground">${job.price}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {dayCrews.length === 0 && (
                  <p className="text-[10px] text-muted-foreground italic text-center py-2">No jobs scheduled</p>
                )}
              </div>

              {/* Day total */}
              {dayTotal > 0 && (
                <div className="px-2 py-1 border-t border-border text-[10px] font-medium text-muted-foreground shrink-0">
                  ${Math.round(dayTotal).toLocaleString()} scheduled
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ═══ BOTTOM BAR ═══ */}
      <div className="px-4 py-2.5 border-t border-border flex items-center justify-between shrink-0">
        <span className="text-sm font-bold text-foreground">
          ${Math.round(weeklyTotal).toLocaleString()}{" "}
          <span className="text-xs font-normal text-muted-foreground">this week</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {weekData.reduce((s, d) => s + d.totalJobs, 0)} jobs
        </span>
      </div>
    </div>
  )
}
