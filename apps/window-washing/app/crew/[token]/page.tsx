"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Loader2, AlertCircle, ChevronRight, ChevronLeft, MapPin, Clock,
  Calendar, PlusCircle, LogOut,
  AlertTriangle, ExternalLink, X,
} from "lucide-react"
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose,
} from "@/components/ui/drawer"
import { ClockWidget } from "@/components/winbros/clock-widget"

/* ─── Types ─── */
interface Job {
  id: number; date: string; scheduled_at: string | null; address: string | null
  service_type: string | null; status: string; job_type: string | null
  hours: number | null; price: number | null
  assignment_status: string; assignment_id: string; customer_first_name: string | null
  cleaner_omw_at: string | null; cleaner_arrived_at: string | null; payment_method: string | null
  visit_status: string | null
}
interface TimeOffEntry { id: number; date: string; reason: string | null }
interface WeeklyDay { available: boolean; start?: string; end?: string }
interface WeeklySchedule { [day: string]: WeeklyDay }
interface PortalData {
  cleaner: { id: number; name: string; phone: string; availability: { weekly?: WeeklySchedule } | null; employee_type?: string; is_team_lead?: boolean }
  tenant: { name: string; slug: string }
  jobs: Job[]; pendingJobs: Job[]
  dateRange: { start: string; end: string }
  timeOff: TimeOffEntry[]
}

/* ─── Theme ─── */
const THEMES: Record<string, { gradient: string; accent: string; accentLight: string; avatarGradient: string; avatarText: string }> = {
  winbros: { gradient: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)", accent: "#14b8a6", accentLight: "#5eead4", avatarGradient: "linear-gradient(135deg, #99f6e4, #5eead4)", avatarText: "#0f766e" },
}
const DEFAULT_THEME = { gradient: "linear-gradient(135deg, #58cc02 0%, #2b9348 100%)", accent: "#58cc02", accentLight: "#89e219", avatarGradient: "linear-gradient(135deg, #d4fc79, #96e6a1)", avatarText: "#2b9348" }

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e", in_progress: "#eab308", scheduled: "#3b82f6",
  confirmed: "#3b82f6", pending: "#a855f7", quoted: "#a855f7", cancelled: "#6b7280",
}

/* ─── Visit Flow Status Config ─── */
const VISIT_STEPS = [
  { key: "on_my_way", short: "OMW", label: "On My Way", color: "#3b82f6" },
  { key: "in_progress", short: "Start", label: "In Progress", color: "#22c55e" },
  { key: "stopped", short: "Stop", label: "Stopped", color: "#f97316" },
  { key: "completed", short: "Done", label: "Completed", color: "#10b981" },
  { key: "checklist_done", short: "Check", label: "Checklist", color: "#a855f7" },
  { key: "payment_collected", short: "Pay", label: "Payment", color: "#6366f1" },
  { key: "closed", short: "Close", label: "Closed", color: "#71717a" },
] as const

const VISIT_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: "Not Started", color: "#9ca3af", bg: "#9ca3af20" },
  on_my_way: { label: "On My Way", color: "#3b82f6", bg: "#3b82f620" },
  in_progress: { label: "In Progress", color: "#22c55e", bg: "#22c55e20" },
  stopped: { label: "Stopped", color: "#f97316", bg: "#f9731620" },
  completed: { label: "Completed", color: "#10b981", bg: "#10b98120" },
  checklist_done: { label: "Checklist", color: "#a855f7", bg: "#a855f720" },
  payment_collected: { label: "Payment", color: "#6366f1", bg: "#6366f120" },
  closed: { label: "Closed", color: "#71717a", bg: "#71717a20" },
}

function getVisitStepIndex(status: string | null): number {
  if (!status || status === "not_started") return -1
  return VISIT_STEPS.findIndex(s => s.key === status)
}

function getServiceBadgeStyle(type: string | null): { bg: string; color: string } {
  switch (type) {
    case "window_cleaning": return { bg: "#0ea5e920", color: "#0ea5e9" }
    case "pressure_washing": return { bg: "#f9731620", color: "#f97316" }
    case "gutter_cleaning": return { bg: "#f59e0b20", color: "#f59e0b" }
    default: return { bg: "#71717a20", color: "#71717a" }
  }
}

const DAYS_OF_WEEK = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"] as const
const DAY_LABELS_SHORT = ["S","M","T","W","T","F","S"]
const DAY_LABELS_FULL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
const TIME_OPTIONS = ["06:00","07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00"]

