"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import FullCalendar from "@fullcalendar/react"
import dayGridPlugin from "@fullcalendar/daygrid"
import timeGridPlugin from "@fullcalendar/timegrid"
import listPlugin from "@fullcalendar/list"
import interactionPlugin from "@fullcalendar/interaction"
import { formatDate } from "@fullcalendar/core"
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput } from "@fullcalendar/core"
import "./calendar.css"

type CalendarJob = {
  id: string | number
  title?: string
  service_type?: string
  date?: string
  scheduled_at?: string
  scheduled_time?: string
  scheduled_date?: string
  hours?: number
  price?: number
  estimated_value?: number
  status?: string
  notes?: string
  address?: string
  phone_number?: string
  customer_name?: string
  customers?: any
  cleaners?: any
  cleaner_id?: number
}

type CalendarEventDetails = {
  jobId: string
  title: string
  start: Date | null
  end: Date | null
  location: string
  description: string
  status: string
  price: number
  client: string
  cleaner: string
  cleanerName: string
  hours: number
}

type PendingMove = {
  jobId: string
  newStart: Date
  newEnd: Date
  hours: number
  cleanerName: string
  conflictJobId: string
  conflictTitle: string
  conflictStart: Date
  conflictEnd: Date
  conflictHours: number
  revert: (() => void) | null
  source: "drag" | "edit"
}

type CreateForm = {
  customer_phone: string
  customer_name: string
  email: string
  address: string
  service_type: string
  date: string
  time: string
  duration_minutes: string
  price: string
  notes: string
}

type RainDayPreview = {
  date: string
  jobs_count: number
  total_revenue: number
  jobs: { id: string; customer_name: string; time: string; value: number; address: string }[]
}

type RainDayResult = {
  jobs_affected: number
  jobs_successfully_rescheduled: number
  notifications_sent: number
  spread_summary: Record<string, number>
}

const CLEANER_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#ef4444", // red
  "#f97316", // orange
  "#a855f7", // purple
  "#14b8a6", // teal
  "#ec4899", // pink
  "#eab308", // yellow
  "#6366f1", // indigo
  "#06b6d4", // cyan
]

const emptyValue = "\u2014"

function resolveCustomer(job: CalendarJob) {
  if (Array.isArray(job.customers)) {
    return job.customers[0]
  }
  return job.customers || null
}

function resolveCustomerName(job: CalendarJob) {
  if (job.customer_name) return job.customer_name
  const customer = resolveCustomer(job)
  if (customer && typeof customer.name === "string" && customer.name.trim()) {
    return customer.name
  }
  const first = customer?.first_name ? String(customer.first_name).trim() : ""
  const last = customer?.last_name ? String(customer.last_name).trim() : ""
  const combined = `${first} ${last}`.trim()
  return combined || "Unknown"
}

function resolveLocation(job: CalendarJob) {
  const customer = resolveCustomer(job)
  return job.address || customer?.address || job.service_type || ""
}

function resolveDescription(job: CalendarJob) {
  return job.notes || job.service_type || ""
}

function resolveCleanerName(job: CalendarJob) {
  const cleaner = job.cleaners
  if (!cleaner) return null
  if (Array.isArray(cleaner)) return cleaner[0]?.name || null
  return cleaner.name || null
}

function resolveStart(job: CalendarJob) {
  // date column is the actual date (YYYY-MM-DD), scheduled_at is a time string
  const dateStr = job.date || job.scheduled_date
  if (!dateStr) return new Date()

  const rawDate = String(dateStr)

  // If it's already a full ISO timestamp, use it directly
  if (rawDate.includes("T")) return new Date(rawDate)

  // Use scheduled_at as the time component (e.g. "09:00 AM PST", "14:30", etc.)
  const timeStr = job.scheduled_at || job.scheduled_time || ""
  const timeMatch = String(timeStr).match(/^(\d{1,2}):(\d{2})/)
  if (timeMatch) {
    return new Date(`${rawDate}T${timeMatch[0]}:00`)
  }

  // Default to 9am
  return new Date(`${rawDate}T09:00:00`)
}

