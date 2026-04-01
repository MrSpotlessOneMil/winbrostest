"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Save, Users, UserX, Calendar,
  Loader2, Check, X, Clock,
} from "lucide-react"

type Cleaner = {
  id: number
  name: string
  phone: string
  is_team_lead: boolean
  employee_type: string | null
  active: boolean
}

type CrewDay = {
  id: number
  date: string
  team_lead_id: number
  crew_day_members: { cleaner_id: number; role: string }[]
}

type TimeOffEntry = {
  cleaner_id: number
  date: string
}

type DayAssignment = {
  team_lead_id: number
  members: { cleaner_id: number; role: string }[]
}

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

function formatDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

export default function CrewsPage() {
  const { tenant, isAdmin } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [crewDays, setCrewDays] = useState<CrewDay[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([])
  const [assignments, setAssignments] = useState<Map<string, DayAssignment[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedDays, setSavedDays] = useState<Set<string>>(new Set())
  const [dragItem, setDragItem] = useState<Cleaner | null>(null)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const teamLeads = cleaners.filter(c => c.is_team_lead)
  const technicians = cleaners.filter(c => !c.is_team_lead && c.employee_type !== "salesman")
  const salesmen = cleaners.filter(c => c.employee_type === "salesman")

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const dateStr = toDateStr(weekStart)
      const res = await fetch(`/api/actions/crews?date=${dateStr}&week=true`)
      const data = await res.json()

      setCleaners(data.cleaners || [])
      setCrewDays(data.crewDays || [])
      setTimeOff((data.timeOff || []).map((t: any) => ({ cleaner_id: t.cleaner_id, date: t.date })))

      // Build assignment map from existing data
      const map = new Map<string, DayAssignment[]>()
      for (const cd of data.crewDays || []) {
        const existing = map.get(cd.date) || []
        existing.push({
          team_lead_id: cd.team_lead_id,
          members: (cd.crew_day_members || []).map((m: any) => ({
            cleaner_id: m.cleaner_id,
            role: m.role,
          })),
        })
        map.set(cd.date, existing)
      }
      setAssignments(map)
    } catch (err) {
      console.error("Failed to load crew data:", err)
    }
    setLoading(false)
  }, [weekStart])

  useEffect(() => { loadData() }, [loadData])

  // Check if a cleaner has time off on a specific date
  const isOffOnDate = (cleanerId: number, dateStr: string) => {
    return timeOff.some(t => t.cleaner_id === cleanerId && t.date === dateStr)
  }

  // Get assignments for a specific date
  const getDateAssignments = (dateStr: string): DayAssignment[] => {
    return assignments.get(dateStr) || []
  }

  // Check if cleaner is already assigned on this date
  const isAssignedOnDate = (cleanerId: number, dateStr: string): boolean => {
    const dayAssigns = getDateAssignments(dateStr)
    return dayAssigns.some(a =>
      a.team_lead_id === cleanerId ||
      a.members.some(m => m.cleaner_id === cleanerId)
    )
  }

  // Add a cleaner to a team lead's crew on a date
  const addToCrew = (dateStr: string, teamLeadId: number, cleaner: Cleaner) => {
    if (isOffOnDate(cleaner.id, dateStr) || isAssignedOnDate(cleaner.id, dateStr)) return

    setAssignments(prev => {
      const map = new Map(prev)
      const dayAssigns = [...(map.get(dateStr) || [])]

      // Find or create crew for this team lead
      let crew = dayAssigns.find(a => a.team_lead_id === teamLeadId)
      if (!crew) {
        crew = { team_lead_id: teamLeadId, members: [] }
        dayAssigns.push(crew)
      }

      const role = cleaner.employee_type === "salesman" ? "salesman" : "technician"
      crew.members = [...crew.members, { cleaner_id: cleaner.id, role }]
      map.set(dateStr, dayAssigns)
      return map
    })
    setSavedDays(prev => { const s = new Set(prev); s.delete(dateStr); return s })
  }

  // Remove a cleaner from a crew on a date
  const removeFromCrew = (dateStr: string, teamLeadId: number, cleanerId: number) => {
    setAssignments(prev => {
      const map = new Map(prev)
      const dayAssigns = [...(map.get(dateStr) || [])]
      const crew = dayAssigns.find(a => a.team_lead_id === teamLeadId)
      if (crew) {
        crew.members = crew.members.filter(m => m.cleaner_id !== cleanerId)
      }
      map.set(dateStr, dayAssigns)
      return map
    })
    setSavedDays(prev => { const s = new Set(prev); s.delete(dateStr); return s })
  }

  // Save a day's assignments
  const saveDay = async (dateStr: string) => {
    setSaving(dateStr)
    try {
      const dayAssigns = getDateAssignments(dateStr)
      await fetch("/api/actions/crews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateStr, assignments: dayAssigns }),
      })
      setSavedDays(prev => new Set(prev).add(dateStr))
    } catch (err) {
      console.error("Failed to save:", err)
    }
    setSaving(null)
  }

  // Drag handlers
  const handleDragStart = (cleaner: Cleaner) => {
    setDragItem(cleaner)
  }

  const handleDrop = (dateStr: string, teamLeadId: number) => {
    if (dragItem) {
      addToCrew(dateStr, teamLeadId, dragItem)
      setDragItem(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isToday = (d: Date) => {
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Crew Assignment</h1>
          <p className="text-sm text-muted-foreground">
            {weekStart.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart(prev => addDays(prev, -7))}
            className="p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setWeekStart(getMonday(new Date()))}
            className="px-3 py-1.5 text-sm rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(prev => addDays(prev, 7))}
            className="p-2 rounded-lg border border-border/50 hover:bg-muted/50 transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground ml-2">
            {formatDateShort(weekStart)} — {formatDateShort(addDays(weekStart, 6))}
          </span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left sidebar — worker roster */}
        <div className="lg:w-48 shrink-0 space-y-3">
          {/* Team Leads */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Team Leads</p>
            <div className="space-y-1">
              {teamLeads.map(c => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => handleDragStart(c)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm cursor-grab active:cursor-grabbing hover:bg-blue-500/20 transition-colors"
                >
                  <span className="text-[10px] font-bold text-blue-400">TL</span>
                  <span className="truncate text-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Technicians */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Technicians</p>
            <div className="space-y-1">
              {technicians.map(c => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => handleDragStart(c)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-sm cursor-grab active:cursor-grabbing hover:bg-green-500/20 transition-colors"
                >
                  <span className="text-[10px] font-bold text-green-400">T</span>
                  <span className="truncate text-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Salesmen */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Salesmen</p>
            <div className="space-y-1">
              {salesmen.map(c => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => handleDragStart(c)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm cursor-grab active:cursor-grabbing hover:bg-amber-500/20 transition-colors"
                >
                  <span className="text-[10px] font-bold text-amber-400">S</span>
                  <span className="truncate text-foreground">{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main grid — 7 day columns */}
        <div className="flex-1 overflow-x-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {weekDays.map(day => {
              const dateStr = toDateStr(day)
              const dayAssigns = getDateAssignments(dateStr)
              const isSaved = savedDays.has(dateStr)
              const isSavingDay = saving === dateStr
              const today = isToday(day)

              return (
                <div
                  key={dateStr}
                  className={`rounded-xl border p-2 min-h-[300px] transition-colors ${
                    today
                      ? "border-primary/30 bg-primary/5"
                      : "border-border/30 bg-card/30"
                  }`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    // If dropping on column without a specific team lead, assign to first TL
                    if (dragItem && teamLeads.length > 0) {
                      const firstTL = teamLeads[0]
                      handleDrop(dateStr, firstTL.id)
                    }
                  }}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-semibold ${today ? "text-primary" : "text-muted-foreground"}`}>
                      {day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                    </span>
                    <button
                      onClick={() => saveDay(dateStr)}
                      disabled={isSavingDay || isSaved}
                      className={`p-1 rounded transition-colors ${
                        isSaved
                          ? "text-green-400"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      title={isSaved ? "Saved" : "Save"}
                    >
                      {isSavingDay ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isSaved ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Crew assignments for this day */}
                  <div className="space-y-2">
                    {teamLeads.map(tl => {
                      const crew = dayAssigns.find(a => a.team_lead_id === tl.id)
                      const tlOff = isOffOnDate(tl.id, dateStr)

                      if (tlOff) {
                        return (
                          <div key={tl.id} className="opacity-40">
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground line-through">
                              <UserX className="h-3 w-3" />
                              {tl.name} — OFF
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div
                          key={tl.id}
                          className="rounded-lg border border-border/20 bg-card/50 p-1.5"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.stopPropagation()
                            handleDrop(dateStr, tl.id)
                          }}
                        >
                          {/* Team lead name */}
                          <div className="text-[11px] font-semibold text-blue-400 mb-1 truncate">
                            {tl.name}
                          </div>

                          {/* Crew members */}
                          {crew && crew.members.length > 0 ? (
                            <div className="space-y-0.5">
                              {crew.members.map(m => {
                                const worker = cleaners.find(c => c.id === m.cleaner_id)
                                const isOff = isOffOnDate(m.cleaner_id, dateStr)
                                return (
                                  <div
                                    key={m.cleaner_id}
                                    className={`flex items-center justify-between text-[10px] px-1.5 py-0.5 rounded ${
                                      isOff ? "opacity-40 line-through" : ""
                                    } ${
                                      m.role === "salesman"
                                        ? "bg-amber-500/10 text-amber-300"
                                        : "bg-green-500/10 text-green-300"
                                    }`}
                                  >
                                    <span className="truncate">{worker?.name || `#${m.cleaner_id}`}</span>
                                    <button
                                      onClick={() => removeFromCrew(dateStr, tl.id, m.cleaner_id)}
                                      className="ml-1 hover:text-red-400 transition-colors shrink-0"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground/50 italic py-1">
                              Drop workers here
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