/* ─── Helpers ─── */
function localToday() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}
function parseHHMM(t: string | null): { h: number; m: number } | null {
  if (!t) return null
  const parts = t.split(":").map(Number)
  if (parts.length < 2 || isNaN(parts[0])) return null
  return { h: parts[0], m: parts[1] || 0 }
}
function formatTime12(t: string | null) {
  const p = parseHHMM(t); if (!p) return "TBD"
  const { h, m } = p; return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`
}
function formatTimeShort(t: string | null) {
  const p = parseHHMM(t); if (!p) return ""
  const { h, m } = p; return m ? `${h % 12 || 12}:${String(m).padStart(2,"0")}` : `${h % 12 || 12}${h >= 12 ? "p" : "a"}`
}
function formatHour(t: string) { const [h] = t.split(":").map(Number); return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}` }
function getEndTime(start: string | null, hours: number | null): string | null {
  const p = parseHHMM(start); if (!p || !hours) return null
  const totalMin = p.h * 60 + p.m + hours * 60
  const eh = Math.floor(totalMin / 60) % 24, em = Math.round(totalMin % 60)
  return `${String(eh).padStart(2,"0")}:${String(em).padStart(2,"0")}`
}
function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }
function formatDateLabel(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function getMondayOfWeek(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00"); const dow = d.getDay()
  const diff = dow === 0 ? -6 : 1 - dow; d.setDate(d.getDate() + diff)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + "T12:00:00"); d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}
function getWeekDays(mondayStr: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayStr, i))
}
function formatCurrency(n: number) { return `$${Math.round(n).toLocaleString()}` }

const DEFAULT_WEEKLY: WeeklySchedule = Object.fromEntries(DAYS_OF_WEEK.map(d => [d, { available: true, start: "08:00", end: "18:00" }]))

