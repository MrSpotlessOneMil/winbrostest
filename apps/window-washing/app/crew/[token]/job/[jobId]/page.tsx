"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, Calendar, Clock, MapPin, Phone,
  CheckCircle2, Loader2, AlertCircle, Lock,
  Navigation, CreditCard, DollarSign, Banknote,
  Plus, X, Check, CircleDot,
  ClipboardCheck, Receipt, XCircle,
} from "lucide-react"

// ── Types ──

type VisitStatus =
  | "not_started"
  | "on_my_way"
  | "in_progress"
  | "stopped"
  | "completed"
  | "checklist_done"
  | "payment_collected"
  | "closed"

interface Visit {
  id: number
  status: VisitStatus
  started_at: string | null
  stopped_at: string | null
  elapsed_seconds: number | null
  checklist_completed: boolean
  payment_recorded: boolean
  payment_type: string | null
  payment_amount: number | null
  tip_amount: number | null
}

interface LineItem {
  id: number
  service_name: string
  description: string | null
  price: number
  revenue_type: string
}

interface CatalogItem {
  id: number
  name: string
  description: string | null
  price: number
}

interface ChecklistItem {
  id: number | string
  item_text: string
  is_completed: boolean
  completed_at: string | null
}

interface JobDetail {
  id: number
  date: string
  scheduled_at: string | null
  address: string | null
  service_type: string | null
  status: string
  notes: string | null
  currency: string
}

interface CustomerInfo {
  first_name: string | null
  last_name: string | null
  phone_number?: string | null
}

interface TenantInfo {
  name: string
  slug: string
}

interface VisitData {
  visit: Visit
  checklist: ChecklistItem[]
  line_items: LineItem[]
  catalog: CatalogItem[]
  job: JobDetail
  customer: CustomerInfo
  tenant: TenantInfo
}

// ── Helpers ──

