"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  ChevronLeft, ChevronRight, Loader2, Calendar, Clock, MapPin,
  DollarSign, Plus, X,
} from "lucide-react"

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
  customers: { first_name: string | null; last_name: string | null } | null
}

type TimeOffDay = {
  id: number
  date: string
  reason: string | null
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

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return ""
  const d = new Date(isoStr)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/20 text-green-400 border-green-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  confirmed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  pending: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  quoted: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  cancelled: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
}

export default function MySchedulePage() {
  const { tenant, user } = useAuth()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [jobs, setJobs] = useState<Job[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffDay[]>([])
  const [loading, setLoading] = useState(true)
  const [cleanerId, setCleanerId] = useState<number | null>(null)
  const [togglingOff, setTogglingOff] = useState<string | null>(null)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // Find worker's cleaner_id from their user record
  useEffect(() => {
    async function findCleaner() {
      if (!user?.id) return
      try {
        const res = await fetch(`/api/actions/settings`)
        const data = await res.json()
        if (data.cleaner_id) {
          setCleanerId(data.cleaner_id)
        }
      } catch {}
    }
    findCleaner()
  }, [user])

  // Load schedule and time-off
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const startDate = toDateStr(weekStart)
      const endDate = toDateStr(addDays(weekStart, 6))

      // Load jobs assigned to this worker
      const jobsRes = await fetch(`/api/actions/crews?date=${startDate}&week=true`)
      const jobsData = await jobsRes.json()

      // Load time-off
      const month = startDate.slice(0, 7)
      const toRes = await fetch(`/api/actions/time-off?month=${month}${cleanerId ? `&cleaner_id=${cleanerId}` : ""}`)
      const toData = await toRes.json()

      setTimeOff(toData.timeOff || [])

      // For now, load all jobs for the calendar view
      // Worker filtering happens in the calendar page's data fetch
      setJobs([])
    } catch (err) {
      console.error("Failed to load schedule:", err)
    }
    setLoading(false)
  }, [weekStart, cleanerId])

  useEffect(() => { loadData() }, [loadData])

  // Toggle time off for a date
  const toggleTimeOff = async (dateStr: string) => {
    if (!cleanerId) return
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

  const isToday = (d: Date) => {
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  }

  const isOffDay = (dateStr: string) => timeOff.some(t => t.date === dateStr)

  const weeklyRevenue = jobs.reduce((sum, j) => sum + (Number(j.price) || 0), 0)

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">My Schedule</h1>
          <p className="text-sm text-muted-foreground">View your schedule and select days off</p>
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
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Time Off Selection */}
          <div className="rounded-xl border border-border/30 bg-card/30 p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Select Your Days Off
            </h2>
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map(day => {
                const dateStr = toDateStr(day)
                const off = isOffDay(dateStr)
                const today = isToday(day)
                const toggling = togglingOff === dateStr

                return (
                  <button
                    key={dateStr}
                    onClick={() => toggleTimeOff(dateStr)}
                    disabled={toggling || !cleanerId}
                    className={`relative flex flex-col items-center justify-center p-3 rounded-xl border transition-all cursor-pointer ${
                      off
                        ? "bg-red-500/15 border-red-500/30 text-red-400"
                        : today
                        ? "bg-primary/10 border-primary/30 text-foreground"
                        : "bg-card/50 border-border/30 text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-[10px] font-medium text-muted-foreground uppercase">
                      {day.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="text-lg font-bold">{day.getDate()}</span>
                    {off && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5">OFF</span>
                    )}
                    {toggling && (
                      <Loader2 className="absolute top-1 right-1 h-3 w-3 animate-spin" />
                    )}
                  </button>
                )
              })}
            </div>
            {!cleanerId && (
              <p className="text-xs text-muted-foreground mt-2">
                Your account is not linked to a worker profile. Ask your admin to connect it.
              </p>
            )}
          </div>

          {/* Weekly schedule — placeholder until we load worker-specific jobs */}
          <div className="rounded-xl border border-border/30 bg-card/30 p-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              This Week
            </h2>
            <div className="grid grid-cols-7 gap-2">
              {weekDays.map(day => {
                const dateStr = toDateStr(day)
                const off = isOffDay(dateStr)
                const today = isToday(day)
                const dayJobs = jobs.filter(j => (j.date || "").startsWith(dateStr))

                return (
                  <div
                    key={dateStr}
                    className={`rounded-xl border p-2 min-h-[120px] ${
                      off
                        ? "bg-red-500/5 border-red-500/20 opacity-50"
                        : today
                        ? "bg-primary/5 border-primary/30"
                        : "bg-card/50 border-border/20"
                    }`}
                  >
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                      {day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                    </div>
                    {off ? (
                      <div className="text-[10px] text-red-400 font-medium">Day Off</div>
                    ) : dayJobs.length === 0 ? (
                      <div className="text-[10px] text-muted-foreground/50 italic">No jobs</div>
                    ) : (
                      <div className="space-y-1">
                        {dayJobs.map(j => (
                          <div
                            key={j.id}
                            className={`text-[10px] px-1.5 py-1 rounded border ${STATUS_COLORS[j.status] || STATUS_COLORS.scheduled}`}
                          >
                            <div className="font-medium truncate">
                              {formatTime(j.scheduled_at)} {j.service_type?.replace(/_/g, " ")}
                            </div>
                            {j.address && (
                              <div className="text-[9px] opacity-70 truncate">{j.address}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