function resolveEnd(job: CalendarJob) {
  const start = resolveStart(job)
  const hours = job.hours ? Number(job.hours) : 2
  return new Date(start.getTime() + hours * 60 * 60 * 1000)
}

function formatRange(start: Date | null, end: Date | null) {
  if (!start) return ""
  const startLabel = formatDate(start, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  if (!end) return startLabel
  const sameDay = start.toDateString() === end.toDateString()
  const endLabel = formatDate(
    end,
    sameDay
      ? { hour: "numeric", minute: "2-digit", hour12: true }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }
  )
  return `${startLabel} \u2013 ${endLabel}`
}

function toLocalInput(date: Date | null) {
  if (!date) return ""
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function eventClassForStatus(status?: string) {
  const normalized = (status || "").toLowerCase().replace(/[_\s]/g, "-")
  if (normalized === "completed") return "event-completed"
  if (normalized === "cancelled") return "event-cancelled"
  if (normalized === "confirmed") return "event-confirmed"
  if (normalized === "in-progress") return "event-in-progress"
  if (normalized === "rescheduled") return "event-rescheduled"
  return "event-scheduled"
}

const STORAGE_KEY_VIEW = "calendar-view"
const STORAGE_KEY_DATE = "calendar-date"

function getSavedView(): string {
  if (typeof window === "undefined") return "dayGridMonth"
  return localStorage.getItem(STORAGE_KEY_VIEW) || "dayGridMonth"
}

function getSavedDate(): string | undefined {
  if (typeof window === "undefined") return undefined
  return localStorage.getItem(STORAGE_KEY_DATE) || undefined
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDetails | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const calendarRef = useRef<FullCalendar | null>(null)
  const [createForm, setCreateForm] = useState<CreateForm>({
    customer_phone: "",
    customer_name: "",
    email: "",
    address: "",
    service_type: "Standard cleaning",
    date: "",
    time: "",
    duration_minutes: "120",
    price: "",
    notes: "",
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState("")

  // Drag-and-drop / edit state
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ date: "", time: "" })
  const [saving, setSaving] = useState(false)

  // Rainy day reschedule state
  const [rainOpen, setRainOpen] = useState(false)
  const [rainStep, setRainStep] = useState<"select" | "preview" | "loading" | "done">("select")
  const [rainDate, setRainDate] = useState("")
  const [rainPreview, setRainPreview] = useState<RainDayPreview | null>(null)
  const [rainResult, setRainResult] = useState<RainDayResult | null>(null)
  const [rainError, setRainError] = useState("")
  const [rainLoading, setRainLoading] = useState(false)

  const timeFormat = useMemo(
    () =>
      ({
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      } as const),
    []
  )

  useEffect(() => {
    async function fetchJobs() {
      try {
        const res = await fetch("/api/calendar")
        const data = await res.json()
        setJobs(data.jobs || [])
      } catch {
        setJobs([])
      }
    }
    fetchJobs()
  }, [])

  const cleanerColorMap = useMemo(() => {
    const names = [...new Set(
      jobs.map(j => resolveCleanerName(j)).filter(Boolean)
    )] as string[]
    const map = new Map<string, string>()
    names.sort().forEach((name, i) => {
      map.set(name, CLEANER_COLORS[i % CLEANER_COLORS.length])
    })
    return map
  }, [jobs])

  const baseEvents = useMemo<EventInput[]>(() => {
    return jobs.map((job) => {
      const start = resolveStart(job)
      const end = resolveEnd(job)
      const location = resolveLocation(job)
      const description = resolveDescription(job)
      const cleanerName = resolveCleanerName(job)
      const customerName = resolveCustomerName(job)
      const title = cleanerName
        ? `${customerName} (${cleanerName})`
        : job.title || job.service_type || customerName
      const className = eventClassForStatus(job.status)
      const cleanerColor = cleanerName ? cleanerColorMap.get(cleanerName) : undefined

      return {
        id: String(job.id),
        title,
        start,
        end,
        classNames: [className],
        backgroundColor: cleanerColor,
        borderColor: cleanerColor,
        extendedProps: {
          description,
          location,
          resourceId: location,
          client: customerName,
          cleaner: cleanerName || "",
          cleanerName: cleanerName || "",
          price: job.price || job.estimated_value || 0,
          status: job.status || "scheduled",
          jobId: String(job.id),
          hours: job.hours ? Number(job.hours) : 2,
        },
      }
    })
  }, [jobs, cleanerColorMap])

  const handleSelect = (info: DateSelectArg) => {
    const d = info.start
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    // Calculate duration from selection range
    const diffMs = info.end.getTime() - info.start.getTime()
    const diffMin = Math.round(diffMs / 60000)
    const duration = diffMin > 0 && diffMin < 1440 ? String(diffMin) : "120"

    setCreateForm({
      customer_phone: "",
      customer_name: "",
      email: "",
      address: "",
      service_type: "Standard cleaning",
      date,
      time: time === "00:00" ? "09:00" : time,
      duration_minutes: duration,
      price: "",
      notes: "",
    })
    setCreateError("")
    setCreateOpen(true)
    info.view.calendar.unselect()
  }

  const handleEventClick = (info: EventClickArg) => {
    const start = info.event.start
    const end = info.event.end
    const details: CalendarEventDetails = {
      jobId: info.event.id || info.event.extendedProps.jobId || "",
      title: info.event.title || "(no title)",
      start,
      end,
      location: info.event.extendedProps.location || emptyValue,
      description: info.event.extendedProps.description || emptyValue,
      status: info.event.extendedProps.status || "scheduled",
      price: info.event.extendedProps.price || 0,
      client: info.event.extendedProps.client || emptyValue,
      cleaner: info.event.extendedProps.cleaner || "",
      cleanerName: info.event.extendedProps.cleanerName || "",
      hours: info.event.extendedProps.hours || 2,
    }
    setSelectedEvent(details)
    setEditMode(false)
  }

  const refreshJobs = async () => {
    try {
      const res = await fetch("/api/calendar")
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch { /* ignore */ }
  }

  const saveJobTime = async (jobId: string, newStart: Date, hours: number): Promise<boolean> => {
    const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`
    const scheduled_at = `${String(newStart.getHours()).padStart(2, "0")}:${String(newStart.getMinutes()).padStart(2, "0")}`
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId, date, scheduled_at }),
      })
      const data = await res.json()
      return data.success === true
    } catch {
      return false
    }
  }

  const findConflicts = (cleanerName: string, newStart: Date, newEnd: Date, excludeEventId: string) => {
    if (!cleanerName) return []
    return baseEvents.filter((e) => {
      if (String(e.id) === excludeEventId) return false
      if ((e.extendedProps as any)?.cleanerName !== cleanerName) return false
      const eStart = new Date(e.start as any)
      const eEnd = new Date(e.end as any)
      return newStart < eEnd && eStart < newEnd
    })
  }

  const handleEventDrop = async (info: EventDropArg) => {
    const { event, revert } = info
    const newStart = event.start!
    const hours = event.extendedProps.hours || 2
    const newEnd = event.end || new Date(newStart.getTime() + hours * 3600000)
    const cleanerName = event.extendedProps.cleanerName || ""
    const jobId = event.id

    if (!cleanerName) {
      setSaving(true)
      const saved = await saveJobTime(jobId, newStart, hours)
      if (!saved) revert()
      else await refreshJobs()
      setSaving(false)
      return
    }

    const conflicts = findConflicts(cleanerName, newStart, newEnd, jobId)
    if (conflicts.length === 0) {
      setSaving(true)
      const saved = await saveJobTime(jobId, newStart, hours)
      if (!saved) revert()
      else await refreshJobs()
      setSaving(false)
      return
    }

    const conflict = conflicts[0]
    setPendingMove({
      jobId,
      newStart,
      newEnd,
      hours,
      cleanerName,
      conflictJobId: String(conflict.id),
      conflictTitle: conflict.title as string,
      conflictStart: new Date(conflict.start as any),
      conflictEnd: new Date(conflict.end as any),
      conflictHours: (conflict.extendedProps as any)?.hours || 2,
      revert,
      source: "drag",
    })
  }

  const handleConfirmMove = async () => {
    if (!pendingMove) return
    setSaving(true)

    const saved = await saveJobTime(pendingMove.jobId, pendingMove.newStart, pendingMove.hours)
    if (!saved) {
      pendingMove.revert?.()
      setPendingMove(null)
      setSaving(false)
      return
    }

    const newConflictStart = pendingMove.newEnd
    await saveJobTime(pendingMove.conflictJobId, newConflictStart, pendingMove.conflictHours)

    if (pendingMove.source === "edit") {
      setSelectedEvent(null)
      setEditMode(false)
    }

    setPendingMove(null)
    setSaving(false)
    await refreshJobs()
  }

  const handleCancelMove = () => {
    pendingMove?.revert?.()
    setPendingMove(null)
  }

  const handleStartEdit = () => {
    if (!selectedEvent?.start) return
    const d = selectedEvent.start
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    setEditForm({ date, time })
    setEditMode(true)
  }

  const handleEditSave = async () => {
    if (!selectedEvent || !editForm.date || !editForm.time) return
    const newStart = new Date(`${editForm.date}T${editForm.time}:00`)
    if (isNaN(newStart.getTime())) return

    const hours = selectedEvent.hours || 2
    const newEnd = new Date(newStart.getTime() + hours * 3600000)
    const cleanerName = selectedEvent.cleanerName || ""
    const jobId = selectedEvent.jobId

    if (cleanerName) {
      const conflicts = findConflicts(cleanerName, newStart, newEnd, jobId)
      if (conflicts.length > 0) {
        const conflict = conflicts[0]
        setPendingMove({
          jobId,
          newStart,
          newEnd,
          hours,
          cleanerName,
          conflictJobId: String(conflict.id),
          conflictTitle: conflict.title as string,
          conflictStart: new Date(conflict.start as any),
          conflictEnd: new Date(conflict.end as any),
          conflictHours: (conflict.extendedProps as any)?.hours || 2,
          revert: null,
          source: "edit",
        })
        return
      }
    }

    setSaving(true)
    const saved = await saveJobTime(jobId, newStart, hours)
    setSaving(false)
    if (saved) {
      setSelectedEvent(null)
      setEditMode(false)
      await refreshJobs()
    }
  }

  const openRainDay = () => {
    setRainOpen(true)
    setRainStep("select")
    setRainDate("")
    setRainPreview(null)
    setRainResult(null)
    setRainError("")
  }

  const handleRainPreview = async () => {
    if (!rainDate) return
    setRainLoading(true)
    setRainError("")
    try {
      const res = await fetch(`/api/rain-day?date=${rainDate}`)
      const data = await res.json()
      if (!data.success) {
        setRainError(data.error || "Failed to fetch preview")
        return
      }
      setRainPreview(data.data)
      setRainStep("preview")
    } catch {
      setRainError("Failed to connect to server")
    } finally {
      setRainLoading(false)
    }
  }

  const handleRainConfirm = async () => {
    if (!rainDate) return
    setRainStep("loading")
    setRainError("")
    try {
      const res = await fetch("/api/rain-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ affected_date: rainDate, auto_spread: true }),
      })
      const data = await res.json()
      if (!data.success) {
        setRainError(data.error || "Reschedule failed")
        setRainStep("preview")
        return
      }
      setRainResult(data.data)
      setRainStep("done")
      // Refresh calendar
      const calRes = await fetch("/api/calendar")
      const calData = await calRes.json()
      setJobs(calData.jobs || [])
    } catch {
      setRainError("Failed to connect to server")
      setRainStep("preview")
    }
  }

  const formatSpreadDate = (dateStr: string) => {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  const handleCreateSave = async () => {
    const phone = createForm.customer_phone.trim()
    if (!phone) {
      setCreateError("Customer phone number is required")
      return
    }
    if (!createForm.date) {
      setCreateError("Date is required")
      return
    }

    setCreateSaving(true)
    setCreateError("")

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_phone: phone,
          customer_name: createForm.customer_name.trim() || undefined,
          email: createForm.email.trim() || undefined,
          address: createForm.address.trim() || undefined,
          service_type: createForm.service_type || "Standard cleaning",
          scheduled_date: createForm.date,
          scheduled_time: createForm.time || "09:00",
          duration_minutes: Number(createForm.duration_minutes) || 120,
          estimated_value: createForm.price ? Number(createForm.price) : undefined,
          notes: createForm.notes.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        setCreateError(data.error || "Failed to create job")
        return
      }

      setCreateOpen(false)
      await refreshJobs()
    } catch {
      setCreateError("Connection error. Please try again.")
    } finally {
      setCreateSaving(false)
    }
  }

  return (
    <>
      <div className="calendar-shell">
        <div className="mb-6" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Calendar</h1>
            <p className="text-sm text-muted-foreground">
              Schedule and manage all service appointments
            </p>
          </div>
          <button className="rain-day-btn" onClick={openRainDay}>
            Rainy Day Reschedule
          </button>
        </div>

        {cleanerColorMap.size >= 2 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.75rem" }}>
            {[...cleanerColorMap.entries()].map(([name, color]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <span style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  backgroundColor: color,
                  display: "inline-block",
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: "0.8rem", color: "#a1a1aa" }}>{name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="calendar-card">
          <div id="calendar">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView={getSavedView()}
              initialDate={getSavedDate()}
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,timeGridWeek,listMonth",
              }}
              events={baseEvents}
              editable
              selectable
              nowIndicator
              dayMaxEvents
              eventDurationEditable={false}
              snapDuration="00:15:00"
              dragRevertDuration={0}
              eventTimeFormat={timeFormat}
              select={handleSelect}
              eventClick={handleEventClick}
              eventDrop={handleEventDrop}
              datesSet={(info) => {
                localStorage.setItem(STORAGE_KEY_VIEW, info.view.type)
                localStorage.setItem(STORAGE_KEY_DATE, info.start.toISOString())
              }}
              eventDidMount={(info) => {
                const desc = info.event.extendedProps.description || ""
                const loc = info.event.extendedProps.location || ""
                const tip = [desc, loc].filter(Boolean).join(" \u2022 ")
                if (tip) {
                  info.el.setAttribute("title", tip)
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Event Details Modal */}
      <div
        className={`cal-modal-backdrop${selectedEvent ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedEvent(null)
        }}
      >
        <div className="cal-modal">
          <div className="cal-modal-header">
            <h5>{selectedEvent?.title || "Event"}</h5>
            <button
              className="cal-modal-close"
              onClick={() => setSelectedEvent(null)}
            >
              &times;
            </button>
          </div>
          <div className="cal-modal-body">
            {!editMode ? (
              <>
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>When:</strong>{" "}
                  {formatRange(selectedEvent?.start || null, selectedEvent?.end || null)}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Customer:</strong> {selectedEvent?.client || emptyValue}
                </div>
                {selectedEvent?.cleaner && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Cleaner:</strong> {selectedEvent.cleaner}
                  </div>
                )}
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Location:</strong> {selectedEvent?.location || emptyValue}
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Status:</strong> {selectedEvent?.status || emptyValue}
                </div>
                {selectedEvent?.price ? (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Price:</strong> ${Number(selectedEvent.price)}
                  </div>
                ) : null}
                <div>
                  <strong>Details:</strong> {selectedEvent?.description || emptyValue}
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label className="cal-form-label">Date</label>
                  <input
                    type="date"
                    className="cal-form-control"
                    value={editForm.date}
                    onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <label className="cal-form-label">Start Time</label>
                  <input
                    type="time"
                    className="cal-form-control"
                    value={editForm.time}
                    onChange={(e) => setEditForm((f) => ({ ...f, time: e.target.value }))}
                  />
                </div>
                <div style={{ marginTop: "0.75rem", fontSize: "0.8rem", color: "#71717a" }}>
                  Duration: {selectedEvent?.hours || 2} hours
                </div>
              </>
            )}
          </div>
          <div className="cal-modal-footer">
            {!editMode ? (
              <>
                <button
                  className="cal-modal-btn cal-modal-btn-edit"
                  onClick={handleStartEdit}
                >
                  Edit
                </button>
                <button
                  className="cal-modal-btn"
                  onClick={() => setSelectedEvent(null)}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <button
                  className="cal-modal-btn"
                  onClick={() => setEditMode(false)}
                >
                  Cancel
                </button>
                <button
                  className="cal-modal-btn cal-modal-btn-primary"
                  onClick={handleEditSave}
                  disabled={saving || !editForm.date || !editForm.time}
                >
                  {saving ? <><span className="saving-spinner" /> Saving...</> : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Conflict Confirmation Dialog */}
      <div
        className={`cal-modal-backdrop${pendingMove ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleCancelMove()
        }}
        style={{ zIndex: 60 }}
      >
        <div className="cal-modal" style={{ maxWidth: 440 }}>
          <div className="cal-modal-header">
            <h5>Schedule Conflict</h5>
            <button
              className="cal-modal-close"
              onClick={handleCancelMove}
            >
              &times;
            </button>
          </div>
          <div className="cal-modal-body">
            <p style={{ marginBottom: "0.75rem", color: "#d4d4d8" }}>
              <strong>{pendingMove?.cleanerName}</strong> already has a job scheduled at this time.
              If you continue, the overlapping job will be automatically rescheduled.
            </p>
            {pendingMove && (
              <div className="conflict-info">
                <div className="conflict-info-label">Overlapping Job</div>
                <div className="conflict-info-title">{pendingMove.conflictTitle}</div>
                <div className="conflict-info-time">
                  {formatRange(pendingMove.conflictStart, pendingMove.conflictEnd)}
                </div>
              </div>
            )}
          </div>
          <div className="cal-modal-footer">
            <button
              className="cal-modal-btn"
              onClick={handleCancelMove}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="cal-modal-btn cal-modal-btn-warning"
              onClick={handleConfirmMove}
              disabled={saving}
            >
              {saving ? <><span className="saving-spinner" /> Saving...</> : "Continue"}
            </button>
          </div>
        </div>
      </div>

      {/* Rainy Day Reschedule Modal */}
      <div
        className={`cal-modal-backdrop${rainOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setRainOpen(false)
        }}
      >
        <div className="cal-modal" style={{ maxWidth: 520 }}>
          <div className="cal-modal-header">
            <h5>Rainy Day Reschedule</h5>
            <button className="cal-modal-close" onClick={() => setRainOpen(false)}>
              &times;
            </button>
          </div>
          <div className="cal-modal-body">
            {rainStep === "select" && (
              <>
                <p style={{ marginBottom: "0.75rem", color: "rgba(161,161,170,1)" }}>
                  Select the date to cancel. All jobs will be automatically spread across the next available days.
                </p>
                <label className="cal-form-label">Rain Date</label>
                <input
                  type="date"
                  className="cal-form-control"
                  value={rainDate}
                  onChange={(e) => setRainDate(e.target.value)}
                />
                {rainError && <p className="rain-error">{rainError}</p>}
              </>
            )}

            {rainStep === "preview" && rainPreview && (
              <>
                <div className="rain-summary">
                  <div className="rain-stat">
                    <span className="rain-stat-value">{rainPreview.jobs_count}</span>
                    <span className="rain-stat-label">Jobs Affected</span>
                  </div>
                  <div className="rain-stat">
                    <span className="rain-stat-value">
                      ${rainPreview.total_revenue.toLocaleString()}
                    </span>
                    <span className="rain-stat-label">Revenue at Risk</span>
                  </div>
                </div>
                {rainPreview.jobs.length > 0 && (
                  <div className="rain-job-list">
                    {rainPreview.jobs.map((j) => (
                      <div key={j.id} className="rain-job-row">
                        <span className="rain-job-name">{j.customer_name}</span>
                        <span className="rain-job-time">{j.time || "9:00 AM"}</span>
                        {j.value > 0 && (
                          <span className="rain-job-value">${j.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {rainPreview.jobs_count === 0 && (
                  <p style={{ color: "rgba(161,161,170,1)", textAlign: "center", padding: "1rem 0" }}>
                    No jobs found on this date.
                  </p>
                )}
                {rainError && <p className="rain-error">{rainError}</p>}
              </>
            )}

            {rainStep === "loading" && (
              <div style={{ textAlign: "center", padding: "2rem 0" }}>
                <div className="rain-spinner" />
                <p style={{ color: "rgba(161,161,170,1)", marginTop: "0.75rem" }}>
                  Rescheduling jobs and sending notifications...
                </p>
              </div>
            )}

            {rainStep === "done" && rainResult && (
              <>
                <div className="rain-summary">
                  <div className="rain-stat">
                    <span className="rain-stat-value">{rainResult.jobs_successfully_rescheduled}</span>
                    <span className="rain-stat-label">Jobs Moved</span>
                  </div>
                  <div className="rain-stat">
                    <span className="rain-stat-value">{rainResult.notifications_sent}</span>
                    <span className="rain-stat-label">Notifications Sent</span>
                  </div>
                </div>
                {Object.keys(rainResult.spread_summary).length > 0 && (
                  <div className="rain-spread-table">
                    <div className="rain-spread-header">
                      <span>New Date</span>
                      <span>Jobs</span>
                    </div>
                    {Object.entries(rainResult.spread_summary)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, count]) => (
                        <div key={date} className="rain-spread-row">
                          <span>{formatSpreadDate(date)}</span>
                          <span>{count} job{count !== 1 ? "s" : ""}</span>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="cal-modal-footer">
            {rainStep === "select" && (
              <button
                className="cal-modal-btn cal-modal-btn-primary"
                disabled={!rainDate || rainLoading}
                onClick={handleRainPreview}
              >
                {rainLoading ? "Loading..." : "Preview Affected Jobs"}
              </button>
            )}
            {rainStep === "preview" && rainPreview && rainPreview.jobs_count > 0 && (
              <>
                <button
                  className="cal-modal-btn"
                  onClick={() => setRainStep("select")}
                >
                  Back
                </button>
                <button
                  className="cal-modal-btn rain-confirm-btn"
                  onClick={handleRainConfirm}
                >
                  Confirm Reschedule
                </button>
              </>
            )}
            {rainStep === "preview" && rainPreview && rainPreview.jobs_count === 0 && (
              <button className="cal-modal-btn" onClick={() => setRainStep("select")}>
                Back
              </button>
            )}
            {rainStep === "done" && (
              <button className="cal-modal-btn cal-modal-btn-primary" onClick={() => setRainOpen(false)}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Create Job Modal */}
      <div
        className={`cal-modal-backdrop${createOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setCreateOpen(false)
        }}
      >
        <div className="cal-modal" style={{ maxWidth: 500 }}>
          <div className="cal-modal-header">
            <h5>Create Job</h5>
            <button
              className="cal-modal-close"
              onClick={() => setCreateOpen(false)}
            >
              &times;
            </button>
          </div>
          <div className="cal-modal-body">
            {/* Customer Phone (required) */}
            <div style={{ marginBottom: "0.5rem" }}>
              <label className="cal-form-label">Customer Phone *</label>
              <input
                type="tel"
                className="cal-form-control"
                placeholder="(555) 123-4567"
                value={createForm.customer_phone}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, customer_phone: e.target.value }))
                }
              />
            </div>

            {/* Customer Name */}
            <div style={{ marginBottom: "0.5rem" }}>
              <label className="cal-form-label">Customer Name</label>
              <input
                type="text"
                className="cal-form-control"
                placeholder="John Smith"
                value={createForm.customer_name}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, customer_name: e.target.value }))
                }
              />
            </div>

            {/* Email & Address */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div>
                <label className="cal-form-label">Email</label>
                <input
                  type="email"
                  className="cal-form-control"
                  placeholder="john@example.com"
                  value={createForm.email}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="cal-form-label">Service Type</label>
                <select
                  className="cal-form-control"
                  value={createForm.service_type}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, service_type: e.target.value }))
                  }
                >
                  <option value="Standard cleaning">Standard Cleaning</option>
                  <option value="Deep cleaning">Deep Cleaning</option>
                  <option value="Move-in/move-out">Move-in/Move-out</option>
                  <option value="Window cleaning">Window Cleaning</option>
                  <option value="Pressure washing">Pressure Washing</option>
                  <option value="Gutter cleaning">Gutter Cleaning</option>
                </select>
              </div>
            </div>

            {/* Address */}
            <div style={{ marginBottom: "0.5rem" }}>
              <label className="cal-form-label">Address</label>
              <input
                type="text"
                className="cal-form-control"
                placeholder="123 Main St, City, State"
                value={createForm.address}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, address: e.target.value }))
                }
              />
            </div>

            {/* Date, Time, Duration */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div>
                <label className="cal-form-label">Date *</label>
                <input
                  type="date"
                  className="cal-form-control"
                  value={createForm.date}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="cal-form-label">Start Time</label>
                <input
                  type="time"
                  className="cal-form-control"
                  value={createForm.time}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, time: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="cal-form-label">Duration (min)</label>
                <select
                  className="cal-form-control"
                  value={createForm.duration_minutes}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, duration_minutes: e.target.value }))
                  }
                >
                  <option value="60">1 hour</option>
                  <option value="90">1.5 hours</option>
                  <option value="120">2 hours</option>
                  <option value="150">2.5 hours</option>
                  <option value="180">3 hours</option>
                  <option value="240">4 hours</option>
                  <option value="300">5 hours</option>
                  <option value="360">6 hours</option>
                </select>
              </div>
            </div>

            {/* Price */}
            <div style={{ marginBottom: "0.5rem" }}>
              <label className="cal-form-label">Price ($)</label>
              <input
                type="number"
                className="cal-form-control"
                placeholder="0.00"
                min="0"
                step="0.01"
                value={createForm.price}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, price: e.target.value }))
                }
              />
            </div>

            {/* Notes */}
            <div>
              <label className="cal-form-label">Notes</label>
              <textarea
                className="cal-form-control"
                rows={2}
                placeholder="Special instructions, access codes, etc."
                value={createForm.notes}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, notes: e.target.value }))
                }
              />
            </div>

            {createError && (
              <p style={{ color: "#f87171", fontSize: "0.8rem", marginTop: "0.5rem" }}>{createError}</p>
            )}
          </div>
          <div className="cal-modal-footer">
            <button
              className="cal-modal-btn"
              onClick={() => setCreateOpen(false)}
              disabled={createSaving}
            >
              Cancel
            </button>
            <button
              className="cal-modal-btn cal-modal-btn-primary"
              onClick={handleCreateSave}
              disabled={createSaving}
            >
              {createSaving ? <><span className="saving-spinner" /> Creating...</> : "Create Job"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
