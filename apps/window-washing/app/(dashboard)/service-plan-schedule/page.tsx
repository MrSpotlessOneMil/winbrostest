"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, ChevronDown,
  Clock, MapPin, GripVertical, Calendar,
} from "lucide-react"
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from "@dnd-kit/core"

/* ─── Types ─── */
interface PlanJob {
  id: number
  customer_name: string
  address: string
  plan_type: string
  target_week: number
  status: string
  price?: number | null
}

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

interface WeekDayData {
  date: string
  crews: CrewSchedule[]
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

function humanizePlan(val: string): string {
  return val.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string; chipBg: string }> = {
  quarterly:  { bg: "bg-blue-500/10",   text: "text-blue-400",   border: "border-blue-500/25",   chipBg: "bg-blue-500/20" },
  triannual:  { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/25", chipBg: "bg-purple-500/20" },
  monthly:    { bg: "bg-cyan-500/10",   text: "text-cyan-400",   border: "border-cyan-500/25",   chipBg: "bg-cyan-500/20" },
  biannual:   { bg: "bg-amber-500/10",  text: "text-amber-400",  border: "border-amber-500/25",  chipBg: "bg-amber-500/20" },
  annual:     { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/25", chipBg: "bg-emerald-500/20" },
}

function getPlanColor(planType: string) {
  const key = planType.toLowerCase().replace(/[-_\s]/g, "")
  return PLAN_COLORS[key] || { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/25", chipBg: "bg-zinc-500/20" }
}

/* ─── Draggable Plan Job Chip ─── */
function DraggablePlanJob({ job }: { job: PlanJob }) {
  const colors = getPlanColor(job.plan_type)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `plan-job-${job.id}`,
    data: { planJob: job },
  })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] cursor-grab active:cursor-grabbing transition-opacity ${colors.bg} ${colors.border} ${isDragging ? "opacity-30" : ""}`}
    >
      <GripVertical className="size-3 opacity-40 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground truncate">{job.customer_name}</div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span className={`font-bold text-[8px] ${colors.text}`}>{humanizePlan(job.plan_type)}</span>
          {job.price != null && job.price > 0 && <span className="ml-auto">${job.price}</span>}
        </div>
      </div>
    </div>
  )
}

/* ─── Droppable Day/TL Cell ─── */
function DroppableCell({ id, children }: { id: string; children: React.ReactNode }) {
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
export default function ServicePlanSchedulePage() {
  const { user } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<"week" | "day">("week")
  const [selectedDay, setSelectedDay] = useState(() => toDateStr(new Date()))
  const [loading, setLoading] = useState(true)
  const [weekData, setWeekData] = useState<WeekDayData[]>([])
  const [bankJobs, setBankJobs] = useState<PlanJob[]>([])
  const [bankLoading, setBankLoading] = useState(true)
  const [scheduling, setScheduling] = useState(false)

  // UI state
  const [expandedTLs, setExpandedTLs] = useState<Set<string>>(new Set())
  const [expandedBankPlans, setExpandedBankPlans] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<PlanJob | null>(null)

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  // Week days
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayStr = toDateStr(new Date())
  const currentYear = weekStart.getFullYear()

  // Fetch unscheduled bank
  const fetchBank = useCallback(async () => {
    setBankLoading(true)
    try {
      const res = await fetch(`/api/actions/service-plan-jobs?year=${currentYear}`)
      if (res.ok) {
        const grouped: Record<number, PlanJob[]> = await res.json()
        // Flatten and keep only unscheduled
        const all = Object.values(grouped).flat().filter(j => j.status === "unscheduled")
        setBankJobs(all)
        // Auto-expand all plan types that have unscheduled jobs
        const types = new Set(all.map(j => j.plan_type))
        setExpandedBankPlans(types)
      }
    } catch {
      setBankJobs([])
    }
    setBankLoading(false)
  }, [currentYear])

  // Fetch week schedule data
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
              totalRevenue: dayCrews.reduce((s, c) => s + (c.daily_revenue || 0), 0),
              totalJobs: dayCrews.reduce((s, c) => s + (c.jobs?.length || 0), 0),
            }
          }
        } catch {
          // ignore
        }
        return { date: dateStr, crews: [], totalRevenue: 0, totalJobs: 0 }
      })
      setWeekData(await Promise.all(fetches))
    } catch {
      setWeekData([])
    }
    setLoading(false)
  }, [weekDays])

  useEffect(() => {
    fetchWeekData()
    fetchBank()
  }, [fetchWeekData, fetchBank])

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
  const toggleBankPlan = (key: string) =>
    setExpandedBankPlans(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  // Weekly totals
  const weeklyTotal = useMemo(
    () => weekData.reduce((s, d) => s + d.totalRevenue, 0),
    [weekData],
  )

  // DnD handlers
  const handleDragStart = (e: DragStartEvent) => {
    setDragItem((e.active.data.current as Record<string, unknown>)?.planJob as PlanJob || null)
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragItem(null)
    if (!e.over) return
    const planJob = (e.active.data.current as Record<string, unknown>)?.planJob as PlanJob | undefined
    if (!planJob) return

    // Droppable ID format: "drop-{date}-{teamLeadId}" or "drop-{date}"
    const overId = e.over.id as string
    const parts = overId.replace("drop-", "").split("-")
    // date is YYYY-MM-DD (3 parts), optional tlId after
    if (parts.length < 3) return
    const targetDate = parts.slice(0, 3).join("-")
    const crewLeadId = parts.length > 3 ? Number(parts[3]) : undefined

    // Schedule the job
    setScheduling(true)
    try {
      const body: Record<string, unknown> = { planJobId: planJob.id, targetDate }
      if (crewLeadId) body.crewLeadId = crewLeadId

      const res = await fetch("/api/actions/service-plan-jobs/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        // Refresh both views
        fetchWeekData()
        fetchBank()
      }
    } catch {
      // ignore
    }
    setScheduling(false)
  }

  // Group bank jobs by plan type
  const bankByPlan = useMemo(() => {
    const map = new Map<string, PlanJob[]>()
    for (const j of bankJobs) {
      if (!map.has(j.plan_type)) map.set(j.plan_type, [])
      map.get(j.plan_type)!.push(j)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [bankJobs])

  const monthName = weekStart.toLocaleString("en-US", { month: "long" })
  const daysToShow = viewMode === "week" ? weekDays : [weekDays.find(d => toDateStr(d) === selectedDay) || weekDays[0]]

  const allLoading = loading || bankLoading

  if (allLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-full flex flex-col">
        {/* ═══ HEADER ═══ */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div>
            <h1 className="text-lg font-bold text-foreground">Service Plan Scheduling</h1>
            <p className="text-xs text-muted-foreground">
              {monthName} {weekStart.getFullYear()}
              {bankJobs.length > 0 && (
                <span className="text-amber-400 font-medium ml-2">{bankJobs.length} unscheduled</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {scheduling && <Loader2 className="size-4 animate-spin text-primary" />}
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

        {/* ═══ UNSCHEDULED BANK ═══ */}
        {bankJobs.length > 0 && (
          <div className="border-b border-border shrink-0 max-h-[200px] overflow-y-auto">
            <div className="px-3 py-1.5 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-2">
              <Calendar className="size-3.5 text-amber-400" />
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                Unscheduled Bank
              </span>
              <span className="text-[10px] text-muted-foreground">
                Drag to a day to schedule
              </span>
            </div>
            <div className="p-2 space-y-1">
              {bankByPlan.map(([planType, jobs]) => {
                const colors = getPlanColor(planType)
                const isExpanded = expandedBankPlans.has(planType)
                return (
                  <div key={planType}>
                    <button
                      onClick={() => toggleBankPlan(planType)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted/50 text-left ${colors.bg}`}
                    >
                      <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-0" : "-rotate-90"}`} />
                      <span className={`text-[10px] font-bold ${colors.text}`}>{humanizePlan(planType)}</span>
                      <span className="text-[9px] text-muted-foreground ml-auto">{jobs.length}</span>
                    </button>
                    {isExpanded && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-1 mt-1 pl-4">
                        {jobs.map(job => (
                          <DraggablePlanJob key={job.id} job={job} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ═══ CALENDAR GRID ═══ */}
        <div className={`flex-1 overflow-auto grid ${viewMode === "week" ? "grid-cols-7" : "grid-cols-1"} gap-px bg-border`}>
          {daysToShow.map(day => {
            const dateStr = toDateStr(day)
            const isToday = dateStr === todayStr
            const dayData = weekData.find(d => d.date === dateStr)
            const dayCrews = dayData?.crews || []
            const dayTotal = dayData?.totalRevenue || 0
            const dayJobCount = dayData?.totalJobs || 0

            // Filter to show only service plan jobs in the grid
            const servicePlanCrews = dayCrews.map(crew => ({
              ...crew,
              jobs: crew.jobs.filter(j =>
                j.services.some(s => s.toLowerCase().includes("service plan"))
              ),
            })).filter(c => c.jobs.length > 0)

            const spTotal = servicePlanCrews.reduce((s, c) => c.jobs.reduce((js, j) => js + j.price, 0) + s, 0)

            return (
              <DroppableCell key={dateStr} id={`drop-${dateStr}`}>
                <div className={`bg-background flex flex-col h-full ${isToday ? "ring-1 ring-primary/30 ring-inset" : ""}`}>
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
                    {/* Team Leads with service plan jobs */}
                    {servicePlanCrews.filter(c => c.team_lead_id != null).map(crew => {
                      const tlKey = `${dateStr}-${crew.team_lead_id}`
                      const isExpanded = expandedTLs.has(tlKey)
                      const crewJobs = crew.jobs

                      return (
                        <DroppableCell key={tlKey} id={`drop-${dateStr}-${crew.team_lead_id}`}>
                          <button
                            onClick={() => toggleTL(tlKey)}
                            className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-muted/50 text-left"
                          >
                            <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1 rounded">TL</span>
                            <span className="text-[11px] font-semibold text-foreground truncate flex-1">
                              {crew.team_lead_name.split(" ")[0]}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{crewJobs.length}</span>
                            <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </button>
                          {isExpanded && (
                            <div className="ml-1 pl-2 border-l border-border space-y-1 mt-1">
                              {crewJobs.map(job => {
                                const planTypeStr = job.services[0]?.replace("Service Plan - ", "") || ""
                                const colors = getPlanColor(planTypeStr)
                                return (
                                  <div
                                    key={job.id}
                                    className={`rounded px-1.5 py-1 border text-[10px] ${colors.bg} ${colors.border}`}
                                  >
                                    <div className="font-bold text-foreground truncate">{job.customer_name}</div>
                                    <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                      <MapPin className="size-2 shrink-0" />
                                      <span className="truncate">{extractTown(job.address)}</span>
                                    </div>
                                    {job.time && (
                                      <div className="flex items-center gap-1 text-muted-foreground mt-0.5">
                                        <Clock className="size-2" />
                                        <span>{job.time}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between mt-0.5">
                                      <span className={`text-[8px] font-bold ${colors.text}`}>{humanizePlan(planTypeStr)}</span>
                                      <span className="font-bold text-foreground">${job.price}</span>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </DroppableCell>
                      )
                    })}

                    {/* All jobs on this day (non-service-plan too, shown smaller) */}
                    {dayCrews.filter(c => c.team_lead_id != null).map(crew => {
                      const nonSpJobs = crew.jobs.filter(j =>
                        !j.services.some(s => s.toLowerCase().includes("service plan"))
                      )
                      if (nonSpJobs.length === 0) return null

                      // Only show if no SP jobs were shown for this TL (avoid double header)
                      const hasSpJobs = servicePlanCrews.some(c => c.team_lead_id === crew.team_lead_id)
                      if (hasSpJobs) return null

                      return (
                        <DroppableCell key={`${dateStr}-${crew.team_lead_id}-other`} id={`drop-${dateStr}-${crew.team_lead_id}`}>
                          <div className="flex items-center gap-1 px-1.5 py-0.5">
                            <span className="text-[9px] font-bold text-blue-400 bg-blue-500/15 px-1 rounded">TL</span>
                            <span className="text-[10px] text-muted-foreground truncate flex-1">
                              {crew.team_lead_name.split(" ")[0]}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{nonSpJobs.length}j</span>
                          </div>
                        </DroppableCell>
                      )
                    })}

                    {servicePlanCrews.length === 0 && dayCrews.length === 0 && (
                      <p className="text-[10px] text-muted-foreground italic text-center py-2">
                        Drop here to schedule
                      </p>
                    )}

                    {servicePlanCrews.length === 0 && dayCrews.length > 0 && (
                      <p className="text-[9px] text-muted-foreground italic text-center py-1">
                        No service plan jobs
                      </p>
                    )}
                  </div>

                  {/* Day total */}
                  {spTotal > 0 && (
                    <div className="px-2 py-1 border-t border-border text-[10px] font-medium text-muted-foreground shrink-0">
                      ${Math.round(spTotal).toLocaleString()} SP revenue
                    </div>
                  )}
                </div>
              </DroppableCell>
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
            {bankJobs.length > 0 && (
              <span className="text-amber-400 font-medium">{bankJobs.length} unscheduled remaining</span>
            )}
          </span>
        </div>

        {/* ═══ DRAG OVERLAY ═══ */}
        <DragOverlay>
          {dragItem && (() => {
            const colors = getPlanColor(dragItem.plan_type)
            return (
              <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[10px] font-medium shadow-lg ${colors.bg} ${colors.border}`}>
                <GripVertical className="size-3 opacity-40" />
                <div>
                  <div className="font-semibold text-foreground">{dragItem.customer_name}</div>
                  <span className={`text-[8px] font-bold ${colors.text}`}>{humanizePlan(dragItem.plan_type)}</span>
                </div>
              </div>
            )
          })()}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
