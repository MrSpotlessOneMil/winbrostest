"use client"

/**
 * Appointments — admin scheduling grid.
 * WinBros Round 2 task 4. Rows = salesmen, columns = time slots.
 * Unassigned appointments render in a strip at the bottom; drop on a salesman
 * row to assign (sets jobs.crew_salesman_id and upserts crew_days).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { Loader2, Plus, X } from "lucide-react"
import { APPOINTMENT_GRID, buildTimeSlots, slotForTime } from "@/lib/appointment-grid-config"

interface Appointment {
  id: number
  customer_id: number | null
  phone_number: string | null
  address: string | null
  service_type: string | null
  date: string | null
  scheduled_at: string | null
  end_time: string | null
  price: number | null
  status: string | null
  crew_salesman_id: number | null
  notes: string | null
}

interface Salesman {
  id: number
  name: string
  employee_type: string | null
  is_team_lead: boolean | null
}

function mondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function labelDate(ymd: string): string {
  const d = new Date(ymd + "T12:00:00")
  return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" })
}

function DraggableAppt({ appt, label }: { appt: Appointment; label: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `appt-${appt.id}`,
    data: appt,
  })
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
    cursor: "grab",
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="rounded border border-blue-400 bg-blue-50 px-2 py-1 text-xs shadow-sm"
    >
      <div className="font-medium text-blue-900">{label}</div>
      {appt.address && <div className="truncate text-blue-700">{appt.address}</div>}
      {appt.scheduled_at && (
        <div className="text-blue-600">
          {appt.scheduled_at}
          {appt.price != null && ` · $${Number(appt.price).toFixed(0)}`}
        </div>
      )}
    </div>
  )
}

function DroppableCell({
  salesmanId,
  date,
  slot,
  appointments,
}: {
  salesmanId: number | null
  date: string
  slot: string
  appointments: Appointment[]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${salesmanId ?? "unassigned"}-${date}-${slot}`,
    data: { salesmanId, date, slot },
  })
  return (
    <td
      ref={setNodeRef}
      className={`min-w-[120px] border border-gray-200 align-top p-1 ${isOver ? "bg-blue-100" : ""}`}
    >
      <div className="flex flex-col gap-1">
        {appointments.map(a => (
          <DraggableAppt
            key={a.id}
            appt={a}
            label={a.service_type || a.phone_number || `Job #${a.id}`}
          />
        ))}
      </div>
    </td>
  )
}

interface CreateFormState {
  date: string
  scheduled_at: string
  duration_minutes: number
  address: string
  phone_number: string
  service_type: string
  price: string
  notes: string
}

function defaultCreateForm(weekStart: string): CreateFormState {
  return {
    date: weekStart,
    scheduled_at: "09:00",
    duration_minutes: 120,
    address: "",
    phone_number: "",
    service_type: "Window Cleaning",
    price: "",
    notes: "",
  }
}

export default function AppointmentsPage() {
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [salesmen, setSalesmen] = useState<Salesman[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<CreateFormState>(() => defaultCreateForm(mondayOf(new Date())))

  const slots = useMemo(() => buildTimeSlots(), [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const start = weekStart
      const end = addDays(weekStart, 6)
      const res = await fetch(`/api/actions/appointments?start=${start}&end=${end}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setAppointments(body.appointments || [])
      setSalesmen(body.salesmen || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load appointments")
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    load()
  }, [load])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  async function handleDragEnd(event: DragEndEvent) {
    const dropData = event.over?.data.current as
      | { salesmanId: number | null; date: string; slot: string }
      | undefined
    const apptData = event.active.data.current as Appointment | undefined
    if (!dropData || !apptData) return

    const nextSalesmanId = dropData.salesmanId
    const nextDate = dropData.date
    const nextTime = dropData.slot

    if (
      apptData.crew_salesman_id === nextSalesmanId &&
      apptData.date === nextDate &&
      apptData.scheduled_at === nextTime
    ) {
      return
    }

    const endISO = (() => {
      const start = new Date(`${nextDate}T${nextTime}:00`)
      start.setMinutes(start.getMinutes() + APPOINTMENT_GRID.slotMinutes)
      return start.toISOString()
    })()

    setAppointments(prev =>
      prev.map(a =>
        a.id === apptData.id
          ? {
              ...a,
              crew_salesman_id: nextSalesmanId,
              date: nextDate,
              scheduled_at: nextTime,
              end_time: endISO,
            }
          : a
      )
    )

    try {
      const res = await fetch(`/api/actions/appointments?id=${apptData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crew_salesman_id: nextSalesmanId,
          date: nextDate,
          scheduled_at: nextTime,
          end_time: endISO,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save assignment")
      load()
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const start = new Date(`${form.date}T${form.scheduled_at}:00`)
      const end = new Date(start.getTime() + form.duration_minutes * 60_000)
      const res = await fetch("/api/actions/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: form.date,
          scheduled_at: form.scheduled_at,
          end_time: end.toISOString(),
          address: form.address || undefined,
          phone_number: form.phone_number || undefined,
          service_type: form.service_type || undefined,
          price: form.price ? Number(form.price) : undefined,
          notes: form.notes || undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setShowCreate(false)
      setForm(defaultCreateForm(weekStart))
      load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create appointment")
    } finally {
      setCreating(false)
    }
  }

  const unassigned = appointments.filter(a => !a.crew_salesman_id)
  const assignedByCell = useMemo(() => {
    const map = new Map<string, Appointment[]>()
    for (const a of appointments) {
      if (!a.crew_salesman_id || !a.date || !a.scheduled_at) continue
      const slot = slotForTime(a.scheduled_at)
      if (!slot) continue
      const key = `${a.crew_salesman_id}|${a.date}|${slot}`
      const bucket = map.get(key) ?? []
      bucket.push(a)
      map.set(key, bucket)
    }
    return map
  }, [appointments])

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <div className="flex items-center gap-2">
          <button
            className="rounded border px-2 py-1 text-sm"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            ← Prev week
          </button>
          <span className="text-sm text-gray-600">
            Week of {labelDate(weekStart)}
          </span>
          <button
            className="rounded border px-2 py-1 text-sm"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            Next week →
          </button>
          <button
            className="ml-2 flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
            onClick={() => {
              setForm(defaultCreateForm(weekStart))
              setShowCreate(true)
            }}
          >
            <Plus className="h-4 w-4" /> New appointment
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-gray-200 bg-gray-50 p-2 text-left font-medium">
                    Salesman / Date
                  </th>
                  {days.map(d =>
                    slots.map(s => (
                      <th
                        key={`${d}-${s}`}
                        className="border border-gray-200 bg-gray-50 p-1 text-center font-normal"
                      >
                        <div className="font-medium">{labelDate(d)}</div>
                        <div className="text-gray-500">{s}</div>
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {salesmen.length === 0 ? (
                  <tr>
                    <td colSpan={1 + days.length * slots.length} className="p-6 text-center text-gray-500">
                      No salesmen found. Seed cleaners with employee_type=&apos;salesman&apos; to populate rows.
                    </td>
                  </tr>
                ) : (
                  salesmen.map(sm => (
                    <tr key={sm.id}>
                      <th className="sticky left-0 z-10 border border-gray-200 bg-white p-2 text-left font-medium">
                        {sm.name}
                      </th>
                      {days.map(d =>
                        slots.map(s => {
                          const key = `${sm.id}|${d}|${s}`
                          const cellAppts = assignedByCell.get(key) ?? []
                          return (
                            <DroppableCell
                              key={key}
                              salesmanId={sm.id}
                              date={d}
                              slot={s}
                              appointments={cellAppts}
                            />
                          )
                        })
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6">
            <h2 className="mb-2 text-sm font-medium text-gray-700">
              Unassigned ({unassigned.length})
            </h2>
            <div className="flex flex-wrap gap-2 rounded border border-dashed border-gray-300 p-3 min-h-[64px]">
              {unassigned.length === 0 ? (
                <span className="text-xs text-gray-500">
                  Drop appointments back here to unassign.
                </span>
              ) : (
                unassigned.map(a => (
                  <DraggableAppt
                    key={a.id}
                    appt={a}
                    label={a.service_type || a.phone_number || `Job #${a.id}`}
                  />
                ))
              )}
            </div>
          </div>
        </DndContext>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={submitCreate}
            className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">New Appointment</h2>
              <button type="button" onClick={() => setShowCreate(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-1">
                <span className="block text-gray-600">Date</span>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-1">
                <span className="block text-gray-600">Start time</span>
                <input
                  type="time"
                  required
                  value={form.scheduled_at}
                  onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-1">
                <span className="block text-gray-600">Duration (min)</span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  required
                  value={form.duration_minutes}
                  onChange={e =>
                    setForm(f => ({ ...f, duration_minutes: Number(e.target.value) }))
                  }
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-1">
                <span className="block text-gray-600">Price</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-2">
                <span className="block text-gray-600">Address</span>
                <input
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-1">
                <span className="block text-gray-600">Phone</span>
                <input
                  value={form.phone_number}
                  onChange={e => setForm(f => ({ ...f, phone_number: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-1">
                <span className="block text-gray-600">Service</span>
                <input
                  value={form.service_type}
                  onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                />
              </label>
              <label className="col-span-2">
                <span className="block text-gray-600">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="mt-1 w-full rounded border px-2 py-1"
                  rows={2}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded border px-3 py-1 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
