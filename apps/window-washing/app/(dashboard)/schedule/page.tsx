"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, ChevronDown,
  Clock, MapPin, GripVertical, Plus, Package,
} from "lucide-react"
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core"
import { JobDetailDrawer } from "@/components/winbros/job-detail-drawer"
import { QuoteBuilderSheet } from "@/components/winbros/quote-builder-sheet"
import { useStartNewQuote } from "@/hooks/use-start-new-quote"

/* ─── Types ─── */
interface ScheduleJob {
  id: number
  customer_name: string
  address: string
  time: string | null
  services: string[]
  price: number
  status: string
  credited_salesman_id?: number | null
  salesman_name?: string | null
}

interface UnscheduledJob {
  id: number
  customer_name: string
  address: string
  date: string | null
  time: string | null
  services: string[]
  price: number
  status: string
  credited_salesman_id: number | null
  salesman_name: string | null
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
  if (job.services.some(s => s.toLowerCase().includes("service plan"))) {
    return { card: "bg-green-500/10 border-green-500/25", accent: "text-green-400" }
  }
  if (job.services.some(s => s.toLowerCase().includes("estimate") || s.toLowerCase().includes("salesman"))) {
    return { card: "bg-amber-500/10 border-amber-500/25", accent: "text-amber-400" }
  }
  return { card: "bg-teal-500/10 border-teal-500/25", accent: "text-teal-400" }
}

function humanizeStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