/* ═══════════════════════════════════════════════════════════════════════ */

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"day" | "week">("day")
  const [currentDate, setCurrentDate] = useState(localToday)
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [jobDetail, setJobDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Availability state
  const [showAvail, setShowAvail] = useState(false)
  const [availView, setAvailView] = useState<"calendar" | "weekly">("calendar")
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() } })
  const [offDays, setOffDays] = useState<Set<string>>(new Set())
  const [togglingDate, setTogglingDate] = useState<string | null>(null)
  const [availError, setAvailError] = useState<string | null>(null)
  const [weekly, setWeekly] = useState<WeeklySchedule>(DEFAULT_WEEKLY)
  const [savingWeekly, setSavingWeekly] = useState(false)
  const [weeklyDirty, setWeeklyDirty] = useState(false)

  // Wave 3e — door-knock salesman widgets
  const [doorKnockDays, setDoorKnockDays] = useState<Array<{ date: string; count: number }>>([])
  const [commissionSummary, setCommissionSummary] = useState<{
    total_pay: number
    range: { start: string; end: string }
  } | null>(null)

  const theme = data?.tenant?.slug ? (THEMES[data.tenant.slug] || DEFAULT_THEME) : DEFAULT_THEME

  // Fetch jobs for the current date range
  const fetchJobs = useCallback(async (date: string, range: "day" | "week") => {
    try {
      const res = await fetch(`/api/crew/${token}?range=${range}&date=${date}`)
      if (!res.ok) throw new Error("Invalid portal link")
      const d = await res.json()
      setData(d)
      setOffDays(new Set((d.timeOff || []).map((t: TimeOffEntry) => t.date)))
      if (d.cleaner.availability?.weekly) {
        setWeekly({ ...DEFAULT_WEEKLY, ...d.cleaner.availability.weekly })
      }
    } catch (e: any) { setError(e.message) }
  }, [token])

  // Fetch on mount + refetch when date/view changes
  useEffect(() => {
    fetchJobs(currentDate, viewMode).finally(() => setLoading(false))
  }, [currentDate, viewMode])

  useEffect(() => {
    fetch(`/api/crew/${token}/auto-session`, { method: "POST" }).catch(() => {})
  }, [token])

  // Wave 3e — pull availability + commission once the cleaner is resolved.
  // Only salesmen need these; other roles skip the fetch.
  useEffect(() => {
    if (!data?.cleaner) return
    const isSalesman = data.cleaner.employee_type === "salesman"
    if (!isSalesman) return
    fetch(`/api/crew/${token}/availability?days=14`)
      .then(r => (r.ok ? r.json() : null))
      .then(b => {
        if (b?.success) setDoorKnockDays(b.data as Array<{ date: string; count: number }>)
      })
      .catch(() => {})
    fetch(`/api/crew/${token}/commission-summary`)
      .then(r => (r.ok ? r.json() : null))
      .then(b => {
        if (b?.success) setCommissionSummary(b.data)
      })
      .catch(() => {})
  }, [token, data?.cleaner])

  // Nav handlers
  const navigate = (dir: -1 | 1) => {
    setCurrentDate(prev => addDays(prev, viewMode === "week" ? dir * 7 : dir))
  }
  const goToday = () => setCurrentDate(localToday())

  // Open job detail drawer
  const openJobDetail = async (job: Job) => {
    setSelectedJob(job)
    setJobDetail(null)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/crew/${token}/job/${job.id}`)
      if (res.ok) setJobDetail(await res.json())
    } catch {}
    setLoadingDetail(false)
  }

  // Availability handlers
  const toggleDay = useCallback(async (dateStr: string) => {
    if (togglingDate) return
    setTogglingDate(dateStr)
    setAvailError(null)
    try {
      const res = await fetch(`/api/crew/${token}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleTimeOff: { date: dateStr } }),
      })
      const result = await res.json()
      if (result.success) {
        setOffDays(prev => { const next = new Set(prev); result.action === "added" ? next.add(dateStr) : next.delete(dateStr); return next })
      } else if (result.error) {
        setAvailError(result.error)
      }
    } catch {
      setAvailError("Couldn't reach the server — try again.")
    }
    setTogglingDate(null)
  }, [token, togglingDate])

  const updateWeeklyDay = (day: string, updates: Partial<WeeklyDay>) => {
    setWeekly(prev => ({ ...prev, [day]: { ...prev[day], ...updates } })); setWeeklyDirty(true)
  }
  const saveWeekly = async () => {
    setSavingWeekly(true)
    try {
      await fetch(`/api/crew/${token}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: { ...(data?.cleaner.availability || {}), weekly } }),
      })
      setWeeklyDirty(false)
    } catch {}
    setSavingWeekly(false)
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.push("/login")
  }

  // ALL hooks must be called before any early returns (Rules of Hooks)
  const jobs = data?.jobs || []
  const pendingJobs = data?.pendingJobs || []
  const cleaner = data?.cleaner
  const tenant = data?.tenant
  const firstName = cleaner?.name?.split(" ")[0] || "Crew"
  const todayStr = localToday()
  const hourNow = new Date().getHours()
  const greeting = hourNow < 12 ? "Good morning" : hourNow < 17 ? "Good afternoon" : "Good evening"

  // Group jobs by date
  const jobsByDate = useMemo(() => {
    const m: Record<string, Job[]> = {}
    for (const j of jobs) { if (!m[j.date]) m[j.date] = []; m[j.date].push(j) }
    return m
  }, [jobs])

  // Daily total for current view
  const dayTotal = useMemo(() => {
    const dayJobs = viewMode === "day" ? (jobsByDate[currentDate] || []) : jobs
    return dayJobs.reduce((s, j) => s + (j.price || 0), 0)
  }, [jobs, jobsByDate, currentDate, viewMode])

  // Week days for week view
  const weekDays = useMemo(() => {
    const monday = getMondayOfWeek(currentDate)
    return getWeekDays(monday)
  }, [currentDate])

  // Calendar month helpers for availability
  const calDate = new Date(calMonth.year, calMonth.month, 1)
  const monthName = calDate.toLocaleString("en-US", { month: "long", year: "numeric" })
  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate()
  const firstDow = calDate.getDay()
  const calDays: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) calDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d)
  const isRecurringOff = (dayNum: number) => {
    const d = new Date(calMonth.year, calMonth.month, dayNum)
    return weekly[DAYS_OF_WEEK[d.getDay()]]?.available === false
  }

  /* ─── Loading / Error ─── */
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f5f0" }}>
      <Loader2 className="size-8 animate-spin" style={{ color: theme.accent }} />
    </div>
  )
  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#f7f5f0" }}>
      <div className="text-center">
        <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800">Invalid Link</h1>
        <p className="text-slate-500 mt-1 text-sm">This portal link is not valid or has expired.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f7f5f0", fontFamily: "Inter, system-ui, sans-serif" }}>

      {/* ═══ HEADER ═══ */}
      <div className="relative overflow-hidden px-5 pt-5 pb-4 shrink-0" style={{ background: theme.gradient }}>
        <div className="absolute -top-8 -right-8 size-28 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold text-white/70 uppercase tracking-wider">{tenant?.name}</span>
            <button onClick={handleLogout} className="text-[10px] text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
              <LogOut className="size-3" /> Log out
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl flex items-center justify-center text-lg font-black shadow-md" style={{ background: theme.avatarGradient, color: theme.avatarText }}>
              {firstName.charAt(0)}
            </div>
            <div className="flex-1">
              <p className="text-white/60 text-xs">{greeting}</p>
              <h1 className="text-xl font-black text-white">{firstName}</h1>
            </div>
            {cleaner?.employee_type === "salesman" && commissionSummary && (
              <div
                data-testid="commission-chip"
                className="rounded-full bg-white/15 backdrop-blur px-3 py-1.5 text-right"
              >
                <div className="text-[9px] text-white/70 uppercase">Pending commission</div>
                <div className="text-sm font-bold text-white">
                  ${commissionSummary.total_pay.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Wave 3e — 14-day door-knock availability strip (salesman only) */}
      {cleaner?.employee_type === "salesman" && doorKnockDays.length > 0 && (
        <div
          data-testid="availability-strip"
          className="shrink-0 overflow-x-auto border-b bg-white px-3 py-2"
          style={{ borderColor: "#e8e5de" }}
        >
          <div className="flex gap-1.5">
            {doorKnockDays.map(d => {
              const level =
                d.count <= 2 ? "green" : d.count <= 4 ? "yellow" : "red"
              const dotColor =
                level === "green" ? "#22c55e" : level === "yellow" ? "#f59e0b" : "#ef4444"
              const date = new Date(d.date + "T12:00:00")
              const label = date.toLocaleDateString("en-US", { weekday: "short" })
              const num = date.getDate()
              const isToday = d.date === todayStr
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setCurrentDate(d.date)}
                  className={`flex flex-col items-center rounded-lg border px-2 py-1.5 text-xs shrink-0 ${
                    isToday ? "border-slate-700" : "border-slate-200"
                  }`}
                  aria-label={`${label} ${num}, ${d.count} jobs booked`}
                >
                  <span className="text-[9px] uppercase text-slate-400">{label}</span>
                  <span className="font-bold text-slate-800">{num}</span>
                  <span
                    className="mt-0.5 h-1.5 w-1.5 rounded-full"
                    style={{ background: dotColor }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Wave 3h — clock-in widget for technicians + team leads. */}
      {(cleaner?.employee_type === "technician" || cleaner?.is_team_lead) && (
        <ClockWidget token={token} accent={theme.accent} />
      )}

      {/* ═══ TOOLBAR ═══ */}
      <div className="px-4 py-2.5 flex items-center gap-2 border-b shrink-0" style={{ borderColor: "#e8e5de", background: "#fff" }}>
        {/* Date nav */}
        <button onClick={() => navigate(-1)} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100">
          <ChevronLeft className="size-4 text-slate-500" />
        </button>
        <button onClick={goToday} className="flex-1 text-center">
          <span className="text-sm font-bold text-slate-700">
            {viewMode === "day"
              ? formatDateLabel(currentDate)
              : `${formatDateLabel(weekDays[0])} – ${formatDateLabel(weekDays[6])}`
            }
          </span>
          {currentDate !== todayStr && (
            <span className="block text-[10px] font-medium" style={{ color: theme.accent }}>Tap for today</span>
          )}
        </button>
        <button onClick={() => navigate(1)} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100">
          <ChevronRight className="size-4 text-slate-500" />
        </button>

        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "#e2ddd5" }}>
          {(["day", "week"] as const).map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className="px-2.5 py-1 text-[10px] font-bold uppercase"
              style={{
                background: viewMode === v ? theme.accent : "transparent",
                color: viewMode === v ? "#fff" : "#94a3b8",
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Availability */}
        <button onClick={() => setShowAvail(true)} className="rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 hover:bg-slate-100 transition-colors" style={{ border: "1px solid #e2ddd5" }}>
          <Calendar className="size-3.5" style={{ color: theme.accent }} />
          <span className="text-[10px] font-bold text-slate-600">Availability</span>
        </button>
      </div>

      {/* ═══ PENDING ACTIONS ═══ */}
      {pendingJobs.length > 0 && (
        <div className="px-4 py-2 shrink-0" style={{ background: "#fef2f2" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-red-500 shrink-0" />
            <p className="text-xs font-bold text-red-700 flex-1">{pendingJobs.length} job{pendingJobs.length > 1 ? "s" : ""} need your response</p>
            <button
              onClick={() => { if (pendingJobs[0]) openJobDetail(pendingJobs[0]) }}
              className="text-[10px] font-bold text-red-600 px-2 py-1 rounded-md bg-red-100"
            >
              View
            </button>
          </div>
        </div>
      )}

      {/* ═══ SCHEDULE VIEW ═══ */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === "day" ? (
          <DayView
            jobs={jobsByDate[currentDate] || []}
            onJobClick={openJobDetail}
            theme={theme}
          />
        ) : (
          <WeekView
            weekDays={weekDays}
            jobsByDate={jobsByDate}
            currentDate={currentDate}
            todayStr={todayStr}
            onJobClick={openJobDetail}
            onDayClick={(d) => { setCurrentDate(d); setViewMode("day") }}
            theme={theme}
          />
        )}
      </div>

      {/* ═══ BOTTOM BAR ═══ */}
      <div className="px-4 py-3 border-t flex items-center justify-between shrink-0" style={{ borderColor: "#e8e5de", background: "#fff" }}>
        <span className="text-sm font-bold text-slate-700">
          {(viewMode === "day" ? (jobsByDate[currentDate] || []) : jobs).length} <span className="text-xs font-normal text-slate-400">jobs scheduled</span>
        </span>
        {/* Wave 3i: any active crew can start a quote. Salesman commission
            attribution still gates on employee_type='salesman' server-side. */}
        {(cleaner?.employee_type === "salesman" ||
          cleaner?.employee_type === "technician" ||
          cleaner?.is_team_lead) && (
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/crew/${token}/quote-draft`, { method: "POST" })
                  const body = await res.json()
                  if (body.success && body.quoteId) {
                    router.push(`/quotes/${body.quoteId}?from=crew:${token}`)
                  } else {
                    router.push(`/crew/${token}`)
                  }
                } catch {
                  router.push(`/crew/${token}`)
                }
              }}
              className="h-10 px-4 rounded-full flex items-center gap-1.5 text-sm font-semibold shadow-lg text-white"
              style={{ background: theme.accent }}
            >
              <PlusCircle className="size-4" /> New Quote
            </button>
          </div>
        )}
      </div>

      {/* ═══ JOB DETAIL DRAWER ═══ */}
      <Drawer open={!!selectedJob} onOpenChange={(open) => { if (!open) setSelectedJob(null) }}>
        <DrawerContent className="rounded-t-2xl" style={{ background: "#fff", maxHeight: "75vh" }}>
          <DrawerHeader className="pb-0">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-slate-800">
                {selectedJob?.service_type ? humanize(selectedJob.service_type) : "Job Details"}
              </DrawerTitle>
              <DrawerClose className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100">
                <X className="size-4 text-slate-400" />
              </DrawerClose>
            </div>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto space-y-3">
            {selectedJob && (
              <>
                {/* Status + Time */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(() => {
                    const vs = selectedJob.visit_status
                    const vm = vs ? VISIT_STATUS_META[vs] : null
                    return vm ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ background: vm.bg, color: vm.color }}>
                        {vm.label}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white"
                        style={{ background: STATUS_COLORS[selectedJob.status] || "#6b7280" }}>
                        {humanize(selectedJob.status)}
                      </span>
                    )
                  })()}
                  {selectedJob.service_type && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full border"
                      style={{
                        background: getServiceBadgeStyle(selectedJob.service_type).bg,
                        color: getServiceBadgeStyle(selectedJob.service_type).color,
                        borderColor: `${getServiceBadgeStyle(selectedJob.service_type).color}30`,
                      }}>
                      {humanize(selectedJob.service_type)}
                    </span>
                  )}
                  {selectedJob.job_type === "estimate" && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">ESTIMATE</span>
                  )}
                  <span className="text-xs text-slate-500">
                    {formatDateLabel(selectedJob.date)} · {formatTime12(selectedJob.scheduled_at)}
                    {selectedJob.hours ? ` - ${formatTime12(getEndTime(selectedJob.scheduled_at, selectedJob.hours))}` : ""}
                  </span>
                </div>
                {/* Visit progress in drawer */}
                {selectedJob.visit_status && selectedJob.job_type !== "estimate" && (
                  <VisitProgressDots visitStatus={selectedJob.visit_status} />
                )}

                {/* Customer */}
                {selectedJob.customer_first_name && (
                  <div className="flex items-center gap-2">
                    <div className="size-8 rounded-lg flex items-center justify-center text-xs font-bold" style={{ background: `${theme.accent}15`, color: theme.accent }}>
                      {selectedJob.customer_first_name.charAt(0)}
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{selectedJob.customer_first_name}</span>
                  </div>
                )}

                {/* Address */}
                {selectedJob.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(selectedJob.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-600 hover:bg-slate-50"
                    style={{ background: "#f8f7f4" }}
                  >
                    <MapPin className="size-4 shrink-0" style={{ color: theme.accent }} />
                    <span className="flex-1">{selectedJob.address}</span>
                    <ExternalLink className="size-3 text-slate-400" />
                  </a>
                )}

                {/* Duration + Price */}
                <div className="flex gap-3">
                  {selectedJob.hours && (
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ background: "#f8f7f4" }}>
                      <Clock className="size-3.5 text-slate-400" />
                      <span className="text-xs font-medium text-slate-600">{selectedJob.hours}h</span>
                    </div>
                  )}
                  {/* Price hidden from crew — admin only */}
                </div>

                {/* Loading detail */}
                {loadingDetail && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-5 animate-spin text-slate-400" />
                  </div>
                )}

                {/* Notes from detail (filter internal system data) */}
                {jobDetail?.job?.notes && (() => {
                  const INTERNAL = /^(PROMO:|NORMAL_PRICE:|__SYS)/i
                  const visible = jobDetail.job.notes.split(/\||\n/).map((s: string) => s.trim()).filter((s: string) => s && !INTERNAL.test(s)).join(' — ')
                  return visible ? (
                    <div className="px-3 py-2 rounded-xl text-xs text-slate-500" style={{ background: "#f8f7f4" }}>
                      {visible}
                    </div>
                  ) : null
                })()}

                {/* View Full Details button */}
                <button
                  onClick={() => {
                    const isEst = selectedJob.job_type === "estimate"
                    router.push(`/crew/${token}/${isEst ? "estimate" : "job"}/${selectedJob.id}`)
                  }}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                  style={{ background: theme.accent }}
                >
                  View Full Details <ChevronRight className="size-4" />
                </button>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* ═══ AVAILABILITY DRAWER ═══ */}
      <Drawer open={showAvail} onOpenChange={setShowAvail}>
        <DrawerContent className="rounded-t-2xl" style={{ background: "#fff", maxHeight: "85vh" }}>
          <DrawerHeader>
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-slate-800">My Availability</DrawerTitle>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAvailView(availView === "calendar" ? "weekly" : "calendar")}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg"
                  style={{ background: `${theme.accent}15`, color: theme.accent }}
                >
                  {availView === "calendar" ? "Weekly Hours" : "Calendar"}
                </button>
                <DrawerClose className="size-8 rounded-full flex items-center justify-center hover:bg-slate-100">
                  <X className="size-4 text-slate-400" />
                </DrawerClose>
              </div>
            </div>
          </DrawerHeader>
          <div className="px-4 pb-6 overflow-y-auto">
            {availView === "calendar" ? (
              /* ── Month Calendar ── */
              <div>
                <div className="flex items-center justify-between mb-3">
                  <button onClick={() => setCalMonth(p => p.month === 0 ? { year: p.year-1, month: 11 } : { year: p.year, month: p.month-1 })} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100">
                    <ChevronLeft className="size-4 text-slate-500" />
                  </button>
                  <span className="text-sm font-bold text-slate-700">{monthName}</span>
                  <button onClick={() => setCalMonth(p => p.month === 11 ? { year: p.year+1, month: 0 } : { year: p.year, month: p.month+1 })} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100">
                    <ChevronRight className="size-4 text-slate-500" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAY_LABELS_SHORT.map((d, i) => <div key={i} className="text-center text-[10px] font-bold text-slate-400 py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calDays.map((day, i) => {
                    if (day === null) return <div key={`e${i}`} />
                    const dateStr = `${calMonth.year}-${String(calMonth.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`
                    const isOff = offDays.has(dateStr); const isRecOff = isRecurringOff(day)
                    const isToday = dateStr === todayStr; const isPast = dateStr < todayStr
                    // Wave 3j — can't request a NEW off-day more than 14 days out.
                    // Already-off days stay tappable so workers can cancel a long-
                    // standing request even if it's now past the 14-day window.
                    const daysOutFromToday = Math.round(
                      (new Date(dateStr + "T00:00:00").getTime() -
                        new Date(todayStr + "T00:00:00").getTime()) / 86400000
                    )
                    const isTooFar = daysOutFromToday > 14 && !isOff
                    const dayOff = isOff || isRecOff
                    const disabled = isPast || isTooFar || togglingDate === dateStr
                    return (
                      <button key={dateStr} onClick={() => !disabled && toggleDay(dateStr)} disabled={disabled}
                        className="relative size-9 rounded-lg text-xs font-semibold flex items-center justify-center transition-all"
                        title={isTooFar ? "Locked — only 2 weeks ahead" : undefined}
                        style={{
                          background: isOff ? "#ef444420" : isRecOff ? "#ef444410" : isToday ? `${theme.accent}15` : "transparent",
                          color: isPast || isTooFar ? "#cbd5e1" : dayOff ? "#ef4444" : isToday ? theme.accent : "#475569",
                          border: isToday ? `2px solid ${theme.accent}` : dayOff ? "2px solid #ef444440" : "2px solid transparent",
                          opacity: togglingDate === dateStr ? 0.5 : isTooFar ? 0.4 : 1,
                          cursor: disabled ? "default" : "pointer",
                        }}
                      >
                        {day}
                        {isOff && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-400" />}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-3 text-center">Tap a day to request off · only 2 weeks ahead</p>
                {availError && (
                  <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 text-center">
                    {availError}
                  </div>
                )}
              </div>
            ) : (
              /* ── Weekly Hours ── */
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400 mb-2">Set your regular weekly hours.</p>
                {DAYS_OF_WEEK.map((day, i) => {
                  const info = weekly[day] || { available: true, start: "08:00", end: "18:00" }
                  return (
                    <div key={day} className="flex items-center gap-2 py-1.5" style={{ borderBottom: i < 6 ? "1px solid #f1f0eb" : "none" }}>
                      <button onClick={() => updateWeeklyDay(day, { available: !info.available })}
                        className="size-7 rounded-lg text-[10px] font-bold flex items-center justify-center shrink-0"
                        style={{
                          background: info.available ? `${theme.accent}15` : "#fee2e2",
                          color: info.available ? theme.accent : "#ef4444",
                          border: `2px solid ${info.available ? `${theme.accent}40` : "#fca5a540"}`,
                        }}
                      >{DAY_LABELS_FULL[i]}</button>
                      {info.available ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <select value={info.start || "08:00"} onChange={e => updateWeeklyDay(day, { start: e.target.value })} className="text-xs bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-slate-600">
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatHour(t)}</option>)}
                          </select>
                          <span className="text-[10px] text-slate-400">to</span>
                          <select value={info.end || "18:00"} onChange={e => updateWeeklyDay(day, { end: e.target.value })} className="text-xs bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-slate-600">
                            {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatHour(t)}</option>)}
                          </select>
                        </div>
                      ) : (
                        <span className="text-xs text-red-400 font-medium">Off</span>
                      )}
                    </div>
                  )
                })}
                {weeklyDirty && (
                  <button onClick={saveWeekly} disabled={savingWeekly}
                    className="w-full mt-2 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                    style={{ background: theme.accent, opacity: savingWeekly ? 0.6 : 1 }}
                  >
                    {savingWeekly ? <><Loader2 className="size-4 animate-spin" /> Saving...</> : "Save Schedule"}
                  </button>
                )}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

