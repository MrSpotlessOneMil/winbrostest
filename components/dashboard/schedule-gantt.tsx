"use client"

import { useMemo, useRef, useEffect, useState } from "react"

// ─── Types ───────────────────────────────────────────────────────
interface GanttJob {
  id: string | number
  title: string
  customerName: string
  cleanerName: string
  cleanerId: string
  start: Date
  end: Date
  status: string
  color: string
}

interface ScheduleGanttProps {
  jobs: GanttJob[]
  cleanerColorMap: Map<string, string>
  onJobClick?: (jobId: string) => void
  onCreateClick?: () => void
}

// ─── Constants ───────────────────────────────────────────────────
const ROW_HEIGHT = 72
const SIDEBAR_WIDTH = 140
const HOUR_WIDTH = 100
const DAY_START_HOUR = 7
const DAY_END_HOUR = 20
const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR
const DAY_WIDTH = HOURS_PER_DAY * HOUR_WIDTH

const AVATAR_COLORS = [
  "#14b8a6", "#f97316", "#6b7280", "#22c55e", "#3b82f6",
  "#a855f7", "#ec4899", "#eab308", "#ef4444", "#06b6d4",
]

function getInitials(name: string): string {
  const parts = name.split(" ").filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (parts[0]?.[0] || "?").toUpperCase()
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM"
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return "12 PM"
  return `${hour - 12} PM`
}