/* ─── Draggable Job Card ─── */
function DraggableJobCard({
  job,
  fromDate,
  fromTLId,
  onCardClick,
}: {
  job: ScheduleJob
  fromDate: string
  fromTLId: number | null
  onCardClick?: (jobId: number) => void
}) {
  const colors = getJobColor(job)
  const statusStyle = STATUS_STYLE[job.status] || STATUS_STYLE.scheduled
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `job-${job.id}`,
    data: { job, fromDate, fromTLId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={() => onCardClick?.(job.id)}
      className={`rounded px-1.5 py-1 border text-[10px] cursor-pointer hover:brightness-110 active:cursor-grabbing transition-opacity ${colors.card} ${isDragging ? "opacity-30" : ""}`}
    >
      {/* Drag handle row */}
      <div className="flex items-center gap-1" {...listeners} {...attributes}>
        <GripVertical className="size-2.5 opacity-40 shrink-0 cursor-grab" />
        <span className="font-bold text-foreground truncate flex-1">
          {job.customer_name}
        </span>
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
      <div className="flex items-center gap-1 mt-0.5">
        <span className={`inline-block px-1 rounded border text-[8px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
          {humanizeStatus(job.status)}
        </span>
        {job.salesman_name && (
          <span className="text-[8px] text-amber-400 bg-amber-500/15 px-1 rounded font-medium truncate">
            Sold: {job.salesman_name.split(" ")[0]}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Draggable Bank Job Card ─── */
function DraggableBankCard({
  job,
  onCardClick,
}: {
  job: UnscheduledJob
  onCardClick?: (jobId: number) => void
}) {
  const statusStyle = STATUS_STYLE[job.status] || STATUS_STYLE.pending
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bank-${job.id}`,
    data: { job, fromDate: null, fromTLId: null, fromBank: true },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={() => onCardClick?.(job.id)}
      className={`rounded-md px-2.5 py-2 border bg-zinc-800/80 border-zinc-700/50 text-xs cursor-pointer hover:brightness-110 active:cursor-grabbing transition-opacity ${isDragging ? "opacity-30" : ""}`}
    >
      <div className="flex items-center gap-1.5" {...listeners} {...attributes}>
        <GripVertical className="size-3 opacity-40 shrink-0 cursor-grab" />
        <span className="font-semibold text-foreground truncate flex-1">
          {job.customer_name}
        </span>
        <span className="font-bold text-green-400 text-[11px]">${job.price}</span>
      </div>
      {job.services[0] && (
        <div className="text-[10px] text-muted-foreground mt-1 truncate pl-4">
          {job.services[0]}
        </div>
      )}
      {job.address && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5 pl-4">
          <MapPin className="size-2 shrink-0" />
          <span className="truncate">{extractTown(job.address)}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-1 pl-4">
        <span className={`inline-block px-1 rounded border text-[8px] font-semibold ${statusStyle.bg} ${statusStyle.text}`}>
          {humanizeStatus(job.status)}
        </span>
        {job.salesman_name && (
          <span className="text-[8px] text-amber-400 bg-amber-500/15 px-1 rounded font-medium truncate">
            Sold: {job.salesman_name.split(" ")[0]}
          </span>
        )}
      </div>
    </div>
  )
}

/* ─── Droppable TL Cell ─── */
function DroppableTLCell({ id, children }: { id: string; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`rounded-md transition-colors min-h-[2rem] ${isOver ? "bg-primary/10 ring-1 ring-primary/30" : ""}`}
    >
      {children}
    </div>
  )
}

/* ═══ MAIN PAGE ═══ */
export default function SchedulePage() {
  const { user, portalToken } = useAuth()
  const { start: startNewQuote, creating: creatingQuote } = useStartNewQuote(portalToken)
  const [quoteSheetId, setQuoteSheetId] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<"week" | "day">("week")
  const [selectedDay, setSelectedDay] = useState(() => toDateStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [weekData, setWeekData] = useState<WeekDayData[]>([])
  const [updating, setUpdating] = useState(false)

  // Unscheduled bank state
  const [bankJobs, setBankJobs] = useState<UnscheduledJob[]>([])
  const [bankLoading, setBankLoading] = useState(true)
  const [bankCollapsed, setBankCollapsed] = useState(false)

  // UI state
  const [expandedTLs, setExpandedTLs] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<{ job: ScheduleJob | UnscheduledJob; fromDate: string | null; fromTLId: number | null; fromBank?: boolean } | null>(null)
  const [drawerJobId, setDrawerJobId] = useState<string | null>(null)
  const openJobDrawer = useCallback((jobId: number) => setDrawerJobId(String(jobId)), [])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

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
              totalRevenue: dayCrews.reduce((s: number, c: CrewSchedule) => s + (c.daily_revenue || 0), 0),
              totalJobs: dayCrews.reduce((s: number, c: CrewSchedule) => s + (c.jobs?.length || 0), 0),
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

  // Fetch unscheduled bank jobs
  const fetchBankJobs = useCallback(async () => {
    setBankLoading(true)
    try {
      const res = await fetch("/api/actions/unscheduled-jobs")
      if (res.ok) {
        const data = await res.json()
        setBankJobs(data.jobs || [])
      }
    } catch {
      setBankJobs([])
    }
    setBankLoading(false)
  }, [])

  useEffect(() => {
    fetchWeekData()
    fetchBankJobs()
  }, [fetchWeekData, fetchBankJobs])

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

  const monthName = weekStart.toLocaleString("en-US", { month: "long" })

  // DnD handlers
  const handleDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { job: ScheduleJob | UnscheduledJob; fromDate: string | null; fromTLId: number | null; fromBank?: boolean } | undefined
    if (data) setDragItem(data)
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragItem(null)
    if (!e.over) return

    const data = e.active.data.current as { job: ScheduleJob | UnscheduledJob; fromDate: string | null; fromTLId: number | null; fromBank?: boolean } | undefined
    if (!data) return

    const { job, fromDate, fromTLId, fromBank } = data

    // Parse droppable ID: "drop-{date}-{teamLeadId}" or "drop-{date}-unassigned"
    const overId = e.over.id as string
    const parts = overId.replace("drop-", "").split("-")
    // date is YYYY-MM-DD (3 parts), optional tlId/unassigned after
    if (parts.length < 3) return
    const targetDate = parts.slice(0, 3).join("-")
    const tlPart = parts.length > 3 ? parts.slice(3).join("-") : null
    const targetTLId = tlPart === "unassigned" ? null : (tlPart ? Number(tlPart) : null)

    const dateChanged = fromBank || targetDate !== fromDate
    const tlChanged = fromBank || targetTLId !== fromTLId

    // Nothing changed (non-bank job dragged to same spot)
    if (!dateChanged && !tlChanged) return

    setUpdating(true)
    try {
      // Assign cleaner if dropping on a team lead
      if (targetTLId != null && (tlChanged || fromBank)) {
        await fetch("/api/actions/assign-cleaner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.id, cleanerId: String(targetTLId) }),
        })
      }
      // Update job date
      if (dateChanged) {
        await fetch("/api/jobs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: job.id, date: targetDate }),
        })
      }
      // Refresh both schedule and bank
      fetchWeekData()
      if (fromBank) fetchBankJobs()
    } catch {
      // ignore
    }
    setUpdating(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const daysToShow = viewMode === "week" ? weekDays : [weekDays.find(d => toDateStr(d) === selectedDay) || weekDays[0]]

  return (
    <>
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground">Scheduling</h1>
            <p className="text-xs text-muted-foreground">{monthName} {weekStart.getFullYear()}</p>
          </div>
          <div className="flex items-center gap-2">
            {updating && <Loader2 className="size-4 animate-spin text-primary" />}
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

        {/* ═══ MAIN CONTENT: BANK + CALENDAR ═══ */}
        <div className="flex-1 flex overflow-hidden">
          {/* ─── UNSCHEDULED BANK SIDEBAR ─── */}
          <div className={`shrink-0 border-r border-border bg-zinc-900/50 flex flex-col transition-all ${bankCollapsed ? "w-10" : "w-[250px]"}`}>
            {/* Bank header */}
            <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
              {!bankCollapsed && (
                <div className="flex items-center gap-1.5">
                  <Package className="size-3.5 text-amber-400" />
                  <span className="text-[11px] font-bold text-foreground">Unscheduled</span>
                  <span className="text-[9px] text-muted-foreground bg-zinc-800 px-1 rounded">{bankJobs.length}</span>
                </div>
              )}
              <button
                onClick={() => setBankCollapsed(!bankCollapsed)}
                className="size-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                title={bankCollapsed ? "Expand bank" : "Collapse bank"}
              >
                {bankCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
              </button>
            </div>

            {/* Bank content */}
            {!bankCollapsed && (
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {bankLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : bankJobs.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic text-center py-4">
                    No unscheduled jobs
                  </p>
                ) : (
                  bankJobs.map(job => (
                    <DraggableBankCard key={job.id} job={job} onCardClick={openJobDrawer} />
                  ))
                )}
              </div>
            )}

            {/* + New button — opens QuoteBuilderSheet on this URL (no nav) */}
            {!bankCollapsed && (
              <div className="px-2 py-2 border-t border-border shrink-0">
                <button
                  onClick={async () => {
                    const id = await startNewQuote()
                    if (id) setQuoteSheetId(id)
                  }}
                  disabled={creatingQuote}
                  data-testid="schedule-new-quote"
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed border-zinc-600 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-zinc-500 hover:bg-zinc-800/50 transition-colors disabled:opacity-60 disabled:cursor-wait"
                >
                  {creatingQuote ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Plus className="size-3" />
                  )}
                  New Quote
                </button>
              </div>
            )}

            {/* Collapsed indicator */}
            {bankCollapsed && bankJobs.length > 0 && (
              <div className="flex-1 flex items-start justify-center pt-3">
                <div className="flex flex-col items-center gap-1">
                  <Package className="size-3.5 text-amber-400" />
                  <span className="text-[9px] font-bold text-amber-400">{bankJobs.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* ─── CALENDAR GRID ─── */}
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
                      <DroppableTLCell key={tlKey} id={`drop-${dateStr}-${crew.team_lead_id}`}>
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
                          {crewTotal > 0 && <span className="text-[9px] text-green-400 font-medium">${Math.round(crewTotal)}</span>}
                          <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>

                        {/* Expanded: Job cards */}
                        {isExpanded && (
                          <div className="ml-1 pl-2 border-l border-border space-y-1 mt-1">
                            {crewJobs.map(job => (
                              <DraggableJobCard
                                key={job.id}
                                job={job}
                                fromDate={dateStr}
                                fromTLId={crew.team_lead_id}
                                onCardClick={openJobDrawer}
                              />
                            ))}
                            {crewJobs.length === 0 && (
                              <p className="text-[9px] text-muted-foreground italic px-1">No jobs</p>
                            )}
                          </div>
                        )}
                      </DroppableTLCell>
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
                      <DroppableTLCell key={uKey} id={`drop-${dateStr}-unassigned`}>
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
                            {unJobs.map(job => (
                              <DraggableJobCard
                                key={job.id}
                                job={job}
                                fromDate={dateStr}
                                fromTLId={null}
                                onCardClick={openJobDrawer}
                              />
                            ))}
                          </div>
                        )}
                      </DroppableTLCell>
                    )
                  })}

                  {dayCrews.length === 0 && (
                    <DroppableTLCell id={`drop-${dateStr}-unassigned`}>
                      <p className="text-[10px] text-muted-foreground italic text-center py-2">No jobs scheduled</p>
                    </DroppableTLCell>
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
        </div>{/* end MAIN CONTENT flex row */}

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

        {/* ═══ DRAG OVERLAY ═══ */}
        <DragOverlay>
          {dragItem && (() => {
            const isBank = !!(dragItem as any).fromBank
            const colors = isBank
              ? { card: "bg-amber-500/10 border-amber-500/25", accent: "text-amber-400" }
              : getJobColor(dragItem.job as ScheduleJob)
            return (
              <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-medium shadow-lg ${colors.card}`}>
                <GripVertical className="size-3 opacity-40" />
                <div>
                  <div className="font-semibold text-foreground">{dragItem.job.customer_name}</div>
                  <div className="text-muted-foreground">{extractTown(dragItem.job.address)}</div>
                </div>
                <span className="font-bold text-foreground ml-auto">${dragItem.job.price}</span>
              </div>
            )
          })()}
        </DragOverlay>
      </div>
    </DndContext>

    <JobDetailDrawer
      jobId={drawerJobId}
      open={drawerJobId !== null}
      onClose={() => setDrawerJobId(null)}
      onJobUpdated={() => { fetchWeekData(); fetchBankJobs() }}
    />

    <QuoteBuilderSheet
      quoteId={quoteSheetId}
      open={quoteSheetId !== null}
      onClose={() => setQuoteSheetId(null)}
      onSaved={() => { fetchWeekData(); fetchBankJobs() }}
    />
    </>
  )
}
