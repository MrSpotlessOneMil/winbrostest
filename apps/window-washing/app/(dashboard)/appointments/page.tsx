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
import { Calendar, FileText, Loader2, MapPin, Plus, User, UserPlus, X } from "lucide-react"
import { APPOINTMENT_GRID, buildTimeSlots, slotForTime } from "@/lib/appointment-grid-config"
import { QuoteBuilderSheet } from "@/components/winbros/quote-builder-sheet"
import { useStartNewQuote } from "@/hooks/use-start-new-quote"
import { useAuth } from "@/lib/auth-context"
import {
  CustomerPickerModal,
  customerDisplayName,
  mapsDirectionsUrl,
  type PickerCustomer,
} from "@/components/winbros/customer-picker"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { VisuallyHidden } from "@radix-ui/react-visually-hidden"

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

function DraggableAppt({
  appt,
  label,
  onConvertToQuote,
  converting,
}: {
  appt: Appointment
  label: string
  onConvertToQuote?: (appt: Appointment) => void
  converting?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `appt-${appt.id}`,
    data: appt,
  })
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border border-teal-500/40 bg-teal-500/15 px-2 py-1 text-xs shadow-sm hover:bg-teal-500/25 hover:border-teal-400/60 transition-colors"
    >
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing"
      >
        <div className="font-medium text-teal-100">{label}</div>
        {appt.address && <div className="truncate text-teal-300/80">{appt.address}</div>}
        {appt.scheduled_at && (
          <div className="text-teal-300">
            {appt.scheduled_at}
            {appt.price != null && ` · $${Number(appt.price).toFixed(0)}`}
          </div>
        )}
      </div>
      {onConvertToQuote && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onConvertToQuote(appt) }}
          disabled={converting}
          title="Mint a draft quote linked to this appointment (12.5% commission earns on conversion)"
          className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50"
        >
          {converting ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <FileText className="h-2.5 w-2.5" />
          )}
          → Quote
        </button>
      )}
    </div>
  )
}

function DroppableCell({
  salesmanId,
  date,
  slot,
  appointments,
  onConvertToQuote,
  convertingId,
}: {
  salesmanId: number | null
  date: string
  slot: string
  appointments: Appointment[]
  onConvertToQuote?: (appt: Appointment) => void
  convertingId?: number | null
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${salesmanId ?? "unassigned"}-${date}-${slot}`,
    data: { salesmanId, date, slot },
  })
  return (
    <td
      ref={setNodeRef}
      className={`min-w-[120px] border border-zinc-800 align-top p-1 transition-colors ${isOver ? "bg-teal-500/20" : "hover:bg-zinc-800/30"}`}
    >
      <div className="flex flex-col gap-1">
        {appointments.map(a => (
          <DraggableAppt
            key={a.id}
            appt={a}
            label={a.service_type || a.phone_number || `Job #${a.id}`}
            onConvertToQuote={onConvertToQuote}
            converting={convertingId === a.id}
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
  customer_id: number | null
  customer_name: string
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
    customer_id: null,
    customer_name: "",
    address: "",
    phone_number: "",
    service_type: "Window Cleaning",
    price: "",
    notes: "",
  }
}

