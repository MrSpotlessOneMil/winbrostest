"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, Plus, MapPin,
  X as XIcon, ChevronDown, GripVertical, Phone, User,
} from "lucide-react"
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core"

/* ══════════════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════════════ */

type Cleaner = {
  id: number; name: string; phone: string
  is_team_lead: boolean; employee_type: string | null; active: boolean
}
type CrewDay = {
  id: number; date: string; team_lead_id: number
  crew_day_members: { cleaner_id: number; role: string }[]
}
type TimeOffEntry = { cleaner_id: number; date: string; reason?: string | null }
type Job = {
  id: number; date: string; scheduled_at: string | null; service_type: string | null
  address: string | null; status: string; price: number | null; hours: number | null
  cleaner_id: number | null; job_type: string | null; cleaner_name: string | null
  phone_number?: string | null; notes?: string | null; frequency?: string | null; customer_id?: number | null
  customers?: { first_name: string | null; last_name: string | null } | null
}

/* ══════════════════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════════════════ */

function getMonday(d: Date): Date {
  const dt = new Date(d); const day = dt.getDay()
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day)); dt.setHours(0, 0, 0, 0); return dt
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseTime(val: string | null): { h: number; m: number } | null {
  if (!val) return null
  if (val.includes("T")) {
    const d = new Date(val)
    if (isNaN(d.getTime())) return null
    return { h: d.getHours(), m: d.getMinutes() }
  }
  const [h, m] = val.split(":").map(Number)
  if (isNaN(h)) return null
  return { h, m: m || 0 }
}

function formatTime12(val: string | null): string {
  const t = parseTime(val)
  if (!t) return "TBD"
  const suffix = t.h >= 12 ? "PM" : "AM"
  const hour = t.h % 12 || 12
  return t.m === 0 ? `${hour}${suffix}` : `${hour}:${String(t.m).padStart(2, "0")}${suffix}`
}

function getEndTimeStr(start: string | null, hours: number | null): string {
  if (!start || !hours) return ""
  const t = parseTime(start)
  if (!t) return ""
  const totalMin = t.h * 60 + t.m + hours * 60
  const endH = Math.floor(totalMin / 60) % 24
  const endM = Math.round(totalMin % 60)
  const suffix = endH >= 12 ? "PM" : "AM"
  const hour = endH % 12 || 12
  return endM === 0 ? `${hour}${suffix}` : `${hour}:${String(endM).padStart(2, "0")}${suffix}`
}

