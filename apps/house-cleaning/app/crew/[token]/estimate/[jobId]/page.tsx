"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { loadStripe } from "@stripe/stripe-js"
import {
  ArrowLeft,
  Check,
  CheckCircle,
  Loader2,
  AlertCircle,
  MapPin,
  User,
  Phone,
  Calendar,
  Clock,
  Shield,
  Star,
  Crown,
  Plus,
  Minus,
  Send,
  DollarSign,
  Circle,
  ClipboardCheck,
  CreditCard,
  Link2,
  Tag,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────

interface QuoteTier { key: string; name: string; tagline: string; badge?: string; included: string[]; description: string }
interface QuoteAddon { key: string; name: string; description: string; priceType: "flat" | "per_unit"; price: number; unit?: string }
interface TierPrice { price: number; breakdown: { service: string; price: number }[]; tier: string }

interface ChecklistItem {
  id: number
  text: string
  order: number
  required: boolean
  completed: boolean
  completed_at: string | null
}

interface ServicePlan {
  id: string
  slug: string
  name: string
  interval_months: number
  discount_amount: number
  description: string | null
}

interface EstimateData {
  job: { id: number; date: string; scheduled_at: string | null; address: string | null; service_type: string | null; job_type: string | null; sqft: number | null; notes: string | null }
  customer: { id: number | null; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; address: string | null }
  pricing: { tiers: QuoteTier[]; tierPrices: Record<string, TierPrice>; addons: QuoteAddon[]; serviceType: string }
  tenant: { name: string; slug: string; stripe_publishable_key?: string; currency?: string | null }
  availability: Record<string, number>
  checklist: ChecklistItem[]
  servicePlans?: ServicePlan[]
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency = "USD"): string {
  const locale = currency.toUpperCase() === "CAD" ? "en-CA" : "en-US"
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "TBD"
  try {
    const [h, m] = timeStr.split(":").map(Number)
    const ampm = h >= 12 ? "PM" : "AM"
    return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${ampm}`
  } catch { return timeStr }
}

const TIER_ICONS = [
  <Shield key="0" className="size-5" />,
  <Star key="1" className="size-5" />,
  <Crown key="2" className="size-5" />,
]

const TIER_COLORS = [
  { bg: "bg-sky-50", border: "border-sky-400", ring: "ring-sky-200", icon: "bg-sky-500", check: "text-sky-500" },
  { bg: "bg-blue-50", border: "border-blue-500", ring: "ring-blue-200", icon: "bg-blue-600", check: "text-blue-600" },
  { bg: "bg-indigo-50", border: "border-indigo-500", ring: "ring-indigo-200", icon: "bg-indigo-600", check: "text-indigo-600" },
]

// ── Component ────────────────────────────────────────────────────────

export default function EstimatePage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const jobId = params.jobId as string

  const [data, setData] = useState<EstimateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedTierKey, setSelectedTierKey] = useState<string | null>(null)
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({})
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({})
  const [useCustomPrice, setUseCustomPrice] = useState(false)
  const [customPrice, setCustomPrice] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceDate, setServiceDate] = useState("")
  const [serviceTime, setServiceTime] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [completed, setCompleted] = useState<{ action: string; total: number; date?: string } | null>(null)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [cardCaptureMode, setCardCaptureMode] = useState<'idle' | 'loading' | 'form' | 'success' | 'error'>('idle')
  const [cardError, setCardError] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/crew/${token}/estimate/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Estimate not found")
        return res.json()
      })
      .then((d) => {
        setData(d)
        // Default to middle tier (Better / Most Popular)
        const tierKeys = d.pricing.tiers.map((t: QuoteTier) => t.key)
        const defaultIdx = Math.min(1, tierKeys.length - 1)
        const defaultTier = tierKeys[defaultIdx]
        setSelectedTierKey(defaultTier)
        // Pre-select included addons
        const tierDef = d.pricing.tiers[defaultIdx]
        if (tierDef) {
          const inc: Record<string, boolean> = {}
          tierDef.included.forEach((k: string) => { inc[k] = true })
          setSelectedAddons(inc)
        }
        // Pre-fill addon quantities
        const q: Record<string, number> = {}
        d.pricing.addons.forEach((a: QuoteAddon) => { if (a.priceType === "per_unit") q[a.key] = 1 })
        setAddonQuantities(q)
        if (d.job.notes) setNotes(d.job.notes)
        if (d.checklist) setChecklist(d.checklist)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token, jobId])

  // ── Checklist toggle ───────────────────────────────────────────────

  async function toggleChecklistItem(itemId: number, completed: boolean) {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, completed, completed_at: completed ? new Date().toISOString() : null }
          : item
      )
    )
    await fetch(`/api/crew/${token}/estimate/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checklist_item_id: itemId, completed }),
    })
  }

  // ── Tier change handler ────────────────────────────────────────────

  const handleTierChange = useCallback((tierKey: string) => {
    setSelectedTierKey(tierKey)
    setUseCustomPrice(false)
    if (!data) return
    const tierDef = data.pricing.tiers.find((t) => t.key === tierKey)
    if (!tierDef) return
    setSelectedAddons(() => {
      const next: Record<string, boolean> = {}
      tierDef.included.forEach((k) => { next[k] = true })
      return next
    })
  }, [data])

  // ── Computed ───────────────────────────────────────────────────────

  const tiers = data?.pricing.tiers ?? []
  const addons = data?.pricing.addons ?? []
  const tierPrices = data?.pricing.tierPrices ?? {}
  const tenantCurrency = data?.tenant?.currency?.toUpperCase() || "USD"
  const fmt = (amount: number) => fmtCurrency(amount, tenantCurrency)
  const selectedTier = tiers.find((t) => t.key === selectedTierKey) ?? null
  const selectedTierPrice = selectedTierKey ? tierPrices[selectedTierKey] : null

  const isAddonIncluded = useCallback(
    (addonKey: string): boolean => !!selectedTier && selectedTier.included.includes(addonKey),
    [selectedTier]
  )

  const getAddonPrice = useCallback(
    (addon: QuoteAddon): number => {
      if (addon.key === "interior" && selectedTierPrice) {
        const item = selectedTierPrice.breakdown.find((b) => b.service === "Interior Window Cleaning")
        if (item) return item.price
        return tierPrices.better?.breakdown.find((b) => b.service === "Interior Window Cleaning")?.price ?? 0
      }
      if (addon.key === "track_detailing" && selectedTierPrice) {
        const item = selectedTierPrice.breakdown.find((b) => b.service === "Track Detailing")
        if (item) return item.price
        return tierPrices.best?.breakdown.find((b) => b.service === "Track Detailing")?.price ?? 0
      }
      if (addon.priceType === "per_unit") return addon.price * (addonQuantities[addon.key] || 1)
      return addon.price
    },
    [selectedTierPrice, addonQuantities, tierPrices]
  )

  const addonTotal = addons.reduce((sum, addon) => {
    if (!selectedAddons[addon.key]) return sum
    if (!useCustomPrice && isAddonIncluded(addon.key)) return sum
    return sum + getAddonPrice(addon)
  }, 0)

  const basePrice = useCustomPrice ? (parseFloat(customPrice) || 0) : (selectedTierPrice?.price ?? 0)
  const total = basePrice + addonTotal

  // ── Submit ─────────────────────────────────────────────────────────

  async function handleSubmit(action: "accepted" | "send_quote" | "collect_card" | "send_payment_link") {
    if (action === "collect_card" && !serviceDate) {
      setError("Pick a service date before booking")
      return
    }
    const uncheckedRequired = checklist.filter((i) => i.required && !i.completed)
    if (uncheckedRequired.length > 0) {
      if (!confirm(`${uncheckedRequired.length} required walkthrough items are not checked. Continue anyway?`)) return
    }
    setSubmitting(true)
    setError(null)
    try {
      const activeAddonKeys = Object.entries(selectedAddons).filter(([, v]) => v).map(([k]) => k)

      // Step 1: Create the quote via the existing POST
      // "collect_card" = accepted (job created now, card collected inline)
      // "send_payment_link" = send_quote (quote stays pending, customer opens link to save card)
      const baseAction = action === "collect_card" ? "accepted" : action === "send_payment_link" ? "send_quote" : action
      const res = await fetch(`/api/crew/${token}/estimate/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: baseAction,
          selected_tier: useCustomPrice ? null : selectedTierKey,
          selected_addons: activeAddonKeys,
          addon_quantities: addonQuantities,
          custom_price: useCustomPrice ? parseFloat(customPrice) || 0 : null,
          notes: notes || null,
          service_date: serviceDate || null,
          service_time: serviceTime || null,
          membership_plan: selectedPlan || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to complete estimate")

      // Step 2: Handle card capture
      if (action === "collect_card") {
        setCardCaptureMode('loading')
        const cardRes = await fetch(`/api/crew/${token}/estimate/${jobId}/card`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setup_intent" }),
        })
        const cardJson = await cardRes.json()
        if (!cardRes.ok) throw new Error(cardJson.error || "Failed to start card capture")

        // Load Stripe.js and mount Elements
        const stripeJs = await loadStripe(cardJson.publishable_key)
        if (!stripeJs) throw new Error("Failed to load Stripe")

        const elements = stripeJs.elements({ clientSecret: cardJson.client_secret })
        const cardEl = elements.create('payment')

        setCardCaptureMode('form')
        // Wait for the modal container to be in the DOM
        await new Promise(r => setTimeout(r, 100))
        const mountTarget = document.getElementById('stripe-card-element')
        if (mountTarget) {
          cardEl.mount('#stripe-card-element')
          // Store references for confirm
          ;(window as any).__stripeInstance = stripeJs
          ;(window as any).__stripeElements = elements
          ;(window as any).__stripeClientSecret = cardJson.client_secret
          ;(window as any).__completedData = { action: json.action, total: json.total, date: serviceDate || undefined }
        } else {
          throw new Error("Card form container not found")
        }
        setSubmitting(false)
        return
      } else if (action === "send_payment_link" && json.quote_token) {
        // Send the payment link via SMS
        await fetch(`/api/crew/${token}/estimate/${jobId}/card`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_link", quote_token: json.quote_token }),
        })
        setCompleted({ action: 'payment_link_sent', total: json.total, date: serviceDate || undefined })
        return
      }

      setCompleted({ action: json.action, total: json.total, date: serviceDate || undefined })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      setCardCaptureMode('idle')
      setSubmitting(false)
    }
  }

  async function confirmCardCapture() {
    setCardError(null)
    setSubmitting(true)
    try {
      const stripeJs = (window as any).__stripeInstance
      const elements = (window as any).__stripeElements
      const clientSecret = (window as any).__stripeClientSecret
      const completedData = (window as any).__completedData

      if (!stripeJs || !elements || !clientSecret) throw new Error("Card form not ready")

      const { error: stripeError } = await stripeJs.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      })

      if (stripeError) {
        setCardError(stripeError.message || "Card declined")
        setSubmitting(false)
        return
      }

      // Card saved successfully
      setCardCaptureMode('success')
      setCompleted(completedData || { action: 'accepted', total: 0 })

      // Cleanup
      delete (window as any).__stripeInstance
      delete (window as any).__stripeElements
      delete (window as any).__stripeClientSecret
      delete (window as any).__completedData
    } catch (err: unknown) {
      setCardError(err instanceof Error ? err.message : "Card save failed")
      setSubmitting(false)
    }
  }

  // ── Loading ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-slate-800">Not Found</h1>
          <p className="text-slate-500 mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  // ── Completed ──────────────────────────────────────────────────────

  if (completed) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm max-w-sm w-full p-6 text-center">
          <div className="size-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4 ring-4 ring-emerald-100">
            <CheckCircle className="size-8 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">
            {completed.action === "accepted" ? "Card Saved & Job Booked!" : completed.action === "payment_link_sent" ? "Payment Link Sent!" : "Quote Sent!"}
          </h2>
          <p className="text-slate-500 text-sm mb-1">
            {completed.action === "accepted"
              ? `Customer confirmed at ${fmt(completed.total)}${completed.date ? ` for ${formatDate(completed.date)}` : ""}. Cleaning job created.`
              : completed.action === "payment_link_sent"
              ? `Payment link for ${fmt(completed.total)} sent to customer. They'll save their card and the job will be created automatically.`
              : `Quote for ${fmt(completed.total)} sent to customer. They'll get a link to review and book.`}
          </p>
          <p className="text-slate-400 text-xs mb-5">The customer has been notified via SMS.</p>
          <button
            onClick={() => router.push(`/crew/${token}`)}
            className="w-full h-11 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all"
          >
            Back to My Jobs
          </button>
        </div>
      </div>
    )
  }

  const { job, customer, tenant } = data

  // ── Main ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 pb-44">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-4">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-blue-200 text-sm mb-2 active:opacity-70">
          <ArrowLeft className="size-4" /> Back
        </button>
        <p className="text-blue-200 text-xs">{tenant.name}</p>
        <h1 className="text-lg font-bold">Complete Estimate</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">

        {/* Customer & Job Info */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="space-y-2 text-sm">
            {customer.first_name && (
              <div className="flex items-center gap-2 text-slate-700">
                <User className="size-4 text-blue-400 shrink-0" />
                <span className="font-medium">{[customer.first_name, customer.last_name].filter(Boolean).join(" ")}</span>
              </div>
            )}
            {customer.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-blue-600">
                <Phone className="size-4 text-blue-400 shrink-0" />
                {customer.phone}
              </a>
            )}
            {(customer.address || job.address) && (
              <div className="flex items-center gap-2 text-slate-500">
                <MapPin className="size-4 text-blue-400 shrink-0" />
                <span className="truncate">{customer.address || job.address}</span>
              </div>
            )}
            <div className="flex items-center gap-4 text-slate-500">
              <span className="flex items-center gap-1">
                <Calendar className="size-4 text-blue-400" />
                {formatDate(job.date)}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-4 text-blue-400" />
                {formatTime(job.scheduled_at)}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
            <AlertCircle className="size-4 text-red-500 shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* Walkthrough Checklist */}
        {checklist.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="size-5 text-blue-600" />
                <h2 className="font-bold text-slate-800">Walkthrough Checklist</h2>
              </div>
              <span className="text-xs font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                {checklist.filter((i) => i.completed).length}/{checklist.length}
              </span>
            </div>
            <div className="space-y-1">
              {checklist.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleChecklistItem(item.id, !item.completed)}
                  className="flex items-center gap-3 w-full text-left py-1.5 px-1 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  {item.completed ? (
                    <CheckCircle className="size-5 text-green-500 shrink-0" />
                  ) : (
                    <Circle className={`size-5 shrink-0 ${item.required ? "text-amber-400" : "text-slate-300"}`} />
                  )}
                  <span className={`text-sm ${item.completed ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    {item.text}
                    {item.required && !item.completed && (
                      <span className="text-[10px] ml-1.5 text-amber-500 font-semibold uppercase">Required</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tier Selection */}
        <div>
          <h2 className="font-bold text-slate-800 mb-3">Select Package</h2>
          <div className="space-y-2">
            {tiers.map((tier, idx) => {
              const isSelected = !useCustomPrice && selectedTierKey === tier.key
              const price = tierPrices[tier.key]?.price ?? 0
              const colors = TIER_COLORS[idx] || TIER_COLORS[0]

              return (
                <button
                  key={tier.key}
                  type="button"
                  onClick={() => handleTierChange(tier.key)}
                  className={`
                    relative w-full text-left rounded-xl border-2 transition-all p-4
                    ${isSelected
                      ? `${colors.bg} ${colors.border} ring-2 ${colors.ring}`
                      : "bg-white border-slate-200 hover:border-blue-200"
                    }
                    active:scale-[0.99]
                  `}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 text-white ${isSelected ? colors.icon : "bg-slate-200 text-slate-400"}`}>
                        {TIER_ICONS[idx] ?? <Shield className="size-5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-slate-800 font-semibold text-sm">{tier.name}</h3>
                          {tier.badge && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{tier.badge}</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{tier.tagline}</p>
                      </div>
                    </div>
                    <span className="text-lg font-bold text-slate-800">{fmt(price)}</span>
                  </div>
                  {isSelected && (
                    <div className="absolute top-3 right-3">
                      <div className={`size-6 rounded-full flex items-center justify-center text-white ${colors.icon}`}>
                        <Check className="size-3.5" />
                      </div>
                    </div>
                  )}
                </button>
              )
            })}

            {/* Custom Price Toggle */}
            <button
              type="button"
              onClick={() => {
                setUseCustomPrice(!useCustomPrice)
                if (!useCustomPrice) setSelectedTierKey(null)
              }}
              className={`
                w-full text-left rounded-xl border-2 transition-all p-4
                ${useCustomPrice
                  ? "bg-amber-50 border-amber-400 ring-2 ring-amber-200"
                  : "bg-white border-dashed border-slate-300 hover:border-blue-200"
                }
                active:scale-[0.99]
              `}
            >
              <div className="flex items-center gap-3">
                <div className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${useCustomPrice ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-400"}`}>
                  <DollarSign className="size-5" />
                </div>
                <div>
                  <h3 className="text-slate-800 font-semibold text-sm">Custom Price</h3>
                  <p className="text-xs text-slate-400">Override with your own quote</p>
                </div>
              </div>
            </button>

            {useCustomPrice && (
              <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
                <label className="text-sm font-medium text-slate-700 mb-1 block">Enter price</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    className="w-full h-12 pl-8 pr-4 text-lg font-semibold rounded-lg border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Add-ons */}
        {addons.length > 0 && (
          <div>
            <h2 className="font-bold text-slate-800 mb-3">Add-ons</h2>
            <div className="space-y-2">
              {addons.map((addon) => {
                const checked = !!selectedAddons[addon.key]
                const included = !useCustomPrice && isAddonIncluded(addon.key)
                const addonPrice = getAddonPrice(addon)

                return (
                  <div key={addon.key}
                    className={`rounded-xl border-2 transition-all overflow-hidden ${
                      checked ? "border-blue-300 bg-blue-50/50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedAddons((prev) => ({ ...prev, [addon.key]: !prev[addon.key] }))}
                      className="w-full text-left p-3 flex items-center gap-3 active:bg-blue-50"
                    >
                      <div className={`size-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                        checked ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                      }`}>
                        {checked && <Check className="size-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-slate-800">{addon.name}</span>
                        {included && checked && (
                          <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">INCLUDED</span>
                        )}
                      </div>
                      <span className={`text-sm font-semibold shrink-0 ${included && checked ? "text-emerald-600" : "text-slate-600"}`}>
                        {included && checked ? "FREE" : addonPrice === 0 ? "FREE" : addon.priceType === "per_unit" ? `$${addon.price}/${addon.unit}` : fmt(addonPrice)}
                      </span>
                    </button>

                    {addon.priceType === "per_unit" && checked && !(included && !useCustomPrice) && (
                      <div className="px-3 pb-3 flex items-center gap-3">
                        <span className="text-xs text-slate-500">Qty:</span>
                        <div className="flex items-center gap-1">
                          <button type="button" className="h-7 w-7 rounded-md border border-slate-200 bg-white flex items-center justify-center active:bg-slate-50"
                            disabled={(addonQuantities[addon.key] || 1) <= 1}
                            onClick={() => setAddonQuantities((p) => ({ ...p, [addon.key]: Math.max(1, (p[addon.key] || 1) - 1) }))}
                          ><Minus className="size-3" /></button>
                          <input type="number" min={1} value={addonQuantities[addon.key] || 1}
                            onChange={(e) => setAddonQuantities((p) => ({ ...p, [addon.key]: Math.max(1, parseInt(e.target.value) || 1) }))}
                            className="w-12 h-7 text-center text-sm border border-slate-200 rounded-md"
                          />
                          <button type="button" className="h-7 w-7 rounded-md border border-slate-200 bg-white flex items-center justify-center active:bg-slate-50"
                            onClick={() => setAddonQuantities((p) => ({ ...p, [addon.key]: (p[addon.key] || 1) + 1 }))}
                          ><Plus className="size-3" /></button>
                        </div>
                        <span className="text-xs text-slate-400">= {fmt(addon.price * (addonQuantities[addon.key] || 1))}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Service Date & Time */}
        <div>
          <h2 className="font-bold text-slate-800 mb-1">Service Date</h2>
          <p className="text-xs text-slate-400 mb-3">Required if customer accepts. Dots show how busy each day is.</p>

          {/* Day picker grid */}
          <div className="grid grid-cols-7 gap-1.5 mb-3">
            {Array.from({ length: 14 }, (_, i) => {
              const d = new Date()
              d.setDate(d.getDate() + i)
              const dateStr = d.toISOString().split("T")[0]
              const dayName = d.toLocaleDateString("en-US", { weekday: "short" })
              const dayNum = d.getDate()
              const isSelected = serviceDate === dateStr
              const jobCount = data?.availability?.[dateStr] || 0
              const isBusy = jobCount >= 5
              const isMod = jobCount >= 3 && jobCount < 5

              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setServiceDate(isSelected ? "" : dateStr)}
                  className={`
                    flex flex-col items-center py-2 rounded-lg border-2 transition-all text-center active:scale-95
                    ${isSelected
                      ? "bg-blue-600 border-blue-600 text-white shadow-md"
                      : isBusy
                        ? "bg-red-50 border-red-200 text-slate-600"
                        : isMod
                          ? "bg-amber-50 border-amber-200 text-slate-600"
                          : "bg-white border-slate-200 text-slate-600 hover:border-blue-300"
                    }
                  `}
                >
                  <span className={`text-[10px] font-medium ${isSelected ? "text-blue-200" : "text-slate-400"}`}>{dayName}</span>
                  <span className={`text-sm font-bold ${isSelected ? "text-white" : ""}`}>{dayNum}</span>
                  {jobCount > 0 && (
                    <div className="flex gap-0.5 mt-0.5">
                      {Array.from({ length: Math.min(jobCount, 5) }, (_, j) => (
                        <div key={j} className={`size-1 rounded-full ${isSelected ? "bg-blue-300" : isBusy ? "bg-red-400" : isMod ? "bg-amber-400" : "bg-slate-300"}`} />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-4 text-[10px] text-slate-400 mb-3">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-slate-300" /> Available</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400" /> Moderate</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-400" /> Busy</span>
          </div>

          <div className="w-32">
            <label className="text-xs text-slate-500 mb-1 block">Time (optional)</label>
            <input
              type="time"
              value={serviceTime}
              onChange={(e) => setServiceTime(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
        </div>

        {/* Service Plans */}
        {data.servicePlans && data.servicePlans.length > 0 && (
          <div>
            <h2 className="font-bold text-slate-800 mb-1">Offer a Service Plan?</h2>
            <p className="text-xs text-slate-400 mb-3">Recurring plans give the customer a discount on every visit.</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  !selectedPlan ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"
                }`}
              >
                <span className="text-sm font-semibold text-slate-700">No plan (one-time service)</span>
              </button>
              {data.servicePlans.map((plan) => (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => setSelectedPlan(selectedPlan === plan.slug ? null : plan.slug)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    selectedPlan === plan.slug ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white hover:border-emerald-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tag className="size-4 text-emerald-500" />
                      <span className="text-sm font-semibold text-slate-700">{plan.name}</span>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">{fmt(plan.discount_amount)} off</span>
                  </div>
                  {plan.description && (
                    <p className="text-xs text-slate-500 mt-1 ml-6">{plan.description}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5 ml-6">Every {plan.interval_months} month{plan.interval_months > 1 ? 's' : ''}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <h2 className="font-bold text-slate-800 mb-2">Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about the property, special requests..."
            rows={3}
            className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>
      </div>

      {/* Card Capture Modal */}
      {cardCaptureMode === 'form' && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-end justify-center" onClick={() => { setCardCaptureMode('idle'); setSubmitting(false) }}>
          <div className="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Collect Card</h3>
            <p className="text-xs text-slate-500 mb-4">Enter the customer's card details below. Card will be saved for later charge.</p>
            <div id="stripe-card-element" className="border border-slate-200 rounded-xl p-4 min-h-[60px] mb-3" />
            {cardError && <p className="text-sm text-red-500 mb-3">{cardError}</p>}
            <button
              onClick={confirmCardCapture}
              disabled={submitting}
              className="w-full h-12 bg-emerald-600 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              Save Card
            </button>
          </div>
        </div>
      )}

      {/* Sticky Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t-2 border-slate-200 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50">
        <div className="max-w-lg mx-auto">
          {/* Total */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-xs text-slate-400">Total</span>
              <p className="text-2xl font-bold text-slate-800">{fmt(total)}</p>
            </div>
            {!useCustomPrice && selectedTier && (
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{selectedTier.name}</span>
            )}
            {useCustomPrice && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">Custom</span>
            )}
          </div>

          {/* Date indicator */}
          {serviceDate && (
            <div className="flex items-center gap-1.5 mb-2">
              <Calendar className="size-3.5 text-emerald-500" />
              <span className="text-xs text-emerald-600 font-medium">{formatDate(serviceDate)}{serviceTime ? ` at ${formatTime(serviceTime)}` : ""}</span>
            </div>
          )}

          {/* CTAs */}
          <div className="flex flex-col gap-2">
            {/* Primary row: Collect Card + Send Payment Link */}
            <div className="flex gap-2">
              <button
                disabled={submitting || total <= 0 || !serviceDate}
                onClick={() => handleSubmit("collect_card")}
                className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  submitting || total <= 0 || !serviceDate
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md"
                }`}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                Collect Card
              </button>
              <button
                disabled={submitting || total <= 0}
                onClick={() => handleSubmit("send_payment_link")}
                className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  submitting || total <= 0
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
                }`}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Send Link
              </button>
            </div>
            {/* Secondary row: Send Quote (no date required) */}
            <div className="flex gap-2">
              <button
                disabled={submitting || total <= 0}
                onClick={() => handleSubmit("send_quote")}
                className={`flex-1 h-10 rounded-xl font-medium text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                  submitting || total <= 0
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-white border-2 border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600"
                }`}
              >
                {submitting ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                Send Quote (customer decides later)
              </button>
            </div>
            {!serviceDate && total > 0 && (
              <p className="text-[10px] text-amber-500 text-center">Pick a service date above to enable card capture</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
