'use client'

/**
 * Job Detail Drawer — Full job execution flow as a slide-over panel
 *
 * Opens from the Calendar page when a user clicks a job.
 * Two tabs: Visit/Job (execution flow) and Info (persistent client data).
 *
 * Matches Blake's wireframe:
 *  - Top: customer name, address (clickable), date, action buttons
 *  - Tab 1 (Visit/Job): line items, upsells, checklist, price book, crew on job, payment
 *  - Tab 2 (Info): notes, tags, client history, service plan
 */

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { VisitChecklist } from '@/components/winbros/visit-checklist'
import { ServicePlanSetup } from '@/components/winbros/service-plan-setup'
import CubeLoader from '@/components/ui/cube-loader'
import {
  MapPin, Navigation, Play, Square, CheckCircle2, Clock, Lock,
  Plus, CreditCard, Banknote, Receipt, ChevronDown, ChevronUp,
  FileText, History, Tag, Users, ScrollText, ExternalLink,
  DollarSign, X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ----------- Types -----------

type VisitStatus =
  | 'not_started' | 'on_my_way' | 'in_progress' | 'stopped'
  | 'completed' | 'checklist_done' | 'payment_collected' | 'closed'

type PaymentType = 'card' | 'cash' | 'check'

type ActiveTab = 'visit' | 'info'

interface LineItem {
  id: number
  service_name: string
  description: string | null
  price: number
  revenue_type: 'original_quote' | 'technician_upsell'
}

interface ChecklistItem {
  id: number
  item_text: string
  is_completed: boolean
  completed_at: string | null
}

interface VisitData {
  id: number
  status: VisitStatus
  visit_date: string
  started_at: string | null
  stopped_at: string | null
  completed_at: string | null
  closed_at: string | null
  checklist_completed: boolean
  payment_recorded: boolean
  payment_type: string | null
  payment_amount: number | null
  tip_amount: number | null
  technicians: number[]
}

interface JobData {
  id: number
  date: string
  scheduled_at: string | null
  scheduled_time: string | null
  address: string
  phone_number: string | null
  service_type: string
  status: string
  notes: string | null
  price: number
  hours: number | null
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  frequency: string | null
  parent_job_id: number | null
  membership_id: string | null
  lead_source: string | null
}

interface CustomerData {
  id: number | null
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  email: string | null
  address: string | null
  card_on_file: boolean
}

interface CrewMember {
  id: number
  name: string
  status: string
}

interface Membership {
  id: string
  status: string
  visits_completed: number
  next_visit_at: string | null
  service_plans: {
    id: string
    name: string
    slug: string
    visits_per_year: number
    interval_months: number
    discount_per_visit: number
  } | null
}

interface PastVisit {
  id: number
  visit_date: string
  status: string
  services: string[]
  total: number
}

interface PageData {
  job: JobData
  visit: VisitData
  checklist: ChecklistItem[]
  line_items: LineItem[]
  customer: CustomerData
  assigned_crew: CrewMember[]
  salesman: { id: number; name: string } | null
  membership: Membership | null
  visit_history: PastVisit[]
}

// ----------- Props -----------

interface JobDetailDrawerProps {
  jobId: string | null
  open: boolean
  onClose: () => void
  /** Called after a visit status transition so the calendar can refresh */
  onJobUpdated?: () => void
}

// ----------- Constants -----------

// Round 2 task 8: prices always editable. The in-drawer "Price book" used to
// be a hardcoded const; it now hydrates from tech_upsell_catalog so admins
// can rename/reprice under /tech-upsells and the drawer picks it up live.
interface PriceBookItem { name: string; price: number }
const PRICE_BOOK_FALLBACK: PriceBookItem[] = []

const STATUS_ORDER: VisitStatus[] = [
  'not_started', 'on_my_way', 'in_progress', 'stopped',
  'completed', 'checklist_done', 'payment_collected', 'closed',
]

// ----------- Helpers -----------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function getStatusIndex(status: VisitStatus): number {
  return STATUS_ORDER.indexOf(status)
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function statusBadgeColor(status: string): string {
  switch (status) {
    case 'not_started': return 'bg-zinc-700 text-zinc-300'
    case 'on_my_way': return 'bg-blue-900 text-blue-300'
    case 'in_progress': return 'bg-green-900 text-green-300'
    case 'stopped': return 'bg-orange-900 text-orange-300'
    case 'completed': return 'bg-emerald-900 text-emerald-300'
    case 'checklist_done': return 'bg-purple-900 text-purple-300'
    case 'payment_collected': return 'bg-indigo-900 text-indigo-300'
    case 'closed': return 'bg-red-900 text-red-300'
    case 'scheduled': return 'bg-blue-900 text-blue-300'
    case 'pending': return 'bg-yellow-900 text-yellow-300'
    default: return 'bg-zinc-700 text-zinc-300'
  }
}

// ----------- Component -----------

export function JobDetailDrawer({ jobId, open, onClose, onJobUpdated }: JobDetailDrawerProps) {
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('visit')

  // Upsell dialog
  const [upsellOpen, setUpsellOpen] = useState(false)
  const [upsellName, setUpsellName] = useState('')
  const [upsellPrice, setUpsellPrice] = useState('')
  const [upsellSubmitting, setUpsellSubmitting] = useState(false)

  // Payment state
  const [paymentMode, setPaymentMode] = useState(false)
  const [paymentType, setPaymentType] = useState<PaymentType>('card')
  const [tipAmount, setTipAmount] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)

  // Flow bar state
  const [flowLoading, setFlowLoading] = useState<string | null>(null)

  // Timer
  const [elapsed, setElapsed] = useState(0)

  // Crew checkboxes (local toggle for who is on the job)
  const [crewOnJob, setCrewOnJob] = useState<number[]>([])

  // Price book collapsible (hydrated from /api/actions/tech-upsell-catalog)
  const [priceBookOpen, setPriceBookOpen] = useState(false)
  const [priceBook, setPriceBook] = useState<PriceBookItem[]>(PRICE_BOOK_FALLBACK)

  // Info tab: notes editing
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  // Service plan creation
  const [showPlanSetup, setShowPlanSetup] = useState(false)

  // ----------- Data Fetching -----------

  const fetchData = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/actions/visit-detail?job_id=${jobId}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load' }))
        setError(err.error || 'Failed to load job details')
        return
      }
      const result: PageData = await res.json()
      setData(result)
      // Initialize crew on job from visit technicians
      setCrewOnJob(result.visit.technicians || [])
      setNotesValue(result.job.notes || '')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (open && jobId) {
      fetchData()
      setActiveTab('visit')
      // Hydrate price book from the tenant tech-upsell catalog so prices are
      // editable via /tech-upsells instead of a code-frozen constant.
      ;(async () => {
        try {
          const res = await fetch('/api/actions/tech-upsell-catalog')
          if (!res.ok) return
          const body: { items?: { name: string; price: number | string }[] } = await res.json()
          if (Array.isArray(body.items)) {
            setPriceBook(
              body.items.map(i => ({ name: i.name, price: Number(i.price) || 0 }))
            )
          }
        } catch {
          // Silent fallback to PRICE_BOOK_FALLBACK; admin can still type
          // freeform service name + price in the upsell form.
        }
      })()
    }
    if (!open) {
      setData(null)
      setError(null)
      setUpsellOpen(false)
      setUpsellName('')
      setUpsellPrice('')
      setPaymentMode(false)
      setTipAmount('')
      setDiscountAmount('')
      setEditingNotes(false)
      setShowPlanSetup(false)
      setPriceBookOpen(false)
    }
  }, [open, jobId, fetchData])

  // Running timer
  useEffect(() => {
    if (!data) return
    const { status, started_at, stopped_at } = data.visit
    if (status === 'in_progress' && started_at) {
      const start = new Date(started_at).getTime()
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    }
    if (stopped_at && started_at) {
      setElapsed(
        Math.floor((new Date(stopped_at).getTime() - new Date(started_at).getTime()) / 1000)
      )
    }
  }, [data?.visit.status, data?.visit.started_at, data?.visit.stopped_at])

  // ----------- Visit Flow Handlers -----------

  const handleTransition = useCallback(async (targetStatus: VisitStatus) => {
    if (!data) return
    setFlowLoading(targetStatus)
    try {
      const res = await fetch('/api/actions/visits/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: data.visit.id,
          targetStatus,
          technicians: crewOnJob.length > 0 ? crewOnJob : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Transition failed' }))
        alert(err.error || 'Transition failed')
        return
      }
      await fetchData()
      onJobUpdated?.()
    } finally {
      setFlowLoading(null)
    }
  }, [data, fetchData, onJobUpdated, crewOnJob])

  const handleCollectPayment = useCallback(async () => {
    if (!data) return
    const lineTotal = data.line_items.reduce((sum, li) => sum + li.price, 0)
    const baseAmount = lineTotal > 0 ? lineTotal : Number(data.job.price || 0)
    const discount = parseFloat(discountAmount) || 0
    const tip = parseFloat(tipAmount) || 0
    const finalAmount = Math.max(0, baseAmount - discount)

    setPaymentSubmitting(true)
    try {
      const res = await fetch('/api/actions/visits/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: data.visit.id,
          payment_type: paymentType,
          payment_amount: finalAmount,
          tip_amount: tip > 0 ? tip : undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Payment failed' }))
        alert(err.error || 'Payment failed')
        return
      }
      setPaymentMode(false)
      setTipAmount('')
      setDiscountAmount('')
      await fetchData()
      onJobUpdated?.()
    } finally {
      setPaymentSubmitting(false)
    }
  }, [data, paymentType, tipAmount, discountAmount, fetchData, onJobUpdated])

  // ----------- Checklist Handlers -----------

  const handleToggleChecklist = useCallback(async (itemId: number, completed: boolean) => {
    if (!data) return
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        checklist: prev.checklist.map(item =>
          item.id === itemId ? { ...item, is_completed: completed } : item
        ),
      }
    })

    const res = await fetch('/api/crew/dashboard/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visit_id: data.visit.id, item_id: itemId, completed }),
    })

    if (!res.ok) {
      await fetchData()
    }
  }, [data, fetchData])

  const handleAddChecklistItem = useCallback(async (text: string) => {
    if (!data) return
    const res = await fetch('/api/crew/dashboard/checklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visit_id: data.visit.id, text }),
    })
    if (res.ok) {
      await fetchData()
    }
  }, [data, fetchData])

  // ----------- Upsell Handler -----------

  const handleAddUpsell = useCallback(async () => {
    if (!data || !upsellName.trim() || !upsellPrice) return
    setUpsellSubmitting(true)
    try {
      const res = await fetch('/api/actions/visits/upsell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: data.visit.id,
          service_name: upsellName.trim(),
          price: parseFloat(upsellPrice),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to add upsell' }))
        alert(err.error || 'Failed to add upsell')
        return
      }
      setUpsellName('')
      setUpsellPrice('')
      setUpsellOpen(false)
      await fetchData()
      onJobUpdated?.()
    } finally {
      setUpsellSubmitting(false)
    }
  }, [data, upsellName, upsellPrice, fetchData, onJobUpdated])

  // Quick upsell from price book
  const handleQuickUpsell = useCallback(async (name: string, price: number) => {
    if (!data) return
    const res = await fetch('/api/actions/visits/upsell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitId: data.visit.id,
        service_name: name,
        price,
      }),
    })
    if (res.ok) {
      await fetchData()
      onJobUpdated?.()
    }
  }, [data, fetchData, onJobUpdated])

  // ----------- Crew Toggle -----------

  const handleCrewToggle = useCallback((crewId: number, checked: boolean) => {
    setCrewOnJob(prev =>
      checked ? [...prev, crewId] : prev.filter(id => id !== crewId)
    )
  }, [])

  // ----------- Notes Save -----------

  const handleSaveNotes = useCallback(async () => {
    if (!data || !data.job.id) return
    setNotesSaving(true)
    try {
      // Save notes via a generic update endpoint or inline
      const res = await fetch('/api/actions/visits/update-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: data.job.id, notes: notesValue }),
      })
      if (res.ok) {
        setEditingNotes(false)
        await fetchData()
      }
    } finally {
      setNotesSaving(false)
    }
  }, [data, notesValue, fetchData])

  // ----------- Derived State -----------

  if (!open) return null

  if (loading) {
    return (
      <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
        <SheetContent
          side="right"
          className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto bg-zinc-950 border-zinc-800 p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Loading</SheetTitle>
            <SheetDescription>Loading job details</SheetDescription>
          </SheetHeader>
          <div className="flex items-center justify-center min-h-[60vh]">
            <CubeLoader />
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  if (error || !data) {
    return (
      <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
        <SheetContent
          side="right"
          className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto bg-zinc-950 border-zinc-800 p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Error</SheetTitle>
            <SheetDescription>Error loading job</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6">
            <p className="text-red-400 text-lg">{error || 'Job not found'}</p>
            <Button variant="outline" onClick={onClose} className="cursor-pointer">
              Close
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  const { job, visit, checklist, line_items, customer, assigned_crew, salesman, membership, visit_history } = data

  const originalItems = line_items.filter(li => li.revenue_type === 'original_quote')
  const upsellItems = line_items.filter(li => li.revenue_type === 'technician_upsell')
  const subtotal = originalItems.reduce((sum, li) => sum + li.price, 0)
  const upsellTotal = upsellItems.reduce((sum, li) => sum + li.price, 0)
  const grandTotal = subtotal + upsellTotal
  const displayTotal = grandTotal > 0 ? grandTotal : Number(job.price || 0)

  const completedCount = checklist.filter(i => i.is_completed).length
  const totalChecklist = checklist.length
  const checklistComplete = totalChecklist > 0 && completedCount === totalChecklist

  const canUpsell = visit.status === 'in_progress'
  const currentIndex = getStatusIndex(visit.status)

  const customerFullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown Customer'

  const directionsUrl = (customer.address || job.address)
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(customer.address || job.address)}`
    : null

  // Determine which action button to show
  const getNextAction = (): { label: string; status: VisitStatus; color: string; icon: React.ElementType } | null => {
    switch (visit.status) {
      case 'not_started':
        return { label: 'On My Way', status: 'on_my_way', color: 'bg-blue-600 hover:bg-blue-700', icon: Navigation }
      case 'on_my_way':
        return { label: 'Start Visit', status: 'in_progress', color: 'bg-green-600 hover:bg-green-700', icon: Play }
      case 'in_progress':
        return { label: 'Stop Visit', status: 'stopped', color: 'bg-orange-600 hover:bg-orange-700', icon: Square }
      case 'stopped':
        return { label: 'Completed', status: 'completed', color: 'bg-emerald-600 hover:bg-emerald-700', icon: CheckCircle2 }
      case 'completed':
        return checklistComplete
          ? { label: 'Checklist Done', status: 'checklist_done', color: 'bg-purple-600 hover:bg-purple-700', icon: CheckCircle2 }
          : null
      case 'checklist_done':
        return null // Payment mode handles this
      case 'payment_collected':
        return { label: 'Close Job', status: 'closed', color: 'bg-red-600 hover:bg-red-700', icon: Lock }
      default:
        return null
    }
  }

  const nextAction = getNextAction()

  // Payment state: show payment section when checklist_done but not yet paid
  const showPaymentSection = visit.status === 'checklist_done' && !visit.payment_recorded
  // Also show after payment for the close button
  const showCloseSection = visit.status === 'payment_collected'

  // Determine "performed by" from assigned crew
  const performedBy = assigned_crew.map(c => c.name).join(', ') || 'Unassigned'

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto bg-zinc-950 border-zinc-800 p-0"
      >
        {/* Accessible header (visually hidden — content below is the real header) */}
        <SheetHeader className="sr-only">
          <SheetTitle>{customerFullName}</SheetTitle>
          <SheetDescription>Job #{job.id} details</SheetDescription>
        </SheetHeader>

        {/* ============================================================ */}
        {/* TOP SECTION — Always visible: name, address, date, actions   */}
        {/* ============================================================ */}
        <div className="px-5 pt-5 pb-4 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
          {/* Customer name + status badge */}
          <div className="flex items-start justify-between pr-8 mb-2">
            <h2 className="text-xl font-bold text-white leading-tight">{customerFullName}</h2>
            <Badge className={`${statusBadgeColor(visit.status)} text-[10px] shrink-0`}>
              {visit.status.replace(/_/g, ' ').toUpperCase()}
            </Badge>
          </div>

          {/* Address — clickable for directions */}
          {(customer.address || job.address) && (
            <button
              onClick={() => directionsUrl && window.open(directionsUrl, '_blank')}
              className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 mb-1 cursor-pointer text-left"
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="underline underline-offset-2">{customer.address || job.address}</span>
              <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
            </button>
          )}

          {/* Date */}
          <p className="text-sm text-zinc-400 mb-3">
            {job.date ? formatDateShort(job.date) : 'No date set'}
            {job.scheduled_time ? ` at ${job.scheduled_time}` : ''}
          </p>

          {/* Timer (if running or stopped) */}
          {(visit.status === 'in_progress' || (visit.started_at && visit.stopped_at)) && (
            <div className="flex items-center gap-2 mb-3 py-1.5 px-3 bg-zinc-900 rounded-md w-fit">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              <span className={`text-lg font-mono font-bold ${visit.status === 'in_progress' ? 'text-green-400' : 'text-zinc-300'}`}>
                {formatDuration(elapsed)}
              </span>
              {visit.status === 'in_progress' && (
                <span className="text-[10px] text-green-500 animate-pulse font-semibold">ACTIVE</span>
              )}
            </div>
          )}

          {/* Action Buttons Row */}
          <div className="flex gap-2">
            {directionsUrl && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs cursor-pointer border-zinc-700"
                onClick={() => window.open(directionsUrl, '_blank')}
              >
                <Navigation className="w-3.5 h-3.5 mr-1" />
                Directions
              </Button>
            )}

            {nextAction && (
              <Button
                size="sm"
                disabled={flowLoading !== null}
                onClick={() => handleTransition(nextAction.status)}
                className={`text-xs cursor-pointer text-white ${nextAction.color} flex-1`}
              >
                {flowLoading === nextAction.status ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
                ) : (
                  <nextAction.icon className="w-3.5 h-3.5 mr-1" />
                )}
                {nextAction.label}
              </Button>
            )}

            {/* Completed steps shown as small check badges */}
            {currentIndex >= 1 && visit.status !== 'not_started' && (
              <div className="flex items-center gap-1 ml-auto">
                {currentIndex >= 1 && (
                  <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> OMW
                  </span>
                )}
                {currentIndex >= 2 && (
                  <span className="text-[10px] text-green-400 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3" /> Started
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Status hints */}
          {visit.status === 'completed' && !checklistComplete && (
            <p className="text-xs text-amber-400 mt-2">Complete the checklist to continue</p>
          )}
          {visit.status === 'closed' && (
            <p className="text-xs text-green-400 mt-2">Job closed -- receipt, review request, and thank you sent</p>
          )}
        </div>

        {/* ============================================================ */}
        {/* TAB SWITCHER                                                 */}
        {/* ============================================================ */}
        <div className="flex border-b border-zinc-800 sticky top-[calc(var(--header-h,0px))] bg-zinc-950 z-[9]">
          <button
            onClick={() => setActiveTab('visit')}
            className={`flex-1 py-2.5 text-sm font-medium text-center cursor-pointer transition-colors
              ${activeTab === 'visit'
                ? 'text-white border-b-2 border-white'
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
          >
            Visit / Job
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`flex-1 py-2.5 text-sm font-medium text-center cursor-pointer transition-colors
              ${activeTab === 'info'
                ? 'text-white border-b-2 border-white'
                : 'text-zinc-500 hover:text-zinc-300'
              }`}
          >
            Info
          </button>
        </div>

        {/* ============================================================ */}
        {/* TAB CONTENT                                                  */}
        {/* ============================================================ */}
        <div className="px-5 py-4 space-y-4">

          {/* ---------------------------------------------------------- */}
          {/* TAB 1: Visit / Job                                         */}
          {/* ---------------------------------------------------------- */}
          {activeTab === 'visit' && (
            <>
              {/* --- Line Items --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50">
                <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Services</span>
                  {canUpsell ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-amber-400 hover:text-amber-300 h-6 px-2 text-xs cursor-pointer"
                      onClick={() => setUpsellOpen(true)}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add
                    </Button>
                  ) : (
                    <span className="text-[10px] text-zinc-600">
                      {visit.status === 'not_started' || visit.status === 'on_my_way'
                        ? 'Start visit to add upsells'
                        : ''}
                    </span>
                  )}
                </div>
                <div className="p-3 space-y-1.5">
                  {originalItems.length > 0 ? (
                    originalItems.map(item => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-zinc-300">{item.service_name}</span>
                        <span className="text-white font-medium">{formatCurrency(item.price)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-300">{job.service_type || 'Service'}</span>
                      <span className="text-white font-medium">{formatCurrency(Number(job.price || 0))}</span>
                    </div>
                  )}

                  {/* Upsell items */}
                  {upsellItems.length > 0 && (
                    <div className="border-t border-zinc-800 pt-1.5 mt-1.5 space-y-1.5">
                      {upsellItems.map(item => (
                        <div key={item.id} className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-zinc-300">{item.service_name}</span>
                            <Badge variant="outline" className="text-[9px] border-amber-600 text-amber-400 py-0 px-1">
                              UPSELL
                            </Badge>
                          </div>
                          <span className="text-amber-400 font-medium">{formatCurrency(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Subtotal */}
                  <div className="border-t border-zinc-800 pt-2 mt-2">
                    {upsellItems.length > 0 && (
                      <div className="flex justify-between text-xs text-zinc-500 mb-1">
                        <span>Subtotal</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                    )}
                    {upsellItems.length > 0 && (
                      <div className="flex justify-between text-xs text-amber-400 mb-1">
                        <span>Upsells</span>
                        <span>+{formatCurrency(upsellTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold">
                      <span className="text-white">Total</span>
                      <span className="text-green-400">{formatCurrency(displayTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* --- Checklist --- */}
              <div>
                {/* Progress bar header */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Checklist</span>
                  <span className={`text-xs font-medium ${checklistComplete ? 'text-green-400' : 'text-zinc-500'}`}>
                    {completedCount}/{totalChecklist} Complete
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1.5 bg-zinc-800 rounded-full mb-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${checklistComplete ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: totalChecklist > 0 ? `${(completedCount / totalChecklist) * 100}%` : '0%' }}
                  />
                </div>
                <VisitChecklist
                  items={checklist}
                  onToggle={handleToggleChecklist}
                  onAddItem={handleAddChecklistItem}
                  disabled={visit.status === 'closed'}
                />
              </div>

              {/* --- Crew On Job (visible during in_progress) --- */}
              {(visit.status === 'in_progress' || visit.status === 'stopped') && assigned_crew.length > 0 && (
                <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-2">
                    Crew on Job
                  </span>
                  <div className="space-y-2">
                    {assigned_crew.map(member => (
                      <label
                        key={member.id}
                        className="flex items-center gap-3 p-2 rounded hover:bg-zinc-800/50 cursor-pointer"
                      >
                        <Checkbox
                          checked={crewOnJob.includes(member.id)}
                          onCheckedChange={(checked) => handleCrewToggle(member.id, checked as boolean)}
                          className="cursor-pointer"
                        />
                        <span className="text-sm text-white">{member.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* --- Payment Section (State 3) --- */}
              {showPaymentSection && (
                <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4 space-y-4">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block">
                    Payment
                  </span>

                  {/* Amount due */}
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm text-zinc-400">Amount Due</span>
                    <span className="text-2xl font-bold text-green-400">{formatCurrency(displayTotal)}</span>
                  </div>

                  {/* Payment type buttons */}
                  <div className="flex gap-2">
                    {(['card', 'cash', 'check'] as PaymentType[]).map(type => (
                      <Button
                        key={type}
                        variant={paymentType === type ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPaymentType(type)}
                        className={`flex-1 cursor-pointer text-xs capitalize ${
                          paymentType === type ? 'bg-zinc-700 text-white' : 'border-zinc-700'
                        }`}
                      >
                        {type === 'card' && <CreditCard className="w-3 h-3 mr-1" />}
                        {type === 'cash' && <Banknote className="w-3 h-3 mr-1" />}
                        {type === 'check' && <Receipt className="w-3 h-3 mr-1" />}
                        {type}
                      </Button>
                    ))}
                  </div>

                  {/* Card on file note */}
                  {paymentType === 'card' && customer.card_on_file && (
                    <p className="text-xs text-green-400 flex items-center gap-1">
                      <CreditCard className="w-3 h-3" /> Card on file
                    </p>
                  )}
                  {paymentType === 'card' && membership && (
                    <p className="text-xs text-purple-400 flex items-center gap-1">
                      <ScrollText className="w-3 h-3" /> On service plan
                    </p>
                  )}

                  {/* Tip + Discount */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Tip Received</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="$0.00"
                        value={tipAmount}
                        onChange={e => setTipAmount(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Discount</label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="-$0.00"
                        value={discountAmount}
                        onChange={e => setDiscountAmount(e.target.value)}
                        className="text-sm"
                      />
                    </div>
                  </div>

                  {/* Performed by */}
                  <p className="text-xs text-zinc-500">
                    Job performed by: <span className="text-zinc-300">{performedBy}</span>
                  </p>

                  {/* Collect button */}
                  <Button
                    onClick={handleCollectPayment}
                    disabled={paymentSubmitting}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                  >
                    {paymentSubmitting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    {paymentSubmitting ? 'Processing...' : `Collect ${formatCurrency(displayTotal)}`}
                  </Button>
                </div>
              )}

              {/* Close Job button (locked until checklist + payment) */}
              {showCloseSection && (
                <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-4">
                  <Button
                    onClick={() => handleTransition('closed')}
                    disabled={!checklistComplete || !visit.payment_recorded || flowLoading !== null}
                    className="w-full bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                  >
                    {flowLoading === 'closed' ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    ) : (
                      <Lock className="w-4 h-4 mr-2" />
                    )}
                    Close Job
                  </Button>
                  {(!checklistComplete || !visit.payment_recorded) && (
                    <p className="text-xs text-amber-400 mt-2 text-center">
                      {!checklistComplete ? 'Complete checklist first' : 'Collect payment first'}
                    </p>
                  )}
                </div>
              )}

              {/* --- Price Book Reference (collapsible) --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50">
                <button
                  onClick={() => setPriceBookOpen(!priceBookOpen)}
                  className="w-full flex items-center justify-between p-3 cursor-pointer"
                >
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <DollarSign className="w-3 h-3" />
                    Price Book
                  </span>
                  {priceBookOpen
                    ? <ChevronUp className="w-4 h-4 text-zinc-500" />
                    : <ChevronDown className="w-4 h-4 text-zinc-500" />
                  }
                </button>
                {priceBookOpen && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {priceBook.map(item => (
                      <div key={item.name} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400">{item.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-300">{formatCurrency(item.price)}</span>
                          {canUpsell && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-5 w-5 p-0 text-amber-400 hover:text-amber-300 cursor-pointer"
                              onClick={() => handleQuickUpsell(item.name, item.price)}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---------------------------------------------------------- */}
          {/* TAB 2: Info (persistent client data)                       */}
          {/* ---------------------------------------------------------- */}
          {activeTab === 'info' && (
            <>
              {/* Info header */}
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider text-center">
                This info is attached to the client permanently
              </p>

              {/* --- Notes --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <FileText className="w-3 h-3" />
                    Notes
                  </span>
                  {!editingNotes ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      onClick={() => { setEditingNotes(true); setNotesValue(job.notes || '') }}
                    >
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-zinc-500 cursor-pointer"
                        onClick={() => { setEditingNotes(false); setNotesValue(job.notes || '') }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-green-400 cursor-pointer"
                        onClick={handleSaveNotes}
                        disabled={notesSaving}
                      >
                        {notesSaving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>
                {editingNotes ? (
                  <Textarea
                    value={notesValue}
                    onChange={e => setNotesValue(e.target.value)}
                    placeholder="Property-specific notes (e.g. backyard full of stuff, storm windows)..."
                    className="text-sm min-h-[80px] bg-zinc-900 border-zinc-700"
                  />
                ) : (
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">
                    {job.notes || <span className="text-zinc-600 italic">No notes yet</span>}
                  </p>
                )}
              </div>

              {/* --- Tags --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <Tag className="w-3 h-3" />
                  Tags
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {salesman && (
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-300">
                      Salesman: {salesman.name}
                    </Badge>
                  )}
                  {assigned_crew.map(c => (
                    <Badge key={c.id} variant="outline" className="text-[10px] border-zinc-700 text-zinc-300">
                      Tech: {c.name}
                    </Badge>
                  ))}
                  {membership?.service_plans && (
                    <Badge variant="outline" className="text-[10px] border-purple-700 text-purple-400">
                      {membership.service_plans.name}
                    </Badge>
                  )}
                  {job.frequency && job.frequency !== 'one-time' && (
                    <Badge variant="outline" className="text-[10px] border-blue-700 text-blue-400 capitalize">
                      {job.frequency}
                    </Badge>
                  )}
                  {job.lead_source && (
                    <Badge variant="outline" className="text-[10px] border-zinc-700 text-zinc-400">
                      Source: {job.lead_source}
                    </Badge>
                  )}
                </div>
              </div>

              {/* --- Client History --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <History className="w-3 h-3" />
                  Client History ({visit_history.length})
                </span>
                {visit_history.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">No past visits</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {visit_history.map(v => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between p-2 rounded bg-zinc-900 text-sm"
                      >
                        <div>
                          <p className="text-zinc-300 text-xs">{formatDateLong(v.visit_date)}</p>
                          <p className="text-[10px] text-zinc-500">
                            {v.services.length > 0
                              ? v.services.join(', ')
                              : 'No services recorded'}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge className={`text-[9px] ${statusBadgeColor(v.status)}`}>
                            {v.status.replace(/_/g, ' ')}
                          </Badge>
                          {v.total > 0 && (
                            <p className="text-[10px] text-green-400 mt-0.5">{formatCurrency(v.total)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* --- Service Plan Section --- */}
              <div className="border border-zinc-800 rounded-lg bg-zinc-900/50 p-3">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                  <ScrollText className="w-3 h-3" />
                  Service Plan
                </span>

                {membership && membership.service_plans ? (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Plan</span>
                      <span className="text-white">{membership.service_plans.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Frequency</span>
                      <span className="text-white">Every {membership.service_plans.interval_months} months</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Visits</span>
                      <span className="text-white">
                        {membership.visits_completed}/{membership.service_plans.visits_per_year} completed
                      </span>
                    </div>
                    {membership.next_visit_at && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Next Visit</span>
                        <span className="text-white">{formatDateLong(membership.next_visit_at)}</span>
                      </div>
                    )}
                    {membership.service_plans.discount_per_visit > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-zinc-400">Discount</span>
                        <span className="text-green-400">
                          -{formatCurrency(membership.service_plans.discount_per_visit)}/visit
                        </span>
                      </div>
                    )}
                    <Badge className={`mt-1 ${membership.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-zinc-700 text-zinc-300'}`}>
                      {membership.status}
                    </Badge>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-zinc-600 italic mb-3">No active service plan</p>
                    {!showPlanSetup ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full cursor-pointer border-purple-700 text-purple-400 hover:bg-purple-900/20"
                        onClick={() => setShowPlanSetup(true)}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Create Service Plan
                      </Button>
                    ) : (
                      <div className="mt-2">
                        <div className="flex justify-end mb-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-zinc-500 cursor-pointer"
                            onClick={() => setShowPlanSetup(false)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                        <ServicePlanSetup
                          customerName={customerFullName}
                          onSubmit={async (planData) => {
                            // POST to create membership endpoint
                            if (!customer.id) return
                            const res = await fetch('/api/actions/memberships/create', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                customerId: customer.id,
                                ...planData,
                              }),
                            })
                            if (res.ok) {
                              setShowPlanSetup(false)
                              await fetchData()
                            }
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/* UPSELL DIALOG                                                */}
        {/* ============================================================ */}
        <Dialog open={upsellOpen} onOpenChange={setUpsellOpen}>
          <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800">
            <DialogHeader>
              <DialogTitle className="text-white">Add Upsell Service</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Service Name</label>
                <Input
                  placeholder="e.g. Screen Cleaning"
                  value={upsellName}
                  onChange={e => setUpsellName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-zinc-400 mb-1 block">Price ($)</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={upsellPrice}
                  onChange={e => setUpsellPrice(e.target.value)}
                />
              </div>

              {/* Quick-fill from price book */}
              <div>
                <p className="text-xs text-zinc-500 mb-1.5">Quick fill:</p>
                <div className="flex flex-wrap gap-1">
                  {priceBook.map(item => (
                    <button
                      key={item.name}
                      onClick={() => { setUpsellName(item.name); setUpsellPrice(String(item.price)) }}
                      className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 cursor-pointer transition-colors"
                    >
                      {item.name} ({formatCurrency(item.price)})
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setUpsellOpen(false)}
                  className="cursor-pointer"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAddUpsell}
                  disabled={upsellSubmitting || !upsellName.trim() || !upsellPrice}
                  className="bg-amber-600 hover:bg-amber-700 cursor-pointer"
                >
                  {upsellSubmitting ? 'Adding...' : 'Add Upsell'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}