function humanize(v: string | null): string {
  if (!v) return "Service"
  return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function extractCity(address: string | null): string {
  if (!address) return ""
  const parts = address.split(",")
  return parts.length >= 2 ? parts[parts.length - 2].trim().split(" ")[0] : parts[0].trim()
}

const STATUS_BG: Record<string, string> = {
  completed: "bg-green-500/15 border-green-500/30",
  in_progress: "bg-amber-500/15 border-amber-500/30",
  scheduled: "bg-blue-500/15 border-blue-500/30",
  confirmed: "bg-blue-500/15 border-blue-500/30",
  pending: "bg-purple-500/15 border-purple-500/30",
  quoted: "bg-purple-500/15 border-purple-500/30",
  not_completed: "bg-red-500/15 border-red-500/30",
}

const STATUS_MARK: Record<string, React.ReactNode> = {
  completed: <span className="text-green-400 font-bold text-[10px]">&#x2715;</span>,
  in_progress: <span className="text-amber-400 font-bold text-[10px]">&#x25CF;</span>,
  not_completed: <span className="text-red-400 font-bold text-[10px]">!</span>,
}

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  team_lead: { label: "TL", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  technician: { label: "T", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  salesman: { label: "S", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
}

/* ══════════════════════════════════════════════════════════════════════════
   DND COMPONENTS
   ══════════════════════════════════════════════════════════════════════════ */

function DraggableWorker({ cleaner, compact }: { cleaner: Cleaner; compact?: boolean }) {
  const role = cleaner.is_team_lead ? "team_lead" : (cleaner.employee_type || "technician")
  const badge = ROLE_BADGE[role] || ROLE_BADGE.technician
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `worker-${cleaner.id}`, data: { cleaner } })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium cursor-grab active:cursor-grabbing transition-opacity ${badge.color} ${isDragging ? "opacity-30" : ""} ${compact ? "py-0.5 text-[10px]" : ""}`}>
      <GripVertical className="size-3 opacity-40 shrink-0" />
      <span className="font-bold text-[10px]">{badge.label}</span>
      <span className="truncate">{cleaner.name.split(" ")[0]}</span>
    </div>
  )
}

function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`rounded-md transition-colors min-h-[2rem] ${isOver ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════════════════ */

export default function CrewAssignmentPage() {
  const { isAdmin, user, cleanerId } = useAuth()

  // ── Shared state ──
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<"week" | "day">("week")
  const [selectedDay, setSelectedDay] = useState(() => toDateStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ── Data ──
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [crewDays, setCrewDays] = useState<CrewDay[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  // ── Admin UI state ──
  const [expandedTLs, setExpandedTLs] = useState<Set<string>>(new Set())
  const [expandedTs, setExpandedTs] = useState<Set<string>>(new Set())
  const [expandedSs, setExpandedSs] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<Cleaner | null>(null)
  const [localAssignments, setLocalAssignments] = useState<Map<string, { team_lead_id: number; members: { cleaner_id: number; role: string }[] }[]>>(new Map())
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  // ── Worker UI state ──
  const [expandedJob, setExpandedJob] = useState<number | null>(null)
  const [togglingOff, setTogglingOff] = useState<string | null>(null)

  // DnD sensors (admin only)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayStr = toDateStr(new Date())

  // ── Categorize cleaners (admin) ──
  const teamLeads = useMemo(() => cleaners.filter(c => c.is_team_lead && c.active), [cleaners])
  const technicians = useMemo(() => cleaners.filter(c => !c.is_team_lead && c.employee_type !== "salesman" && c.active), [cleaners])
  const salesmen = useMemo(() => cleaners.filter(c => c.employee_type === "salesman" && !c.is_team_lead && c.active), [cleaners])

  const timeOffSet = useMemo(() => {
    const s = new Set<string>()
    for (const t of timeOff) s.add(`${t.cleaner_id}-${t.date}`)
    return s
  }, [timeOff])
  const isOff = (cId: number, date: string) => timeOffSet.has(`${cId}-${date}`)

  const jobsByDateCleaner = useMemo(() => {
    const m: Record<string, Record<number, Job[]>> = {}
    for (const j of jobs) {
      if (j.status === "cancelled") continue
      if (!m[j.date]) m[j.date] = {}
      const cid = j.cleaner_id || 0
      if (!m[j.date][cid]) m[j.date][cid] = []
      m[j.date][cid].push(j)
    }
    return m
  }, [jobs])

  const getAssignments = useCallback((dateStr: string) => {
    if (localAssignments.has(dateStr)) return localAssignments.get(dateStr)!
    return crewDays.filter(cd => cd.date === dateStr).map(cd => ({ team_lead_id: cd.team_lead_id, members: cd.crew_day_members || [] }))
  }, [localAssignments, crewDays])

  const getMembersForTL = useCallback((dateStr: string, tlId: number) => {
    const dayAsn = getAssignments(dateStr)
    const tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
    return (tlAsn?.members || []).map(m => cleaners.find(c => c.id === m.cleaner_id)).filter(Boolean) as Cleaner[]
  }, [getAssignments, cleaners])

  const getAssignedIdsForDay = useCallback((dateStr: string): Set<number> => {
    const dayAsn = getAssignments(dateStr)
    const ids = new Set<number>()
    for (const a of dayAsn) {
      for (const m of a.members) ids.add(m.cleaner_id)
    }
    return ids
  }, [getAssignments])

  const getAvailableTLs = useCallback((dateStr: string) => teamLeads.filter(tl => !isOff(tl.id, dateStr)), [teamLeads, isOff])
  const getAvailableTs = useCallback((dateStr: string) => {
    const assigned = getAssignedIdsForDay(dateStr)
    return technicians.filter(t => !isOff(t.id, dateStr) && !assigned.has(t.id))
  }, [technicians, isOff, getAssignedIdsForDay])
  const getAvailableSs = useCallback((dateStr: string) => {
    const assigned = getAssignedIdsForDay(dateStr)
    return salesmen.filter(s => !isOff(s.id, dateStr) && !assigned.has(s.id))
  }, [salesmen, isOff, getAssignedIdsForDay])

  // ── Fetch data ──
  const fetchData = useCallback(async () => {
    const dateStr = toDateStr(weekStart)
    try {
      const [crewRes, jobsRes] = await Promise.all([
        fetch(`/api/actions/crews?date=${dateStr}&week=true`).then(r => r.json()),
        fetch(`/api/actions/my-jobs?date=${dateStr}&range=week`).then(r => r.json()),
      ])
      setCleaners(crewRes.cleaners || [])
      setCrewDays(crewRes.crewDays || [])
      setTimeOff(crewRes.timeOff || [])
      setJobs(jobsRes.jobs || [])
      setLocalAssignments(new Map()); setDirty(new Set())
    } catch { }
    setLoading(false)
  }, [weekStart])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])

  // ── Load worker time-off ──
  const [workerTimeOff, setWorkerTimeOff] = useState<TimeOffEntry[]>([])
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  useEffect(() => {
    if (isAdmin || !cleanerId || cleanerId <= 0) return
    const monthStr = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}`
    fetch(`/api/actions/time-off?month=${monthStr}&cleaner_id=${cleanerId}`).then(r => r.json()).then(d => setWorkerTimeOff(d.timeOff || [])).catch(() => { })
  }, [calendarMonth, cleanerId, isAdmin])

  // ── Navigation ──
  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))
  const goToday = () => { setWeekStart(getMonday(new Date())); setSelectedDay(todayStr) }

  // ── Admin: drag handlers ──
  const handleDragStart = (e: DragStartEvent) => setDragItem((e.active.data.current as any)?.cleaner || null)
  const handleDragEnd = (e: DragEndEvent) => {
    setDragItem(null)
    if (!e.over) return
    const cleaner = (e.active.data.current as any)?.cleaner as Cleaner
    if (!cleaner) return
    const parts = (e.over.id as string).split("|")
    if (parts.length !== 3) return
    const [, dateStr, tlIdStr] = parts
    const tlId = Number(tlIdStr)
    setLocalAssignments(prev => {
      const next = new Map(prev)
      const dayAsn = [...(next.get(dateStr) || getAssignments(dateStr))]
      let tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
      if (!tlAsn) { tlAsn = { team_lead_id: tlId, members: [] }; dayAsn.push(tlAsn) }
      if (!tlAsn.members.find(m => m.cleaner_id === cleaner.id)) {
        tlAsn.members = [...tlAsn.members, { cleaner_id: cleaner.id, role: cleaner.employee_type || "technician" }]
      }
      next.set(dateStr, dayAsn); return next
    })
    setDirty(prev => new Set(prev).add(dateStr))
  }

  // ── Admin: save/remove ──
  const saveDay = async (dateStr: string) => {
    setSaving(true)
    const dayAsn = localAssignments.get(dateStr)
    if (!dayAsn) { setSaving(false); return }
    try {
      await fetch("/api/actions/crews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: dateStr, assignments: dayAsn }) })
      setDirty(prev => { const n = new Set(prev); n.delete(dateStr); return n })
      fetchData()
    } catch { }
    setSaving(false)
  }
  const removeMember = (dateStr: string, tlId: number, cId: number) => {
    setLocalAssignments(prev => {
      const next = new Map(prev)
      const dayAsn = [...(next.get(dateStr) || getAssignments(dateStr))]
      const tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
      if (tlAsn) tlAsn.members = tlAsn.members.filter(m => m.cleaner_id !== cId)
      next.set(dateStr, dayAsn); return next
    })
    setDirty(prev => new Set(prev).add(dateStr))
  }

  // ── Worker: toggle time off ──
  const toggleTimeOff = async (dateStr: string) => {
    if (!cleanerId || cleanerId <= 0) return
    setTogglingOff(dateStr)
    const isCurrentlyOff = workerTimeOff.some(t => t.date === dateStr)
    try {
      if (isCurrentlyOff) {
        await fetch("/api/actions/time-off", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cleaner_id: cleanerId, dates: [dateStr] }) })
        setWorkerTimeOff(prev => prev.filter(t => t.date !== dateStr))
      } else {
        await fetch("/api/actions/time-off", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cleaner_id: cleanerId, dates: [dateStr] }) })
        setWorkerTimeOff(prev => [...prev, { cleaner_id: cleanerId, date: dateStr }])
      }
    } catch { }
    setTogglingOff(null)
  }

  // ── Toggles ──
  const toggleTL = (key: string) => setExpandedTLs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleT = (key: string) => setExpandedTs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleS = (key: string) => setExpandedSs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const weeklyTotal = useMemo(() => jobs.reduce((s, j) => s + (j.status !== "cancelled" ? (j.price || 0) : 0), 0), [jobs])

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>

  const daysToShow = viewMode === "week" ? weekDays : [weekDays.find(d => toDateStr(d) === selectedDay) || weekDays[0]]
  const monthName = weekStart.toLocaleString("en-US", { month: "long" })

  /* ════════════════════════════════════════════════════════════════════════
     WORKER VIEW — Simple on/off day calendar (no jobs, no times)
     ════════════════════════════════════════════════════════════════════════ */
  const showWorkerView = !isAdmin
  if (showWorkerView) {
    const workerOffSet = new Set(workerTimeOff.map(t => t.date))
    const calYear = calendarMonth.getFullYear()
    const calMonth = calendarMonth.getMonth()
    const firstDow = new Date(calYear, calMonth, 1).getDay()
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const calLabel = calendarMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    const WKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)
    const twoWeeksOut = new Date(todayDate)
    twoWeeksOut.setDate(twoWeeksOut.getDate() + 14)

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground">Off Days</h1>
            <p className="text-xs text-muted-foreground">Tap a date to toggle availability</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setCalendarMonth(p => { const n = new Date(p); n.setMonth(n.getMonth() - 1); return n })}
              className="p-2 rounded-md hover:bg-muted transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <h2 className="text-base font-semibold text-foreground">{calLabel}</h2>
            <button
              onClick={() => setCalendarMonth(p => { const n = new Date(p); n.setMonth(n.getMonth() + 1); return n })}
              className="p-2 rounded-md hover:bg-muted transition-colors"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-muted-foreground uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Leading empty cells */}
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`pad-${i}`} className="aspect-square" />
            ))}

            {/* Day cells */}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const dayNum = i + 1
              const dayDate = new Date(calYear, calMonth, dayNum)
              const dateStr = toDateStr(dayDate)
              const off = workerOffSet.has(dateStr)
              const isToday = dateStr === todayStr
              const isPast = dayDate < todayDate
              const tooSoon = !isPast && dayDate < twoWeeksOut
              const toggling = togglingOff === dateStr
              const noCleanerId = cleanerId !== null && cleanerId <= 0

              // Past dates: non-clickable, grayed
              // Within 14 days: grayed, non-clickable, show "Text manager" tooltip
              // But if already OFF within 14 days, allow toggling back ON
              const isDisabled = toggling || noCleanerId || isPast || (tooSoon && !off)

              let cellClasses = "relative flex flex-col items-center justify-center rounded-lg aspect-square transition-all text-sm font-medium "

              if (off) {
                // OFF state: red, line-through styling
                cellClasses += "bg-red-500/20 border-2 border-red-500/40 text-red-400 "
              } else if (isPast) {
                cellClasses += "bg-zinc-900/30 text-zinc-600 cursor-not-allowed "
              } else if (tooSoon) {
                cellClasses += "bg-zinc-900/30 text-zinc-500 cursor-not-allowed "
              } else if (isToday) {
                cellClasses += "bg-primary/10 border-2 border-primary/30 text-foreground hover:bg-primary/20 cursor-pointer "
              } else {
                // Available (ON) state: default
                cellClasses += "border border-zinc-800/40 text-foreground hover:bg-muted/40 cursor-pointer "
              }

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    if (isDisabled) return
                    toggleTimeOff(dateStr)
                  }}
                  disabled={isDisabled}
                  title={
                    isPast ? "Past date" :
                    tooSoon && !off ? "Text manager for short-notice requests" :
                    off ? "Tap to mark available" :
                    "Tap to mark off"
                  }
                  className={cellClasses}
                >
                  <span className={off ? "line-through" : ""}>{dayNum}</span>
                  {off && (
                    <span className="text-[8px] font-bold uppercase leading-none mt-0.5 text-red-400">
                      OFF
                    </span>
                  )}
                  {tooSoon && !off && !isPast && (
                    <span className="text-[7px] text-amber-400 font-semibold leading-none mt-0.5">
                      TEXT MGR
                    </span>
                  )}
                  {toggling && (
                    <Loader2 className="absolute top-1 right-1 size-3 animate-spin text-muted-foreground" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-6 mt-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded border border-zinc-800/40 bg-background" />
              <span>Available</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded bg-red-500/20 border-2 border-red-500/40" />
              <span>Off</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="size-3 rounded bg-zinc-900/30" />
              <span>Locked</span>
            </div>
          </div>

          <p className="text-[11px] text-amber-400/70 mt-4 text-center">
            Off-day requests must be at least 2 weeks in advance. Text your manager for short-notice requests.
          </p>
        </div>
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════════════════
     ADMIN VIEW — Weekly calendar with TL schedules, drag-drop assignment
     ════════════════════════════════════════════════════════════════════════ */
  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground">Crew Assignment</h1>
            <p className="text-xs text-muted-foreground">{monthName} {weekStart.getFullYear()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={goToday} className="text-xs text-primary font-medium hover:underline cursor-pointer">Today</button>
            <div className="flex items-center gap-1">
              <button onClick={prevWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted cursor-pointer"><ChevronLeft className="size-4" /></button>
              <button onClick={nextWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted cursor-pointer"><ChevronRight className="size-4" /></button>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["day", "week"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase cursor-pointer ${viewMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{v}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Calendar grid */}
        <div className={`flex-1 overflow-auto grid ${viewMode === "week" ? "grid-cols-7" : "grid-cols-1"} gap-px bg-border`}>
          {daysToShow.map(day => {
            const dateStr = toDateStr(day)
            const isToday = dateStr === todayStr
            const dayTLs = getAvailableTLs(dateStr)
            const dayTs = getAvailableTs(dateStr)
            const daySs = getAvailableSs(dateStr)
            const dayJobs = jobsByDateCleaner[dateStr] || {}
            const dayTotal = Object.values(dayJobs).flat().reduce((s, j) => s + (j.price || 0), 0)
            const isDirty = dirty.has(dateStr)
            const tKey = `t-${dateStr}`
            const sKey = `s-${dateStr}`

            return (
              <div key={dateStr} className={`bg-background flex flex-col ${isToday ? "ring-1 ring-primary/30 ring-inset" : ""}`}>
                {/* Day header */}
                <div className={`px-2 py-1.5 border-b border-border flex items-center justify-between shrink-0 ${isToday ? "bg-primary/5" : ""}`}>
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground">{day.toLocaleDateString("en-US", { weekday: "short" })}</span>
                    <span className={`ml-1 text-sm font-bold ${isToday ? "text-primary" : "text-foreground"}`}>{day.getDate()}</span>
                  </div>
                  {isDirty && (
                    <button onClick={() => saveDay(dateStr)} disabled={saving}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer">
                      {saving ? "..." : "Save"}
                    </button>
                  )}
                </div>

                {/* Day content */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  {/* Team Leads */}
                  {dayTLs.map(tl => {
                    const tlKey = `${dateStr}-${tl.id}`
                    const isExpanded = expandedTLs.has(tlKey)
                    const tlJobs = (dayJobs[tl.id] || []).sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))
                    const members = getMembersForTL(dateStr, tl.id)
                    const tlTotal = tlJobs.reduce((s, j) => s + (j.price || 0), 0)
                    return (
                      <DroppableCell key={tlKey} id={`tl|${dateStr}|${tl.id}`}>
                        <button onClick={() => toggleTL(tlKey)}
                          className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left cursor-pointer">
                          <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1 rounded">TL</span>
                          <span className="text-[11px] font-semibold text-foreground truncate flex-1">{tl.name.split(" ")[0]}</span>
                          {tlJobs.length > 0 && <span className="text-[9px] text-muted-foreground">{tlJobs.length}</span>}
                          <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                        {isExpanded && (
                          <div className="ml-1 pl-2 border-l border-border space-y-1 mt-1">
                            {tlJobs.map(job => {
                              const statusClass = STATUS_BG[job.status] || STATUS_BG.scheduled
                              const isJobExpanded = expandedJob === job.id
                              const isSales = job.job_type === "sales_appointment" || job.service_type === "sales_appointment"
                              return (
                                <div key={job.id}>
                                  <button onClick={() => setExpandedJob(isJobExpanded ? null : job.id)}
                                    className={`w-full text-left rounded px-1.5 py-1 border text-[10px] ${statusClass} ${isSales ? "border-amber-500/30" : ""} cursor-pointer`}>
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-foreground">
                                        {formatTime12(job.scheduled_at)}{job.hours ? ` – ${getEndTimeStr(job.scheduled_at, job.hours)}` : ""}
                                      </span>
                                      {STATUS_MARK[job.status]}
                                    </div>
                                    <div className="text-muted-foreground truncate">
                                      {humanize(job.service_type)}
                                      {isSales && <span className="ml-1 text-[8px] font-bold text-amber-400">SALES</span>}
                                      {job.address ? `, ${job.address.split(",")[0]}` : ""}
                                    </div>
                                  </button>
                                  {isJobExpanded && (
                                    <div className="ml-2 mt-0.5 mb-1 p-2 rounded bg-muted/20 border border-border/20 space-y-1 text-[10px] text-muted-foreground">
                                      {job.address && <div className="flex items-start gap-1.5"><MapPin className="size-3 shrink-0 mt-0.5" /><span>{job.address}</span></div>}
                                      {job.customers && <div className="flex items-center gap-1.5"><User className="size-3 shrink-0" /><span>{[job.customers.first_name, job.customers.last_name].filter(Boolean).join(" ")}</span></div>}
                                      {job.phone_number && <div className="flex items-center gap-1.5"><Phone className="size-3 shrink-0" /><a href={`tel:${job.phone_number}`} className="hover:text-foreground">{job.phone_number}</a></div>}
                                      {job.notes && <p className="text-[9px] italic border-t border-border/10 pt-1 mt-0.5">{job.notes}</p>}
                                      {job.frequency && job.frequency !== "one_time" && (
                                        <span className="inline-block text-[8px] font-semibold text-blue-400 bg-blue-400/10 px-1 py-0.5 rounded uppercase">{job.frequency.replace(/_/g, " ")}</span>
                                      )}
                                      {job.price ? <p className="text-[9px] font-semibold text-green-400">${Number(job.price).toLocaleString()}</p> : null}
                                      {job.customer_id && (
                                        <a href={`/customers?customerId=${job.customer_id}`}
                                          className="inline-flex items-center gap-1 text-[9px] font-semibold text-primary hover:underline cursor-pointer mt-0.5">
                                          See More →
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                            {tlJobs.length === 0 && <p className="text-[9px] text-muted-foreground italic px-1">No jobs</p>}
                            {members.length > 0 && (
                              <div className="space-y-0.5 pt-1 border-t border-border/50">
                                {members.map(m => {
                                  const badge = ROLE_BADGE[m.employee_type || "technician"] || ROLE_BADGE.technician
                                  return (
                                    <div key={m.id} className="flex items-center gap-1 text-[10px]">
                                      <span className={`px-1 rounded text-[8px] font-bold ${badge.color}`}>{badge.label}</span>
                                      <span className="truncate text-foreground">{m.name.split(" ")[0]}</span>
                                      <button onClick={() => removeMember(dateStr, tl.id, m.id)}
                                        className="ml-auto size-4 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive cursor-pointer">
                                        <XIcon className="size-2.5" />
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                            {tlTotal > 0 && <p className="text-[9px] font-medium text-muted-foreground pt-1">${Math.round(tlTotal).toLocaleString()} scheduled</p>}
                          </div>
                        )}
                      </DroppableCell>
                    )
                  })}
                  {dayTLs.length === 0 && <p className="text-[10px] text-muted-foreground italic text-center py-2">No TLs available</p>}

                  {/* Technicians */}
                  {dayTs.length > 0 && (
                    <div>
                      <button onClick={() => toggleT(tKey)}
                        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left cursor-pointer">
                        <span className="text-[9px] font-bold text-green-400 bg-green-500/15 px-1 rounded">T</span>
                        <span className="text-[10px] text-muted-foreground flex-1">Technicians</span>
                        <span className="text-[9px] text-muted-foreground">{dayTs.length}</span>
                        <ChevronDown className={`size-3 text-muted-foreground transition-transform ${expandedTs.has(tKey) ? "rotate-180" : ""}`} />
                      </button>
                      {expandedTs.has(tKey) && (
                        <div className="ml-1 pl-2 border-l border-green-500/20 space-y-1 mt-1">
                          {dayTs.map(t => <DraggableWorker key={t.id} cleaner={t} compact />)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Salesmen */}
                  {daySs.length > 0 && (
                    <div>
                      <button onClick={() => toggleS(sKey)}
                        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left cursor-pointer">
                        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/15 px-1 rounded">S</span>
                        <span className="text-[10px] text-muted-foreground flex-1">Salesmen</span>
                        <span className="text-[9px] text-muted-foreground">{daySs.length}</span>
                        <ChevronDown className={`size-3 text-muted-foreground transition-transform ${expandedSs.has(sKey) ? "rotate-180" : ""}`} />
                      </button>
                      {expandedSs.has(sKey) && (
                        <div className="ml-1 pl-2 border-l border-amber-500/20 space-y-1 mt-1">
                          {daySs.map(s => <DraggableWorker key={s.id} cleaner={s} compact />)}
                        </div>
                      )}
                    </div>
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

        {/* Bottom bar */}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-sm font-bold text-foreground">
            ${Math.round(weeklyTotal).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">this week</span>
          </span>
          <button className="size-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 cursor-pointer">
            <Plus className="size-4" />
          </button>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {dragItem && (
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium shadow-lg ${ROLE_BADGE[dragItem.employee_type || "technician"]?.color || ROLE_BADGE.technician.color}`}>
              <GripVertical className="size-3 opacity-40" />
              <span className="font-bold text-[10px]">{ROLE_BADGE[dragItem.employee_type || "technician"]?.label || "T"}</span>
              <span>{dragItem.name.split(" ")[0]}</span>
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
