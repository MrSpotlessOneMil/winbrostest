"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Check,
  Loader2,
  Shield,
  Star,
  Crown,
  Sparkles,
  Plus,
  Minus,
  CheckCircle,
  Clock,
  Calendar,
  AlertTriangle,
  MapPin,
  Phone,
  User,
  FileText,
  CreditCard,
  ShieldCheck,
  Lock,
  Home,
  ChevronDown,
  ChevronUp,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────

interface QuoteTier { key: string; name: string; tagline: string; badge?: string; included: string[]; description: string }
interface QuoteAddon { key: string; name: string; description: string; priceType: "flat" | "per_unit"; price: number; unit?: string }
interface TierPrice { price: number; breakdown: { service: string; price: number }[]; tier: string }
interface ServicePlan { id: string; slug: string; name: string; visits_per_year: number; interval_months: number; discount_per_visit: number; free_addons: string[] | null; agreement_text: string | null }
interface ServiceAgreement { cancellation_fee: number; cancellation_window_hours: number; satisfaction_guarantee: boolean; deposit_percentage: number; processing_fee_percentage: number; terms: string[] }
interface Quote { id: string; token: string; status: "pending" | "approved" | "expired" | "cancelled"; customer_name: string | null; customer_phone: string | null; customer_email: string | null; customer_address: string | null; square_footage: number | null; bedrooms: number | null; bathrooms: number | null; selected_tier: string | null; selected_addons: string[]; subtotal: string | null; discount: string | null; total: string | null; membership_discount: string | null; membership_plan: string | null; deposit_amount: string | null; valid_until: string; approved_at: string | null; created_at: string }
interface APIResponse { success: boolean; quote: Quote; tierPrices: Record<string, TierPrice>; tiers: QuoteTier[]; addons: QuoteAddon[]; serviceType: "window_cleaning" | "house_cleaning"; servicePlans: ServicePlan[]; serviceAgreement: ServiceAgreement; custom_base_price: number | null; tenant: { name: string; slug: string; phone: string | null; email: string | null; brand_color?: string | null; brand_color_light?: string | null; logo_url?: string | null } }

// ── Helpers ──────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

const TIER_ICONS = [
  <Shield key="0" className="size-6" />,
  <Star key="1" className="size-6" />,
  <Crown key="2" className="size-6" />,
]

// Tier accent colors — clean, bright, professional
const TIER_COLORS = [
  { bg: "bg-sky-50", border: "border-sky-400", ring: "ring-sky-200", icon: "bg-sky-500", check: "text-sky-500", badge: "bg-sky-500" },
  { bg: "bg-blue-50", border: "border-blue-500", ring: "ring-blue-200", icon: "bg-blue-600", check: "text-blue-600", badge: "bg-blue-600" },
  { bg: "bg-indigo-50", border: "border-indigo-500", ring: "ring-indigo-200", icon: "bg-indigo-600", check: "text-indigo-600", badge: "bg-indigo-600" },
]

// ── Component ────────────────────────────────────────────────────────

