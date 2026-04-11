"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, Plus, X,
  Check, Clock, MapPin, User, Calendar,
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

type Cleaner = {
  id: number
  name: string
  phone: string
  is_team_lead: boolean
  employee_type: string | null
  active: boolean
}

type CreateForm = {
  customer_name: string
  phone: string
  address: string
  service_type: string
  date: string
  time: string
  assign_to: string
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
  return d.toISOString().split("T")[0]
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
  const duration = hours || 2
  const end = new Date(start.getTime() + duration * 60 * 60 * 1000)
  return formatTimeShort(end.toISOString())
}

function extractCity(address: string | null): string {
  if (!address) return ""
  const parts = address.split(",")
  if (parts.length >= 2) {
    return parts[parts.length - 2].trim().split(" ")[0]
  }
  return parts[0].trim().split(" ").slice(-1)[0] || ""
}

function formatServiceType(st: string | null): string {
  if (!st) return "Service"
  return st
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
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

const STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <Check className="h-3 w-3 text-green-400" />,
  in_progress: <Clock className="h-3 w-3 text-yellow-400 animate-pulse" />,
  not_completed: <X className="h-3 w-3 text-red-400" />,
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ScheduleAdminPage() {
  const { isAdmin } = useAuth()
  const [viewMode, setViewMode] = useState<"day" | "week">("week")
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState<Job[]>([])
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set())
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState<CreateForm>({
    customer_name: "",
    phone: "",
    address: "",
    service_type: "exterior_windows",
    date: toDateStr(new Date()),
    time: "08:00",
    assign_to: "",
  })
  const [creating, setCreating] = useState(false)

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )

  const teamLeads = useMemo(
    () => cleaners.filter(c => c.is_team_lead),
    [cleaners],
  )

  // ── Data fetching ──

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const dateStr = viewMode === "week" ? toDateStr(weekStart) : toDateStr(currentDate)
      const range = viewMode === "week" ? "week" : "day"

      const [jobsRes, crewsRes] = await Promise.all([
        fetch(`/api/actions/my-jobs?date=${dateStr}&range=${range}`),
        fetch(`/api/actions/crews?date=${dateStr}&week=${viewMode === "week"}`),
      ])

      const jobsData = await jobsRes.json()
      const crewsData = await crewsRes.json()

      setJobs(jobsData.jobs || [])
      setCleaners(crewsData.cleaners || [])
    } catch (err) {
      console.error("Failed to load schedule data:", err)
    }
    setLoading(false)
  }, [weekStart, currentDate, viewMode])

  useEffect(() => { loadData() }, [loadData])

  // ── Computed data ──

  // Group jobs by date, then by cleaner_id
  const jobsByDateAndCleaner = useMemo(() => {
    const map = new Map<string, Map<number, Job[]>>()
    for (const job of jobs) {
      const date = job.date
      if (!map.has(date)) map.set(date, new Map())
      const cleanerId = job.cleaner_id || 0
      const cleanerMap = map.get(date)!
      if (!cleanerMap.has(cleanerId)) cleanerMap.set(cleanerId, [])
      cleanerMap.get(cleanerId)!.push(job)
    }
    return map
  }, [jobs])

  // Get team leads with jobs on a specific date
  function getLeadsForDate(dateStr: string): { cleaner: Cleaner; jobs: Job[] }[] {
    const cleanerMap = jobsByDateAndCleaner.get(dateStr)
    if (!cleanerMap) return []

    const results: { cleaner: Cleaner; jobs: Job[] }[] = []

    for (const tl of teamLeads) {
      const tlJobs = cleanerMap.get(tl.id)
      if (tlJobs && tlJobs.length > 0) {
        results.push({ cleaner: tl, jobs: tlJobs })
      }
    }

    // Include unassigned jobs (cleaner_id = 0 or null)
    const unassigned = cleanerMap.get(0)
    if (unassigned && unassigned.length > 0) {
      results.push({
        cleaner: { id: 0, name: "Unassigned", phone: "", is_team_lead: false, employee_type: null, active: true },
        jobs: unassigned,
      })
    }

    // Include non-team-lead cleaners who have jobs
    for (const [cleanerId, cJobs] of cleanerMap) {
      if (cleanerId === 0) continue
      if (teamLeads.some(tl => tl.id === cleanerId)) continue
      const cleaner = cleaners.find(c => c.id === cleanerId)
      if (cleaner) {
        results.push({ cleaner, jobs: cJobs })
      }
    }

    return results
  }

  // Toggle expanded state for a team lead on a given date
  function toggleExpand(dateStr: string, cleanerId: number) {
    const key = `${dateStr}-${cleanerId}`
    setExpandedLeads(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Navigation ──

  function navigateBack() {
    if (viewMode === "week") {
      setWeekStart(prev => addDays(prev, -7))
    } else {
      setCurrentDate(prev => addDays(prev, -1))
    }
  }

  function navigateForward() {
    if (viewMode === "week") {
      setWeekStart(prev => addDays(prev, 7))
    } else {
      setCurrentDate(prev => addDays(prev, 1))
    }
  }

  function goToday() {
    const now = new Date()
    setCurrentDate(now)
    setWeekStart(getMonday(now))
  }

  function isToday(d: Date): boolean {
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }

  // ── Create job ──

  async function handleCreate() {
    setCreating(true)
    try {
      const scheduledAt = `${createForm.date}T${createForm.time}:00`
      await fetch("/api/actions/my-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: createForm.customer_name,
          phone_number: createForm.phone,
          address: createForm.address,
          service_type: createForm.service_type,
          date: createForm.date,
          scheduled_at: scheduledAt,
          cleaner_id: createForm.assign_to ? Number(createForm.assign_to) : null,
        }),
      })
      setShowCreateModal(false)
      setCreateForm({
        customer_name: "",
        phone: "",
        address: "",
        service_type: "exterior_windows",
        date: toDateStr(new Date()),
        time: "08:00",
        assign_to: "",
      })
      loadData()
    } catch (err) {
      console.error("Failed to create job:", err)
    }
    setCreating(false)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const dateLabel = viewMode === "week"
    ? `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${addDays(weekStart, 6).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })

  return (
    <div className="space-y-4 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Schedule</h1>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border/50 overflow-hidden">
            <button
              onClick={() => setViewMode("day")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "day"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted/50 text-muted-foreground"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted/50 text-muted-foreground"
              }`}
            >
              Week
            </button>
          </div>

          {/* Nav */}
          <button
            onClick={navigateBack}
            className="p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-sm rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            Today
          </button>
          <button
            onClick={navigateForward}
            className="p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground ml-1 hidden sm:inline">{dateLabel}</span>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "week" ? (
        /* ── Weekly Grid ── */
        <div className="overflow-x-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 min-w-[700px]">
            {weekDays.map(day => {
              const dateStr = toDateStr(day)
              const today = isToday(day)
              const leads = getLeadsForDate(dateStr)
              const dayTotal = leads.reduce(
                (sum, l) => sum + l.jobs.reduce((s, j) => s + (Number(j.price) || 0), 0),
                0,
              )

              return (
                <div
                  key={dateStr}
                  className={`rounded-xl border p-2 min-h-[200px] transition-colors ${
                    today
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/30 bg-card/30"
                  }`}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border/20">
                    <span className={`text-xs font-semibold ${today ? "text-primary" : "text-muted-foreground"}`}>
                      {day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                    {dayTotal > 0 && (
                      <span className="text-[10px] font-semibold text-green-400">
                        ${dayTotal.toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Team leads */}
                  {leads.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground/50 italic py-4 text-center">
                      No jobs scheduled
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {leads.map(({ cleaner, jobs: cJobs }) => {
                        const key = `${dateStr}-${cleaner.id}`
                        const isExpanded = expandedLeads.has(key)
                        const leadTotal = cJobs.reduce((s, j) => s + (Number(j.price) || 0), 0)

                        return (
                          <div key={key}>
                            {/* Team lead row — click to expand */}
                            <button
                              onClick={() => toggleExpand(dateStr, cleaner.id)}
                              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left transition-colors ${
                                isExpanded
                                  ? "bg-blue-500/15 border border-blue-500/20"
                                  : "hover:bg-muted/30 border border-transparent"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <User className="h-3 w-3 text-blue-400 shrink-0" />
                                <span className="text-[11px] font-semibold text-foreground truncate">
                                  {cleaner.name}
                                </span>
                              </div>
                              <span className={`text-[10px] font-medium shrink-0 ml-1 px-1.5 py-0.5 rounded-full ${
                                cleaner.id === 0
                                  ? "bg-zinc-500/20 text-zinc-400"
                                  : "bg-blue-500/20 text-blue-400"
                              }`}>
                                {cJobs.length}
                              </span>
                            </button>

                            {/* Expanded: Job blocks */}
                            {isExpanded && (
                              <div className="mt-1 space-y-1 pl-1">
                                {cJobs.map(job => (
                                  <div
                                    key={job.id}
                                    className={`rounded-lg border-l-[3px] bg-card/60 border border-border/20 px-2 py-1.5 ${
                                      STATUS_BORDER[job.status] || "border-l-zinc-500"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      {STATUS_ICON[job.status] || (
                                        <div className="h-3 w-3 rounded-full border-2 border-blue-400/50" />
                                      )}
                                      <span className="text-[11px] font-bold text-foreground">
                                        {formatTimeShort(job.scheduled_at)}
                                        {job.scheduled_at && (
                                          <span className="text-muted-foreground font-normal">
                                            {" "}-{" "}{getEndTime(job.scheduled_at, job.hours)}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-foreground mt-0.5">
                                      {formatServiceType(job.service_type)}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                                      {extractCity(job.address) || "No location"}
                                    </div>
                                    {job.customers && (
                                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                                        {[job.customers.first_name, job.customers.last_name].filter(Boolean).join(" ")}
                                      </div>
                                    )}
                                  </div>
                                ))}

                                {/* Daily total for this lead */}
                                {leadTotal > 0 && (
                                  <div className="text-[11px] font-semibold text-green-400 pt-1 pl-2">
                                    ${leadTotal.toLocaleString()} scheduled
                                  </div>
                                )}
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
        </div>
      ) : (
        /* ── Day View ── */
        (() => {
          const dateStr = toDateStr(currentDate)
          const leads = getLeadsForDate(dateStr)
          const dayTotal = leads.reduce(
            (sum, l) => sum + l.jobs.reduce((s, j) => s + (Number(j.price) || 0), 0),
            0,
          )

          return (
            <div className="space-y-3">
              {leads.length === 0 ? (
                <div className="rounded-xl border border-border/30 bg-card/30 p-8 text-center">
                  <Calendar className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No jobs scheduled for this day</p>
                </div>
              ) : (
                leads.map(({ cleaner, jobs: cJobs }) => {
                  const leadTotal = cJobs.reduce((s, j) => s + (Number(j.price) || 0), 0)

                  return (
                    <div
                      key={cleaner.id}
                      className="rounded-xl border border-border/30 bg-card/30 p-3"
                    >
                      {/* Team lead header */}
                      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/20">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <User className="h-3.5 w-3.5 text-blue-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold">{cleaner.name}</p>
                            <p className="text-[10px] text-muted-foreground">{cJobs.length} job{cJobs.length !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        {leadTotal > 0 && (
                          <span className="text-sm font-semibold text-green-400">
                            ${leadTotal.toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* Job blocks */}
                      <div className="space-y-2">
                        {cJobs.map(job => (
                          <div
                            key={job.id}
                            className={`rounded-lg border-l-[3px] bg-card/80 border border-border/20 p-3 ${
                              STATUS_BORDER[job.status] || "border-l-zinc-500"
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                {STATUS_ICON[job.status] || (
                                  <div className="h-3.5 w-3.5 rounded-full border-2 border-blue-400/50 mt-0.5" />
                                )}
                                <div>
                                  <p className="text-xs font-bold text-foreground">
                                    {formatTimeShort(job.scheduled_at)}
                                    {job.scheduled_at && (
                                      <span className="text-muted-foreground font-normal">
                                        {" "}-{" "}{getEndTime(job.scheduled_at, job.hours)}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-xs text-foreground mt-0.5">
                                    {formatServiceType(job.service_type)}
                                  </p>
                                </div>
                              </div>
                              {job.price && (
                                <span className="text-xs font-semibold text-green-400">
                                  ${Number(job.price).toLocaleString()}
                                </span>
                              )}
                            </div>

                            <div className="mt-2 space-y-0.5">
                              {job.address && (
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  {job.address}
                                </p>
                              )}
                              {job.customers && (
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                                  <User className="h-3 w-3 shrink-0" />
                                  {[job.customers.first_name, job.customers.last_name].filter(Boolean).join(" ")}
                                  {job.phone_number && <span className="text-muted-foreground/60">({job.phone_number})</span>}
                                </p>
                              )}
                              {job.notes && (
                                <p className="text-[10px] text-muted-foreground/70 italic mt-1">{job.notes}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}

              {/* Day total */}
              {dayTotal > 0 && (
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <span className="text-sm font-bold text-green-400">
                    ${dayTotal.toLocaleString()} scheduled
                  </span>
                </div>
              )}
            </div>
          )
        })()
      )}

      {/* ── FAB: Add Job ── */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        <Plus className="h-6 w-6" />
      </button>

      {/* ── Create Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border/50 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in">
            {/* Modal header */}
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h2 className="text-sm font-bold">Add Job / Appointment</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={createForm.customer_name}
                  onChange={e => setCreateForm(prev => ({ ...prev, customer_name: e.target.value }))}
                  className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="John Smith"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Phone
                </label>
                <input
                  type="tel"
                  value={createForm.phone}
                  onChange={e => setCreateForm(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="(309) 555-1234"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Address
                </label>
                <input
                  type="text"
                  value={createForm.address}
                  onChange={e => setCreateForm(prev => ({ ...prev, address: e.target.value }))}
                  className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  placeholder="123 Main St, Morton, IL"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Service Type
                  </label>
                  <select
                    value={createForm.service_type}
                    onChange={e => setCreateForm(prev => ({ ...prev, service_type: e.target.value }))}
                    className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="exterior_windows">Ext. Windows</option>
                    <option value="interior_windows">Int. Windows</option>
                    <option value="interior_exterior_windows">Int/Ext Windows</option>
                    <option value="pressure_washing">Pressure Washing</option>
                    <option value="gutter_cleaning">Gutter Cleaning</option>
                    <option value="solar_panel">Solar Panels</option>
                    <option value="estimate">Estimate</option>
                    <option value="sales_appointment">Sales Appointment</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Assign To
                  </label>
                  <select
                    value={createForm.assign_to}
                    onChange={e => setCreateForm(prev => ({ ...prev, assign_to: e.target.value }))}
                    className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    <option value="">Unassigned</option>
                    {cleaners.map(c => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name} {c.is_team_lead ? "(TL)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Date
                  </label>
                  <input
                    type="date"
                    value={createForm.date}
                    onChange={e => setCreateForm(prev => ({ ...prev, date: e.target.value }))}
                    className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Time
                  </label>
                  <input
                    type="time"
                    value={createForm.time}
                    onChange={e => setCreateForm(prev => ({ ...prev, time: e.target.value }))}
                    className="mt-1 w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-border/30">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createForm.customer_name || !createForm.date}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
