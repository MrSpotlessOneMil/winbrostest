"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Users, Loader2, Plus, MapPin,
  Clock, X as XIcon, ChevronDown, GripVertical,
} from "lucide-react"
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core"

/* ─── Types ─── */
type Cleaner = {
  id: number; name: string; phone: string
  is_team_lead: boolean; employee_type: string | null; active: boolean
}
type CrewDay = {
  id: number; date: string; team_lead_id: number
  crew_day_members: { cleaner_id: number; role: string }[]
}
type TimeOffEntry = { cleaner_id: number; date: string }
type Job = {
  id: number; date: string; scheduled_at: string | null; service_type: string | null
  address: string | null; status: string; price: number | null; hours: number | null
  cleaner_id: number | null; job_type: string | null; cleaner_name: string | null
  customers?: { first_name: string | null; last_name: string | null }
}

/* ─── Helpers ─── */
function getMonday(d: Date): Date {
  const dt = new Date(d); const day = dt.getDay()
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day)); dt.setHours(0,0,0,0); return dt
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate()+n); return r }
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}
function formatTime12(t: string | null) {
  if (!t) return "TBD"
  const [h, m] = t.split(":").map(Number)
  return `${h%12||12}:${String(m||0).padStart(2,"0")} ${h>=12?"PM":"AM"}`
}
function getEndTime(start: string | null, hours: number | null): string | null {
  if (!start || !hours) return null
  const [h,m] = start.split(":").map(Number)
  const total = h*60+(m||0)+hours*60
  return `${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(Math.round(total%60)).padStart(2,"0")}`
}
function humanize(v: string) { return v.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()) }

const STATUS_BG: Record<string,string> = {
  completed: "bg-green-500/15 border-green-500/30",
  in_progress: "bg-amber-500/15 border-amber-500/30",
  scheduled: "bg-blue-500/15 border-blue-500/30",
  confirmed: "bg-blue-500/15 border-blue-500/30",
  pending: "bg-purple-500/15 border-purple-500/30",
  quoted: "bg-purple-500/15 border-purple-500/30",
}

const ROLE_BADGE: Record<string, { label: string; color: string }> = {
  team_lead: { label: "TL", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  technician: { label: "T", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  salesman: { label: "S", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
}

/* ─── Draggable Worker Chip ─── */
function DraggableWorker({ cleaner, compact }: { cleaner: Cleaner; compact?: boolean }) {
  const role = cleaner.is_team_lead ? "team_lead" : (cleaner.employee_type || "technician")
  const badge = ROLE_BADGE[role] || ROLE_BADGE.technician
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `worker-${cleaner.id}`, data: { cleaner } })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium cursor-grab active:cursor-grabbing transition-opacity ${badge.color} ${isDragging ? "opacity-30" : ""} ${compact ? "py-0.5 text-[10px]" : ""}`}
    >
      <GripVertical className="size-3 opacity-40 shrink-0" />
      <span className="font-bold text-[10px]">{badge.label}</span>
      <span className="truncate">{cleaner.name.split(" ")[0]}</span>
    </div>
  )
}

/* ─── Droppable Team Lead Cell ─── */
function DroppableTeamLeadCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`rounded-md transition-colors min-h-[2rem] ${isOver ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}>
      {children}
    </div>
  )
}