function formatDate(d: string): string {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatTime(t: string | null): string {
  if (!t) return "TBD"
  try {
    const [h, m] = t.split(":").map(Number)
    return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
  } catch {
    return t
  }
}

function formatElapsed(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`
  }
  return `${mins}m ${secs.toString().padStart(2, "0")}s`
}

function formatCurrency(amount: number, currency = "usd"): string {
  const cur = (currency || "usd").toUpperCase()
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: cur,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function serviceLabel(type: string | null): string {
  if (!type) return "Service"
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function serviceBadgeColor(type: string | null): string {
  switch (type) {
    case "window_cleaning":
      return "bg-sky-500/20 text-sky-400 border-sky-500/30"
    case "pressure_washing":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30"
    case "gutter_cleaning":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30"
    default:
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
  }
}

// ── Step Definitions ──

interface StepDef {
  key: string
  label: string
  targetStatus: VisitStatus
  color: string
  bgGlow: string
  description: string
}

const STEPS: StepDef[] = [
  {
    key: "omw",
    label: "On My Way",
    targetStatus: "on_my_way",
    color: "bg-blue-500",
    bgGlow: "shadow-blue-500/30",
    description: "Notifies the customer you are en route",
  },
  {
    key: "start",
    label: "Start Visit",
    targetStatus: "in_progress",
    color: "bg-green-500",
    bgGlow: "shadow-green-500/30",
    description: "Starts the job timer",
  },
  {
    key: "stop",
    label: "Stop Visit",
    targetStatus: "stopped",
    color: "bg-orange-500",
    bgGlow: "shadow-orange-500/30",
    description: "Stops the job timer",
  },
  {
    key: "completed",
    label: "Completed",
    targetStatus: "completed",
    color: "bg-emerald-500",
    bgGlow: "shadow-emerald-500/30",
    description: "Marks the work as done",
  },
  {
    key: "checklist",
    label: "Checklist",
    targetStatus: "checklist_done",
    color: "bg-purple-500",
    bgGlow: "shadow-purple-500/30",
    description: "Complete all checklist items",
  },
  {
    key: "payment",
    label: "Collect Payment",
    targetStatus: "payment_collected",
    color: "bg-indigo-500",
    bgGlow: "shadow-indigo-500/30",
    description: "Record the customer payment",
  },
  {
    key: "tip",
    label: "Record Tip",
    targetStatus: "payment_collected", // tip transitions handled separately
    color: "bg-teal-500",
    bgGlow: "shadow-teal-500/30",
    description: "Optional: record a tip",
  },
  {
    key: "close",
    label: "Close Job",
    targetStatus: "closed",
    color: "bg-red-500",
    bgGlow: "shadow-red-500/30",
    description: "Finalize and close the job",
  },
]

const STATUS_ORDER: VisitStatus[] = [
  "not_started",
  "on_my_way",
  "in_progress",
  "stopped",
  "completed",
  "checklist_done",
  "payment_collected",
  "closed",
]

function stepIndex(status: VisitStatus): number {
  return STATUS_ORDER.indexOf(status)
}

function currentStepIndex(visit: Visit): number {
  // Map the current visit status to which step we're on
  // not_started = before step 0
  // on_my_way = step 0 completed, step 1 is next
  // in_progress = step 1 completed, show timer, step 2 is next
  // stopped = step 2 completed, step 3 is next
  // completed = step 3 completed, step 4 (checklist) is next
  // checklist_done = step 4 completed, step 5 (payment) is next
  // payment_collected = steps 5+6 completed, step 7 (close) is next
  // closed = all steps done
  switch (visit.status) {
    case "not_started":
      return -1 // no steps completed, step 0 is next
    case "on_my_way":
      return 0 // step 0 done, step 1 next
    case "in_progress":
      return 1 // step 1 done, step 2 next
    case "stopped":
      return 2 // step 2 done, step 3 next
    case "completed":
      return 3 // step 3 done, step 4 next
    case "checklist_done":
      return 4 // step 4 done, step 5 next
    case "payment_collected":
      return 6 // steps 5+6 done, step 7 next
    case "closed":
      return 7 // all done
    default:
      return -1
  }
}

// ── Main Component ──

export default function CrewJobVisitPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const jobId = params.jobId as string

  const [data, setData] = useState<VisitData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // (Live visit timer removed in Round 2 — upsells no longer time-gated.)

  // Upsell catalog picker (Q1=C — no free-form upsells)
  const [showUpsellPicker, setShowUpsellPicker] = useState(false)
  const [upsellLoading, setUpsellLoading] = useState<number | null>(null)

  // Add checklist item
  const [showAddChecklist, setShowAddChecklist] = useState(false)
  const [newChecklistText, setNewChecklistText] = useState("")

  // Payment
  const [selectedPaymentType, setSelectedPaymentType] = useState<string | null>(null)
  const [paymentAmount, setPaymentAmount] = useState("")
  const [tipAmount, setTipAmount] = useState("")
  const [showTipInput, setShowTipInput] = useState(false)

  const apiBase = `/api/crew/${token}/job/${jobId}/visit`

  // ── Fetch ──

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(apiBase)
      if (!res.ok) throw new Error("Not found")
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e: unknown) {
      if (e instanceof Error) setError(e.message)
      else setError("Unknown error")
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Pre-fill payment amount with total once data arrives.
  // Must sit above any early return so hook order stays stable.
  useEffect(() => {
    if (!data) return
    const total = data.line_items.reduce((sum, li) => sum + li.price, 0)
    if (total > 0 && !paymentAmount) {
      setPaymentAmount(total.toFixed(2))
    }
  }, [data, paymentAmount])

  // ── POST Actions ──

  async function postAction(body: Record<string, unknown>): Promise<boolean> {
    setActionLoading(true)
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }))
        alert(err.error || "Action failed")
        return false
      }
      await fetchData()
      return true
    } catch {
      alert("Network error")
      return false
    } finally {
      setActionLoading(false)
    }
  }

  async function handleTransition(targetStatus: VisitStatus) {
    await postAction({ action: "transition", target_status: targetStatus })
  }

  async function handleUpsellFromCatalog(catalogItemId: number) {
    setUpsellLoading(catalogItemId)
    const ok = await postAction({
      action: "upsell",
      catalog_item_id: catalogItemId,
      quantity: 1,
    })
    if (ok) setShowUpsellPicker(false)
    setUpsellLoading(null)
  }

  async function handleToggleChecklist(itemId: number | string, completed: boolean) {
    await postAction({ action: "toggle_checklist", item_id: itemId, completed })
  }

  async function handleAddChecklistItem() {
    if (!newChecklistText.trim()) return
    const ok = await postAction({ action: "add_checklist_item", text: newChecklistText.trim() })
    if (ok) {
      setNewChecklistText("")
      setShowAddChecklist(false)
    }
  }

  async function handleRecordPayment() {
    if (!selectedPaymentType) {
      alert("Select a payment method")
      return
    }
    const amount = parseFloat(paymentAmount)
    if (isNaN(amount) || amount <= 0) {
      alert("Enter a valid payment amount")
      return
    }
    const tip = tipAmount ? parseFloat(tipAmount) : 0
    await postAction({
      action: "record_payment",
      payment_type: selectedPaymentType,
      payment_amount: amount,
      tip_amount: tip,
    })
  }

  async function handleRecordTip() {
    const tip = parseFloat(tipAmount)
    if (isNaN(tip) || tip <= 0) {
      alert("Enter a valid tip amount")
      return
    }
    await postAction({
      action: "record_payment",
      payment_type: data?.visit.payment_type || "cash",
      payment_amount: data?.visit.payment_amount || 0,
      tip_amount: tip,
    })
    setShowTipInput(false)
  }

  // ── Loading / Error States ──

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white">Job Not Found</h1>
          <p className="text-zinc-500 mt-1 text-sm">This job could not be loaded.</p>
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="mt-4 text-sm font-semibold text-blue-400"
          >
            Back to Portal
          </button>
        </div>
      </div>
    )
  }

  const { visit, checklist, line_items, catalog, job, customer, tenant } = data
  const canAddUpsell = visit.status !== "not_started" && visit.status !== "closed"
  const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "Customer"
  const completedStepIdx = currentStepIndex(visit)
  const isClosed = visit.status === "closed"

  // Calculate totals
  const quoteItems = line_items.filter((li) => li.revenue_type === 'original_quote')
  const upsellItems = line_items.filter((li) => li.revenue_type !== 'original_quote')
  const totalAmount = line_items.reduce((sum, li) => sum + li.price, 0)

  // Checklist progress
  const checklistCompleted = checklist.filter((c) => c.is_completed).length
  const checklistTotal = checklist.length
  const allChecklistDone = checklistTotal > 0 && checklistCompleted === checklistTotal

  // ── Closed State ──

  if (isClosed) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white">
        <div className="max-w-lg mx-auto px-4 pt-5 pb-8">
          {/* Header */}
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="flex items-center gap-1.5 text-zinc-500 text-sm mb-6 active:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="size-4" /> Back to Jobs
          </button>

          {/* Closed Hero */}
          <div className="text-center py-12">
            <div className="size-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="size-10 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">Job Closed</h1>
            <p className="text-zinc-400 text-sm">{customerName} - {formatDate(job.date)}</p>
          </div>

          {/* Summary Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Summary</h2>

            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Total Collected</span>
              <span className="text-lg font-bold text-white">
                {formatCurrency(visit.payment_amount || 0, job.currency)}
              </span>
            </div>

            {visit.tip_amount != null && visit.tip_amount > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Tip</span>
                <span className="text-lg font-bold text-teal-400">
                  {formatCurrency(visit.tip_amount, job.currency)}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-zinc-400 text-sm">Payment Method</span>
              <span className="text-sm font-medium text-white capitalize">
                {visit.payment_type || "N/A"}
              </span>
            </div>

            {visit.elapsed_seconds != null && (
              <div className="flex justify-between items-center">
                <span className="text-zinc-400 text-sm">Time on Site</span>
                <span className="text-sm font-medium text-white">
                  {formatElapsed(visit.elapsed_seconds)}
                </span>
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4 mt-4">
              <p className="text-xs text-zinc-500 text-center">
                Receipt, review request, and thank you sent automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Active Visit Render ──

  // Determine the next action step
  const nextStepIdx = completedStepIdx + 1
  const nextStep = nextStepIdx < STEPS.length ? STEPS[nextStepIdx] : null

  // For checklist step: only allow transition if all items complete
  const canAdvanceChecklist = completedStepIdx === 3 && allChecklistDone
  // For close step: only allow if checklist + payment done
  const canClose = visit.checklist_completed && visit.payment_recorded

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-8">
      <style>{`
        @keyframes timerPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50% { box-shadow: 0 0 0 12px rgba(34, 197, 94, 0); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: fadeSlideUp 0.35s ease-out both;
        }
      `}</style>

      <div className="max-w-lg mx-auto px-4 pt-5 space-y-5">

        {/* ═══════════ 1. HEADER BAR ═══════════ */}
        <div>
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="flex items-center gap-1.5 text-zinc-500 text-sm mb-4 active:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="size-4" /> Back to Jobs
          </button>

          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-white truncate">{customerName}</h1>
              {job.address && (
                <a
                  href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-400 mt-0.5 active:text-blue-300"
                >
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="truncate">{job.address}</span>
                </a>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Calendar className="size-3.5" />
              <span>{formatDate(job.date)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Clock className="size-3.5" />
              <span>{formatTime(job.scheduled_at)}</span>
            </div>
            {job.service_type && (
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${serviceBadgeColor(job.service_type)}`}
              >
                {serviceLabel(job.service_type)}
              </span>
            )}
          </div>

          {customer.phone_number && (
            <a
              href={`tel:${customer.phone_number}`}
              className="flex items-center gap-1.5 text-sm text-zinc-400 mt-2 active:text-zinc-200"
            >
              <Phone className="size-3.5" />
              <span>{customer.phone_number}</span>
            </a>
          )}
        </div>

        {/* ═══════════ 2. VISIT FLOW — THE HERO ═══════════ */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-slide-up">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            Visit Progress
          </h2>

          {/* Completed steps as small badges */}
          {completedStepIdx >= 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {STEPS.slice(0, completedStepIdx + 1).map((step) => (
                <div
                  key={step.key}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-400"
                >
                  <CheckCircle2 className="size-3 text-emerald-400" />
                  {step.label}
                </div>
              ))}
            </div>
          )}

          {/* Next action button — THE big button */}
          {nextStep && !isClosed && (() => {
            // Special handling for different steps
            const isChecklistStep = nextStep.key === "checklist"
            const isPaymentStep = nextStep.key === "payment"
            const isTipStep = nextStep.key === "tip"
            const isCloseStep = nextStep.key === "close"

            // Skip rendering the big button for checklist/payment/tip steps — they have their own sections
            if (isChecklistStep || isPaymentStep || isTipStep) {
              return (
                <div className="text-center py-2">
                  <p className="text-sm text-zinc-400">
                    {isChecklistStep && "Complete the checklist below to continue"}
                    {isPaymentStep && "Collect payment below to continue"}
                    {isTipStep && "Record an optional tip or skip to close"}
                  </p>
                </div>
              )
            }

            const disabled = actionLoading || (isCloseStep && !canClose)

            return (
              <div>
                <button
                  onClick={() => handleTransition(nextStep.targetStatus)}
                  disabled={disabled}
                  className={`w-full py-4 rounded-2xl font-bold text-base text-white
                    active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2.5
                    ${nextStep.color} shadow-lg ${nextStep.bgGlow}`}
                >
                  {actionLoading ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <>
                      {nextStep.key === "omw" && <Navigation className="size-5" />}
                      {nextStep.key === "start" && <CircleDot className="size-5" />}
                      {nextStep.key === "stop" && <XCircle className="size-5" />}
                      {nextStep.key === "completed" && <CheckCircle2 className="size-5" />}
                      {nextStep.key === "close" && <Lock className="size-5" />}
                      {nextStep.label.toUpperCase()}
                    </>
                  )}
                </button>
                <p className="text-xs text-zinc-500 text-center mt-2">{nextStep.description}</p>
                {isCloseStep && !canClose && (
                  <p className="text-xs text-red-400 text-center mt-1">
                    Complete checklist and record payment to close
                  </p>
                )}
              </div>
            )
          })()}

          {/* Tip skip button — shown when tip step is active */}
          {nextStep?.key === "tip" && (
            <div className="flex gap-3 mt-3">
              {!showTipInput ? (
                <>
                  <button
                    onClick={() => setShowTipInput(true)}
                    className="flex-1 py-3 rounded-xl font-semibold text-sm bg-teal-500 text-white active:scale-[0.97] transition-all flex items-center justify-center gap-2"
                  >
                    <DollarSign className="size-4" /> Add Tip
                  </button>
                  <button
                    onClick={() => handleTransition("closed")}
                    disabled={actionLoading || !canClose}
                    className="flex-1 py-3 rounded-xl font-semibold text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 active:scale-[0.97] transition-all disabled:opacity-40"
                  >
                    Skip to Close
                  </button>
                </>
              ) : (
                <div className="flex-1 space-y-3">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={tipAmount}
                        onChange={(e) => setTipAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    <button
                      onClick={handleRecordTip}
                      disabled={actionLoading || !tipAmount}
                      className="px-4 py-3 rounded-xl font-semibold text-sm bg-teal-500 text-white active:scale-[0.97] transition-all disabled:opacity-40"
                    >
                      {actionLoading ? <Loader2 className="size-4 animate-spin" /> : "Save"}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setShowTipInput(false)
                      setTipAmount("")
                    }}
                    className="text-xs text-zinc-500 active:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══════════ 3. LINE ITEMS ═══════════ */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            Line Items
          </h2>

          {/* Original Quote Services */}
          {quoteItems.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                Original Quote
              </p>
              <div className="space-y-2">
                {quoteItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2.5 px-3 bg-zinc-800/50 rounded-xl"
                  >
                    <div className="flex items-center gap-2">
                      <Lock className="size-3.5 text-zinc-600" />
                      <span className="text-sm text-zinc-300">{item.service_name}</span>
                    </div>
                    <span className="text-sm font-semibold text-white">
                      {formatCurrency(item.price, job.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technician Upsells */}
          <div>
            <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-2">
              Technician Upsells
            </p>
            {upsellItems.length > 0 ? (
              <div className="space-y-2 mb-3">
                {upsellItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2.5 px-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
                  >
                    <span className="text-sm text-emerald-300">{item.service_name}</span>
                    <span className="text-sm font-semibold text-emerald-400">
                      +{formatCurrency(item.price, job.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600 mb-3">No upsells added</p>
            )}

            {/* Add Upsell — picker from pre-approved catalog (Q1=C) */}
            {canAddUpsell && (
              <button
                onClick={() => setShowUpsellPicker(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-blue-400 active:text-blue-300 transition-colors"
              >
                <Plus className="size-4" /> Add Upsell
              </button>
            )}
          </div>

          {/* Upsell Picker Modal */}
          {showUpsellPicker && (
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
              onClick={() => upsellLoading === null && setShowUpsellPicker(false)}
            >
              <div
                className="w-full sm:max-w-md max-h-[85vh] bg-zinc-900 border border-zinc-700 rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                  <h3 className="text-base font-semibold text-white">Add Upsell</h3>
                  <button
                    onClick={() => upsellLoading === null && setShowUpsellPicker(false)}
                    disabled={upsellLoading !== null}
                    className="size-8 rounded-full flex items-center justify-center hover:bg-zinc-800 disabled:opacity-40"
                  >
                    <X className="size-4 text-zinc-400" />
                  </button>
                </div>
                <div className="overflow-y-auto flex-1 p-3 space-y-2">
                  {catalog.length === 0 ? (
                    <p className="text-center text-sm text-zinc-500 py-8">
                      No upsell items available for this tenant yet.
                    </p>
                  ) : (
                    catalog.map((item) => {
                      const isLoading = upsellLoading === item.id
                      const disabled = upsellLoading !== null
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleUpsellFromCatalog(item.id)}
                          disabled={disabled}
                          className="w-full text-left bg-zinc-800 border border-zinc-700 rounded-xl p-3 active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate">{item.name}</p>
                            {item.description && (
                              <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{item.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-semibold text-emerald-400">
                              {formatCurrency(item.price, job.currency)}
                            </span>
                            {isLoading ? (
                              <Loader2 className="size-4 animate-spin text-blue-400" />
                            ) : (
                              <Plus className="size-4 text-blue-400" />
                            )}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Total */}
          <div className="border-t border-zinc-800 mt-4 pt-3 flex justify-between items-center">
            <span className="text-sm font-semibold text-zinc-400">Total</span>
            <span className="text-lg font-bold text-white">
              {formatCurrency(totalAmount, job.currency)}
            </span>
          </div>
        </div>

        {/* ═══════════ 4. CHECKLIST SECTION ═══════════ */}
        {(completedStepIdx >= 3 || visit.status === "completed" || visit.status === "checklist_done" || stepIndex(visit.status) >= stepIndex("completed")) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-4 text-purple-400" />
                <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Checklist
                </h2>
              </div>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  allChecklistDone
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {checklistCompleted}/{checklistTotal} completed
              </span>
            </div>

            {/* Progress bar */}
            {checklistTotal > 0 && (
              <div className="h-1.5 rounded-full bg-zinc-800 mb-4 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${(checklistCompleted / checklistTotal) * 100}%`,
                    background: allChecklistDone
                      ? "rgb(34 197 94)"
                      : "linear-gradient(90deg, rgb(168 85 247), rgb(139 92 246))",
                  }}
                />
              </div>
            )}

            {/* Checklist items */}
            <div className="space-y-1">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleToggleChecklist(item.id, !item.is_completed)}
                  className="flex items-center gap-3 w-full text-left py-2.5 px-3 rounded-xl active:bg-zinc-800 transition-colors"
                >
                  <div
                    className={`size-5 rounded-md flex items-center justify-center shrink-0 transition-all duration-200 ${
                      item.is_completed
                        ? "bg-emerald-500"
                        : "border-2 border-zinc-600"
                    }`}
                  >
                    {item.is_completed && <Check className="size-3 text-white" strokeWidth={3} />}
                  </div>
                  <span
                    className={`text-sm transition-all ${
                      item.is_completed ? "line-through text-zinc-600" : "text-zinc-300"
                    }`}
                  >
                    {item.item_text}
                  </span>
                </button>
              ))}
            </div>

            {/* Add item */}
            <div className="mt-3">
              {!showAddChecklist ? (
                <button
                  onClick={() => setShowAddChecklist(true)}
                  className="flex items-center gap-1.5 text-sm font-medium text-purple-400 active:text-purple-300 transition-colors"
                >
                  <Plus className="size-4" /> Add Item
                </button>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddChecklistItem()}
                    placeholder="Checklist item..."
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500"
                    autoFocus
                  />
                  <button
                    onClick={handleAddChecklistItem}
                    disabled={!newChecklistText.trim()}
                    className="px-3 py-2 rounded-lg text-sm font-semibold bg-purple-500 text-white active:scale-[0.97] disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setShowAddChecklist(false)
                      setNewChecklistText("")
                    }}
                    className="px-2 py-2 rounded-lg text-zinc-400 bg-zinc-800"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Warning if incomplete and on checklist step */}
            {completedStepIdx === 3 && !allChecklistDone && (
              <div className="mt-4 flex items-center gap-2 py-2.5 px-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <AlertCircle className="size-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-400">
                  Complete all items to continue
                </p>
              </div>
            )}

            {/* Advance button when all done and on checklist step */}
            {completedStepIdx === 3 && allChecklistDone && (
              <button
                onClick={() => handleTransition("checklist_done")}
                disabled={actionLoading}
                className="w-full mt-4 py-3 rounded-xl font-bold text-sm bg-purple-500 text-white active:scale-[0.97] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {actionLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="size-4" /> CHECKLIST COMPLETE
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* ═══════════ 5. PAYMENT SECTION ═══════════ */}
        {(visit.status === "checklist_done" || completedStepIdx === 4) && !visit.payment_recorded && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 animate-slide-up" style={{ animationDelay: "0.15s" }}>
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="size-4 text-indigo-400" />
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                Collect Payment
              </h2>
            </div>

            {/* Payment method buttons */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { type: "card", label: "Card", icon: <CreditCard className="size-4" /> },
                { type: "cash", label: "Cash", icon: <Banknote className="size-4" /> },
                { type: "check", label: "Check", icon: <Receipt className="size-4" /> },
              ].map(({ type, label, icon }) => (
                <button
                  key={type}
                  onClick={() => setSelectedPaymentType(type)}
                  className={`py-3 rounded-xl text-sm font-semibold flex flex-col items-center gap-1.5 transition-all active:scale-[0.97] ${
                    selectedPaymentType === type
                      ? "bg-indigo-500 text-white border-2 border-indigo-400"
                      : "bg-zinc-800 text-zinc-400 border-2 border-zinc-700"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Amount</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Tip (optional)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={tipAmount}
                    onChange={(e) => setTipAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            {/* Submit button */}
            <button
              onClick={handleRecordPayment}
              disabled={actionLoading || !selectedPaymentType}
              className="w-full mt-4 py-3.5 rounded-xl font-bold text-sm bg-indigo-500 text-white active:scale-[0.97] transition-all disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
            >
              {actionLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <CreditCard className="size-4" /> COLLECT PAYMENT
                </>
              )}
            </button>
          </div>
        )}

        {/* ═══════════ PAYMENT RECORDED BANNER ═══════════ */}
        {visit.payment_recorded && !isClosed && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 className="size-5 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-emerald-400">Payment Recorded</p>
              <p className="text-xs text-zinc-500">
                {formatCurrency(visit.payment_amount || 0, job.currency)} via {visit.payment_type}
                {visit.tip_amount != null && visit.tip_amount > 0 && (
                  <> + {formatCurrency(visit.tip_amount, job.currency)} tip</>
                )}
              </p>
            </div>
          </div>
        )}

        {/* ═══════════ CLOSE JOB BUTTON (final step) ═══════════ */}
        {visit.payment_recorded && !isClosed && nextStep?.key === "close" && (
          <button
            onClick={() => handleTransition("closed")}
            disabled={actionLoading || !canClose}
            className="w-full py-4 rounded-2xl font-bold text-base bg-red-500 text-white active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shadow-lg shadow-red-500/20"
          >
            {actionLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <Lock className="size-5" /> CLOSE JOB
              </>
            )}
          </button>
        )}

        {/* Bottom padding for safe area */}
        <div className="h-4" />
      </div>
    </div>
  )
}
