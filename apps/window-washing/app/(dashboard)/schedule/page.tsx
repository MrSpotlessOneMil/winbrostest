"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useAuth } from "@/lib/auth-context"
import { DaySchedule } from "@/components/winbros/day-schedule"
import { Loader2, ChevronLeft, ChevronRight, MapPin, DollarSign } from "lucide-react"

function getMonday(d: Date): Date {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day))
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDaysDate(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

interface WeekDayData {
  date: string
  crews: any[]
  salesmanAppointments: any[]
  totalRevenue: number
  totalJobs: number
}

export default function SchedulePage() {
  const { user } = useAuth()
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [viewMode, setViewMode] = useState<"day" | "week">("day")
  const [loading, setLoading] = useState(true)
  const [crews, setCrews] = useState<any[]>([])
  const [salesmanAppointments, setSalesmanAppointments] = useState<any[]>([])
  const [weekData, setWeekData] = useState<WeekDayData[]>([])
  const [weekLoading, setWeekLoading] = useState(false)

  const weekStart = useMemo(() => getMonday(new Date(date + "T12:00:00")), [date])
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysDate(weekStart, i)),
    [weekStart]
  )
  const todayStr = toDateStr(new Date())

  const fetchSchedule = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/actions/schedule-day?date=${date}`)
      if (res.ok) {
        const data = await res.json()
        setCrews(data.crews || [])
        setSalesmanAppointments(data.salesmanAppointments || [])
      } else {
        setCrews([])
        setSalesmanAppointments([])
      }
    } catch {
      setCrews([])
      setSalesmanAppointments([])
    }
    setLoading(false)
  }, [date])

  useEffect(() => {
    if (viewMode === "day") {
      fetchSchedule()
    }
  }, [fetchSchedule, viewMode])

  // Fetch week data when in week view
  const fetchWeekData = useCallback(async () => {
    setWeekLoading(true)
    const results: WeekDayData[] = []
    try {
      const fetches = weekDays.map(async (day) => {
        const dateStr = toDateStr(day)
        try {
          const res = await fetch(`/api/actions/schedule-day?date=${dateStr}`)
          if (res.ok) {
            const data = await res.json()
            const dayCrews = data.crews || []
            return {
              date: dateStr,
              crews: dayCrews,
              salesmanAppointments: data.salesmanAppointments || [],
              totalRevenue: dayCrews.reduce(
                (s: number, c: any) => s + (c.daily_revenue || 0),
                0
              ),
              totalJobs: dayCrews.reduce(
                (s: number, c: any) => s + (c.jobs?.length || 0),
                0
              ),
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
      const resolved = await Promise.all(fetches)
      results.push(...resolved)
    } catch {
      // ignore
    }
    setWeekData(results)
    setWeekLoading(false)
  }, [weekDays])

  useEffect(() => {
    if (viewMode === "week") {
      fetchWeekData()
    }
  }, [fetchWeekData, viewMode])

  const weeklyTotal = useMemo(
    () => weekData.reduce((s, d) => s + d.totalRevenue, 0),
    [weekData]
  )
  const weeklyJobs = useMemo(
    () => weekData.reduce((s, d) => s + d.totalJobs, 0),
    [weekData]
  )

  const handlePrevWeek = () => {
    const d = new Date(date + "T12:00:00")
    d.setDate(d.getDate() - 7)
    setDate(toDateStr(d))
  }
  const handleNextWeek = () => {
    const d = new Date(date + "T12:00:00")
    d.setDate(d.getDate() + 7)
    setDate(toDateStr(d))
  }

  if (viewMode === "day" && loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* View toggle */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {viewMode === "week" && (
            <>
              <button
                onClick={handlePrevWeek}
                className="p-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDate(todayStr)}
                className="px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                Today
              </button>
              <button
                onClick={handleNextWeek}
                className="p-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`px-3 py-1.5 font-medium capitalize transition-colors cursor-pointer ${
                viewMode === v
                  ? "bg-teal-600 text-white"
                  : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {viewMode === "day" ? (
        <DaySchedule
          date={date}
          crews={crews}
          salesmanAppointments={salesmanAppointments}
          onDateChange={setDate}
          onJobClick={(jobId) => {
            window.location.href = `/jobs?job=${jobId}`
          }}
        />
      ) : weekLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Week header */}
          <div className="text-center">
            <h2 className="text-lg font-semibold text-white">
              Week of{" "}
              {weekStart.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </h2>
            <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 mt-1">
              <span>{weeklyJobs} total jobs</span>
              <span className="text-green-400">
                ${weeklyTotal.toLocaleString()} total
              </span>
            </div>
          </div>

          {/* Week grid: 7 day columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {weekDays.map((day) => {
              const dateStr = toDateStr(day)
              const isToday = dateStr === todayStr
              const dayData = weekData.find((d) => d.date === dateStr)
              const dayCrews = dayData?.crews || []
              const dayRevenue = dayData?.totalRevenue || 0
              const dayJobs = dayData?.totalJobs || 0

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    setDate(dateStr)
                    setViewMode("day")
                  }}
                  className={`rounded-lg border p-2 min-h-[140px] text-left transition-colors cursor-pointer ${
                    isToday
                      ? "bg-teal-500/5 border-teal-500/20"
                      : "bg-zinc-950 border-zinc-800 hover:bg-zinc-900/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-[10px] font-semibold uppercase ${
                        isToday ? "text-teal-400" : "text-zinc-500"
                      }`}
                    >
                      {day.toLocaleDateString("en-US", {
                        weekday: "short",
                      })}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        isToday ? "text-teal-400" : "text-white"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>

                  {dayCrews.length === 0 ? (
                    <div className="text-[10px] text-zinc-600 italic py-2">
                      No crews
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {dayCrews.slice(0, 3).map((crew: any) => (
                        <div
                          key={crew.team_lead_id}
                          className="text-[9px] px-1.5 py-1 rounded border border-zinc-800 bg-zinc-900/50"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white truncate">
                              {crew.team_lead_name?.split(" ")[0] || "TL"}
                            </span>
                            <span className="text-green-400 font-medium">
                              ${(crew.daily_revenue || 0).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 text-zinc-500 mt-0.5">
                            <MapPin className="w-2.5 h-2.5" />
                            <span className="truncate">
                              {crew.first_job_town || "TBD"}
                            </span>
                            <span className="ml-auto">
                              {crew.jobs?.length || 0}j
                            </span>
                          </div>
                        </div>
                      ))}
                      {dayCrews.length > 3 && (
                        <p className="text-[8px] text-zinc-600 pl-1">
                          +{dayCrews.length - 3} more crews
                        </p>
                      )}
                    </div>
                  )}

                  {/* Day footer */}
                  {dayJobs > 0 && (
                    <div className="mt-1.5 pt-1 border-t border-zinc-800/50 flex items-center justify-between text-[9px]">
                      <span className="text-zinc-500">{dayJobs} jobs</span>
                      <span className="text-green-400 font-semibold">
                        ${dayRevenue.toLocaleString()}
                      </span>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Weekly total footer */}
          {weeklyTotal > 0 && (
            <div className="flex items-center justify-center gap-2 py-3 border-t border-zinc-800">
              <DollarSign className="w-4 h-4 text-green-400" />
              <span className="text-lg font-bold text-white">
                ${weeklyTotal.toLocaleString()}
              </span>
              <span className="text-sm text-zinc-500">weekly total</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