function formatTimeRange(start: Date, end: Date): string {
  const fmt = (d: Date) => {
    let h = d.getHours()
    const m = d.getMinutes()
    const ampm = h >= 12 ? "pm" : "am"
    h = h % 12 || 12
    return m > 0 ? `${h}:${String(m).padStart(2, "0")}${ampm}` : `${h}${ampm}`
  }
  return `${fmt(start)}–${fmt(end)}`
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ─── Component ───────────────────────────────────────────────────
export function ScheduleGantt({ jobs, cleanerColorMap, onJobClick, onCreateClick }: ScheduleGanttProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay()) // Sunday
    d.setHours(0, 0, 0, 0)
    return d
  })

  // Build 7-day array
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  const totalWidth = 7 * DAY_WIDTH

  // Unique employees sorted alphabetically
  const employees = useMemo(() => {
    const nameSet = new Map<string, string>() // id -> name
    for (const j of jobs) {
      if (j.cleanerName && j.cleanerId) {
        nameSet.set(j.cleanerId, j.cleanerName)
      }
    }
    // Also include unassigned row
    const list = Array.from(nameSet.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [jobs])

  // Add "Unassigned" row if there are jobs without a cleaner
  const hasUnassigned = jobs.some(j => !j.cleanerName)
  const allRows = useMemo(() => {
    const rows = [...employees]
    if (hasUnassigned) rows.push({ id: "__unassigned__", name: "Unassigned" })
    return rows
  }, [employees, hasUnassigned])

  // Group jobs by employee
  const jobsByEmployee = useMemo(() => {
    const map = new Map<string, GanttJob[]>()
    for (const row of allRows) map.set(row.id, [])
    for (const j of jobs) {
      const key = j.cleanerId || "__unassigned__"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(j)
    }
    return map
  }, [jobs, allRows])

  // Scroll to current time on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const now = new Date()
    const todayIndex = days.findIndex(d => isSameDay(d, now))
    if (todayIndex === -1) return
    const hourOffset = now.getHours() - DAY_START_HOUR + now.getMinutes() / 60
    const px = todayIndex * DAY_WIDTH + Math.max(0, hourOffset) * HOUR_WIDTH - 200
    scrollRef.current.scrollLeft = Math.max(0, px)
  }, [days])

  // Current time position
  const now = new Date()
  const nowDayIndex = days.findIndex(d => isSameDay(d, now))
  let nowX: number | null = null
  if (nowDayIndex >= 0) {
    const hourOffset = now.getHours() - DAY_START_HOUR + now.getMinutes() / 60
    if (hourOffset >= 0 && hourOffset <= HOURS_PER_DAY) {
      nowX = nowDayIndex * DAY_WIDTH + hourOffset * HOUR_WIDTH
    }
  }

  // Navigation
  const goToPrev = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d })
  const goToNext = () => setWeekStart(prev => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d })
  const goToToday = () => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    d.setHours(0, 0, 0, 0)
    setWeekStart(d)
  }

  // Week label
  const weekLabel = (() => {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    return `${fmt(weekStart)} – ${fmt(end)}, ${end.getFullYear()}`
  })()

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzAbbr = new Date().toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop() || tz

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={goToPrev} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={goToToday} className="px-3 py-1 text-xs font-medium rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors">
            Today
          </button>
          <button onClick={goToNext} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <span className="text-sm font-medium text-zinc-200">{weekLabel}</span>
        <span className="text-xs text-zinc-500">{tzAbbr}</span>
      </div>

      {/* Body: sidebar + scrollable timeline */}
      <div className="flex flex-1 overflow-hidden">
        {/* Fixed sidebar */}
        <div className="shrink-0 border-r border-zinc-800 bg-zinc-900/30" style={{ width: SIDEBAR_WIDTH }}>
          {/* Spacer for day + hour headers */}
          <div className="border-b border-zinc-800" style={{ height: 52 }} />
          {allRows.map((emp, i) => (
            <div
              key={emp.id}
              className="flex items-center gap-2.5 px-3 border-b border-zinc-800/50"
              style={{ height: ROW_HEIGHT }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: emp.id === "__unassigned__" ? "#52525b" : (AVATAR_COLORS[i % AVATAR_COLORS.length]) }}
              >
                {getInitials(emp.name)}
              </div>
              <span className="text-xs text-zinc-300 truncate leading-tight">{emp.name}</span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto">
          <div style={{ width: totalWidth, minHeight: "100%" }}>
            {/* Day + hour headers */}
            <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800" style={{ height: 52 }}>
              {/* Day row */}
              <div className="flex" style={{ height: 24 }}>
                {days.map((day, di) => {
                  const isToday = isSameDay(day, now)
                  return (
                    <div
                      key={di}
                      className={`flex items-center justify-center text-xs font-medium border-r border-zinc-700/50 ${isToday ? "text-amber-400" : "text-zinc-400"}`}
                      style={{ width: DAY_WIDTH }}
                    >
                      {day.getDate()} {day.toLocaleDateString("en-US", { weekday: "short" })}
                    </div>
                  )
                })}
              </div>
              {/* Hour row */}
              <div className="flex" style={{ height: 28 }}>
                {days.map((_, di) => (
                  <div key={di} className="flex border-r border-zinc-700/50" style={{ width: DAY_WIDTH }}>
                    {Array.from({ length: HOURS_PER_DAY }, (__, hi) => (
                      <div
                        key={hi}
                        className="flex items-center justify-center text-[10px] text-zinc-600 border-r border-zinc-800/40"
                        style={{ width: HOUR_WIDTH }}
                      >
                        {formatHour(DAY_START_HOUR + hi)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Employee rows */}
            {allRows.map((emp, ri) => {
              const empJobs = jobsByEmployee.get(emp.id) || []
              const rowColor = emp.id === "__unassigned__" ? "#52525b" : (AVATAR_COLORS[ri % AVATAR_COLORS.length])

              return (
                <div key={emp.id} className="relative border-b border-zinc-800/50" style={{ height: ROW_HEIGHT }}>
                  {/* Hour grid lines */}
                  {days.map((_, di) => (
                    <div key={di} className="absolute top-0 bottom-0" style={{ left: di * DAY_WIDTH, width: DAY_WIDTH }}>
                      {Array.from({ length: HOURS_PER_DAY }, (__, hi) => (
                        <div
                          key={hi}
                          className="absolute top-0 bottom-0 border-r border-zinc-800/30"
                          style={{ left: hi * HOUR_WIDTH, width: HOUR_WIDTH }}
                        />
                      ))}
                      {/* Day separator */}
                      <div className="absolute top-0 bottom-0 right-0 border-r border-zinc-700/40" />
                    </div>
                  ))}

                  {/* Job blocks */}
                  {empJobs.map(job => {
                    const dayIndex = days.findIndex(d => isSameDay(d, job.start))
                    if (dayIndex === -1) return null

                    const startHourOffset = job.start.getHours() - DAY_START_HOUR + job.start.getMinutes() / 60
                    const endHourOffset = job.end.getHours() - DAY_START_HOUR + job.end.getMinutes() / 60
                    const duration = Math.max(endHourOffset - startHourOffset, 0.5)

                    const left = dayIndex * DAY_WIDTH + Math.max(0, startHourOffset) * HOUR_WIDTH
                    const width = Math.max(duration * HOUR_WIDTH, 40)

                    const bgColor = job.color + "20"
                    const borderColor = job.color || rowColor

                    return (
                      <div
                        key={String(job.id)}
                        className="absolute flex flex-col justify-center px-2.5 rounded-md cursor-pointer hover:brightness-125 transition-all overflow-hidden"
                        style={{
                          left,
                          width,
                          top: 8,
                          bottom: 8,
                          backgroundColor: bgColor,
                          borderLeft: `3px solid ${borderColor}`,
                        }}
                        onClick={() => onJobClick?.(String(job.id))}
                        title={`${job.customerName}\n${formatTimeRange(job.start, job.end)}`}
                      >
                        <span className="text-[11px] font-semibold text-zinc-100 truncate leading-tight">
                          {job.customerName}
                        </span>
                        <span className="text-[10px] text-zinc-400 truncate leading-tight mt-0.5">
                          {formatTimeRange(job.start, job.end)}
                        </span>
                      </div>
                    )
                  })}

                  {/* Current time indicator */}
                  {nowX !== null && (
                    <div
                      className="absolute top-0 bottom-0 w-px bg-amber-400/70 z-20 pointer-events-none"
                      style={{ left: nowX }}
                    />
                  )}
                </div>
              )
            })}

            {/* Empty state */}
            {allRows.length === 0 && (
              <div className="flex items-center justify-center py-16 text-sm text-zinc-600">
                No employees with scheduled jobs this week
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FAB for creating new jobs */}
      {onCreateClick && (
        <button
          onClick={onCreateClick}
          className="absolute bottom-5 right-5 w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 flex items-center justify-center transition-colors z-30"
          title="Create job"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        </button>
      )}
    </div>
  )
}
