"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
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
  cleaner_assignments?: any[]
  teams?: any
  frequency?: string
  parent_job_id?: number | null
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
  cleanerId: string
  team: string
  service: string
  notes: string
  hours: number
  cardOnFile: boolean
  frequency: string
  parentJobId: string | null
  jobType: string
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

type AddonOption = {
  addon_key: string
  label: string
  flat_price: number | null
  minutes: number
}

type AssignmentMode = "auto_broadcast" | "unassigned" | "specific"

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
  bedrooms: string
  bathrooms: string
  sqft: string
  frequency: string
  cleaner_id: string
  assignment_mode: AssignmentMode
  is_quote: boolean
  selected_addons: string[]
  membership_id: string
}

type CustomerMembership = {
  id: string
  status: string
  visits_completed: number
  service_plans: {
    name: string
    visits_per_year: number
    discount_per_visit: number
  }
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

function humanizeServiceType(value: string | undefined): string {
  if (!value) return ""
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

function resolveServiceLabel(job: CalendarJob): string {
  return humanizeServiceType(job.service_type) || ""
}

function resolveTeamName(job: CalendarJob): string {
  const team = job.teams
  if (!team) return ""
  if (Array.isArray(team)) return team[0]?.name || ""
  return team.name || ""
}

function resolveNotes(job: CalendarJob): string {
  const notes = job.notes
  if (!notes) return ""
  // Strip internal tags and format for display
  const lines = notes.split('\n').map(l => l.trim()).filter(Boolean)
  const cleaned: string[] = []
  for (const line of lines) {
    const lower = line.toLowerCase()
    // Skip internal override tags, payment notes, emails
    if (lower.startsWith('override:')) continue
    if (lower.startsWith('hours:') || lower.startsWith('pay:') || lower.startsWith('payment:')) continue
    if (lower.includes('invoice_url') || lower.includes('@')) continue
    // Format frequency nicely
    if (lower.startsWith('frequency:')) {
      const freq = line.split(':')[1]?.trim().replace(/_/g, ' ')
      if (freq) cleaned.push(`Frequency: ${freq.charAt(0).toUpperCase() + freq.slice(1)}`)
      continue
    }
    // Filter out all-caps system notes
    if (/^[A-Z0-9_|\s]+$/.test(line.trim())) continue
    cleaned.push(line)
  }
  return cleaned.join(' | ')
}

function resolveCleanerFromAssignments(job: CalendarJob): { id: string; name: string } | null {
  const assignments = job.cleaner_assignments
  if (!Array.isArray(assignments) || assignments.length === 0) return null
  const confirmed = assignments.find((a: any) => a.status === "confirmed") || assignments[0]
  if (!confirmed) return null
  const c = Array.isArray(confirmed.cleaners) ? confirmed.cleaners[0] : confirmed.cleaners
  if (!c) return null
  return { id: String(c.id), name: c.name || "Unknown" }
}

function resolveCleanerName(job: CalendarJob) {
  const cleaner = job.cleaners
  if (cleaner) {
    if (Array.isArray(cleaner)) return cleaner[0]?.name || null
    return cleaner.name || null
  }
  return resolveCleanerFromAssignments(job)?.name || null
}

function resolveCleanerId(job: CalendarJob): string {
  const cleaner = job.cleaners
  if (cleaner) {
    const c = Array.isArray(cleaner) ? cleaner[0] : cleaner
    return c?.id ? String(c.id) : ""
  }
  return resolveCleanerFromAssignments(job)?.id || ""
}

function resolveStart(job: CalendarJob) {
  // date column is the actual date (YYYY-MM-DD), scheduled_at is a time string
  const dateStr = job.date || job.scheduled_date
  if (!dateStr) return new Date()

  const rawDate = String(dateStr)

  // If it's already a full ISO timestamp, use it directly
  if (rawDate.includes("T")) return new Date(rawDate)

  // Use scheduled_at as the time component (e.g. "09:00 AM PST", "14:30", "4:00 PM", etc.)
  const timeStr = String(job.scheduled_at || job.scheduled_time || "")

  // Handle 12-hour format: "4:00 PM", "10:30 AM", "4:00 PM PST"
  const twelveHrMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (twelveHrMatch) {
    let hours = parseInt(twelveHrMatch[1], 10)
    const minutes = twelveHrMatch[2]
    const meridiem = twelveHrMatch[3].toUpperCase()
    if (meridiem === "PM" && hours !== 12) hours += 12
    if (meridiem === "AM" && hours === 12) hours = 0
    return new Date(`${rawDate}T${String(hours).padStart(2, "0")}:${minutes}:00`)
  }

  // Handle 24-hour format: "14:00", "09:00"
  const twentyFourHrMatch = timeStr.match(/^(\d{1,2}):(\d{2})/)
  if (twentyFourHrMatch) {
    const hh = String(parseInt(twentyFourHrMatch[1], 10)).padStart(2, "0")
    return new Date(`${rawDate}T${hh}:${twentyFourHrMatch[2]}:00`)
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
  if (normalized === "quoted") return "event-quoted"
  return "event-scheduled"
}

const STORAGE_KEY_VIEW = "calendar-view"
const STORAGE_KEY_DATE = "calendar-date"

function getSavedView(): string {
  if (typeof window === "undefined") return "dayGridMonth"
  const saved = localStorage.getItem(STORAGE_KEY_VIEW)
  if (saved) return saved
  // Default to list view on mobile for better readability
  return window.innerWidth < 768 ? "listMonth" : "dayGridMonth"
}

function getSavedDate(): string | undefined {
  if (typeof window === "undefined") return undefined
  return localStorage.getItem(STORAGE_KEY_DATE) || undefined
}

export default function JobsPage() {
  const { user } = useAuth()
  const isHouseCleaning = user?.tenantSlug !== "winbros"
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
    bedrooms: "",
    bathrooms: "",
    sqft: "",
    frequency: "one-time",
    cleaner_id: "",
    assignment_mode: "auto_broadcast" as AssignmentMode,
    is_quote: false,
    selected_addons: [],
    membership_id: "",
  })
  const [createSaving, setCreateSaving] = useState(false)
  const [createError, setCreateError] = useState("")
  const [addonsList, setAddonsList] = useState<AddonOption[]>([])
  const [lookedUpCustomerId, setLookedUpCustomerId] = useState<string | null>(null)
  const [customerMemberships, setCustomerMemberships] = useState<CustomerMembership[]>([])
  // Add charge state (card-on-file tenants)
  const [addChargeOpen, setAddChargeOpen] = useState(false)
  const [addChargeType, setAddChargeType] = useState("")
  const [addChargeAmount, setAddChargeAmount] = useState("")
  const [addChargeDesc, setAddChargeDesc] = useState("")
  const [addChargeSaving, setAddChargeSaving] = useState(false)
  const [basePrice, setBasePrice] = useState<number>(0)
  const [addressSuggestions, setAddressSuggestions] = useState<{ description: string; place_id: string }[]>([])
  const [showAddressSuggestions, setShowAddressSuggestions] = useState(false)
  const [phoneLookedUp, setPhoneLookedUp] = useState("")

  // Auto-populate price when property details change (house cleaning only)
  useEffect(() => {
    if (!isHouseCleaning) return
    const { bedrooms, bathrooms, sqft, service_type } = createForm
    if (!bedrooms || !bathrooms) return

    const params = new URLSearchParams({
      bedrooms,
      bathrooms,
      service_type,
      ...(sqft ? { sqft } : {}),
    })

    let cancelled = false
    fetch(`/api/pricing/estimate?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data?.price != null) {
          const base = Number(res.data.price)
          setBasePrice(base)
          // Add addon prices
          const addonTotal = createForm.selected_addons.reduce((sum, key) => {
            const addon = addonsList.find((a) => a.addon_key === key)
            return sum + (addon?.flat_price || 0)
          }, 0)
          setCreateForm((prev) => ({ ...prev, price: String(base + addonTotal) }))
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [createForm.bedrooms, createForm.bathrooms, createForm.sqft, createForm.service_type])

  // Recalculate price when add-ons change
  useEffect(() => {
    if (!isHouseCleaning || !basePrice) return
    const addonTotal = createForm.selected_addons.reduce((sum, key) => {
      const addon = addonsList.find((a) => a.addon_key === key)
      return sum + (addon?.flat_price || 0)
    }, 0)
    setCreateForm((prev) => ({ ...prev, price: String(basePrice + addonTotal) }))
  }, [createForm.selected_addons])

  // Fetch add-ons when create modal or add-charge form opens
  useEffect(() => {
    if ((!createOpen && !addChargeOpen) || !isHouseCleaning) return
    if (addonsList.length > 0) return // already fetched
    fetch("/api/pricing/addons")
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setAddonsList(res.data)
        }
      })
      .catch(() => {})
  }, [createOpen, addChargeOpen])

  // Auto-populate from phone number (debounced)
  useEffect(() => {
    if (!createOpen) return
    const digits = createForm.customer_phone.replace(/\D/g, "")
    if (digits.length < 10 || digits === phoneLookedUp) return

    const timer = setTimeout(() => {
      fetch(`/api/customers/lookup?phone=${encodeURIComponent(digits)}`)
        .then((r) => r.json())
        .then((res) => {
          if (!res.success || !res.data?.length) {
            setLookedUpCustomerId(null)
            setCustomerMemberships([])
            return
          }
          const c = res.data[0]
          setPhoneLookedUp(digits)
          setLookedUpCustomerId(c.id || null)
          setCreateForm((prev) => ({
            ...prev,
            customer_name: prev.customer_name || [c.first_name, c.last_name].filter(Boolean).join(" "),
            email: prev.email || c.email || "",
            address: prev.address || c.address || "",
            bedrooms: prev.bedrooms || (c.bedrooms ? String(c.bedrooms) : ""),
            bathrooms: prev.bathrooms || (c.bathrooms ? String(c.bathrooms) : ""),
            sqft: prev.sqft || (c.sqft ? String(c.sqft) : ""),
            membership_id: "",
          }))
          // Fetch active memberships for this customer (WinBros only)
          if (c.id && !isHouseCleaning) {
            fetch(`/api/actions/memberships?customer_id=${c.id}&status=active`)
              .then((r) => r.json())
              .then((mRes) => {
                if (mRes.data) setCustomerMemberships(mRes.data)
                else setCustomerMemberships([])
              })
              .catch(() => setCustomerMemberships([]))
          }
        })
        .catch(() => {})
    }, 500)

    return () => clearTimeout(timer)
  }, [createForm.customer_phone, createOpen])

  // Address suggestions via Google Places Autocomplete (debounced)
  useEffect(() => {
    if (!createOpen || !createForm.address || createForm.address.length < 3) {
      setAddressSuggestions([])
      return
    }

    const timer = setTimeout(() => {
      fetch(`/api/places/autocomplete?input=${encodeURIComponent(createForm.address)}`)
        .then((r) => r.json())
        .then((res) => {
          if (res.success && Array.isArray(res.data)) {
            setAddressSuggestions(res.data)
          }
        })
        .catch(() => {})
    }, 300)

    return () => clearTimeout(timer)
  }, [createForm.address, createOpen])

  // Drag-and-drop / edit state
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ date: "", time: "", cleanerId: "" })
  const [saving, setSaving] = useState(false)
  const [autoScheduling, setAutoScheduling] = useState(false)
  const [autoScheduleResult, setAutoScheduleResult] = useState<string | null>(null)
  const [cleanersList, setCleanersList] = useState<{ id: string; name: string }[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteMode, setDeleteMode] = useState<"single" | "future" | null>(null)

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
      const description = resolveServiceLabel(job)
      const cleanerName = resolveCleanerName(job)
      const cleanerId = resolveCleanerId(job)
      const teamName = resolveTeamName(job)
      const jobNotes = resolveNotes(job)
      const customerName = resolveCustomerName(job)
      const customer = resolveCustomer(job)
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
          cleanerId: cleanerId || "",
          teamName: teamName || "",
          service: description || "",
          notes: jobNotes || "",
          price: job.price || job.estimated_value || 0,
          status: job.status || "scheduled",
          jobId: String(job.id),
          hours: job.hours ? Number(job.hours) : 2,
          cardOnFile: !!customer?.card_on_file_at,
          frequency: job.frequency || "one-time",
          parentJobId: job.parent_job_id ? String(job.parent_job_id) : null,
          jobType: (job as any).job_type || "",
          isCommercial: !!customer?.is_commercial,
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
      bedrooms: "",
      bathrooms: "",
      sqft: "",
      frequency: "one-time",
      cleaner_id: "",
      assignment_mode: "auto_broadcast",
      is_quote: false,
      selected_addons: [],
      membership_id: "",
    })
    setCreateError("")
    setPhoneLookedUp("")
    setBasePrice(0)
    setAddressSuggestions([])
    setLookedUpCustomerId(null)
    setCustomerMemberships([])
    setCreateOpen(true)

    // Fetch cleaners list if not already loaded
    if (cleanersList.length === 0) {
      fetch("/api/teams")
        .then((r) => r.json())
        .then((data) => {
          const all: { id: string; name: string }[] = []
          for (const team of data.data || []) {
            for (const member of team.members || []) {
              all.push({ id: String(member.id), name: member.name })
            }
          }
          for (const c of data.unassigned_cleaners || []) {
            all.push({ id: String(c.id), name: c.name })
          }
          setCleanersList(all)
        })
        .catch(() => {})
    }
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
      cleanerId: info.event.extendedProps.cleanerId || "",
      team: info.event.extendedProps.teamName || "",
      service: info.event.extendedProps.service || "",
      notes: info.event.extendedProps.notes || "",
      hours: info.event.extendedProps.hours || 2,
      cardOnFile: !!info.event.extendedProps.cardOnFile,
      frequency: info.event.extendedProps.frequency || "one-time",
      parentJobId: info.event.extendedProps.parentJobId || null,
      jobType: info.event.extendedProps.jobType || "",
    }
    setSelectedEvent(details)
    setEditMode(false)
    setConfirmDelete(false)
    setAutoScheduleResult(null)
    setAddChargeOpen(false)
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

  const handleStartEdit = async () => {
    if (!selectedEvent?.start) return
    const d = selectedEvent.start
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    setEditForm({ date, time, cleanerId: selectedEvent.cleanerId || "" })
    setEditMode(true)

    // Fetch cleaners list if not already loaded
    if (cleanersList.length === 0) {
      try {
        const res = await fetch("/api/teams")
        const data = await res.json()
        const all: { id: string; name: string }[] = []
        for (const team of data.data || []) {
          for (const member of team.members || []) {
            all.push({ id: String(member.id), name: member.name })
          }
        }
        for (const c of data.unassigned_cleaners || []) {
          all.push({ id: String(c.id), name: c.name })
        }
        setCleanersList(all)
      } catch { /* ignore, dropdown will just be empty */ }
    }
  }

  const handleAutoSchedule = async () => {
    if (!selectedEvent) return
    setAutoScheduling(true)
    setAutoScheduleResult(null)
    try {
      const res = await fetch('/api/actions/auto-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: selectedEvent.jobId }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setAutoScheduleResult(`Scheduled: ${data.display}${data.team_name ? ` (${data.team_name})` : ''}`)
        await refreshJobs()
      } else {
        setAutoScheduleResult(`Error: ${data.error || 'Failed to auto-schedule'}`)
      }
    } catch {
      setAutoScheduleResult('Error: Network request failed')
    } finally {
      setAutoScheduling(false)
    }
  }

  const handleAddCharge = async () => {
    if (!selectedEvent || !addChargeType) return
    setAddChargeSaving(true)
    try {
      const body: Record<string, unknown> = { job_id: selectedEvent.jobId, addon_type: addChargeType }
      if (addChargeType === "custom" && addChargeAmount) {
        body.amount = parseFloat(addChargeAmount)
        body.description = addChargeDesc || "Custom charge"
        body.addon_type = addChargeDesc || "custom_charge"
      }
      const res = await fetch("/api/actions/add-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        // Update the selected event price in UI
        setSelectedEvent(prev => prev ? { ...prev, price: data.new_total } : prev)
        setAddChargeOpen(false)
        setAddChargeType("")
        setAddChargeAmount("")
        setAddChargeDesc("")
      } else {
        alert(data.error || "Failed to add charge")
      }
    } catch {
      alert("Failed to add charge")
    } finally {
      setAddChargeSaving(false)
    }
  }

  const handleDeleteJob = async (mode: "single" | "future") => {
    if (!selectedEvent) return
    setDeleteMode(mode)
    setSaving(true)
    try {
      if (mode === "future") {
        // Server-side handles finding all related jobs (children + orphaned siblings by customer_id)
        const res = await fetch("/api/actions/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete-future", job_id: Number(selectedEvent.jobId) }),
        })
        const data = await res.json()
        if (!res.ok) {
          console.error("Delete future failed:", data.error)
          return
        }
      } else {
        const res = await fetch(`/api/jobs?id=${selectedEvent.jobId}`, { method: "DELETE" })
        const data = await res.json()
        if (!data.success) return
      }

      setSelectedEvent(null)
      setEditMode(false)
      setConfirmDelete(false)
      setDeleteMode(null)
      await refreshJobs()
    } finally {
      setSaving(false)
    }
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
    const date = editForm.date
    const scheduled_at = editForm.time
    const body: Record<string, any> = { id: jobId, date, scheduled_at }

    // Include cleaner_id if it changed
    if (editForm.cleanerId !== selectedEvent.cleanerId) {
      body.cleaner_id = editForm.cleanerId || null
    }

    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setSelectedEvent(null)
        setEditMode(false)
        await refreshJobs()
      }
    } finally {
      setSaving(false)
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
    if (isHouseCleaning) {
      if (!createForm.bedrooms) {
        setCreateError("Number of bedrooms is required")
        return
      }
      if (!createForm.bathrooms) {
        setCreateError("Number of bathrooms is required")
        return
      }
      if (!createForm.sqft) {
        setCreateError("Square footage is required")
        return
      }
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
          bedrooms: createForm.bedrooms ? Number(createForm.bedrooms) : undefined,
          bathrooms: createForm.bathrooms ? Number(createForm.bathrooms) : undefined,
          sqft: createForm.sqft ? Number(createForm.sqft) : undefined,
          frequency: createForm.frequency !== "one-time" ? createForm.frequency : undefined,
          membership_id: createForm.membership_id || undefined,
          cleaner_id: createForm.assignment_mode === "specific" ? createForm.cleaner_id : undefined,
          assignment_mode: createForm.assignment_mode,
          status: createForm.is_quote ? "quoted" : "scheduled",
          addons: createForm.selected_addons.length > 0 ? createForm.selected_addons.map((key) => {
            const addon = addonsList.find((a) => a.addon_key === key)
            return { key, label: addon?.label || key, price: addon?.flat_price || 0 }
          }) : undefined,
        }),
      })

      const data = await res.json()
      if (!data.success) {
        setCreateError(data.error || "Failed to create job")
        return
      }

      setCreateOpen(false)
      setPhoneLookedUp("")
      setLookedUpCustomerId(null)
      setCustomerMemberships([])
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
              height="100%"
              headerToolbar={
                typeof window !== "undefined" && window.innerWidth < 768
                  ? { left: "prev,next", center: "title", right: "listMonth,dayGridMonth" }
                  : { left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,listMonth" }
              }
              events={baseEvents}
              editable
              selectable
              nowIndicator
              dayMaxEvents={false}
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
                const titleEl = info.el.querySelector(".fc-event-title, .fc-list-event-title")
                if (titleEl) {
                  if (isHouseCleaning) {
                    // Commercial/Residential badge — house cleaning tenants only
                    const typeBadge = document.createElement("span")
                    typeBadge.textContent = info.event.extendedProps.isCommercial ? " \uD83C\uDFE2" : " \uD83C\uDFE0"
                    typeBadge.title = info.event.extendedProps.isCommercial ? "Commercial" : "Residential"
                    typeBadge.style.cssText = "font-size:0.75em;"
                    titleEl.appendChild(typeBadge)
                  }

                  // Recurring badge
                  const freq = info.event.extendedProps.frequency || "one-time"
                  if (freq !== "one-time") {
                    const recurBadge = document.createElement("span")
                    recurBadge.textContent = " \u21BB"
                    recurBadge.title = `Recurring: ${freq}`
                    recurBadge.style.cssText = "font-size:0.7em;opacity:0.7;"
                    titleEl.appendChild(recurBadge)
                  }
                }
                const service = info.event.extendedProps.service || ""
                const loc = info.event.extendedProps.location || ""
                const tip = [service, loc].filter(Boolean).join(" \u2022 ")
                if (tip) {
                  info.el.setAttribute("title", tip)
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* Mobile FAB — Create Job */}
      <button
        className="md:hidden"
        onClick={() => {
          const now = new Date()
          const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
          setCreateForm({
            customer_phone: "",
            customer_name: "",
            email: "",
            address: "",
            service_type: "Standard cleaning",
            date,
            time: "09:00",
            duration_minutes: "120",
            price: "",
            notes: "",
            bedrooms: "",
            bathrooms: "",
            sqft: "",
            frequency: "one-time",
            cleaner_id: "",
            assignment_mode: "auto_broadcast",
            is_quote: false,
            selected_addons: [],
            membership_id: "",
          })
          setCreateError("")
          setPhoneLookedUp("")
          setBasePrice(0)
          setAddressSuggestions([])
          setLookedUpCustomerId(null)
          setCustomerMemberships([])
          setCreateOpen(true)
          if (cleanersList.length === 0) {
            fetch("/api/teams")
              .then((r) => r.json())
              .then((data) => {
                if (data.cleaners) setCleanersList(data.cleaners.map((c: any) => ({ id: c.id, name: c.name })))
              })
              .catch(() => {})
          }
        }}
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          zIndex: 50,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
          border: "none",
          boxShadow: "0 4px 16px rgba(124, 58, 237, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "#fff",
          fontSize: "1.75rem",
          fontWeight: 300,
          lineHeight: 1,
        }}
        aria-label="Create Job"
      >
        +
      </button>

      {/* Event Details Modal */}
      <div
        className={`cal-modal-backdrop${selectedEvent ? " open" : ""}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) { setSelectedEvent(null); setConfirmDelete(false); setDeleteMode(null) }
        }}
      >
        <div className="cal-modal">
          <div className="cal-modal-header">
            <h5>{selectedEvent?.title || "Event"}</h5>
            <button
              className="cal-modal-close"
              onClick={() => { setSelectedEvent(null); setConfirmDelete(false); setDeleteMode(null) }}
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
                <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}>
                  <strong>Customer:</strong> {selectedEvent?.client || emptyValue}
                  {selectedEvent?.cardOnFile && (
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      background: "rgba(16, 185, 129, 0.12)",
                      color: "#34d399",
                      border: "1px solid rgba(16, 185, 129, 0.2)",
                    }}>Card on file</span>
                  )}
                </div>
                {selectedEvent?.service && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Service:</strong> {selectedEvent.service}
                  </div>
                )}
                {selectedEvent?.frequency && selectedEvent.frequency !== "one-time" && (
                  <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontSize: "0.65rem",
                      fontWeight: 600,
                      background: "rgba(139, 92, 246, 0.12)",
                      color: "#a78bfa",
                      border: "1px solid rgba(139, 92, 246, 0.2)",
                    }}>
                      &#8635; {selectedEvent.frequency.replace("-", "-")}
                    </span>
                    {selectedEvent.parentJobId && (
                      <span style={{ fontSize: "0.65rem", color: "#71717a" }}>
                        (instance of series #{selectedEvent.parentJobId})
                      </span>
                    )}
                  </div>
                )}
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong>Cleaner:</strong> {selectedEvent?.cleaner || "Unassigned"}
                </div>
                {selectedEvent?.team && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>Team:</strong> {selectedEvent.team}
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
                {selectedEvent?.notes && (
                  <div>
                    <strong>Notes:</strong> {selectedEvent.notes}
                  </div>
                )}
                {/* Auto-schedule button for unscheduled cleaning jobs */}
                {selectedEvent?.jobType === 'cleaning' && !selectedEvent?.start && (selectedEvent?.status === 'pending' || selectedEvent?.status === 'scheduled') && (
                  <div style={{ marginTop: "1rem", padding: "0.75rem", borderRadius: 8, background: "rgba(59, 130, 246, 0.08)", border: "1px solid rgba(59, 130, 246, 0.2)" }}>
                    <div style={{ fontSize: "0.8rem", color: "#93c5fd", marginBottom: "0.5rem" }}>
                      This cleaning job has no date set.
                    </div>
                    <button
                      onClick={handleAutoSchedule}
                      disabled={autoScheduling}
                      style={{
                        width: "100%",
                        padding: "0.5rem 1rem",
                        borderRadius: 6,
                        border: "none",
                        background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        cursor: autoScheduling ? "not-allowed" : "pointer",
                        opacity: autoScheduling ? 0.7 : 1,
                      }}
                    >
                      {autoScheduling ? "Finding best slot..." : "Auto-schedule soonest"}
                    </button>
                    {autoScheduleResult && (
                      <div style={{
                        marginTop: "0.5rem",
                        fontSize: "0.8rem",
                        color: autoScheduleResult.startsWith('Error') ? "#f87171" : "#34d399",
                      }}>
                        {autoScheduleResult}
                      </div>
                    )}
                  </div>
                )}
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
                <div style={{ marginBottom: "0.75rem" }}>
                  <label className="cal-form-label">Start Time</label>
                  <input
                    type="time"
                    className="cal-form-control"
                    value={editForm.time}
                    onChange={(e) => setEditForm((f) => ({ ...f, time: e.target.value }))}
                  />
                </div>
                <div style={{ marginBottom: "0.5rem" }}>
                  <label className="cal-form-label">Assigned Cleaner</label>
                  <select
                    className="cal-form-control"
                    value={editForm.cleanerId}
                    onChange={(e) => setEditForm((f) => ({ ...f, cleanerId: e.target.value }))}
                  >
                    <option value="">— Unassigned —</option>
                    {cleanersList.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#71717a" }}>
                  Duration: {selectedEvent?.hours || 2} hours
                </div>
              </>
            )}
          </div>
          <div className="cal-modal-footer">
            {confirmDelete ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
                {selectedEvent && (selectedEvent.frequency !== "one-time" || selectedEvent.parentJobId) ? (
                  <>
                    <span style={{ fontSize: "0.85rem", color: "#ef4444" }}>This is a recurring job. What do you want to delete?</span>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="cal-modal-btn"
                        onClick={() => { setConfirmDelete(false); setDeleteMode(null) }}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button
                        className="cal-modal-btn"
                        onClick={() => handleDeleteJob("single")}
                        disabled={saving}
                        style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      >
                        {saving && deleteMode === "single" ? <><span className="saving-spinner" /> Deleting...</> : "Just this one"}
                      </button>
                      <button
                        className="cal-modal-btn"
                        onClick={() => { setDeleteMode("future"); handleDeleteJob("future") }}
                        disabled={saving}
                        style={{ color: "#fff", backgroundColor: "#ef4444", borderColor: "#ef4444" }}
                      >
                        {saving && deleteMode === "future" ? <><span className="saving-spinner" /> Deleting all...</> : "This & all future"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.85rem", color: "#ef4444" }}>Delete this job?</span>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="cal-modal-btn"
                        onClick={() => setConfirmDelete(false)}
                        disabled={saving}
                      >
                        Cancel
                      </button>
                      <button
                        className="cal-modal-btn"
                        onClick={() => handleDeleteJob("single")}
                        disabled={saving}
                        style={{ color: "#ef4444", borderColor: "#ef4444" }}
                      >
                        {saving ? <><span className="saving-spinner" /> Deleting...</> : "Yes, delete"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : addChargeOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%" }}>
                <span style={{ fontSize: "0.85rem", fontWeight: 500 }}>Add Charge</span>
                {/* Preset add-ons from pricing table */}
                {addonsList.filter(a => a.flat_price && a.flat_price > 0).length > 0 && (
                  <select
                    value={addChargeType === "custom" ? "" : addChargeType}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v) {
                        setAddChargeType(v)
                        setAddChargeAmount("")
                        setAddChargeDesc("")
                      }
                    }}
                    style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid #3f3f46", background: "#18181b", color: "#e4e4e7", fontSize: "0.85rem" }}
                  >
                    <option value="">Quick add-on...</option>
                    {addonsList.filter(a => a.flat_price && a.flat_price > 0).map(a => (
                      <option key={a.addon_key} value={a.addon_key}>{a.label} (${a.flat_price})</option>
                    ))}
                  </select>
                )}
                {/* Divider */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "#71717a" }}>
                  <div style={{ flex: 1, height: 1, background: "#3f3f46" }} />
                  or custom amount
                  <div style={{ flex: 1, height: 1, background: "#3f3f46" }} />
                </div>
                {/* Custom amount — always visible */}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <div style={{ position: "relative", width: 100 }}>
                    <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#71717a", fontSize: "0.85rem", pointerEvents: "none" }}>$</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={addChargeAmount}
                      onChange={(e) => { setAddChargeAmount(e.target.value); if (e.target.value) setAddChargeType("custom") }}
                      style={{ width: "100%", padding: "0.35rem 0.5rem 0.35rem 1.2rem", borderRadius: 6, border: "1px solid #3f3f46", background: "#18181b", color: "#e4e4e7", fontSize: "0.85rem" }}
                    />
                  </div>
                  <input
                    placeholder="Description (e.g. Extra deep clean)"
                    value={addChargeDesc}
                    onChange={(e) => { setAddChargeDesc(e.target.value); if (!addChargeType) setAddChargeType("custom") }}
                    style={{ flex: 1, padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid #3f3f46", background: "#18181b", color: "#e4e4e7", fontSize: "0.85rem" }}
                  />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button className="cal-modal-btn" onClick={() => setAddChargeOpen(false)} disabled={addChargeSaving}>Cancel</button>
                  <button
                    className="cal-modal-btn cal-modal-btn-primary"
                    onClick={handleAddCharge}
                    disabled={addChargeSaving || !addChargeType || (addChargeType === "custom" && !addChargeAmount)}
                  >
                    {addChargeSaving ? <><span className="saving-spinner" /> Adding...</> : "Add Charge"}
                  </button>
                </div>
              </div>
            ) : !editMode ? (
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <button
                  className="cal-modal-btn"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete job"
                  style={{ color: "#ef4444", borderColor: "#ef4444", padding: "0.4rem 0.65rem" }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                  </svg>
                </button>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {isHouseCleaning && selectedEvent?.status !== "completed" && (
                    <button
                      className="cal-modal-btn"
                      onClick={() => setAddChargeOpen(true)}
                      title="Add on-site charge"
                      style={{ fontSize: "0.8rem" }}
                    >
                      + Charge
                    </button>
                  )}
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
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                <button
                  className="cal-modal-btn"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete job"
                  style={{ color: "#ef4444", borderColor: "#ef4444", padding: "0.4rem 0.65rem" }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                  </svg>
                </button>
                <div style={{ display: "flex", gap: "0.5rem" }}>
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
                </div>
              </div>
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
                  value={["Standard cleaning","Deep cleaning","Move-in/move-out","Window cleaning","Pressure washing","Gutter cleaning","Walkthru"].includes(createForm.service_type) ? createForm.service_type : "__custom__"}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setCreateForm((prev) => ({ ...prev, service_type: "" }))
                    } else {
                      setCreateForm((prev) => ({ ...prev, service_type: e.target.value }))
                    }
                  }}
                  style={!["Standard cleaning","Deep cleaning","Move-in/move-out","Window cleaning","Pressure washing","Gutter cleaning","Walkthru","__custom__"].includes(createForm.service_type) ? { display: "none" } : undefined}
                >
                  {isHouseCleaning ? (
                    <>
                      <option value="Standard cleaning">Standard Cleaning</option>
                      <option value="Deep cleaning">Deep Cleaning</option>
                      <option value="Move-in/move-out">Move-in/Move-out</option>
                    </>
                  ) : (
                    <>
                      <option value="Window cleaning">Window Cleaning</option>
                      <option value="Pressure washing">Pressure Washing</option>
                      <option value="Gutter cleaning">Gutter Cleaning</option>
                      <option value="Walkthru">Walkthru</option>
                    </>
                  )}
                  <option value="__custom__">Other (type your own)</option>
                </select>
                {!["Standard cleaning","Deep cleaning","Move-in/move-out","Window cleaning","Pressure washing","Gutter cleaning","Walkthru"].includes(createForm.service_type) && (
                  <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                    <input
                      type="text"
                      className="cal-form-control"
                      placeholder="Type service name..."
                      autoFocus
                      value={createForm.service_type}
                      onChange={(e) =>
                        setCreateForm((prev) => ({ ...prev, service_type: e.target.value }))
                      }
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="cal-form-control"
                      style={{ width: "auto", padding: "0 0.5rem", cursor: "pointer", color: "#a1a1aa" }}
                      onClick={() => setCreateForm((prev) => ({ ...prev, service_type: isHouseCleaning ? "Standard cleaning" : "Window cleaning" }))}
                      title="Back to list"
                    >
                      &times;
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Address with autocomplete */}
            <div style={{ marginBottom: "0.5rem", position: "relative" }}>
              <label className="cal-form-label">Address</label>
              <input
                type="text"
                className="cal-form-control"
                placeholder="123 Main St, City, State"
                value={createForm.address}
                onChange={(e) => {
                  setCreateForm((prev) => ({ ...prev, address: e.target.value }))
                  setShowAddressSuggestions(true)
                }}
                onFocus={() => setShowAddressSuggestions(true)}
                onBlur={() => setTimeout(() => setShowAddressSuggestions(false), 200)}
              />
              {showAddressSuggestions && addressSuggestions.length > 0 && (
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: "#1e1e21",
                  border: "1px solid rgba(63, 63, 70, 0.6)",
                  borderRadius: 8,
                  marginTop: 2,
                  maxHeight: 200,
                  overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}>
                  {addressSuggestions.map((s) => (
                    <button
                      key={s.place_id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setCreateForm((prev) => ({ ...prev, address: s.description }))
                        setShowAddressSuggestions(false)
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "0.5rem 0.75rem",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid rgba(63, 63, 70, 0.3)",
                        color: "#e4e4e7",
                        fontSize: "0.8rem",
                        cursor: "pointer",
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "rgba(63, 63, 70, 0.3)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {s.description}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Property Details — house cleaning tenants only */}
            {isHouseCleaning && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <div>
                  <label className="cal-form-label">Bedrooms *</label>
                  <select
                    className="cal-form-control"
                    value={createForm.bedrooms}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, bedrooms: e.target.value }))
                    }
                  >
                    <option value="">Select</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6+</option>
                  </select>
                </div>
                <div>
                  <label className="cal-form-label">Bathrooms *</label>
                  <select
                    className="cal-form-control"
                    value={createForm.bathrooms}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, bathrooms: e.target.value }))
                    }
                  >
                    <option value="">Select</option>
                    <option value="1">1</option>
                    <option value="1.5">1.5</option>
                    <option value="2">2</option>
                    <option value="2.5">2.5</option>
                    <option value="3">3</option>
                    <option value="3.5">3.5</option>
                    <option value="4">4+</option>
                  </select>
                </div>
                <div>
                  <label className="cal-form-label">Sqft *</label>
                  <input
                    type="number"
                    className="cal-form-control"
                    placeholder="1500"
                    min="0"
                    value={createForm.sqft}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, sqft: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            {/* Frequency (house cleaning) or Membership (WinBros) & Cleaner (all tenants) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
              {isHouseCleaning && (
                <div>
                  <label className="cal-form-label">Frequency *</label>
                  <select
                    className="cal-form-control"
                    value={createForm.frequency}
                    onChange={(e) =>
                      setCreateForm((prev) => ({ ...prev, frequency: e.target.value }))
                    }
                  >
                    <option value="one-time">One-time</option>
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              )}
              {!isHouseCleaning && (
                <div>
                  <label className="cal-form-label">Membership</label>
                  <select
                    className="cal-form-control"
                    value={createForm.membership_id}
                    onChange={(e) => {
                      const memId = e.target.value
                      const mem = memId ? customerMemberships.find((m) => m.id === memId) : null
                      setCreateForm((prev) => {
                        const updated = { ...prev, membership_id: memId }
                        const currentBase = basePrice || Number(prev.price) || 0
                        if (mem?.service_plans?.discount_per_visit && currentBase > 0) {
                          updated.price = String(Math.max(0, currentBase - mem.service_plans.discount_per_visit))
                        } else if (!memId && currentBase > 0) {
                          // Deselected membership — restore base price
                          updated.price = String(currentBase)
                        }
                        return updated
                      })
                    }}
                  >
                    <option value="">No membership</option>
                    {customerMemberships.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.service_plans.name} — {m.visits_completed}/{m.service_plans.visits_per_year} visits
                        {m.service_plans.discount_per_visit ? ` (-$${m.service_plans.discount_per_visit})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="cal-form-label">Assignment</label>
                <select
                  className="cal-form-control"
                  value={createForm.assignment_mode === "specific" ? `cleaner:${createForm.cleaner_id}` : createForm.assignment_mode}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === "auto_broadcast") {
                      setCreateForm((prev) => ({ ...prev, assignment_mode: "auto_broadcast", cleaner_id: "" }))
                    } else if (val === "unassigned") {
                      setCreateForm((prev) => ({ ...prev, assignment_mode: "unassigned", cleaner_id: "" }))
                    } else if (val.startsWith("cleaner:")) {
                      setCreateForm((prev) => ({ ...prev, assignment_mode: "specific", cleaner_id: val.replace("cleaner:", "") }))
                    }
                  }}
                >
                  <option value="auto_broadcast">Auto Broadcast</option>
                  <option value="unassigned">Unassigned</option>
                  {cleanersList.length > 0 && (
                    <option disabled style={{ fontWeight: 600, color: "#71717a" }}>── Assign to ──</option>
                  )}
                  {cleanersList.map((c) => (
                    <option key={c.id} value={`cleaner:${c.id}`}>{c.name}</option>
                  ))}
                </select>
              </div>
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

            {/* Add-ons — house cleaning only */}
            {isHouseCleaning && addonsList.length > 0 && (
              <div style={{ marginBottom: "0.5rem" }}>
                <label className="cal-form-label">Add-ons</label>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.25rem",
                  background: "rgba(39, 39, 42, 0.3)",
                  borderRadius: 8,
                  border: "1px solid rgba(63, 63, 70, 0.4)",
                  padding: "0.5rem",
                  maxHeight: 160,
                  overflowY: "auto",
                }}>
                  {addonsList.map((addon) => (
                    <label
                      key={addon.addon_key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.35rem",
                        cursor: "pointer",
                        padding: "0.2rem 0.25rem",
                        borderRadius: 4,
                        fontSize: "0.8rem",
                        color: createForm.selected_addons.includes(addon.addon_key) ? "#e4e4e7" : "#a1a1aa",
                        background: createForm.selected_addons.includes(addon.addon_key) ? "rgba(139, 92, 246, 0.15)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={createForm.selected_addons.includes(addon.addon_key)}
                        onChange={(e) => {
                          setCreateForm((prev) => ({
                            ...prev,
                            selected_addons: e.target.checked
                              ? [...prev.selected_addons, addon.addon_key]
                              : prev.selected_addons.filter((k) => k !== addon.addon_key),
                          }))
                        }}
                        style={{ accentColor: "#8b5cf6" }}
                      />
                      <span style={{ flex: 1 }}>{addon.label}</span>
                      {addon.flat_price != null && addon.flat_price > 0 && (
                        <span style={{ color: "#71717a", fontSize: "0.7rem" }}>+${addon.flat_price}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Price + Quote toggle */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.5rem", alignItems: "end", marginBottom: "0.5rem" }}>
              <div>
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
              <button
                type="button"
                onClick={() => setCreateForm((prev) => ({ ...prev, is_quote: !prev.is_quote }))}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: 8,
                  border: `1px solid ${createForm.is_quote ? "rgba(6, 182, 212, 0.4)" : "rgba(63, 63, 70, 0.6)"}`,
                  background: createForm.is_quote ? "rgba(6, 182, 212, 0.15)" : "rgba(39, 39, 42, 0.5)",
                  color: createForm.is_quote ? "#22d3ee" : "#a1a1aa",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  height: "fit-content",
                }}
              >
                {createForm.is_quote ? "Quote" : "Scheduled"}
              </button>
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
              {createSaving ? <><span className="saving-spinner" /> Creating...</> : createForm.is_quote ? "Send Quote" : "Create Job"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