/* ═══ VISIT PROGRESS DOTS (shared by day + week views) ═══ */
function VisitProgressDots({ visitStatus }: { visitStatus: string | null }) {
  const currentIdx = getVisitStepIndex(visitStatus)
  return (
    <div className="flex items-center gap-1">
      {VISIT_STEPS.map((step, i) => {
        const isDone = i <= currentIdx
        const isCurrent = i === currentIdx
        return (
          <div
            key={step.key}
            title={step.label}
            className="rounded-full transition-all"
            style={{
              width: isCurrent ? 16 : 6,
              height: 6,
              borderRadius: isCurrent ? 3 : 3,
              background: isDone ? step.color : "#e2e8f0",
              boxShadow: isCurrent ? `0 0 6px ${step.color}60` : "none",
            }}
          />
        )
      })}
    </div>
  )
}

/* ═══ DAY VIEW ═══ */
function DayView({ jobs, onJobClick, theme }: { jobs: Job[]; onJobClick: (j: Job) => void; theme: typeof DEFAULT_THEME }) {
  if (jobs.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Calendar className="size-10 text-slate-300 mb-3" />
      <p className="text-sm font-semibold text-slate-500">No jobs scheduled</p>
      <p className="text-xs text-slate-400 mt-1">Enjoy your day off!</p>
    </div>
  )

  // Sort by time
  const sorted = [...jobs].sort((a, b) => (a.scheduled_at || "99:99").localeCompare(b.scheduled_at || "99:99"))

  return (
    <div className="px-4 py-3 space-y-2">
      {sorted.map(job => {
        const isEstimate = job.job_type === "estimate" || job.job_type === "sales_appointment"
        const vs = job.visit_status
        const visitMeta = vs ? VISIT_STATUS_META[vs] : null
        const borderColor = isEstimate ? "#f59e0b" : (visitMeta?.color || STATUS_COLORS[job.status] || "#6b7280")
        const endTime = getEndTime(job.scheduled_at, job.hours)
        const serviceBadge = getServiceBadgeStyle(job.service_type)

        return (
          <button
            key={job.id}
            onClick={() => onJobClick(job)}
            className="w-full text-left rounded-xl overflow-hidden active:scale-[0.98] transition-transform"
            style={{
              background: "#fff",
              boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
              borderLeft: `4px solid ${borderColor}`,
            }}
          >
            <div className="p-3">
              {/* Top row: time + badges */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold" style={{ color: borderColor }}>
                  {formatTime12(job.scheduled_at)}
                  {endTime ? ` - ${formatTime12(endTime)}` : ""}
                </span>
                <div className="flex items-center gap-1.5">
                  {/* Service type badge */}
                  {job.service_type && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                      style={{ background: serviceBadge.bg, color: serviceBadge.color, borderColor: `${serviceBadge.color}30` }}>
                      {humanize(job.service_type)}
                    </span>
                  )}
                  {/* Visit status badge */}
                  {isEstimate ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: "#f59e0b" }}>
                      APPT
                    </span>
                  ) : visitMeta ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: visitMeta.bg, color: visitMeta.color }}>
                      {visitMeta.label}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: STATUS_COLORS[job.status] || "#6b7280" }}>
                      {humanize(job.status)}
                    </span>
                  )}
                </div>
              </div>

              {/* Customer name */}
              {job.customer_first_name && (
                <p className="text-sm font-semibold text-slate-800 mb-0.5">{job.customer_first_name}</p>
              )}

              {/* Address */}
              {job.address && (
                <p className="text-xs text-slate-400 truncate flex items-center gap-1 mb-1.5">
                  <MapPin className="size-3 shrink-0" />
                  {job.address}
                </p>
              )}

              {/* Visit progress dots */}
              {!isEstimate && vs && (
                <div className="mb-1">
                  <VisitProgressDots visitStatus={vs} />
                </div>
              )}

              {/* Bottom: hours */}
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                {job.hours && <span className="flex items-center gap-0.5"><Clock className="size-3" />{job.hours}h</span>}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ═══ WEEK VIEW ═══ */
function WeekView({ weekDays, jobsByDate, currentDate, todayStr, onJobClick, onDayClick, theme }: {
  weekDays: string[]; jobsByDate: Record<string, Job[]>; currentDate: string; todayStr: string
  onJobClick: (j: Job) => void; onDayClick: (d: string) => void; theme: typeof DEFAULT_THEME
}) {
  return (
    <div className="grid grid-cols-7 gap-px h-full min-h-[400px]" style={{ background: "#e8e5de" }}>
      {weekDays.map(dateStr => {
        const d = new Date(dateStr + "T12:00:00")
        const dayNum = d.getDate()
        const dayLabel = DAY_LABELS_FULL[d.getDay()]
        const isToday = dateStr === todayStr
        const dayJobs = (jobsByDate[dateStr] || []).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))

        return (
          <div key={dateStr} className="flex flex-col min-h-0" style={{ background: "#fff" }}>
            {/* Column header */}
            <button
              onClick={() => onDayClick(dateStr)}
              className="py-2 text-center border-b shrink-0"
              style={{ borderColor: "#f1f0eb" }}
            >
              <div className="text-[10px] font-medium text-slate-400">{dayLabel}</div>
              <div
                className="text-sm font-bold mx-auto size-7 rounded-full flex items-center justify-center"
                style={{
                  background: isToday ? theme.accent : "transparent",
                  color: isToday ? "#fff" : "#334155",
                }}
              >
                {dayNum}
              </div>
            </button>

            {/* Job chips */}
            <div className="flex-1 overflow-y-auto p-1 space-y-1">
              {dayJobs.map(job => {
                const isEst = job.job_type === "estimate" || job.job_type === "sales_appointment"
                const vs = job.visit_status
                const visitMeta = vs ? VISIT_STATUS_META[vs] : null
                const chipColor = isEst ? "#f59e0b" : (visitMeta?.color || STATUS_COLORS[job.status] || "#6b7280")
                return (
                  <button
                    key={job.id}
                    onClick={(e) => { e.stopPropagation(); onJobClick(job) }}
                    className="w-full text-left rounded-md p-1.5 transition-colors hover:brightness-95 active:scale-95"
                    style={{
                      background: `${chipColor}12`,
                      borderLeft: `3px solid ${chipColor}`,
                    }}
                  >
                    <div className="text-[9px] font-bold" style={{ color: chipColor }}>
                      {formatTimeShort(job.scheduled_at)}
                    </div>
                    <div className="text-[10px] font-medium text-slate-700 truncate">
                      {job.customer_first_name || (job.service_type ? humanize(job.service_type) : "Job")}
                    </div>
                    {!isEst && vs && vs !== "not_started" && (
                      <div className="text-[8px] font-bold mt-0.5" style={{ color: chipColor }}>
                        {visitMeta?.label || humanize(job.status)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
