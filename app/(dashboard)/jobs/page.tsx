"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import FullCalendar from "@fullcalendar/react"
import dayGridPlugin from "@fullcalendar/daygrid"
import timeGridPlugin from "@fullcalendar/timegrid"
import listPlugin from "@fullcalendar/list"
import interactionPlugin from "@fullcalendar/interaction"
import { formatDate } from "@fullcalendar/core"
import type { DateSelectArg, EventClickArg, EventInput } from "@fullcalendar/core"
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
}

type CalendarEventDetails = {
  title: string
  start: Date | null
  end: Date | null
  location: string
  description: string
  status: string
  price: number
  client: string
}

type CreateForm = {
  title: string
  start: string
  end: string
  location: string
  description: string
}

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

function resolveStart(job: CalendarJob) {
  const dateValue = job.scheduled_at || job.scheduled_date || job.date
  if (!dateValue) return new Date()

  const raw = String(dateValue)

  // If it's a full ISO timestamp, use it directly
  if (raw.includes("T")) return new Date(raw)

  // If we have a separate time field, combine them
  const timeValue = job.scheduled_time
  if (timeValue && /^\d{2}:\d{2}/.test(timeValue)) {
    return new Date(`${raw}T${timeValue}`)
  }

  // Default to 9am
  return new Date(`${raw}T09:00:00`)
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

export default function JobsPage() {
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventDetails | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const calendarRef = useRef<FullCalendar | null>(null)
  const [createForm, setCreateForm] = useState<CreateForm>({
    title: "",
    start: "",
    end: "",
    location: "",
    description: "",
  })

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

  const baseEvents = useMemo<EventInput[]>(() => {
    return jobs.map((job) => {
      const start = resolveStart(job)
      const end = resolveEnd(job)
      const location = resolveLocation(job)
      const description = resolveDescription(job)
      const title = job.title || job.service_type || resolveCustomerName(job)
      const className = eventClassForStatus(job.status)

      return {
        id: String(job.id),
        title,
        start,
        end,
        classNames: [className],
        extendedProps: {
          description,
          location,
          resourceId: location,
          client: resolveCustomerName(job),
          price: job.price || job.estimated_value || 0,
          status: job.status || "scheduled",
        },
      }
    })
  }, [jobs])

  const handleSelect = (info: DateSelectArg) => {
    setCreateForm({
      title: "",
      start: toLocalInput(info.start),
      end: toLocalInput(info.end),
      location: "",
      description: "",
    })
    setCreateOpen(true)
    info.view.calendar.unselect()
  }

  const handleEventClick = (info: EventClickArg) => {
    const start = info.event.start
    const end = info.event.end
    const details: CalendarEventDetails = {
      title: info.event.title || "(no title)",
      start,
      end,
      location: info.event.extendedProps.location || emptyValue,
      description: info.event.extendedProps.description || emptyValue,
      status: info.event.extendedProps.status || "scheduled",
      price: info.event.extendedProps.price || 0,
      client: info.event.extendedProps.client || emptyValue,
    }
    setSelectedEvent(details)
  }

  const handleCreateSave = () => {
    const calendar = calendarRef.current?.getApi()
    const title = createForm.title.trim() || "New Event"
    const location = createForm.location.trim()
    const description = createForm.description.trim()

    if (calendar) {
      calendar.addEvent({
        id: `local-${Date.now()}`,
        title,
        start: createForm.start,
        end: createForm.end || undefined,
        classNames: ["event-scheduled"],
        extendedProps: {
          description,
          location,
          resourceId: location,
        },
      })
    }

    setCreateOpen(false)
  }

  return (
    <>
      <div className="calendar-shell">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Jobs Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Schedule and manage all service appointments
          </p>
        </div>

        <div className="calendar-card">
          <div id="calendar">
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,timeGridWeek,listMonth",
              }}
              events={baseEvents}
              selectable
              nowIndicator
              dayMaxEvents
              eventTimeFormat={timeFormat}
              select={handleSelect}
              eventClick={handleEventClick}
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
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>When:</strong>{" "}
              {formatRange(selectedEvent?.start || null, selectedEvent?.end || null)}
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>Customer:</strong> {selectedEvent?.client || emptyValue}
            </div>
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
          </div>
          <div className="cal-modal-footer">
            <button
              className="cal-modal-btn"
              onClick={() => setSelectedEvent(null)}
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Create Event Modal */}
      <div
        className={`cal-modal-backdrop${createOpen ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setCreateOpen(false)
        }}
      >
        <div className="cal-modal">
          <div className="cal-modal-header">
            <h5>Create Event</h5>
            <button
              className="cal-modal-close"
              onClick={() => setCreateOpen(false)}
            >
              &times;
            </button>
          </div>
          <div className="cal-modal-body">
            <div style={{ marginBottom: "0.5rem" }}>
              <label className="cal-form-label">Title</label>
              <input
                type="text"
                className="cal-form-control"
                placeholder="Event title"
                value={createForm.title}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, title: e.target.value }))
                }
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label className="cal-form-label">Start</label>
                <input
                  type="datetime-local"
                  className="cal-form-control"
                  value={createForm.start}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, start: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="cal-form-label">End</label>
                <input
                  type="datetime-local"
                  className="cal-form-control"
                  value={createForm.end}
                  onChange={(e) =>
                    setCreateForm((prev) => ({ ...prev, end: e.target.value }))
                  }
                />
              </div>
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <label className="cal-form-label">Location (optional)</label>
              <input
                type="text"
                className="cal-form-control"
                value={createForm.location}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, location: e.target.value }))
                }
              />
            </div>
            <div style={{ marginTop: "0.5rem" }}>
              <label className="cal-form-label">Description</label>
              <textarea
                className="cal-form-control"
                rows={3}
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="cal-modal-footer">
            <button
              className="cal-modal-btn cal-modal-btn-primary"
              onClick={handleCreateSave}
            >
              Add to calendar
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
