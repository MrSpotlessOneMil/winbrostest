"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
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
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────

interface QuoteTier { key: string; name: string; tagline: string; badge?: string; included: string[]; description: string }
interface QuoteAddon { key: string; name: string; description: string; priceType: "flat" | "per_unit"; price: number; unit?: string }
interface TierPrice { price: number; breakdown: { service: string; price: number }[]; tier: string }

interface EstimateData {
  job: { id: number; date: string; scheduled_at: string | null; address: string | null; service_type: string | null; job_type: string | null; sqft: number | null; notes: string | null }
  customer: { id: number | null; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; address: string | null }
  pricing: { tiers: QuoteTier[]; tierPrices: Record<string, TierPrice>; addons: QuoteAddon[]; serviceType: string }
  tenant: { name: string; slug: string }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
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
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token, jobId])

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

  async function handleSubmit(action: "accepted" | "send_quote") {
    if (action === "accepted" && !serviceDate) {
      setError("Pick a service date before booking")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const activeAddonKeys = Object.entries(selectedAddons).filter(([, v]) => v).map(([k]) => k)
      const res = await fetch(`/api/crew/${token}/estimate/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          selected_tier: useCustomPrice ? null : selectedTierKey,
          selected_addons: activeAddonKeys,
          addon_quantities: addonQuantities,
          custom_price: useCustomPrice ? parseFloat(customPrice) || 0 : null,
          notes: notes || null,
          service_date: serviceDate || null,
          service_time: serviceTime || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to complete estimate")
      setCompleted({ action: json.action, total: json.total, date: serviceDate || undefined })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong")
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
            {completed.action === "accepted" ? "Job Booked!" : "Quote Sent!"}
          </h2>
          <p className="text-slate-500 text-sm mb-1">
            {completed.action === "accepted"
              ? `Customer confirmed at ${fmt(completed.total)}${completed.date ? ` for ${formatDate(completed.date)}` : ""}. Cleaning job created.`
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
          <p className="text-xs text-slate-400 mb-3">Required if customer accepts. When should the crew come?</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">Date</label>
              <input
                type="date"
                value={serviceDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setServiceDate(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
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
        </div>

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

          {/* Two CTAs */}
          <div className="flex gap-2">
            <button
              disabled={submitting || total <= 0}
              onClick={() => handleSubmit("send_quote")}
              className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                submitting || total <= 0
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-white border-2 border-blue-500 text-blue-600 hover:bg-blue-50"
              }`}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send Quote
            </button>
            <button
              disabled={submitting || total <= 0}
              onClick={() => handleSubmit("accepted")}
              className={`flex-1 h-12 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                submitting || total <= 0
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                  : !serviceDate
                    ? "bg-blue-400 text-white hover:bg-blue-500 shadow-md"
                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-md"
              }`}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
              {!serviceDate ? "Pick Date First" : "Customer Accepted"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