/* ═══ MAIN PAGE ═══ */
export default function CrewAssignmentPage() {
  const { isAdmin } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<"week" | "day">("week")
  const [selectedDay, setSelectedDay] = useState(() => toDateStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Data
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [crewDays, setCrewDays] = useState<CrewDay[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([])
  const [jobs, setJobs] = useState<Job[]>([])

  // UI state
  const [expandedTLs, setExpandedTLs] = useState<Set<string>>(new Set())
  const [expandedTs, setExpandedTs] = useState<Set<string>>(new Set())
  const [expandedSs, setExpandedSs] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<Cleaner | null>(null)

  // Local assignment changes (pending save)
  const [localAssignments, setLocalAssignments] = useState<Map<string, { team_lead_id: number; members: { cleaner_id: number; role: string }[] }[]>>(new Map())
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  // Week days
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayStr = toDateStr(new Date())

  // Categorize cleaners
  const teamLeads = useMemo(() => cleaners.filter(c => c.is_team_lead && c.active), [cleaners])
  const technicians = useMemo(() => cleaners.filter(c => !c.is_team_lead && c.employee_type !== "salesman" && c.active), [cleaners])
  const salesmen = useMemo(() => cleaners.filter(c => c.employee_type === "salesman" && !c.is_team_lead && c.active), [cleaners])

  // Time-off set for quick lookup
  const timeOffSet = useMemo(() => {
    const s = new Set<string>()
    for (const t of timeOff) s.add(`${t.cleaner_id}-${t.date}`)
    return s
  }, [timeOff])

  const isOff = (cleanerId: number, date: string) => timeOffSet.has(`${cleanerId}-${date}`)

  // Jobs grouped by date → cleaner_id
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

  // Get assignments for a date (local or from server)
  const getAssignments = useCallback((dateStr: string) => {
    if (localAssignments.has(dateStr)) return localAssignments.get(dateStr)!
    return crewDays
      .filter(cd => cd.date === dateStr)
      .map(cd => ({ team_lead_id: cd.team_lead_id, members: cd.crew_day_members || [] }))
  }, [localAssignments, crewDays])

  // Get members assigned to a team lead on a date
  const getMembersForTL = useCallback((dateStr: string, tlId: number) => {
    const dayAsn = getAssignments(dateStr)
    const tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
    return (tlAsn?.members || []).map(m => cleaners.find(c => c.id === m.cleaner_id)).filter(Boolean) as Cleaner[]
  }, [getAssignments, cleaners])

  // Available team leads for a date (not off)
  const getAvailableTLs = useCallback((dateStr: string) => teamLeads.filter(tl => !isOff(tl.id, dateStr)), [teamLeads, isOff])
  const getAvailableTs = useCallback((dateStr: string) => technicians.filter(t => !isOff(t.id, dateStr)), [technicians, isOff])
  const getAvailableSs = useCallback((dateStr: string) => salesmen.filter(s => !isOff(s.id, dateStr)), [salesmen, isOff])

  // Demo data generator for when no real data exists
  const generateDemoData = useCallback((monday: Date) => {
    const demoCleaners: Cleaner[] = [
      { id: 101, name: "Jack Rivera", phone: "(309) 555-0101", is_team_lead: true, employee_type: "team_lead", active: true },
      { id: 102, name: "Marcus Hall", phone: "(309) 555-0102", is_team_lead: true, employee_type: "team_lead", active: true },
      { id: 103, name: "Tyler Brooks", phone: "(309) 555-0103", is_team_lead: false, employee_type: "technician", active: true },
      { id: 104, name: "Noah Patel", phone: "(309) 555-0104", is_team_lead: false, employee_type: "technician", active: true },
      { id: 105, name: "Ryan Garcia", phone: "(309) 555-0105", is_team_lead: false, employee_type: "technician", active: true },
      { id: 106, name: "Derek Shaw", phone: "(309) 555-0106", is_team_lead: false, employee_type: "salesman", active: true },
      { id: 107, name: "Chris Wen", phone: "(309) 555-0107", is_team_lead: false, employee_type: "salesman", active: true },
    ]
    const demoJobs: Job[] = []
    const services = ["window_cleaning", "gutter_cleaning", "pressure_washing", "screen_repair"]
    const addresses = [
      "1423 Oak St, Morton, IL",
      "809 Birch Ln, Pekin, IL",
      "2205 Washington Rd, East Peoria, IL",
      "315 Main St, Peoria Heights, IL",
    ]
    for (let d = 0; d < 6; d++) {
      const day = addDays(monday, d)
      const dateStr = toDateStr(day)
      const leadId = d % 2 === 0 ? 101 : 102
      for (let j = 0; j < 2 + (d % 2); j++) {
        const hour = 8 + j * 2
        demoJobs.push({
          id: d * 100 + j, date: dateStr, scheduled_at: `${String(hour).padStart(2, "0")}:00`,
          service_type: services[(d + j) % 4], address: addresses[(d + j) % 4],
          status: d < 2 ? "completed" : "scheduled", price: [185, 250, 320, 150][(d + j) % 4],
          hours: [1.5, 2, 2.5, 1][(d + j) % 4], cleaner_id: leadId, job_type: null, cleaner_name: null,
        })
      }
    }
    const demoCrewDays: CrewDay[] = []
    for (let d = 0; d < 5; d++) {
      const dateStr = toDateStr(addDays(monday, d))
      demoCrewDays.push({
        id: d + 1, date: dateStr, team_lead_id: d % 2 === 0 ? 101 : 102,
        crew_day_members: [
          { cleaner_id: 103 + (d % 3), role: "technician" },
          ...(d % 2 === 0 ? [{ cleaner_id: 106, role: "salesman" }] : []),
        ],
      })
    }
    const demoTimeOff: TimeOffEntry[] = [
      { cleaner_id: 105, date: toDateStr(addDays(monday, 3)) },
    ]
    return { cleaners: demoCleaners, crewDays: demoCrewDays, timeOff: demoTimeOff, jobs: demoJobs }
  }, [])

  // Fetch data
  const fetchData = useCallback(async () => {
    const dateStr = toDateStr(weekStart)
    try {
      const [crewRes, jobsRes] = await Promise.all([
        fetch(`/api/actions/crews?date=${dateStr}&week=true`).then(r => r.json()),
        fetch(`/api/actions/my-jobs?date=${dateStr}&range=week`).then(r => r.json()),
      ])
      const realCleaners = crewRes.cleaners || []
      if (realCleaners.length === 0) {
        // No crew data — seed with demo
        const demo = generateDemoData(weekStart)
        setCleaners(demo.cleaners)
        setCrewDays(demo.crewDays)
        setTimeOff(demo.timeOff)
        setJobs(demo.jobs)
      } else {
        setCleaners(realCleaners)
        setCrewDays(crewRes.crewDays || [])
        setTimeOff(crewRes.timeOff || [])
        setJobs(jobsRes.jobs || [])
      }
      setLocalAssignments(new Map())
      setDirty(new Set())
    } catch {
      // Fallback to demo on error
      const demo = generateDemoData(weekStart)
      setCleaners(demo.cleaners)
      setCrewDays(demo.crewDays)
      setTimeOff(demo.timeOff)
      setJobs(demo.jobs)
    }
    setLoading(false)
  }, [weekStart, generateDemoData])

  useEffect(() => { setLoading(true); fetchData() }, [fetchData])

  // Navigate
  const prevWeek = () => setWeekStart(addDays(weekStart, -7))
  const nextWeek = () => setWeekStart(addDays(weekStart, 7))
  const goToday = () => { setWeekStart(getMonday(new Date())); setSelectedDay(toDateStr(new Date())) }

  // Drag handlers
  const handleDragStart = (e: DragStartEvent) => {
    setDragItem((e.active.data.current as any)?.cleaner || null)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setDragItem(null)
    if (!e.over) return
    const cleaner = (e.active.data.current as any)?.cleaner as Cleaner
    if (!cleaner) return

    // Droppable ID format: "tl-{date}-{teamLeadId}"
    const [, dateStr, tlIdStr] = (e.over.id as string).split("-")
    if (!dateStr || !tlIdStr) return
    const tlId = Number(tlIdStr)

    // Add member to local assignments
    setLocalAssignments(prev => {
      const next = new Map(prev)
      const dayAsn = [...(next.get(dateStr) || getAssignments(dateStr))]
      let tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
      if (!tlAsn) {
        tlAsn = { team_lead_id: tlId, members: [] }
        dayAsn.push(tlAsn)
      }
      // Don't add duplicates
      if (!tlAsn.members.find(m => m.cleaner_id === cleaner.id)) {
        tlAsn.members = [...tlAsn.members, { cleaner_id: cleaner.id, role: cleaner.employee_type || "technician" }]
      }
      next.set(dateStr, dayAsn)
      return next
    })
    setDirty(prev => new Set(prev).add(dateStr))
  }

  // Save assignments for a date
  const saveDay = async (dateStr: string) => {
    setSaving(true)
    const dayAsn = localAssignments.get(dateStr)
    if (!dayAsn) { setSaving(false); return }

    try {
      await fetch("/api/actions/crews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr, assignments: dayAsn }),
      })
      setDirty(prev => { const n = new Set(prev); n.delete(dateStr); return n })
      fetchData()
    } catch {}
    setSaving(false)
  }

  // Remove member from TL
  const removeMember = (dateStr: string, tlId: number, cleanerId: number) => {
    setLocalAssignments(prev => {
      const next = new Map(prev)
      const dayAsn = [...(next.get(dateStr) || getAssignments(dateStr))]
      const tlAsn = dayAsn.find(a => a.team_lead_id === tlId)
      if (tlAsn) {
        tlAsn.members = tlAsn.members.filter(m => m.cleaner_id !== cleanerId)
      }
      next.set(dateStr, dayAsn)
      return next
    })
    setDirty(prev => new Set(prev).add(dateStr))
  }

  // Toggle expand
  const toggleTL = (key: string) => setExpandedTLs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleT = (key: string) => setExpandedTs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  const toggleS = (key: string) => setExpandedSs(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  // Weekly revenue
  const weeklyTotal = useMemo(() => jobs.reduce((s, j) => s + (j.status !== "cancelled" ? (j.price || 0) : 0), 0), [jobs])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )

  const daysToShow = viewMode === "week" ? weekDays : [weekDays.find(d => toDateStr(d) === selectedDay) || weekDays[0]]
  const monthName = weekStart.toLocaleString("en-US", { month: "long" })

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground">Crew Assignment</h1>
            <p className="text-xs text-muted-foreground">{monthName} {weekStart.getFullYear()}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={goToday} className="text-xs text-primary font-medium hover:underline">Today</button>
            <div className="flex items-center gap-1">
              <button onClick={prevWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted"><ChevronLeft className="size-4" /></button>
              <button onClick={nextWeek} className="size-7 rounded-md flex items-center justify-center hover:bg-muted"><ChevronRight className="size-4" /></button>
            </div>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["day", "week"] as const).map(v => (
                <button key={v} onClick={() => setViewMode(v)}
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
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {day.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className={`ml-1 text-sm font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
                      {day.getDate()}
                    </span>
                  </div>
                  {isDirty && (
                    <button onClick={() => saveDay(dateStr)} disabled={saving}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
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
                      <DroppableTeamLeadCell key={tlKey} id={`tl-${dateStr}-${tl.id}`}>
                        {/* TL Header */}
                        <button onClick={() => toggleTL(tlKey)}
                          className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left">
                          <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1 rounded">TL</span>
                          <span className="text-[11px] font-semibold text-foreground truncate flex-1">{tl.name.split(" ")[0]}</span>
                          {tlJobs.length > 0 && <span className="text-[9px] text-muted-foreground">{tlJobs.length}</span>}
                          <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>

                        {/* Expanded: TL Schedule + Members */}
                        {isExpanded && (
                          <div className="ml-1 pl-2 border-l border-border space-y-1 mt-1">
                            {/* Job time blocks */}
                            {tlJobs.map(job => {
                              const isComplete = job.status === "completed"
                              const statusClass = STATUS_BG[job.status] || STATUS_BG.scheduled
                              return (
                                <div key={job.id} className={`rounded px-1.5 py-1 border text-[10px] relative ${statusClass}`}>
                                  {isComplete && <span className="absolute top-0.5 right-1 text-green-500 font-bold text-[10px]">✕</span>}
                                  <div className="font-bold text-foreground">
                                    {formatTime12(job.scheduled_at)}
                                    {job.hours ? ` – ${formatTime12(getEndTime(job.scheduled_at, job.hours))}` : ""}
                                  </div>
                                  <div className="text-muted-foreground truncate">
                                    {job.service_type ? humanize(job.service_type) : "Job"}
                                    {job.address ? `, ${job.address.split(",")[0]}` : ""}
                                  </div>
                                </div>
                              )
                            })}
                            {tlJobs.length === 0 && (
                              <p className="text-[9px] text-muted-foreground italic px-1">No jobs</p>
                            )}

                            {/* Assigned members */}
                            {members.length > 0 && (
                              <div className="space-y-0.5 pt-1 border-t border-border/50">
                                {members.map(m => {
                                  const role = m.employee_type || "technician"
                                  const badge = ROLE_BADGE[role] || ROLE_BADGE.technician
                                  return (
                                    <div key={m.id} className="flex items-center gap-1 text-[10px]">
                                      <span className={`px-1 rounded text-[8px] font-bold ${badge.color}`}>{badge.label}</span>
                                      <span className="truncate text-foreground">{m.name.split(" ")[0]}</span>
                                      <button onClick={() => removeMember(dateStr, tl.id, m.id)}
                                        className="ml-auto size-4 flex items-center justify-center rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive">
                                        <XIcon className="size-2.5" />
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {tlTotal > 0 && (
                              <p className="text-[9px] font-medium text-muted-foreground pt-1">${Math.round(tlTotal).toLocaleString()} scheduled</p>
                            )}
                          </div>
                        )}
                      </DroppableTeamLeadCell>
                    )
                  })}

                  {dayTLs.length === 0 && (
                    <p className="text-[10px] text-muted-foreground italic text-center py-2">No team leads available</p>
                  )}

                  {/* Technicians dropdown */}
                  {dayTs.length > 0 && (
                    <div>
                      <button onClick={() => toggleT(tKey)}
                        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left">
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

                  {/* Salesmen dropdown */}
                  {daySs.length > 0 && (
                    <div>
                      <button onClick={() => toggleS(sKey)}
                        className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left">
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

        {/* ═══ BOTTOM BAR ═══ */}
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-sm font-bold text-foreground">
            ${Math.round(weeklyTotal).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">this week</span>
          </span>
        </div>

        {/* ═══ DRAG OVERLAY ═══ */}
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