export default function AppointmentsPage() {
  const { portalToken } = useAuth()
  const [weekStart, setWeekStart] = useState<string>(() => mondayOf(new Date()))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [salesmen, setSalesmen] = useState<Salesman[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [form, setForm] = useState<CreateFormState>(() => defaultCreateForm(mondayOf(new Date())))
  const [convertingApptId, setConvertingApptId] = useState<number | null>(null)
  const [quoteSheetId, setQuoteSheetId] = useState<string | null>(null)
  const { start: startNewQuote } = useStartNewQuote(portalToken)

  const handleConvertToQuote = useCallback(async (appt: Appointment) => {
    setError(null)
    setConvertingApptId(appt.id)
    try {
      const id = await startNewQuote({
        appointment_job_id: appt.id,
        customer_id: appt.customer_id ?? undefined,
      })
      if (!id) {
        setError("Could not create quote draft for this appointment.")
        return
      }
      setQuoteSheetId(id)
    } finally {
      setConvertingApptId(null)
    }
  }, [startNewQuote])

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
          customer_id: form.customer_id || undefined,
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
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-teal-400" />
            Sales Appointments
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Drag appointments onto a salesman / time slot to assign.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            ← Prev week
          </button>
          <span className="px-3 py-1.5 text-xs font-medium text-zinc-400 rounded-md bg-zinc-900 border border-zinc-800">
            Week of {labelDate(weekStart)}
          </span>
          <button
            className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            Next week →
          </button>
          <button
            className="ml-2 flex items-center gap-1.5 rounded-md bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-600 transition-colors"
            onClick={() => {
              setForm(defaultCreateForm(weekStart))
              setShowCreate(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New appointment
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-900/60 bg-red-950/40 p-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-zinc-800 bg-zinc-900 p-2 text-left font-semibold text-zinc-300 uppercase tracking-wider text-[10px]">
                    Salesman / Date
                  </th>
                  {days.map(d =>
                    slots.map(s => (
                      <th
                        key={`${d}-${s}`}
                        className="border border-zinc-800 bg-zinc-900 p-1 text-center font-normal"
                      >
                        <div className="font-semibold text-zinc-200">{labelDate(d)}</div>
                        <div className="text-zinc-500">{s}</div>
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {salesmen.length === 0 ? (
                  <tr>
                    <td colSpan={1 + days.length * slots.length} className="p-8 text-center text-sm text-zinc-500">
                      No salesmen found. Seed cleaners with <code className="px-1.5 py-0.5 bg-zinc-900 rounded text-teal-300">employee_type=&apos;salesman&apos;</code> to populate rows.
                    </td>
                  </tr>
                ) : (
                  salesmen.map(sm => (
                    <tr key={sm.id}>
                      <th className="sticky left-0 z-10 border border-zinc-800 bg-zinc-950 p-2 text-left font-medium text-zinc-200">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-md bg-teal-500/15 flex items-center justify-center text-xs font-semibold text-teal-300 shrink-0">
                            {sm.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{sm.name}</span>
                        </div>
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
                              onConvertToQuote={handleConvertToQuote}
                              convertingId={convertingApptId}
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
            <h2 className="mb-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Unassigned ({unassigned.length})
            </h2>
            <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-3 min-h-[72px]">
              {unassigned.length === 0 ? (
                <span className="text-xs text-zinc-600 italic self-center">
                  Drop appointments back here to unassign.
                </span>
              ) : (
                unassigned.map(a => (
                  <DraggableAppt
                    key={a.id}
                    appt={a}
                    label={a.service_type || a.phone_number || `Job #${a.id}`}
                    onConvertToQuote={handleConvertToQuote}
                    converting={convertingApptId === a.id}
                  />
                ))
              )}
            </div>
          </div>
        </DndContext>
      )}

      <CustomerPickerModal
        open={showCustomerPicker}
        onClose={() => setShowCustomerPicker(false)}
        onSelect={(c: PickerCustomer) => {
          setForm(f => ({
            ...f,
            customer_id: c.id,
            customer_name: customerDisplayName(c),
            phone_number: c.phone_number ?? f.phone_number,
            address: c.address ?? f.address,
          }))
        }}
        initialQuery={form.customer_name}
      />

      <Sheet open={showCreate} onOpenChange={(next) => { if (!next) setShowCreate(false) }}>
        <SheetContent
          side="right"
          data-testid="appointment-create-sheet"
          className="w-full sm:max-w-md overflow-y-auto bg-white p-0 border-l"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>New Appointment</SheetTitle>
            <SheetDescription>Schedule a new sales appointment</SheetDescription>
          </SheetHeader>
          <form onSubmit={submitCreate} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">New Appointment</h2>
              <button type="button" onClick={() => setShowCreate(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-gray-600">Client</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setShowCustomerPicker(true)}
                      className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
                    >
                      <User className="h-3 w-3" /> Select
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCustomerPicker(true)}
                      className="flex items-center gap-1 rounded border bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                    >
                      <UserPlus className="h-3 w-3" /> Add
                    </button>
                    {form.customer_id && (
                      <button
                        type="button"
                        onClick={() => setShowCustomerPicker(true)}
                        className="rounded border px-2 py-0.5 text-xs"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                {form.customer_id ? (
                  <div className="rounded border bg-gray-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{form.customer_name}</div>
                        <div className="text-xs text-gray-600">
                          {form.phone_number || "—"}
                        </div>
                        {form.address && (
                          <div className="text-xs text-gray-600">{form.address}</div>
                        )}
                      </div>
                      {form.address && mapsDirectionsUrl(form.address) && (
                        <a
                          href={mapsDirectionsUrl(form.address) as string}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 rounded border bg-white px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                        >
                          <MapPin className="h-3 w-3" /> Click for directions
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded border border-dashed p-2 text-center text-xs text-gray-500">
                    No client selected
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="block text-gray-600">Date</span>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1"
                  />
                </label>
                <label>
                  <span className="block text-gray-600">Start time</span>
                  <input
                    type="time"
                    required
                    value={form.scheduled_at}
                    onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))}
                    className="mt-1 w-full rounded border px-2 py-1"
                  />
                </label>
                <label>
                  <span className="block text-gray-600">Duration (min, sets end time)</span>
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
                <label>
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
        </SheetContent>
      </Sheet>

      <QuoteBuilderSheet
        quoteId={quoteSheetId}
        open={quoteSheetId !== null}
        onClose={() => setQuoteSheetId(null)}
        onSaved={load}
      />
    </div>
  )
}
