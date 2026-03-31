"use client"

import { useMemo, useRef, useEffect, useState, useCallback } from "react"

/* ── types ─────────────────────────────────────────────────────── */

export type GanttJob = {
  id: string
  customerName: string
  cleanerName: string
  cleanerId: string
  start: Date
  end: Date
  status: string
  color?: string
}

type Props = {
  jobs: GanttJob[]
  cleanerColorMap: Map<string, string>
  onJobClick?: (jobId: string) => void
  /** ISO string – the Monday of the week to display */
  initialDate?: string
}

/* ── constants ─────────────────────────────────────────────────── */

const ROW_H = 72
const SIDEBAR_W = 140
const HOUR_W = 80
const START_HOUR = 6 // 6 AM
const END_HOUR = 21 // 9 PM
const HOURS_PER_DAY = END_HOUR - START_HOUR
const DAY_W = HOURS_PER_DAY * HOUR_W

const AVATAR_COLORS = [
  "#14b8a6", "#f97316", "#6b7280", "#22c55e", "#3b82f6",
  "#a855f7", "#ec4899", "#eab308", "#ef4444", "#06b6d4",
]

/* ── helpers ───────────────────────────────────────────────────── */

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function getMonday(d: Date) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0, 0, 0, 0)
  return dt
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function fmtHour(h: number) {
  if (h === 0 || h === 24) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function fmtTime(d: Date) {
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? "pm" : "am"
  h = h % 12 || 12
  return m ? `${h}:${String(m).padStart(2, "0")}${ampm}` : `${h}${ampm}`
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function getTimezoneAbbr() {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" }).formatToParts(new Date())
    const tz = parts.find((p) => p.type === "timeZoneName")
    return tz?.value || ""
  } catch {
    const offset = -new Date().getTimezoneOffset()
    const sign = offset >= 0 ? "+" : "-"
    const h = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")
    return `GMT${sign}${h}`
  }
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/* ── component ─────────────────────────────────────────────────── */

export default function ScheduleGantt({ jobs, cleanerColorMap, onJobClick, initialDate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [weekStart, setWeekStart] = useState(() => {
    if (initialDate) return getMonday(new Date(initialDate))
    return getMonday(new Date())
  })

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  // Unique employees from jobs in this week range (+ "Unassigned" row for jobs without a cleaner)
  const UNASSIGNED_ID = "__unassigned__"
  const employees = useMemo(() => {
    const weekEnd = addDays(weekStart, 7)
    const map = new Map<string, { id: string; name: string; color: string }>()
    let hasUnassigned = false
    for (const j of jobs) {
      if (j.start >= weekEnd || j.end <= weekStart) continue
      if (!j.cleanerName || !j.cleanerId) {
        hasUnassigned = true
        continue
      }
      if (!map.has(j.cleanerId)) {
        map.set(j.cleanerId, {
          id: j.cleanerId,
          name: j.cleanerName,
          color: cleanerColorMap.get(j.cleanerName) || AVATAR_COLORS[map.size % AVATAR_COLORS.length],
        })
      }
    }
    const sorted = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
    if (hasUnassigned) {
      sorted.push({ id: UNASSIGNED_ID, name: "Unassigned", color: "#ef4444" })
    }
    return sorted
  }, [jobs, weekStart, cleanerColorMap])

  // Jobs indexed by cleanerId (unassigned jobs go under UNASSIGNED_ID)
  const jobsByEmployee = useMemo(() => {
    const weekEnd = addDays(weekStart, 7)
    const m = new Map<string, GanttJob[]>()
    for (const j of jobs) {
      if (j.start >= weekEnd || j.end <= weekStart) continue
      const key = j.cleanerId || UNASSIGNED_ID
      const list = m.get(key) || []
      list.push(j)
      m.set(key, list)
    }
    return m
  }, [jobs, weekStart])

  const totalW = DAY_W * 7
  const totalH = Math.max(employees.length * ROW_H, ROW_H * 3)

  // Current-time indicator
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Scroll to today on mount
  useEffect(() => {
    if (!scrollRef.current) return
    const today = new Date()
    const dayIndex = weekDays.findIndex((d) => isSameDay(d, today))
    if (dayIndex >= 0) {
      const targetX = dayIndex * DAY_W
      scrollRef.current.scrollLeft = Math.max(0, targetX - 40)
    }
  }, [weekDays])

  const nowX = useMemo(() => {
    const dayIndex = weekDays.findIndex((d) => isSameDay(d, now))
    if (dayIndex < 0) return null
    const hourFrac = now.getHours() + now.getMinutes() / 60 - START_HOUR
    if (hourFrac < 0 || hourFrac > HOURS_PER_DAY) return null
    return dayIndex * DAY_W + hourFrac * HOUR_W
  }, [now, weekDays])

  const goToday = useCallback(() => setWeekStart(getMonday(new Date())), [])
  const goPrev = useCallback(() => setWeekStart((w) => addDays(w, -7)), [])
  const goNext = useCallback(() => setWeekStart((w) => addDays(w, 7)), [])

  // Title
  const title = useMemo(() => {
    const end = addDays(weekStart, 6)
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
    const s = weekStart.toLocaleDateString("en-US", opts)
    const e = end.toLocaleDateString("en-US", { ...opts, year: "numeric" })
    return `${s} – ${e}`
  }, [weekStart])

  function jobBlock(j: GanttJob, dayDate: Date, empColor: string) {
    if (!isSameDay(j.start, dayDate)) return null
    const startFrac = j.start.getHours() + j.start.getMinutes() / 60 - START_HOUR
    const endFrac = j.end.getHours() + j.end.getMinutes() / 60 - START_HOUR
    if (endFrac <= 0 || startFrac >= HOURS_PER_DAY) return null

    const clampedStart = Math.max(startFrac, 0)
    const clampedEnd = Math.min(endFrac, HOURS_PER_DAY)
    const left = clampedStart * HOUR_W
    const width = Math.max((clampedEnd - clampedStart) * HOUR_W, 40)

    const statusColor =
      j.status === "completed" ? "#22c55e" :   // green — done
      j.status === "in_progress" ? "#eab308" : // yellow — ongoing
      j.status === "cancelled" ? "#71717a" :   // grey — cancelled
      j.status === "pending" || j.status === "quoted" ? "#a855f7" : // purple — needs action
      j.status === "scheduled" || j.status === "confirmed" ? "#3b82f6" : // blue — upcoming
      empColor

    return (
      <div
        key={j.id}
        onClick={(e) => { e.stopPropagation(); onJobClick?.(j.id) }}
        title={`${j.customerName}\n${fmtTime(j.start)}–${fmtTime(j.end)}`}
        style={{
          position: "absolute",
          top: 8,
          left,
          width,
          height: ROW_H - 20,
          borderRadius: 6,
          background: "rgba(39,39,42,0.85)",
          border: `1px solid rgba(63,63,70,0.6)`,
          borderLeft: `3px solid ${statusColor}`,
          cursor: "pointer",
          overflow: "hidden",
          padding: "4px 8px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          transition: "box-shadow 0.15s",
          zIndex: 2,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.boxShadow = `0 0 0 1px ${statusColor}`)}
        onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "#e4e4e7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {j.customerName}
        </span>
        <span style={{ fontSize: 10, color: "#a1a1aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {fmtTime(j.start)}–{fmtTime(j.end)}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 0 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={goPrev} className="gantt-nav-btn">&lsaquo;</button>
          <button onClick={goNext} className="gantt-nav-btn">&rsaquo;</button>
        </div>
        <button onClick={goToday} className="gantt-today-btn">Today</button>
        <span style={{ fontSize: 16, fontWeight: 600, color: "#e4e4e7" }}>{title}</span>
      </div>

      {/* main area */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, border: "1px solid rgba(63,63,70,0.5)", borderRadius: 8, overflow: "hidden", background: "rgba(24,24,27,0.6)" }}>
        {/* sidebar */}
        <div style={{ width: SIDEBAR_W, flexShrink: 0, borderRight: "1px solid rgba(63,63,70,0.5)", overflow: "hidden" }}>
          {/* header spacer */}
          <div style={{ height: 52, borderBottom: "1px solid rgba(63,63,70,0.5)" }} />
          {employees.length === 0 ? (
            <div style={{ padding: 16, color: "#71717a", fontSize: 13, textAlign: "center" }}>No employees with jobs this week</div>
          ) : (
            employees.map((emp) => (
              <div key={emp.id} style={{ height: ROW_H, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: "1px solid rgba(63,63,70,0.3)" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%", background: emp.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0,
                }}>
                  {getInitials(emp.name)}
                </div>
                <span style={{ fontSize: 13, color: "#d4d4d8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emp.name}</span>
              </div>
            ))
          )}
        </div>

        {/* timeline */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: "auto", overflowY: "hidden", position: "relative" }}>
          <div style={{ width: totalW, minHeight: totalH + 52 }}>
            {/* day + hour headers */}
            <div style={{ position: "sticky", top: 0, zIndex: 10, background: "rgba(24,24,27,0.95)", borderBottom: "1px solid rgba(63,63,70,0.5)" }}>
              {/* day row */}
              <div style={{ display: "flex", height: 26 }}>
                {weekDays.map((d, i) => {
                  const isToday = isSameDay(d, now)
                  return (
                    <div key={i} style={{
                      width: DAY_W, textAlign: "center", fontSize: 12, fontWeight: isToday ? 700 : 500,
                      color: isToday ? "#a78bfa" : "#a1a1aa", lineHeight: "26px",
                      borderRight: i < 6 ? "1px solid rgba(63,63,70,0.4)" : undefined,
                    }}>
                      {d.getDate()} {DAY_ABBR[d.getDay()]}
                    </div>
                  )
                })}
              </div>
              {/* hour row */}
              <div style={{ display: "flex", height: 26 }}>
                {weekDays.map((_, di) => (
                  <div key={di} style={{ display: "flex", width: DAY_W, borderRight: di < 6 ? "1px solid rgba(63,63,70,0.4)" : undefined }}>
                    {Array.from({ length: HOURS_PER_DAY }, (_, hi) => (
                      <div key={hi} style={{
                        width: HOUR_W, textAlign: "center", fontSize: 10, color: "#71717a", lineHeight: "26px",
                        borderRight: hi < HOURS_PER_DAY - 1 ? "1px solid rgba(63,63,70,0.15)" : undefined,
                      }}>
                        {fmtHour(START_HOUR + hi)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {/* timezone label */}
              <div style={{ position: "absolute", top: 2, left: 4, fontSize: 9, color: "#71717a" }}>
                {getTimezoneAbbr()}
              </div>
            </div>

            {/* rows */}
            {employees.map((emp) => {
              const empJobs = jobsByEmployee.get(emp.id) || []
              return (
                <div key={emp.id} style={{ display: "flex", height: ROW_H, borderBottom: "1px solid rgba(63,63,70,0.3)" }}>
                  {weekDays.map((dayDate, di) => (
                    <div key={di} style={{ width: DAY_W, position: "relative", borderRight: di < 6 ? "1px solid rgba(63,63,70,0.4)" : undefined }}>
                      {/* hour grid lines */}
                      {Array.from({ length: HOURS_PER_DAY }, (_, hi) => (
                        <div key={hi} style={{
                          position: "absolute", top: 0, bottom: 0,
                          left: hi * HOUR_W,
                          borderRight: "1px solid rgba(63,63,70,0.12)",
                        }} />
                      ))}
                      {/* job blocks */}
                      {empJobs.map((j) => jobBlock(j, dayDate, emp.color))}
                    </div>
                  ))}
                </div>
              )
            })}

            {/* now indicator */}
            {nowX !== null && (
              <div style={{
                position: "absolute", top: 52, bottom: 0, left: nowX, width: 2,
                background: "#eab308", zIndex: 5, pointerEvents: "none",
                boxShadow: "0 0 6px rgba(234,179,8,0.4)",
              }} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
