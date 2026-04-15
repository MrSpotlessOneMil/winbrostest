'use client'

/**
 * Job Detail Drawer — Full job execution flow as a slide-over panel
 *
 * Opens from the Calendar page when a user clicks "Full Details".
 * Contains the complete two-column job detail layout: services, checklist,
 * visit flow bar, customer info, notes, and client history.
 *
 * Uses the same /api/actions/visit-detail endpoint as the standalone page.
 */

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { VisitFlowBar } from '@/components/winbros/visit-flow-bar'
import { VisitChecklist } from '@/components/winbros/visit-checklist'
import CubeLoader from '@/components/ui/cube-loader'
import {
  DollarSign, MapPin, Phone, User, Calendar,
  Users, Tag, Plus, ExternalLink, FileText, History,
  Sparkles, CreditCard, Percent, ScrollText
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

// ----------- Helpers -----------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
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
  const router = useRouter()

  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Upsell dialog
  const [upsellOpen, setUpsellOpen] = useState(false)
  const [upsellName, setUpsellName] = useState('')
  const [upsellPrice, setUpsellPrice] = useState('')
  const [upsellSubmitting, setUpsellSubmitting] = useState(false)

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
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => {
    if (open && jobId) {
      fetchData()
    }
    if (!open) {
      // Reset state when drawer closes
      setData(null)
      setError(null)
      setUpsellOpen(false)
      setUpsellName('')
      setUpsellPrice('')
    }
  }, [open, jobId, fetchData])

  // ----------- Visit Flow Handlers -----------

  const handleTransition = useCallback(async (targetStatus: VisitStatus) => {
    if (!data) return
    const res = await fetch('/api/actions/visits/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitId: data.visit.id, targetStatus }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Transition failed' }))
      alert(err.error || 'Transition failed')
      return
    }
    await fetchData()
    onJobUpdated?.()
  }, [data, fetchData, onJobUpdated])

  const handleCollectPayment = useCallback(() => {
    if (!data) return
    const amount = data.job.price || 0
    fetch('/api/actions/visits/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitId: data.visit.id,
        payment_type: 'card',
        payment_amount: amount,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Payment failed' }))
        alert(err.error || 'Payment failed')
        return
      }
      await fetchData()
      onJobUpdated?.()
    })
  }, [data, fetchData, onJobUpdated])

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

  // ----------- Render -----------

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[40vh]">
          <CubeLoader />
        </div>
      )
    }

    if (error || !data) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
          <p className="text-red-400 text-lg">{error || 'Job not found'}</p>
        </div>
      )
    }

    const { job, visit, checklist, line_items, customer, assigned_crew, salesman, membership, visit_history } = data

    const originalItems = line_items.filter(li => li.revenue_type === 'original_quote')
    const upsellItems = line_items.filter(li => li.revenue_type === 'technician_upsell')
    const subtotal = originalItems.reduce((sum, li) => sum + li.price, 0)
    const upsellTotal = upsellItems.reduce((sum, li) => sum + li.price, 0)
    const grandTotal = subtotal + upsellTotal
    const displayTotal = grandTotal > 0 ? grandTotal : Number(job.price || 0)

    const checklistComplete = checklist.length > 0 && checklist.every(item => item.is_completed)
    const canUpsell = visit.status === 'in_progress'

    const customerFullName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Unknown Customer'

    const directionsUrl = job.address
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`
      : null

    return (
      <>
        {/* Visit Flow Bar — top of drawer, full width */}
        <div className="mb-4">
          <VisitFlowBar
            visitId={visit.id}
            status={visit.status}
            startedAt={visit.started_at}
            stoppedAt={visit.stopped_at}
            checklistComplete={checklistComplete}
            paymentRecorded={visit.payment_recorded}
            onTransition={handleTransition}
            onCollectPayment={handleCollectPayment}
          />
        </div>

        {/* TWO-COLUMN LAYOUT (stacks on narrower drawers) */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

          {/* ======== LEFT COLUMN — Job Details ======== */}
          <div className="space-y-4">

            {/* Price / Services */}
            <Card className="border border-zinc-800 bg-zinc-950">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <DollarSign className="w-4 h-4 text-green-500" />
                  Price / Services
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {originalItems.length > 0 ? (
                  <div className="space-y-1">
                    {originalItems.map(item => (
                      <div key={item.id} className="flex justify-between text-sm">
                        <span className="text-zinc-300">{item.service_name}</span>
                        <span className="text-white font-medium">{formatCurrency(item.price)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-300">{job.service_type || 'Service'}</span>
                    <span className="text-white font-medium">{formatCurrency(Number(job.price || 0))}</span>
                  </div>
                )}

                {upsellItems.length > 0 && (
                  <div className="border-t border-zinc-800 pt-2 space-y-1">
                    {upsellItems.map(item => (
                      <div key={item.id} className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-zinc-300">{item.service_name}</span>
                          <Badge variant="outline" className="text-[10px] border-amber-600 text-amber-400">
                            UPSELL
                          </Badge>
                        </div>
                        <span className="text-amber-400 font-medium">{formatCurrency(item.price)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-zinc-800 pt-3 space-y-1">
                  {upsellItems.length > 0 && (
                    <>
                      <div className="flex justify-between text-xs text-zinc-400">
                        <span>Subtotal</span>
                        <span>{formatCurrency(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-amber-400">
                        <span>Upsells</span>
                        <span>+{formatCurrency(upsellTotal)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-lg font-bold">
                    <span className="text-white">Total</span>
                    <span className="text-green-400">{formatCurrency(displayTotal)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Checklist */}
            <VisitChecklist
              items={checklist}
              onToggle={handleToggleChecklist}
              onAddItem={handleAddChecklistItem}
              disabled={visit.status === 'closed'}
            />

            {/* Service Plan */}
            {membership && membership.service_plans && (
              <Card className="border border-zinc-800 bg-zinc-950">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <ScrollText className="w-4 h-4 text-purple-500" />
                    Service Plan
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
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
                      <span className="text-white">{formatDate(membership.next_visit_at)}</span>
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
                </CardContent>
              </Card>
            )}

            {/* Upsells Add Button */}
            {canUpsell && (
              <Card className="border border-dashed border-amber-700 bg-zinc-950/50">
                <CardContent className="py-4">
                  <Button
                    variant="outline"
                    className="w-full border-amber-600 text-amber-400 hover:bg-amber-900/30 cursor-pointer"
                    onClick={() => setUpsellOpen(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Service (Upsell)
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ======== RIGHT COLUMN — Customer Info + Metadata ======== */}
          <div className="space-y-4">

            {/* Customer Info */}
            <Card className="border border-zinc-800 bg-zinc-950">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-blue-500" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">{customerFullName}</span>
                  {customer.card_on_file && (
                    <Badge variant="outline" className="text-[10px] border-green-600 text-green-400">
                      <CreditCard className="w-3 h-3 mr-1" />
                      Card on File
                    </Badge>
                  )}
                </div>

                {customer.address && (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                    <span className="text-zinc-300">{customer.address}</span>
                  </div>
                )}

                {customer.phone_number && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-zinc-500" />
                    <a href={`tel:${customer.phone_number}`} className="text-blue-400 hover:underline">
                      {customer.phone_number}
                    </a>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  {directionsUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs cursor-pointer"
                      onClick={() => window.open(directionsUrl, '_blank')}
                    >
                      <MapPin className="w-3 h-3 mr-1" />
                      Directions
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                  {customer.id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs cursor-pointer"
                      onClick={() => router.push(`/customers?highlight=${customer.id}`)}
                    >
                      <User className="w-3 h-3 mr-1" />
                      Full Record
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Job Metadata */}
            <Card className="border border-zinc-800 bg-zinc-950">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-zinc-500" />
                  Job Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Date
                  </span>
                  <span className="text-white">{job.date ? formatDate(job.date) : 'TBD'}</span>
                </div>

                {assigned_crew.length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Crew
                    </span>
                    <span className="text-white">
                      {assigned_crew.map(c => c.name).join(', ')}
                    </span>
                  </div>
                )}

                {salesman && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Salesman
                    </span>
                    <span className="text-white">{salesman.name}</span>
                  </div>
                )}

                {job.lead_source && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Source
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {job.lead_source.toUpperCase()}
                    </Badge>
                  </div>
                )}

                {job.frequency && job.frequency !== 'one-time' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400 flex items-center gap-1">
                      <Percent className="w-3 h-3" /> Frequency
                    </span>
                    <span className="text-white capitalize">{job.frequency}</span>
                  </div>
                )}

                {job.hours && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">Est. Hours</span>
                    <span className="text-white">{job.hours}h</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Job Notes */}
            {job.notes && (
              <Card className="border border-zinc-800 bg-zinc-950">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4 text-yellow-500" />
                    Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-zinc-300 whitespace-pre-wrap">{job.notes}</p>
                  {visit.started_at && (
                    <p className="text-xs text-zinc-500 mt-2">
                      Last visit: {new Date(visit.started_at).toLocaleDateString()}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Client History */}
            {visit_history.length > 0 && (
              <Card className="border border-zinc-800 bg-zinc-950">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <History className="w-4 h-4 text-zinc-500" />
                    Client History ({visit_history.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {visit_history.map(v => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between p-2 rounded bg-zinc-900 text-sm"
                      >
                        <div>
                          <p className="text-zinc-300">{formatDate(v.visit_date)}</p>
                          <p className="text-xs text-zinc-500">
                            {v.services.length > 0
                              ? v.services.join(', ')
                              : 'No services recorded'}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge className={`text-[10px] ${statusBadgeColor(v.status)}`}>
                            {v.status.replace(/_/g, ' ')}
                          </Badge>
                          {v.total > 0 && (
                            <p className="text-xs text-green-400 mt-0.5">{formatCurrency(v.total)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Upsell Dialog (rendered inside drawer) */}
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
      </>
    )
  }

  const headerTitle = data
    ? `${data.job.service_type || 'Job'} — ${[data.customer.first_name, data.customer.last_name].filter(Boolean).join(' ') || 'Unknown'}`
    : 'Job Details'

  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[85vw] sm:max-w-5xl overflow-y-auto bg-zinc-950 border-zinc-800 p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-2 border-b border-zinc-800 sticky top-0 bg-zinc-950 z-10">
          <div className="flex items-center justify-between pr-8">
            <div>
              <SheetTitle className="text-white text-lg">{headerTitle}</SheetTitle>
              <SheetDescription className="text-zinc-400">
                {data ? `Job #${data.job.id}${data.job.date ? ` | ${formatDate(data.job.date)}` : ''}` : 'Loading...'}
              </SheetDescription>
            </div>
            {data && (
              <Badge className={`${statusBadgeColor(data.visit.status)} text-xs`}>
                {data.visit.status.replace(/_/g, ' ').toUpperCase()}
              </Badge>
            )}
          </div>
        </SheetHeader>
        <div className="px-6 py-4">
          {renderContent()}
        </div>
      </SheetContent>
    </Sheet>
  )
}
