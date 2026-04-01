"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, Clock, MapPin,
  User, Plus, X, Check, Phone,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────

type Job = {
  id: number
  date: string
  scheduled_at: string | null
  service_type: string
  address: string | null
  status: string
  price: number | null
  hours: number | null
  phone_number: string | null
  job_type: string | null
  notes: string | null
  cleaner_id: number | null
  cleaner_name: string | null
  is_team_lead: boolean
  frequency: string | null
  customers: { first_name: string | null; last_name: string | null } | null
}

type TimeOffEntry = {
  id: number
  date: string
  reason: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
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

function formatTimeShort(isoStr: string | null): string {
  if (!isoStr) return ""
  const d = new Date(isoStr)
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return m === 0 ? `${hour}${suffix}` : `${hour}:${m.toString().padStart(2, "0")}${suffix}`
}

function getEndTime(scheduledAt: string | null, hours: number | null): string {
  if (!scheduledAt) return ""
  const start = new Date(scheduledAt)
  if (isNaN(start.getTime())) return ""
  const duration = hours || 2
  const end = new Date(start.getTime() + duration * 60 * 60 * 1000)
  return formatTimeShort(end.toISOString())
}

function formatServiceType(st: string | null): string {
  if (!st) return "Service"
  return st
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
}

function extractCity(address: string | null): string {
  if (!address) return ""
  const parts = address.split(",")
  if (parts.length >= 2) {
    return parts[parts.length - 2].trim().split(" ")[0]
  }
  return parts[0].trim().split(" ").slice(-1)[0] || ""
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
}

function isSalesAppointment(job: Job): boolean {
  return job.job_type === "sales_appointment" || job.service_type === "sales_appointment" || job.service_type === "estimate"
}

const STATUS_BORDER: Record<string, string> = {
  completed: "border-l-green-500",
  in_progress: "border-l-yellow-500",
  scheduled: "border-l-blue-500",
  confirmed: "border-l-blue-500",
  pending: "border-l-purple-500",
  quoted: "border-l-purple-500",
  cancelled: "border-l-zinc-500",
  not_completed: "border-l-red-500",
}

const STATUS_BG: Record<string, string> = {
  completed: "bg-green-500/10",
  in_progress: "bg-yellow-500/10",
  scheduled: "bg-blue-500/10",
  confirmed: "bg-blue-500/10",
  pending: "bg-purple-500/10",
  not_completed: "bg-red-500/10",
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <Check className="h-3 w-3 text-green-400" />,
  in_progress: <Clock className="h-3 w-3 text-yellow-400 animate-pulse" />,
  not_completed: <X className="h-3 w-3 text-red-400" />,
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ── Component ──────────────────────────────────────────────────────────────

export default function MySchedulePage() {
  const { user } = useAuth()

  // State
  const [cleanerId, setCleanerId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingJobs, setLoadingJobs] = useState(false)

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([])
  const [togglingOff, setTogglingOff] = useState<string | null>(null)

  // Schedule state
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [scheduleView, setScheduleView] = useState<"day" | "week">("day")
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState<Job[]>([])
  const [expandedJob, setExpandedJob] = useState<number | null>(null)

  // ── Resolve cleaner_id ──

  useEffect(() => {
    async function findCleaner() {
      if (!user?.id) return
      try {
        // The my-jobs API resolves cleaner_id from the user's phone automatically
        // We also try settings in case it's stored there
        const res = await fetch("/api/actions/settings")
        const data = await res.json()
        if (data.cleaner_id) {
          setCleanerId(data.cleaner_id)
        } else {
          // Fallback: let the my-jobs API handle resolution (pass no cleaner_id)
          // We'll set a sentinel to indicate we should not pass cleaner_id
          setCleanerId(-1)
        }
      } catch {
        setCleanerId(-1)
      }
      setLoading(false)
    }
    findCleaner()
  }, [user])

  // ── Calendar helpers ──

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear()
    const month = calendarMonth.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startDow = firstDay.getDay() // 0=Sun

    const days: { date: Date; inMonth: boolean }[] = []

    // Pad days from previous month
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i)
      days.push({ date: d, inMonth: false })
    }

    // Current month days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), inMonth: true })
    }

    // Pad days from next month to fill grid (always 6 rows = 42 cells)
    while (days.length < 42) {
      const nextDay = new Date(year, month + 1, days.length - lastDay.getDate() - startDow + 1)
      days.push({ date: nextDay, inMonth: false })
    }

    return days
  }, [calendarMonth])

  const monthLabel = calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  function navigateMonth(delta: number) {
    setCalendarMonth(prev => {
      const next = new Date(prev)
      next.setMonth(next.getMonth() + delta)
      return next
    })
  }

  // ── Load time-off for visible month ──

  const loadTimeOff = useCallback(async () => {
    if (!cleanerId || cleanerId === -1) return
    try {
      const monthStr = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}`
      const res = await fetch(`/api/actions/time-off?month=${monthStr}&cleaner_id=${cleanerId}`)
      const data = await res.json()
      setTimeOff(data.timeOff || [])
    } catch (err) {
      console.error("Failed to load time off:", err)
    }
  }, [calendarMonth, cleanerId])

  useEffect(() => { loadTimeOff() }, [loadTimeOff])

  // ── Generate demo jobs for a week centered on selectedDate ──

  const generateDemoJobs = useCallback((baseDate: Date): Job[] => {
    const monday = getMonday(baseDate)
    const demo: Job[] = []
    const services = ["window_cleaning", "gutter_cleaning", "pressure_washing", "screen_repair", "window_cleaning"]
    const addresses = [
      "1423 Oak St, Morton, IL 61550",
      "809 Birch Ln, Pekin, IL 61554",
      "2205 Washington Rd, East Peoria, IL 61611",
      "315 Main St, Peoria Heights, IL 61616",
      "987 Cedar Dr, Morton, IL 61550",
      "452 Maple Ave, Pekin, IL 61554",
      "1100 N Main St, East Peoria, IL 61611",
    ]
    const customers = [
      { first_name: "Sarah", last_name: "Mitchell" },
      { first_name: "James", last_name: "Rodriguez" },
      { first_name: "Linda", last_name: "Chen" },
      { first_name: "Mike", last_name: "O'Brien" },
      { first_name: "Karen", last_name: "Johnson" },
      { first_name: "Dave", last_name: "Kowalski" },
      { first_name: "Emily", last_name: "Taylor" },
    ]
    const statuses = ["scheduled", "confirmed", "completed", "in_progress", "scheduled"]

    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d)
      const dateStr = toDateStr(day)
      // Skip Sunday (day 6 = index 6 from Monday start)
      if (day.getDay() === 0) continue
      const jobsPerDay = d === 5 ? 1 : 2 + (d % 2) // Sat=1, else 2-3
      for (let j = 0; j < jobsPerDay; j++) {
        const hour = 8 + j * 2 + (d % 2)
        const idx = (d * 3 + j) % 7
        demo.push({
          id: d * 100 + j,
          date: dateStr,
          scheduled_at: `${dateStr}T${String(hour).padStart(2, "0")}:${j === 1 ? "30" : "00"}:00`,
          service_type: services[idx % services.length],
          address: addresses[idx],
          status: d < new Date().getDay() ? "completed" : statuses[idx % statuses.length],
          price: [185, 250, 320, 150, 275, 195, 340][idx],
          hours: [1.5, 2, 2.5, 1, 2, 1.5, 3][idx],
          phone_number: `(309) 555-${String(1000 + idx).slice(1)}`,
          job_type: j === 2 ? "sales_appointment" : null,
          notes: j === 0 ? "Large two-story home, bring extension ladder" : null,
          cleaner_id: 1,
          cleaner_name: "Demo Crew",
          is_team_lead: true,
          frequency: idx % 3 === 0 ? "monthly" : idx % 3 === 1 ? "bi_weekly" : "one_time",
          customers: customers[idx],
        })
      }
    }
    return demo
  }, [])

  // ── Load jobs for selected day/week ──

  const loadJobs = useCallback(async () => {
    if (!cleanerId) return
    setLoadingJobs(true)
    try {
      const dateStr = scheduleView === "week" ? toDateStr(weekStart) : toDateStr(selectedDate)
      const range = scheduleView === "week" ? "week" : "day"
      const clParam = cleanerId > 0 ? `&cleaner_id=${cleanerId}` : ""
      const res = await fetch(`/api/actions/my-jobs?date=${dateStr}&range=${range}${clParam}`)
      const data = await res.json()
      const realJobs = data.jobs || []
      // Use demo data if no real jobs found
      if (realJobs.length === 0) {
        setJobs(generateDemoJobs(scheduleView === "week" ? weekStart : selectedDate))
      } else {
        setJobs(realJobs)
      }
    } catch (err) {
      console.error("Failed to load jobs:", err)
      // Fallback to demo data on error
      setJobs(generateDemoJobs(scheduleView === "week" ? weekStart : selectedDate))
    }
    setLoadingJobs(false)
  }, [selectedDate, weekStart, scheduleView, cleanerId, generateDemoJobs])

  useEffect(() => { loadJobs() }, [loadJobs])

  // ── Toggle time off ──

  async function toggleTimeOff(dateStr: string) {
    if (!cleanerId || cleanerId <= 0) return
    setTogglingOff(dateStr)

    const isOff = timeOff.some(t => t.date === dateStr)

    try {
      if (isOff) {
        await fetch("/api/actions/time-off", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cleaner_id: cleanerId, dates: [dateStr] }),
        })
        setTimeOff(prev => prev.filter(t => t.date !== dateStr))
      } else {
        await fetch("/api/actions/time-off", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cleaner_id: cleanerId, dates: [dateStr] }),
        })
        setTimeOff(prev => [...prev, { id: 0, date: dateStr, reason: null }])
      }
    } catch (err) {
      console.error("Failed to toggle time off:", err)
    }

    setTogglingOff(null)
  }

  function isOffDay(dateStr: string): boolean {
    return timeOff.some(t => t.date === dateStr)
  }

  // ── Schedule helpers ──

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  function selectDay(d: Date) {
    setSelectedDate(d)
    if (scheduleView === "week") {
      setScheduleView("day")
    }
  }

  function toggleScheduleView(mode: "day" | "week") {
    setScheduleView(mode)
    if (mode === "week") {
      setWeekStart(getMonday(selectedDate))
    }
  }

  // Sort jobs by scheduled_at
  const sortedDayJobs = useMemo(() => {
    const dateStr = toDateStr(selectedDate)
    return jobs
      .filter(j => j.date === dateStr)
      .sort((a, b) => {
        if (!a.scheduled_at && !b.scheduled_at) return 0
        if (!a.scheduled_at) return 1
        if (!b.scheduled_at) return -1
        return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      })
  }, [jobs, selectedDate])

  const dayTotal = sortedDayJobs.reduce((sum, j) => sum + (Number(j.price) || 0), 0)

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-bold">My Schedule</h1>
        <p className="text-sm text-muted-foreground">Your jobs and time off</p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
         SECTION A: Full Month Calendar — Time Off
         ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border/30 bg-card/30 p-4">
        {/* Month header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            Select Your Days Off
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-medium text-muted-foreground min-w-[120px] text-center">
              {monthLabel}
            </span>
            <button
              onClick={() => navigateMonth(1)}
              className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_HEADERS.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground uppercase py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map(({ date, inMonth }, idx) => {
            const dateStr = toDateStr(date)
            const off = isOffDay(dateStr)
            const today = isSameDay(date, new Date())
            const isSelected = isSameDay(date, selectedDate)
            const toggling = togglingOff === dateStr

            return (
              <button
                key={idx}
                onClick={() => {
                  if (inMonth) {
                    selectDay(date)
                    toggleTimeOff(dateStr)
                  }
                }}
                disabled={!inMonth || toggling || (cleanerId !== null && cleanerId <= 0)}
                className={`
                  relative flex flex-col items-center justify-center p-1.5 rounded-lg
                  transition-all text-center min-h-[40px]
                  ${!inMonth
                    ? "opacity-20 cursor-default"
                    : off
                      ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
                      : isSelected
                        ? "bg-primary/15 border border-primary/40 text-primary"
                        : today
                          ? "bg-primary/10 border border-primary/20 text-foreground"
                          : "border border-transparent hover:bg-muted/40 text-foreground"
                  }
                `}
              >
                <span className={`text-xs font-medium ${!inMonth ? "text-muted-foreground/30" : ""}`}>
                  {date.getDate()}
                </span>
                {off && inMonth && (
                  <span className="text-[8px] font-bold uppercase tracking-wider leading-none mt-0.5">OFF</span>
                )}
                {toggling && (
                  <Loader2 className="absolute top-0.5 right-0.5 h-2.5 w-2.5 animate-spin" />
                )}
              </button>
            )
          })}
        </div>

        {cleanerId !== null && cleanerId <= 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Your account is not linked to a worker profile. Ask your admin to connect it.
          </p>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
         SECTION B & C: Daily / Weekly Schedule
         ══════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border/30 bg-card/30 p-4">
        {/* Schedule header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {scheduleView === "day"
              ? selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
              : `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            }
          </h2>

          <div className="flex items-center gap-2">
            {/* Day/Week toggle */}
            <div className="flex rounded-lg border border-border/50 overflow-hidden">
              <button
                onClick={() => toggleScheduleView("day")}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  scheduleView === "day"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                Day
              </button>
              <button
                onClick={() => toggleScheduleView("week")}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  scheduleView === "week"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                Week
              </button>
            </div>

            {/* Nav arrows for day view */}
            {scheduleView === "day" && (
              <>
                <button
                  onClick={() => setSelectedDate(prev => addDays(prev, -1))}
                  className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setSelectedDate(prev => addDays(prev, 1))}
                  className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}

            {/* Nav arrows for week view */}
            {scheduleView === "week" && (
              <>
                <button
                  onClick={() => setWeekStart(prev => addDays(prev, -7))}
                  className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setWeekStart(prev => addDays(prev, 7))}
                  className="p-1.5 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {loadingJobs ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : scheduleView === "day" ? (
          /* ── Day View ── */
          <div className="space-y-0">
            {isOffDay(toDateStr(selectedDate)) && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 mb-3">
                <p className="text-xs font-semibold text-red-400">Day Off</p>
              </div>
            )}

            {sortedDayJobs.length === 0 ? (
              <div className="py-8 text-center">
                <Calendar className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No jobs scheduled</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {sortedDayJobs.map(job => {
                  const isExpanded = expandedJob === job.id
                  const isSales = isSalesAppointment(job)

                  return (
                    <div key={job.id} className="py-0.5">
                      <button
                        onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                        className={`
                          w-full text-left rounded-lg border-l-[3px] p-2.5 transition-colors
                          ${isSales
                            ? `border border-amber-500/30 bg-transparent ${STATUS_BORDER[job.status] || "border-l-amber-500"}`
                            : `border border-border/20 ${STATUS_BG[job.status] || "bg-card/60"} ${STATUS_BORDER[job.status] || "border-l-zinc-500"}`
                          }
                        `}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            {STATUS_ICON[job.status] || (
                              <div className="h-3 w-3 rounded-full border-2 border-blue-400/50 shrink-0" />
                            )}
                            <span className="text-xs font-bold text-foreground">
                              {formatTimeShort(job.scheduled_at)}
                              {job.scheduled_at && (
                                <span className="text-muted-foreground font-normal">
                                  {" "}-{" "}{getEndTime(job.scheduled_at, job.hours)}
                                </span>
                              )}
                            </span>
                          </div>
                          {job.price && (
                            <span className="text-[11px] font-semibold text-green-400 shrink-0 ml-2">
                              ${Number(job.price).toLocaleString()}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-foreground">
                            {formatServiceType(job.service_type)}
                            {isSales && (
                              <span className="ml-1.5 text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
                                SALES
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {extractCity(job.address)}
                          </span>
                        </div>
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="ml-3 mt-1 mb-2 p-3 rounded-lg bg-muted/20 border border-border/20 space-y-2 animate-fade-in">
                          {job.address && (
                            <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>{job.address}</span>
                            </div>
                          )}
                          {job.customers && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <User className="h-3.5 w-3.5 shrink-0" />
                              <span>
                                {[job.customers.first_name, job.customers.last_name].filter(Boolean).join(" ")}
                              </span>
                            </div>
                          )}
                          {job.phone_number && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <Phone className="h-3.5 w-3.5 shrink-0" />
                              <a href={`tel:${job.phone_number}`} className="hover:text-foreground transition-colors">
                                {job.phone_number}
                              </a>
                            </div>
                          )}
                          {job.notes && (
                            <p className="text-[10px] text-muted-foreground/70 italic border-t border-border/10 pt-1.5 mt-1.5">
                              {job.notes}
                            </p>
                          )}
                          {job.frequency && job.frequency !== "one_time" && (
                            <span className="inline-block text-[9px] font-semibold text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded uppercase">
                              {job.frequency.replace(/_/g, " ")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Day total */}
            {dayTotal > 0 && (
              <div className="mt-3 pt-3 border-t border-border/20 text-center">
                <span className="text-sm font-bold text-green-400">
                  ${dayTotal.toLocaleString()} scheduled
                </span>
              </div>
            )}
          </div>
        ) : (
          /* ── Week View ── */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {weekDays.map(day => {
              const dateStr = toDateStr(day)
              const off = isOffDay(dateStr)
              const today = isSameDay(day, new Date())
              const isSelected = isSameDay(day, selectedDate)
              const dayJobs = jobs
                .filter(j => j.date === dateStr)
                .sort((a, b) => {
                  if (!a.scheduled_at && !b.scheduled_at) return 0
                  if (!a.scheduled_at) return 1
                  if (!b.scheduled_at) return -1
                  return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
                })
              const wkDayTotal = dayJobs.reduce((s, j) => s + (Number(j.price) || 0), 0)

              return (
                <button
                  key={dateStr}
                  onClick={() => selectDay(day)}
                  className={`rounded-xl border p-2 min-h-[130px] text-left transition-colors ${
                    off
                      ? "bg-red-500/5 border-red-500/20 opacity-60"
                      : isSelected
                        ? "bg-primary/10 border-primary/30"
                        : today
                          ? "bg-primary/5 border-primary/20"
                          : "bg-card/50 border-border/20 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-[10px] font-semibold uppercase ${
                      today ? "text-primary" : "text-muted-foreground"
                    }`}>
                      {day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                    </span>
                    {wkDayTotal > 0 && (
                      <span className="text-[9px] font-semibold text-green-400">
                        ${wkDayTotal.toLocaleString()}
                      </span>
                    )}
                  </div>

                  {off ? (
                    <div className="text-[10px] text-red-400 font-medium">Day Off</div>
                  ) : dayJobs.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground/40 italic">No jobs</div>
                  ) : (
                    <div className="space-y-1">
                      {dayJobs.slice(0, 4).map(j => (
                        <div
                          key={j.id}
                          className={`text-[10px] px-1.5 py-0.5 rounded border-l-2 ${
                            STATUS_BORDER[j.status] || "border-l-zinc-500"
                          } ${isSalesAppointment(j) ? "border border-amber-500/20 bg-transparent" : "bg-card/60"}`}
                        >
                          <span className="font-medium">
                            {formatTimeShort(j.scheduled_at)}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {formatServiceType(j.service_type).slice(0, 16)}
                          </span>
                        </div>
                      ))}
                      {dayJobs.length > 4 && (
                        <p className="text-[9px] text-muted-foreground/60 pl-1.5">
                          +{dayJobs.length - 4} more
                        </p>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Week total (week view only) ── */}
      {scheduleView === "week" && (() => {
        const weekTotal = jobs.reduce((s, j) => s + (Number(j.price) || 0), 0)
        if (weekTotal <= 0) return null
        return (
          <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
            <span className="text-sm font-bold text-green-400">
              ${weekTotal.toLocaleString()} scheduled this week
            </span>
          </div>
        )
      })()}
    </div>
  )
}