export default function QuotePage() {
  const params = useParams()
  const token = params.token as string

  const [data, setData] = useState<APIResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedTierKey, setSelectedTierKey] = useState<string | null>(null)
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({})
  const [addonQuantities, setAddonQuantities] = useState<Record<string, number>>({})
  const [approving, setApproving] = useState(false)
  const [selectedMembership, setSelectedMembership] = useState<string | null>(null)
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [customerName, setCustomerName] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [showTerms, setShowTerms] = useState(false)
  const [serviceDate, setServiceDate] = useState("")

  // ── Fetch quote ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/quotes/${token}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Quote not found")
        setData(json)

        // Custom-priced quote (salesman-set price): use 'custom' tier, skip tier selection
        if (json.custom_base_price != null) {
          setSelectedTierKey('custom')
        } else {
          const tierKeys = (json.tiers as QuoteTier[]).map((t) => t.key)
          const middleIndex = Math.min(1, tierKeys.length - 1)
          const defaultTier = tierKeys[middleIndex] || tierKeys[0]
          setSelectedTierKey(defaultTier)

          // Pre-select included addons for default tier
          const defaultTierDef = (json.tiers as QuoteTier[]).find((t) => t.key === defaultTier)
          if (defaultTierDef) {
            const inc: Record<string, boolean> = {}
            defaultTierDef.included.forEach((k) => { inc[k] = true })
            setSelectedAddons(inc)
          }
        }

        if (json.quote.customer_name) setCustomerName(json.quote.customer_name)
        if (json.quote.customer_email) setCustomerEmail(json.quote.customer_email)
        if (json.quote.status === "approved") setSelectedTierKey(json.quote.selected_tier)

        const q: Record<string, number> = {}
        json.addons.forEach((a: QuoteAddon) => { if (a.priceType === "per_unit") q[a.key] = 1 })
        setAddonQuantities(q)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load quote")
      } finally {
        setLoading(false)
      }
    }
    if (token) fetchQuote()
  }, [token])

  // ── When tier changes, auto-select included addons ───────────────

  const handleTierChange = useCallback((tierKey: string) => {
    setSelectedTierKey(tierKey)
    if (!data) return
    const tierDef = data.tiers.find((t) => t.key === tierKey)
    if (!tierDef) return
    // Reset all add-ons: turn ON included ones, turn OFF everything else
    setSelectedAddons(() => {
      const next: Record<string, boolean> = {}
      tierDef.included.forEach((k) => { next[k] = true })
      return next
    })
  }, [data])

  // ── Computed values ──────────────────────────────────────────────

  const quote = data?.quote ?? null
  const tiers = data?.tiers ?? []
  const addons = data?.addons ?? []
  const tierPrices = data?.tierPrices ?? {}
  const servicePlans = data?.servicePlans ?? []
  const serviceAgreement = data?.serviceAgreement ?? null
  const tenant = data?.tenant ?? null
  const serviceType = data?.serviceType ?? "house_cleaning"
  const customBasePrice = data?.custom_base_price ?? null
  const isCustomPriced = customBasePrice != null
  const businessName = tenant?.name || "Our Team"

  const selectedTier = tiers.find((t) => t.key === selectedTierKey) ?? null
  const selectedTierPrice = selectedTierKey ? tierPrices[selectedTierKey] : null

  const isAddonIncluded = useCallback(
    (addonKey: string): boolean => !!selectedTier && selectedTier.included.includes(addonKey),
    [selectedTier]
  )

  const getAddonPrice = useCallback(
    (addon: QuoteAddon): number => {
      if (!selectedTierPrice) return 0
      if (addon.key === "interior") {
        const item = selectedTierPrice.breakdown.find((b) => b.service === "Interior Window Cleaning")
        if (item) return item.price
        return tierPrices.better?.breakdown.find((b) => b.service === "Interior Window Cleaning")?.price ?? 0
      }
      if (addon.key === "track_detailing") {
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
    if (isAddonIncluded(addon.key)) return sum
    return sum + getAddonPrice(addon)
  }, 0)

  const subtotal = isCustomPriced
    ? customBasePrice + addonTotal
    : selectedTierPrice
      ? selectedTierPrice.price + addonTotal
      : 0

  const selectedPlan = servicePlans.find((p) => p.slug === selectedMembership) ?? null
  const membershipDiscount = selectedPlan ? Number(selectedPlan.discount_per_visit) || 0 : 0
  const existingDiscount = Number(quote?.discount) || 0
  const total = Math.max(0, subtotal - existingDiscount - membershipDiscount)

  // ── Approve handler ──────────────────────────────────────────────

  async function handleApprove() {
    if (!selectedTierKey || !quote) return
    setApproving(true)
    try {
      const activeAddons = Object.entries(selectedAddons).filter(([, v]) => v).map(([key]) => key)
      const res = await fetch(`/api/quotes/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_tier: selectedTierKey,
          selected_addons: activeAddons,
          membership_plan: selectedPlan?.slug || null,
          customer_name: customerName || undefined,
          customer_email: customerEmail || undefined,
          service_date: serviceDate || undefined,
          service_agreement_accepted: true,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to process quote")
      if (json.checkout_url) {
        window.location.href = json.checkout_url
      } else {
        setError("Payment session could not be created. Please try again.")
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process quote")
      setApproving(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-blue-400" />
          <p className="text-slate-500 text-sm">Loading your quote...</p>
        </div>
      </div>
    )
  }

  if (error && !quote) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="bg-white border border-blue-100 rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
          <AlertTriangle className="size-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-800 mb-2">Quote Not Found</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!quote) return null

  const isExpired = quote.status === "expired"
  const isApproved = quote.status === "approved"
  const quoteNumber = token.slice(0, 8).toUpperCase()
  const canApprove = selectedTierKey && !approving && agreementAccepted && !isExpired
  const activeExtraAddons = addons.filter((a) => selectedAddons[a.key] && !isAddonIncluded(a.key)).length

  // ── Approved ─────────────────────────────────────────────────────

  if (isApproved) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="bg-white border border-blue-100 rounded-2xl shadow-sm max-w-lg w-full p-8 text-center">
          <div className="size-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-6 ring-4 ring-emerald-100">
            <CheckCircle className="size-10 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">You&apos;re All Set!</h2>
          <p className="text-slate-500 mb-6">Your card is on file and your cleaning is booked. We&apos;ll be in touch!</p>
          {tenant?.phone && (
            <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
              <Phone className="size-4" /> {tenant.phone}
            </a>
          )}
        </div>
      </div>
    )
  }

  // ── Main page ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white pb-36 sm:pb-8 text-slate-800" style={{ colorScheme: 'light' }}>
      {/* Clean gradient top bar */}
      <div className="h-1.5 bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500" />

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-6">

        {/* ── Header ───────────────────────────────────────────── */}
        <div className="bg-white border border-blue-100 rounded-2xl shadow-sm p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="size-12 sm:size-14 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shrink-0 shadow-md">
              {tenant?.logo_url ? (
                <img src={tenant.logo_url} alt={businessName} className="size-8 sm:size-10 object-contain" />
              ) : (
                <Sparkles className="size-6 sm:size-7 text-white" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-800 leading-tight">{businessName}</h1>
              <p className="text-sm text-slate-400 mt-0.5">Your Custom Quote</p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <FileText className="size-3.5" /> #{quoteNumber}
                </span>
                <StatusBadge status={quote.status} />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-blue-50 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {quote.customer_name && (
              <div className="flex items-center gap-2 text-slate-700">
                <User className="size-4 text-blue-300 shrink-0" /> {quote.customer_name}
              </div>
            )}
            {quote.customer_address && (
              <div className="flex items-center gap-2 text-slate-500">
                <MapPin className="size-4 text-blue-300 shrink-0" />
                <span className="truncate">{quote.customer_address}</span>
              </div>
            )}
            {quote.customer_phone && (
              <div className="flex items-center gap-2 text-slate-500">
                <Phone className="size-4 text-blue-300 shrink-0" /> {quote.customer_phone}
              </div>
            )}
            {serviceType === "house_cleaning" && (quote.bedrooms || quote.bathrooms) && (
              <div className="flex items-center gap-2 text-slate-500">
                <Home className="size-4 text-blue-300 shrink-0" /> {quote.bedrooms || 0} bed / {quote.bathrooms || 0} bath
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-slate-400 text-xs">
            <Clock className="size-3.5" /> Valid until {fmtDate(quote.valid_until)}
          </div>
        </div>

        {/* ── Banners ─────────────────────────────────────────── */}
        {isExpired && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-500 shrink-0" />
            <div>
              <p className="text-red-700 font-semibold text-sm">This quote has expired</p>
              <p className="text-red-400 text-xs">Contact us for an updated quote.</p>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-500 shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* ── Tier Selection (hidden for custom-priced quotes) ─ */}
        {isCustomPriced ? (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Your Custom Quote</h2>
            <p className="text-slate-400 text-sm mb-3">Prepared by our team after your on-site estimate.</p>
            <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-slate-800 font-bold text-lg">Base Service</h3>
                  <p className="text-slate-500 text-sm mt-1">Custom-quoted price</p>
                </div>
                <span className="text-2xl font-bold text-slate-800">{fmt(customBasePrice)}</span>
              </div>
            </div>
          </div>
        ) : (
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Choose Your Package</h2>
          <p className="text-slate-400 text-sm mb-5">Select the service level that fits your needs.</p>

          <div className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-4">
            {tiers.map((tier, idx) => {
              const isSelected = selectedTierKey === tier.key
              const price = tierPrices[tier.key]?.price ?? 0
              const breakdown = tierPrices[tier.key]?.breakdown ?? []
              const colors = TIER_COLORS[idx] || TIER_COLORS[0]

              return (
                <button
                  key={tier.key}
                  type="button"
                  disabled={isExpired}
                  onClick={() => handleTierChange(tier.key)}
                  className={`
                    relative w-full text-left rounded-2xl border-2 transition-all duration-200 p-5 flex flex-col
                    ${isSelected
                      ? `${colors.bg} ${colors.border} ring-2 ${colors.ring} shadow-lg`
                      : "bg-white border-blue-100 hover:border-blue-200 hover:shadow-md"
                    }
                    ${isExpired ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-[0.98]"}
                  `}
                >
                  {tier.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <span className={`${colors.badge} text-white text-xs font-bold px-4 py-1 rounded-full shadow-md whitespace-nowrap`}>
                        {tier.badge}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3">
                    <div className={`size-11 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm ${isSelected ? colors.icon : "bg-slate-200 text-slate-400"}`}>
                      {TIER_ICONS[idx] ?? <Shield className="size-6" />}
                    </div>
                    <div>
                      <h3 className="text-slate-800 font-bold text-base sm:text-lg">{tier.name}</h3>
                      <p className="text-slate-400 text-xs">{tier.tagline}</p>
                    </div>
                  </div>

                  {tier.description && (
                    <p className="text-slate-400 text-xs leading-relaxed mb-3">{tier.description}</p>
                  )}

                  <div className="flex-1 space-y-1.5 mb-4">
                    {breakdown.map((item) => (
                      <div key={item.service} className="flex items-start gap-2">
                        <Check className={`size-4 shrink-0 mt-0.5 ${isSelected ? colors.check : "text-slate-300"}`} />
                        <span className="text-sm text-slate-600">{item.service}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-blue-50 pt-3 mt-auto">
                    <span className="text-2xl font-bold text-slate-800">{fmt(price)}</span>
                  </div>

                  {isSelected && (
                    <div className="absolute top-4 right-4">
                      <div className={`size-7 rounded-full flex items-center justify-center text-white shadow-md ${colors.icon}`}>
                        <Check className="size-4" />
                      </div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        )}

        {/* ── Add-ons ─────────────────────────────────────────── */}
        {addons.length > 0 && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Customize Your Clean</h2>
            <p className="text-slate-400 text-sm mb-5">Tap to add or remove. Build your perfect package.</p>

            <div className="space-y-2">
              {addons.map((addon) => {
                const checked = !!selectedAddons[addon.key]
                const included = isAddonIncluded(addon.key)
                const addonPrice = getAddonPrice(addon)

                return (
                  <div key={addon.key}
                    className={`rounded-xl border-2 transition-all duration-150 overflow-hidden ${
                      checked ? "border-blue-300 bg-blue-50/50" : "border-blue-100 bg-white hover:border-blue-200"
                    } ${isExpired ? "opacity-50" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={isExpired}
                      onClick={() => {
                        if (isExpired) return
                        setSelectedAddons((prev) => ({ ...prev, [addon.key]: !prev[addon.key] }))
                      }}
                      className="w-full text-left p-4 flex items-center gap-3 cursor-pointer active:bg-blue-50"
                    >
                      <div className={`size-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                        checked ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                      }`}>
                        {checked && <Check className="size-4" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{addon.name}</span>
                          {included && checked && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">INCLUDED</span>
                          )}
                        </div>
                        {addon.description && <p className="text-xs text-slate-400 mt-0.5">{addon.description}</p>}
                      </div>

                      <span className={`text-sm font-bold shrink-0 ${included && checked ? "text-emerald-600" : "text-slate-700"}`}>
                        {included && checked ? "FREE" : addonPrice === 0 ? "FREE" : addon.priceType === "per_unit" ? `${fmt(addon.price)}/${addon.unit || "ea"}` : fmt(addonPrice)}
                      </span>
                    </button>

                    {addon.priceType === "per_unit" && checked && !included && (
                      <div className="px-4 pb-4 flex items-center gap-3">
                        <span className="text-xs text-slate-500">Qty:</span>
                        <div className="flex items-center gap-1">
                          <button type="button" className="h-8 w-8 rounded-lg border border-blue-100 bg-white flex items-center justify-center active:bg-blue-50"
                            disabled={isExpired || (addonQuantities[addon.key] || 1) <= 1}
                            onClick={() => setAddonQuantities((p) => ({ ...p, [addon.key]: Math.max(1, (p[addon.key] || 1) - 1) }))}
                          ><Minus className="size-3.5" /></button>
                          <Input type="number" min={1} value={addonQuantities[addon.key] || 1}
                            onChange={(e) => setAddonQuantities((p) => ({ ...p, [addon.key]: Math.max(1, parseInt(e.target.value) || 1) }))}
                            className="w-14 h-8 text-center text-sm border-blue-100" disabled={isExpired}
                          />
                          <button type="button" className="h-8 w-8 rounded-lg border border-blue-100 bg-white flex items-center justify-center active:bg-blue-50"
                            disabled={isExpired}
                            onClick={() => setAddonQuantities((p) => ({ ...p, [addon.key]: (p[addon.key] || 1) + 1 }))}
                          ><Plus className="size-3.5" /></button>
                        </div>
                        <span className="text-xs text-slate-500">= {fmt(addon.price * (addonQuantities[addon.key] || 1))}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Membership Plans ────────────────────────────────── */}
        {!isExpired && servicePlans.length > 0 && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Save with a Membership</h2>
            <p className="text-slate-400 text-sm mb-5">Regular service = bigger savings every visit.</p>

            <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-3">
              <button type="button" onClick={() => setSelectedMembership(null)}
                className={`relative w-full text-left rounded-xl border-2 p-4 transition-all cursor-pointer active:scale-[0.98] ${
                  selectedMembership === null ? "border-slate-400 bg-slate-50 shadow-sm" : "border-blue-100 bg-white hover:border-blue-200"
                }`}
              >
                <h3 className="text-slate-800 font-semibold text-sm">No Membership</h3>
                <p className="text-slate-400 text-xs mt-1">One-time service, no commitment</p>
                {selectedMembership === null && (
                  <div className="absolute top-3 right-3 size-6 rounded-full bg-slate-500 flex items-center justify-center">
                    <Check className="size-3 text-white" />
                  </div>
                )}
              </button>

              {servicePlans.map((plan) => {
                const isSelected = selectedMembership === plan.slug
                const freeAddons = plan.free_addons || []
                return (
                  <button key={plan.slug} type="button" onClick={() => setSelectedMembership(plan.slug)}
                    className={`relative w-full text-left rounded-xl border-2 p-4 transition-all cursor-pointer active:scale-[0.98] ${
                      isSelected ? "border-emerald-400 bg-emerald-50 shadow-sm" : "border-blue-100 bg-white hover:border-blue-200"
                    }`}
                  >
                    <h3 className="text-slate-800 font-semibold text-sm">{plan.name}</h3>
                    <p className="text-slate-400 text-xs mt-1">{plan.visits_per_year} visits/yr &middot; Every {plan.interval_months}mo</p>
                    <p className="text-emerald-600 font-bold text-sm mt-2">Save {fmt(Number(plan.discount_per_visit))}/visit</p>
                    {freeAddons.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {freeAddons.map((perk) => (
                          <div key={perk} className="flex items-center gap-1.5">
                            <Check className="size-3 text-emerald-500 shrink-0" />
                            <span className="text-slate-500 text-xs">{perk}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-3 right-3 size-6 rounded-full bg-emerald-500 flex items-center justify-center">
                        <Check className="size-3 text-white" />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Preferred Service Date ─────────────────────────── */}
        {!isExpired && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <Calendar className="size-5 text-blue-500" />
              Preferred Service Date
            </h2>
            <p className="text-slate-400 text-sm mb-4">Pick a date that works best for you.</p>

            <div className={`border-2 rounded-2xl p-4 transition-all ${serviceDate ? "border-blue-300 bg-blue-50/50" : "border-blue-100 bg-white"}`}>
              <input
                type="date"
                value={serviceDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setServiceDate(e.target.value)}
                className="w-full h-12 px-4 rounded-xl border border-blue-200 bg-white text-slate-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
              />
              {serviceDate && (
                <p className="mt-2 text-sm text-blue-600 font-medium flex items-center gap-1.5">
                  <CheckCircle className="size-4" />
                  {new Date(serviceDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </p>
              )}
              {!serviceDate && (
                <p className="mt-2 text-xs text-slate-400">Optional — we&apos;ll contact you to schedule if you skip this.</p>
              )}
            </div>
          </div>
        )}

        {/* ── Service Agreement ───────────────────────────────── */}
        {!isExpired && serviceAgreement && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-500" />
              Service Agreement
            </h2>

            <div className={`border-2 rounded-2xl overflow-hidden transition-all ${agreementAccepted ? "border-emerald-400" : "border-blue-100"}`}>
              {/* Expandable terms */}
              <button type="button" onClick={() => setShowTerms(!showTerms)}
                className="w-full flex items-center justify-between p-4 text-left bg-white active:bg-blue-50/50"
              >
                <span className="text-sm text-slate-600 font-medium">View Terms &amp; Conditions</span>
                {showTerms ? <ChevronUp className="size-5 text-slate-400" /> : <ChevronDown className="size-5 text-slate-400" />}
              </button>

              {showTerms && (
                <div className="px-4 pb-4 space-y-3 bg-white border-t border-blue-50">
                  {serviceAgreement.terms.map((term, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="size-6 rounded-full bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-blue-500 text-xs font-bold">{i + 1}</span>
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{term}</p>
                    </div>
                  ))}
                  {serviceAgreement.satisfaction_guarantee && (
                    <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <ShieldCheck className="size-5 text-emerald-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-emerald-700 font-semibold text-sm">100% Satisfaction Guarantee</p>
                        <p className="text-emerald-600 text-xs mt-1">Not happy? We&apos;ll come back and make it right — free.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Big accept bar */}
              <button
                type="button"
                onClick={() => setAgreementAccepted(!agreementAccepted)}
                className={`w-full border-t-2 px-4 py-5 flex items-center gap-4 transition-all active:opacity-80 ${
                  agreementAccepted ? "bg-emerald-50 border-emerald-300" : "bg-amber-50/70 border-amber-200"
                }`}
              >
                <div className={`size-9 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                  agreementAccepted ? "bg-emerald-500 border-emerald-500" : "bg-white border-slate-300"
                }`}>
                  {agreementAccepted && <Check className="size-5 text-white" />}
                </div>
                <div className="text-left">
                  <p className={`font-bold text-sm ${agreementAccepted ? "text-emerald-700" : "text-slate-800"}`}>
                    {agreementAccepted ? "Service Agreement Accepted" : "Tap to Accept Service Agreement"}
                  </p>
                  <p className={`text-xs mt-0.5 ${agreementAccepted ? "text-emerald-600" : "text-amber-600"}`}>
                    {agreementAccepted ? "You've agreed to the terms above." : "Required before booking."}
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── Price Summary ───────────────────────────────────── */}
        <div className="bg-white border-2 border-blue-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-blue-50 bg-blue-50/50">
            <h3 className="font-bold text-slate-800">Price Summary</h3>
          </div>
          <div className="p-5 space-y-2.5">
            {isCustomPriced ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Base Service</span>
                <span className="text-slate-800 font-semibold">{fmt(customBasePrice)}</span>
              </div>
            ) : selectedTier && selectedTierPrice ? (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">{selectedTier.name}</span>
                <span className="text-slate-800 font-semibold">{fmt(selectedTierPrice.price)}</span>
              </div>
            ) : null}

            {addons.filter((a) => selectedAddons[a.key] && !isAddonIncluded(a.key)).map((addon) => (
              <div key={addon.key} className="flex justify-between text-sm">
                <span className="text-slate-500">+ {addon.name}{addon.priceType === "per_unit" && (addonQuantities[addon.key] || 1) > 1 ? ` x${addonQuantities[addon.key]}` : ""}</span>
                <span className="text-slate-700">{fmt(getAddonPrice(addon))}</span>
              </div>
            ))}

            {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key)).map((addon) => (
              <div key={addon.key} className="flex justify-between text-sm">
                <span className="text-slate-400">{addon.name}</span>
                <span className="text-emerald-500 text-xs font-medium">Included</span>
              </div>
            ))}

            <div className="border-t border-blue-50 my-1" />

            {(existingDiscount > 0 || membershipDiscount > 0) && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal</span>
                  <span className="text-slate-600">{fmt(subtotal)}</span>
                </div>
                {existingDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600">Discount</span>
                    <span className="text-emerald-600">-{fmt(existingDiscount)}</span>
                  </div>
                )}
                {membershipDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600">Membership ({selectedPlan?.name})</span>
                    <span className="text-emerald-600">-{fmt(membershipDiscount)}</span>
                  </div>
                )}
              </>
            )}

            <div className="border-t-2 border-blue-100 pt-3">
              <div className="flex justify-between items-baseline">
                <span className="text-slate-800 font-bold text-lg">Total</span>
                <span className="text-slate-800 font-bold text-3xl">{fmt(total)}</span>
              </div>
              <p className="text-slate-400 text-xs mt-2">
                {selectedPlan
                  ? `Charged after each visit · Every ${selectedPlan.interval_months} month${selectedPlan.interval_months !== 1 ? 's' : ''} · ${selectedPlan.visits_per_year} visit${selectedPlan.visits_per_year !== 1 ? 's' : ''}/year`
                  : "Your card will be saved on file. Charged after service is complete."}
              </p>
            </div>
          </div>
        </div>

        {/* ── Desktop CTA ─────────────────────────────────────── */}
        <div className="hidden sm:flex flex-col items-center gap-3 pb-8">
          <button
            disabled={!canApprove}
            onClick={handleApprove}
            className={`w-full sm:max-w-md h-14 rounded-xl text-white font-bold text-base shadow-lg transition-all flex items-center justify-center gap-2 ${
              canApprove
                ? "bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 hover:shadow-xl active:scale-[0.98]"
                : "bg-slate-300 cursor-not-allowed"
            }`}
          >
            {approving ? <><Loader2 className="size-5 animate-spin" /> Processing...</> : <><CreditCard className="size-5" /> Save Card &amp; Book — {fmt(total)}</>}
          </button>
          {!agreementAccepted && (
            <p className="text-amber-600 text-sm font-medium flex items-center gap-1.5">
              <AlertTriangle className="size-4" /> Accept the service agreement to continue
            </p>
          )}
          <p className="flex items-center gap-1.5 text-slate-400 text-xs"><Lock className="size-3" /> Secure payment powered by Stripe</p>
        </div>

        <div className="text-center pb-4 sm:pb-8">
          <p className="text-slate-300 text-xs">Powered by {businessName}</p>
        </div>
      </div>

      {/* ── Mobile Sticky Bottom Bar ──────────────────────────── */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t-2 border-blue-100 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] z-50">
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className="text-xs text-slate-400">Total</span>
            <p className="text-xl font-bold text-slate-800">{fmt(total)}</p>
          </div>
          {activeExtraAddons > 0 && (
            <span className="text-xs text-slate-400 bg-blue-50 px-2 py-1 rounded-full">{activeExtraAddons} add-on{activeExtraAddons !== 1 ? "s" : ""}</span>
          )}
        </div>
        <button
          disabled={!canApprove}
          onClick={handleApprove}
          className={`w-full h-[52px] rounded-xl text-white font-bold text-base transition-all flex items-center justify-center gap-2 ${
            canApprove
              ? "bg-gradient-to-r from-sky-500 to-blue-600 shadow-lg active:scale-[0.98]"
              : "bg-slate-300 cursor-not-allowed"
          }`}
        >
          {approving ? <><Loader2 className="size-5 animate-spin" /> Processing...</> : <><CreditCard className="size-5" /> Save Card &amp; Book</>}
        </button>
        <p className="text-center text-slate-400 text-[10px] mt-1.5 flex items-center justify-center gap-1"><Lock className="size-2.5" /> Secure payment by Stripe</p>
      </div>
    </div>
  )
}

// ── Status Badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Quote["status"] }) {
  const cfg: Record<string, { style: string; icon: React.ReactNode; label: string }> = {
    pending: { style: "bg-amber-100 text-amber-700 border-amber-200", icon: <Clock className="size-3" />, label: "Awaiting Response" },
    approved: { style: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle className="size-3" />, label: "Approved" },
    expired: { style: "bg-red-100 text-red-700 border-red-200", icon: <AlertTriangle className="size-3" />, label: "Expired" },
  }
  const c = cfg[status]
  if (!c) return null
  return (
    <span className={`inline-flex items-center gap-1 ${c.style} border text-xs font-medium px-2.5 py-0.5 rounded-full`}>
      {c.icon} {c.label}
    </span>
  )
}
