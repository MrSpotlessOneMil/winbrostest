"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  AlertTriangle,
  MapPin,
  Phone,
  User,
  FileText,
  CreditCard,
  ShieldCheck,
  Lock,
  Home,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────

interface QuoteTier {
  key: string
  name: string
  tagline: string
  badge?: string
  included: string[]
  description: string
}

interface QuoteAddon {
  key: string
  name: string
  description: string
  priceType: "flat" | "per_unit"
  price: number
  unit?: string
}

interface TierPrice {
  price: number
  breakdown: { service: string; price: number }[]
  tier: string
}

interface ServicePlan {
  id: string
  slug: string
  name: string
  visits_per_year: number
  interval_months: number
  discount_per_visit: number
  early_cancel_repay: number | null
  free_addons: string[] | null
  agreement_text: string | null
}

interface ServiceAgreement {
  cancellation_fee: number
  cancellation_window_hours: number
  satisfaction_guarantee: boolean
  deposit_percentage: number
  processing_fee_percentage: number
  terms: string[]
}

interface Quote {
  id: string
  token: string
  status: "pending" | "approved" | "expired" | "cancelled"
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  square_footage: number | null
  bedrooms: number | null
  bathrooms: number | null
  selected_tier: string | null
  selected_addons: string[]
  subtotal: string | null
  discount: string | null
  total: string | null
  membership_discount: string | null
  membership_plan: string | null
  deposit_amount: string | null
  valid_until: string
  approved_at: string | null
  created_at: string
}

interface APIResponse {
  success: boolean
  quote: Quote
  tierPrices: Record<string, TierPrice>
  tiers: QuoteTier[]
  addons: QuoteAddon[]
  serviceType: "window_cleaning" | "house_cleaning"
  servicePlans: ServicePlan[]
  serviceAgreement: ServiceAgreement
  tenant: {
    name: string
    slug: string
    phone: string | null
    email: string | null
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

// ── Theme Definitions ────────────────────────────────────────────────

type ThemeKey = "1" | "2" | "3"

const THEMES: Record<ThemeKey, {
  name: string
  bg: string
  cardBg: string
  cardBorder: string
  headerBg: string
  accent: string
  accentLight: string
  accentBtn: string
  accentBtnHover: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  tierSelected: (idx: number) => string
  tierUnselected: string
  tierRing: (idx: number) => string
  addonChecked: string
  addonUnchecked: string
  agreementBg: string
  agreementBorder: string
  agreementCheckedBg: string
  summaryBg: string
  summaryBorder: string
  topBar: string
}> = {
  // Theme 1: Clean & Airy — white bg, soft blue accents
  "1": {
    name: "Clean & Airy",
    bg: "bg-slate-50",
    cardBg: "bg-white",
    cardBorder: "border-slate-200",
    headerBg: "bg-white",
    accent: "text-blue-600",
    accentLight: "text-blue-500",
    accentBtn: "bg-blue-600 hover:bg-blue-700",
    accentBtnHover: "hover:bg-blue-700",
    textPrimary: "text-slate-900",
    textSecondary: "text-slate-600",
    textMuted: "text-slate-400",
    tierSelected: (i) => ["bg-blue-50 border-blue-300 ring-2 ring-blue-200", "bg-violet-50 border-violet-300 ring-2 ring-violet-200", "bg-amber-50 border-amber-300 ring-2 ring-amber-200"][i] || "bg-blue-50 border-blue-300 ring-2 ring-blue-200",
    tierUnselected: "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md",
    tierRing: (i) => ["text-blue-600", "text-violet-600", "text-amber-600"][i] || "text-blue-600",
    addonChecked: "bg-blue-50 border-blue-200",
    addonUnchecked: "bg-white border-slate-200 hover:border-slate-300",
    agreementBg: "bg-white",
    agreementBorder: "border-slate-200",
    agreementCheckedBg: "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200",
    summaryBg: "bg-white",
    summaryBorder: "border-slate-200",
    topBar: "bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-600",
  },
  // Theme 2: Warm & Friendly — cream tones, teal accents
  "2": {
    name: "Warm & Friendly",
    bg: "bg-amber-50/40",
    cardBg: "bg-white",
    cardBorder: "border-orange-100",
    headerBg: "bg-white",
    accent: "text-teal-600",
    accentLight: "text-teal-500",
    accentBtn: "bg-teal-600 hover:bg-teal-700",
    accentBtnHover: "hover:bg-teal-700",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-600",
    textMuted: "text-stone-400",
    tierSelected: (i) => ["bg-teal-50 border-teal-300 ring-2 ring-teal-200", "bg-orange-50 border-orange-300 ring-2 ring-orange-200", "bg-rose-50 border-rose-300 ring-2 ring-rose-200"][i] || "bg-teal-50 border-teal-300 ring-2 ring-teal-200",
    tierUnselected: "bg-white border-orange-100 hover:border-orange-200 hover:shadow-md",
    tierRing: (i) => ["text-teal-600", "text-orange-600", "text-rose-600"][i] || "text-teal-600",
    addonChecked: "bg-teal-50 border-teal-200",
    addonUnchecked: "bg-white border-orange-100 hover:border-orange-200",
    agreementBg: "bg-white",
    agreementBorder: "border-orange-100",
    agreementCheckedBg: "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200",
    summaryBg: "bg-white",
    summaryBorder: "border-orange-100",
    topBar: "bg-gradient-to-r from-teal-500 via-emerald-500 to-teal-600",
  },
  // Theme 3: Bold & Modern — light gray, vivid gradient cards
  "3": {
    name: "Bold & Modern",
    bg: "bg-gray-50",
    cardBg: "bg-white",
    cardBorder: "border-gray-200",
    headerBg: "bg-white",
    accent: "text-purple-600",
    accentLight: "text-purple-500",
    accentBtn: "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700",
    accentBtnHover: "",
    textPrimary: "text-gray-900",
    textSecondary: "text-gray-600",
    textMuted: "text-gray-400",
    tierSelected: (i) => ["bg-purple-50 border-purple-300 ring-2 ring-purple-200 shadow-lg shadow-purple-100", "bg-pink-50 border-pink-300 ring-2 ring-pink-200 shadow-lg shadow-pink-100", "bg-amber-50 border-amber-300 ring-2 ring-amber-200 shadow-lg shadow-amber-100"][i] || "bg-purple-50 border-purple-300 ring-2 ring-purple-200",
    tierUnselected: "bg-white border-gray-200 hover:border-gray-300 hover:shadow-lg",
    tierRing: (i) => ["text-purple-600", "text-pink-600", "text-amber-600"][i] || "text-purple-600",
    addonChecked: "bg-purple-50 border-purple-200",
    addonUnchecked: "bg-white border-gray-200 hover:border-gray-300",
    agreementBg: "bg-white",
    agreementBorder: "border-gray-200",
    agreementCheckedBg: "bg-emerald-50 border-emerald-300 ring-2 ring-emerald-200",
    summaryBg: "bg-white",
    summaryBorder: "border-gray-200",
    topBar: "bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500",
  },
}

const TIER_ICONS = [
  <Shield key="s" className="size-6" />,
  <Star key="st" className="size-6" />,
  <Crown key="c" className="size-6" />,
]

// ── Component ────────────────────────────────────────────────────────

export default function QuotePage() {
  const params = useParams()
  const searchParams = useSearchParams()
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
  const [themeKey, setThemeKey] = useState<ThemeKey>((searchParams.get("v") as ThemeKey) || "1")

  const t = THEMES[themeKey]

  // ── Fetch quote ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/quotes/${token}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Quote not found")
        setData(json)

        const tierKeys = (json.tiers as QuoteTier[]).map((t) => t.key)
        const middleIndex = Math.min(1, tierKeys.length - 1)
        setSelectedTierKey(tierKeys[middleIndex] || tierKeys[0])

        if (json.quote.customer_name) setCustomerName(json.quote.customer_name)
        if (json.quote.customer_email) setCustomerEmail(json.quote.customer_email)

        if (json.quote.status === "approved") {
          setSelectedTierKey(json.quote.selected_tier)
        }

        const quantities: Record<string, number> = {}
        json.addons.forEach((addon: QuoteAddon) => {
          if (addon.priceType === "per_unit") quantities[addon.key] = 1
        })
        setAddonQuantities(quantities)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load quote")
      } finally {
        setLoading(false)
      }
    }
    if (token) fetchQuote()
  }, [token])

  // ── Computed values ──────────────────────────────────────────────

  const quote = data?.quote ?? null
  const tiers = data?.tiers ?? []
  const addons = data?.addons ?? []
  const tierPrices = data?.tierPrices ?? {}
  const servicePlans = data?.servicePlans ?? []
  const serviceAgreement = data?.serviceAgreement ?? null
  const tenant = data?.tenant ?? null
  const serviceType = data?.serviceType ?? "house_cleaning"

  const businessName = tenant?.name || "Our Team"

  const selectedTier = tiers.find((t) => t.key === selectedTierKey) ?? null
  const selectedTierPrice = selectedTierKey ? tierPrices[selectedTierKey] : null

  const getAddonPrice = useCallback(
    (addon: QuoteAddon): number => {
      if (!selectedTierPrice) return 0
      if (addon.key === "interior" && selectedTierPrice) {
        const interiorItem = selectedTierPrice.breakdown.find((b) => b.service === "Interior Window Cleaning")
        if (interiorItem) return interiorItem.price
        const betterPrice = tierPrices.better?.breakdown.find((b) => b.service === "Interior Window Cleaning")
        return betterPrice?.price ?? 0
      }
      if (addon.key === "track_detailing" && selectedTierPrice) {
        const trackItem = selectedTierPrice.breakdown.find((b) => b.service === "Track Detailing")
        if (trackItem) return trackItem.price
        const bestPrice = tierPrices.best?.breakdown.find((b) => b.service === "Track Detailing")
        return bestPrice?.price ?? 0
      }
      if (addon.priceType === "per_unit") {
        return addon.price * (addonQuantities[addon.key] || 1)
      }
      return addon.price
    },
    [selectedTierPrice, addonQuantities, tierPrices]
  )

  const subtotal = selectedTierPrice
    ? selectedTierPrice.price +
      addons.reduce((sum, addon) => {
        if (selectedAddons[addon.key]) return sum + getAddonPrice(addon)
        return sum
      }, 0)
    : 0

  const selectedPlan = servicePlans.find((p) => p.slug === selectedMembership) ?? null
  const membershipDiscount = selectedPlan ? Number(selectedPlan.discount_per_visit) || 0 : 0
  const existingDiscount = Number(quote?.discount) || 0
  const discountAmount = existingDiscount + membershipDiscount
  const total = Math.max(0, subtotal - discountAmount)

  // ── Approve handler ──────────────────────────────────────────────

  async function handleApprove() {
    if (!selectedTierKey || !quote) return
    setApproving(true)
    try {
      const activeAddons = Object.entries(selectedAddons)
        .filter(([, v]) => v)
        .map(([key]) => key)

      const res = await fetch(`/api/quotes/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_tier: selectedTierKey,
          selected_addons: activeAddons,
          membership_plan: selectedPlan?.slug || null,
          customer_name: customerName || undefined,
          customer_email: customerEmail || undefined,
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
      <div className={`min-h-screen ${t.bg} flex items-center justify-center`}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className={`size-8 animate-spin ${t.accent}`} />
          <p className={`${t.textSecondary} text-sm`}>Loading your quote...</p>
        </div>
      </div>
    )
  }

  if (error && !quote) {
    return (
      <div className={`min-h-screen ${t.bg} flex items-center justify-center px-4`}>
        <div className={`${t.cardBg} border ${t.cardBorder} rounded-2xl shadow-lg max-w-md w-full p-8`}>
          <div className="flex flex-col items-center gap-4">
            <AlertTriangle className="size-12 text-red-500" />
            <h2 className={`text-lg font-semibold ${t.textPrimary}`}>Quote Not Found</h2>
            <p className={`${t.textSecondary} text-sm text-center`}>{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!quote) return null

  const isExpired = quote.status === "expired"
  const isApproved = quote.status === "approved"
  const quoteNumber = token.slice(0, 8).toUpperCase()
  const tierGridCols = tiers.length <= 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4"

  const canApprove = selectedTierKey && !approving && agreementAccepted && !isExpired

  // ── Approved state ───────────────────────────────────────────────

  if (isApproved) {
    return (
      <div className={`min-h-screen ${t.bg} flex items-center justify-center px-4`}>
        <div className={`${t.cardBg} border ${t.cardBorder} rounded-2xl shadow-lg max-w-lg w-full p-8`}>
          <div className="flex flex-col items-center gap-6">
            <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="size-10 text-emerald-600" />
            </div>
            <div className="text-center space-y-2">
              <h2 className={`text-2xl font-bold ${t.textPrimary}`}>You&apos;re All Set!</h2>
              <p className={t.textSecondary}>
                Your card is on file and your cleaning is booked. We&apos;ll be in touch with scheduling details!
              </p>
            </div>
            {tenant?.phone && (
              <a href={`tel:${tenant.phone}`} className={`flex items-center gap-2 ${t.textSecondary} hover:${t.textPrimary} text-sm`}>
                <Phone className="size-4" />
                {tenant.phone}
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Main page ────────────────────────────────────────────────────

  return (
    <div className={`min-h-screen ${t.bg}`}>
      {/* Top accent bar */}
      <div className={`h-1.5 ${t.topBar}`} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">

        {/* ── Theme Switcher (for review — remove later) ───────── */}
        <div className="flex items-center gap-2 justify-center">
          <span className={`text-xs ${t.textMuted}`}>Theme:</span>
          {(["1", "2", "3"] as ThemeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setThemeKey(k)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
                themeKey === k
                  ? `${t.accentBtn} text-white shadow-md`
                  : `${t.cardBg} border ${t.cardBorder} ${t.textSecondary} hover:shadow-md`
              }`}
            >
              {THEMES[k].name}
            </button>
          ))}
        </div>

        {/* ── Header ───────────────────────────────────────────── */}
        <div className={`${t.cardBg} border ${t.cardBorder} rounded-2xl shadow-sm p-6 sm:p-8`}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className={`size-11 rounded-xl ${t.topBar} flex items-center justify-center shadow-md`}>
                  <Sparkles className="size-5 text-white" />
                </div>
                <div>
                  <h1 className={`text-xl sm:text-2xl font-bold ${t.textPrimary}`}>{businessName}</h1>
                  <p className={`text-sm ${t.textSecondary}`}>Your Custom Quote</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-2">
                <div className={`flex items-center gap-1.5 ${t.textMuted} text-sm`}>
                  <FileText className="size-4" />
                  <span>Quote #{quoteNumber}</span>
                </div>
                <StatusBadge status={quote.status} />
              </div>

              <div className={`flex items-center gap-1.5 ${t.textMuted} text-xs`}>
                <Clock className="size-3.5" />
                <span>Valid until {formatDate(quote.valid_until)}</span>
              </div>
            </div>

            {/* Customer info card */}
            <div className="bg-slate-50 rounded-xl px-5 py-4 space-y-2 sm:text-right border border-slate-100">
              {quote.customer_name && (
                <div className={`flex items-center gap-2 sm:justify-end ${t.textPrimary} font-medium`}>
                  <User className="size-4 text-slate-400" />
                  {quote.customer_name}
                </div>
              )}
              {quote.customer_address && (
                <div className={`flex items-center gap-2 sm:justify-end ${t.textSecondary} text-sm`}>
                  <MapPin className="size-4" />
                  {quote.customer_address}
                </div>
              )}
              {quote.customer_phone && (
                <div className={`flex items-center gap-2 sm:justify-end ${t.textSecondary} text-sm`}>
                  <Phone className="size-4" />
                  {quote.customer_phone}
                </div>
              )}
              {serviceType === "house_cleaning" && (quote.bedrooms || quote.bathrooms) && (
                <div className={`flex items-center gap-2 sm:justify-end ${t.textSecondary} text-sm`}>
                  <Home className="size-4" />
                  {quote.bedrooms || 0} bed / {quote.bathrooms || 0} bath
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Expired Banner ──────────────────────────────────── */}
        {isExpired && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-500 shrink-0" />
            <div>
              <p className="text-red-700 font-medium text-sm">This quote has expired</p>
              <p className="text-red-500 text-xs">Please contact us for an updated quote.</p>
            </div>
          </div>
        )}

        {/* ── Error Banner ────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-500 shrink-0" />
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {/* ── Tier Selection ──────────────────────────────────── */}
        <div>
          <h2 className={`text-xl font-bold ${t.textPrimary} mb-1`}>Choose Your Package</h2>
          <p className={`${t.textSecondary} text-sm mb-6`}>Select the service level that fits your needs.</p>

          <div className={`grid grid-cols-1 ${tierGridCols} gap-4`}>
            {tiers.map((tier, tierIdx) => {
              const isSelected = selectedTierKey === tier.key
              const price = tierPrices[tier.key]?.price ?? 0
              const breakdown = tierPrices[tier.key]?.breakdown ?? []
              const isBestValue = !!tier.badge

              return (
                <button
                  key={tier.key}
                  type="button"
                  disabled={isExpired}
                  onClick={() => setSelectedTierKey(tier.key)}
                  className={`
                    relative text-left rounded-2xl border-2 transition-all duration-200 p-6 flex flex-col
                    ${isSelected ? t.tierSelected(tierIdx) : t.tierUnselected}
                    ${isExpired ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                  `}
                >
                  {isBestValue && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-gradient-to-r from-violet-600 to-pink-600 text-white text-xs font-bold px-4 py-1 rounded-full shadow-md">
                        {tier.badge}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-3 mb-3">
                    <div className={`size-11 rounded-xl flex items-center justify-center ${
                      isSelected ? `${t.tierSelected(tierIdx).split(' ')[0]}` : "bg-slate-100"
                    } ${isSelected ? t.tierRing(tierIdx) : "text-slate-400"}`}>
                      {TIER_ICONS[tierIdx] ?? <Shield className="size-6" />}
                    </div>
                    <div>
                      <h3 className={`${t.textPrimary} font-bold text-lg`}>{tier.name}</h3>
                      <p className={`${t.textMuted} text-xs`}>{tier.tagline}</p>
                    </div>
                  </div>

                  {serviceType === "house_cleaning" && tier.description && (
                    <p className={`${t.textMuted} text-xs leading-relaxed mb-4`}>{tier.description}</p>
                  )}

                  <div className="flex-1 space-y-2 mb-5">
                    {breakdown.map((item) => (
                      <div key={item.service} className="flex items-start gap-2">
                        <Check className={`size-4 shrink-0 mt-0.5 ${isSelected ? t.tierRing(tierIdx) : t.textMuted}`} />
                        <span className={`text-sm ${t.textSecondary}`}>
                          {item.service}
                          {item.price > 0 && <span className={`${t.textMuted} text-xs ml-1`}>+{formatCurrency(item.price)}</span>}
                          {item.price === 0 && <span className="text-emerald-500 text-xs ml-1">Included</span>}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-slate-100 pt-4 mt-auto">
                    <div className={`text-2xl font-bold ${t.textPrimary}`}>{formatCurrency(price)}</div>
                  </div>

                  {isSelected && (
                    <div className="absolute top-4 right-4">
                      <div className={`size-7 rounded-full flex items-center justify-center bg-emerald-500 shadow-md`}>
                        <Check className="size-4 text-white" />
                      </div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Add-ons Section ─────────────────────────────────── */}
        {addons.length > 0 && (
          <div>
            <h2 className={`text-xl font-bold ${t.textPrimary} mb-1`}>Customize with Add-ons</h2>
            <p className={`${t.textSecondary} text-sm mb-6`}>Mix and match extras to build your perfect clean.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {addons.map((addon) => {
                const checked = !!selectedAddons[addon.key]
                const addonPrice = getAddonPrice(addon)

                return (
                  <button
                    key={addon.key}
                    type="button"
                    disabled={isExpired}
                    onClick={() => {
                      if (isExpired) return
                      setSelectedAddons((prev) => ({ ...prev, [addon.key]: !prev[addon.key] }))
                    }}
                    className={`
                      rounded-xl border-2 p-4 transition-all duration-150 text-left
                      ${checked ? t.addonChecked : t.addonUnchecked}
                      ${isExpired ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`size-6 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                        checked
                          ? "bg-emerald-500 border-emerald-500"
                          : "border-slate-300 bg-white"
                      }`}>
                        {checked && <Check className="size-4 text-white" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <span className={`text-sm font-semibold ${t.textPrimary}`}>{addon.name}</span>
                            {addon.description && (
                              <p className={`text-xs ${t.textMuted} mt-0.5`}>{addon.description}</p>
                            )}
                          </div>
                          <span className={`text-sm font-bold ${checked ? "text-emerald-600" : t.textSecondary} shrink-0`}>
                            {addon.priceType === "per_unit"
                              ? `${formatCurrency(addon.price)}/${addon.unit || "unit"}`
                              : addonPrice === 0
                              ? "FREE"
                              : formatCurrency(addonPrice)}
                          </span>
                        </div>

                        {addon.priceType === "per_unit" && checked && (
                          <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                            <span className={`text-xs ${t.textMuted}`}>Qty:</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className={`h-7 w-7 rounded-md border ${t.cardBorder} ${t.cardBg} flex items-center justify-center`}
                                disabled={isExpired || (addonQuantities[addon.key] || 1) <= 1}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setAddonQuantities((prev) => ({ ...prev, [addon.key]: Math.max(1, (prev[addon.key] || 1) - 1) }))
                                }}
                              >
                                <Minus className="size-3" />
                              </button>
                              <Input
                                type="number"
                                min={1}
                                value={addonQuantities[addon.key] || 1}
                                onChange={(e) => {
                                  setAddonQuantities((prev) => ({ ...prev, [addon.key]: Math.max(1, parseInt(e.target.value) || 1) }))
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="w-14 h-7 text-center text-sm"
                                disabled={isExpired}
                              />
                              <button
                                type="button"
                                className={`h-7 w-7 rounded-md border ${t.cardBorder} ${t.cardBg} flex items-center justify-center`}
                                disabled={isExpired}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setAddonQuantities((prev) => ({ ...prev, [addon.key]: (prev[addon.key] || 1) + 1 }))
                                }}
                              >
                                <Plus className="size-3" />
                              </button>
                            </div>
                            <span className={`text-xs ${t.textMuted}`}>= {formatCurrency(addon.price * (addonQuantities[addon.key] || 1))}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Membership Plans ────────────────────────────────── */}
        {!isExpired && servicePlans.length > 0 && (
          <div>
            <h2 className={`text-xl font-bold ${t.textPrimary} mb-1`}>Save with a Membership</h2>
            <p className={`${t.textSecondary} text-sm mb-6`}>Commit to regular service and save on every visit.</p>

            <div className={`grid grid-cols-1 sm:grid-cols-2 ${servicePlans.length >= 3 ? "lg:grid-cols-4" : ""} gap-3`}>
              <button
                type="button"
                onClick={() => setSelectedMembership(null)}
                className={`relative text-left rounded-2xl border-2 p-5 transition-all duration-200 cursor-pointer ${
                  selectedMembership === null
                    ? "ring-2 ring-slate-300 border-slate-300 bg-slate-50"
                    : `${t.tierUnselected}`
                }`}
              >
                <h3 className={`${t.textPrimary} font-semibold mb-1`}>No Membership</h3>
                <p className={`${t.textMuted} text-xs mb-3`}>One-time service at regular price</p>
                <p className={`${t.textSecondary} text-sm`}>No commitment</p>
                {selectedMembership === null && (
                  <div className="absolute top-3 right-3">
                    <div className="size-6 rounded-full bg-slate-400 flex items-center justify-center">
                      <Check className="size-3 text-white" />
                    </div>
                  </div>
                )}
              </button>

              {servicePlans.map((plan) => {
                const isSelected = selectedMembership === plan.slug
                const freeAddons = plan.free_addons || []
                return (
                  <button
                    key={plan.slug}
                    type="button"
                    onClick={() => setSelectedMembership(plan.slug)}
                    className={`relative text-left rounded-2xl border-2 p-5 transition-all duration-200 cursor-pointer ${
                      isSelected
                        ? "ring-2 ring-emerald-300 border-emerald-300 bg-emerald-50"
                        : t.tierUnselected
                    }`}
                  >
                    <h3 className={`${t.textPrimary} font-semibold text-sm mb-1`}>{plan.name}</h3>
                    <p className={`${t.textMuted} text-xs mb-3`}>
                      {plan.visits_per_year} visits/year &middot; Every {plan.interval_months} month{plan.interval_months !== 1 ? "s" : ""}
                    </p>
                    <div className="mb-3">
                      <span className="text-emerald-600 font-bold text-sm">Save {formatCurrency(Number(plan.discount_per_visit))}/visit</span>
                    </div>
                    {freeAddons.length > 0 && (
                      <div className="space-y-1">
                        <p className={`${t.textMuted} text-xs font-medium`}>Free perks:</p>
                        {freeAddons.map((perk) => (
                          <div key={perk} className="flex items-center gap-1.5">
                            <Check className="size-3 text-emerald-500 shrink-0" />
                            <span className={`${t.textSecondary} text-xs`}>{perk}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-3 right-3">
                        <div className="size-6 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check className="size-3 text-white" />
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {selectedPlan?.agreement_text && (
              <div className={`mt-6 border ${t.cardBorder} rounded-xl overflow-hidden`}>
                <div className={`px-4 py-2.5 bg-slate-50 border-b ${t.cardBorder}`}>
                  <p className={`text-sm font-medium ${t.textPrimary}`}>Membership Agreement — {selectedPlan.name}</p>
                </div>
                <div className={`px-4 py-3 max-h-[200px] overflow-y-auto text-sm ${t.textSecondary} leading-relaxed bg-white`}>
                  {selectedPlan.agreement_text}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Customer Info ───────────────────────────────────── */}
        {!isExpired && (
          <div>
            <h2 className={`text-xl font-bold ${t.textPrimary} mb-1`}>Your Information</h2>
            <p className={`${t.textSecondary} text-sm mb-4`}>Confirm your details for the service.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <div className="space-y-1.5">
                <Label htmlFor="customer-name" className={`text-sm ${t.textSecondary}`}>Name</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Your name"
                  className="bg-white border-slate-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-email" className={`text-sm ${t.textSecondary}`}>Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="bg-white border-slate-200"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Service Agreement — BIG AND OBVIOUS ────────────── */}
        {!isExpired && serviceAgreement && (
          <div>
            <h2 className={`text-xl font-bold ${t.textPrimary} mb-1 flex items-center gap-2`}>
              <ShieldCheck className="size-5 text-emerald-500" />
              Service Agreement
            </h2>
            <p className={`${t.textSecondary} text-sm mb-4`}>Please review and accept before booking.</p>

            <div className={`border-2 ${t.agreementBorder} rounded-2xl overflow-hidden ${t.agreementBg}`}>
              <div className="p-5 sm:p-6 space-y-4">
                {serviceAgreement.terms.map((term, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="size-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                      <span className={`${t.textSecondary} text-xs font-bold`}>{i + 1}</span>
                    </div>
                    <p className={`text-sm ${t.textSecondary} leading-relaxed`}>{term}</p>
                  </div>
                ))}

                {serviceAgreement.satisfaction_guarantee && (
                  <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 mt-4">
                    <ShieldCheck className="size-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-emerald-700 font-semibold text-sm">100% Satisfaction Guarantee</p>
                      <p className="text-emerald-600 text-xs mt-1">
                        If you&apos;re not happy with the service, we&apos;ll come back and make it right at no extra charge.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Big obvious acceptance toggle */}
              <div
                onClick={() => setAgreementAccepted(!agreementAccepted)}
                className={`
                  border-t-2 px-5 sm:px-6 py-5 cursor-pointer transition-all duration-200
                  ${agreementAccepted
                    ? "bg-emerald-50 border-emerald-300"
                    : "bg-amber-50 border-amber-200 hover:bg-amber-100"
                  }
                `}
              >
                <div className="flex items-center gap-4">
                  <div className={`
                    size-8 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all duration-200
                    ${agreementAccepted
                      ? "bg-emerald-500 border-emerald-500"
                      : "bg-white border-slate-300"
                    }
                  `}>
                    {agreementAccepted && <Check className="size-5 text-white" />}
                  </div>
                  <div className="flex-1">
                    <p className={`font-semibold text-sm ${agreementAccepted ? "text-emerald-700" : t.textPrimary}`}>
                      {agreementAccepted ? "Service Agreement Accepted" : "Tap here to accept the Service Agreement"}
                    </p>
                    <p className={`text-xs mt-0.5 ${agreementAccepted ? "text-emerald-600" : "text-amber-600"}`}>
                      {agreementAccepted
                        ? "You've agreed to the terms, cancellation policy, and payment terms above."
                        : "You must accept the terms above to continue with your booking."
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Price Summary ───────────────────────────────────── */}
        <div className={`${t.summaryBg} border-2 ${t.summaryBorder} rounded-2xl shadow-sm overflow-hidden`}>
          <div className={`px-6 py-4 border-b ${t.cardBorder} bg-slate-50`}>
            <h3 className={`font-bold ${t.textPrimary}`}>Price Summary</h3>
          </div>
          <div className="p-6 space-y-3">
            {selectedTier && selectedTierPrice && (
              <div className="flex justify-between text-sm">
                <span className={t.textSecondary}>{selectedTier.name}</span>
                <span className={`${t.textPrimary} font-medium`}>{formatCurrency(selectedTierPrice.price)}</span>
              </div>
            )}

            {addons
              .filter((a) => selectedAddons[a.key])
              .map((addon) => (
                <div key={addon.key} className="flex justify-between text-sm">
                  <span className={t.textMuted}>
                    {addon.name}
                    {addon.priceType === "per_unit" && (addonQuantities[addon.key] || 1) > 1 ? ` x${addonQuantities[addon.key]}` : ""}
                  </span>
                  <span className={t.textSecondary}>{formatCurrency(getAddonPrice(addon))}</span>
                </div>
              ))}

            <div className="border-t border-slate-100 my-2" />

            <div className="flex justify-between text-sm">
              <span className={t.textMuted}>Subtotal</span>
              <span className={t.textSecondary}>{formatCurrency(subtotal)}</span>
            </div>

            {existingDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600">Discount</span>
                <span className="text-emerald-600">-{formatCurrency(existingDiscount)}</span>
              </div>
            )}

            {membershipDiscount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600">Membership ({selectedPlan?.name})</span>
                <span className="text-emerald-600">-{formatCurrency(membershipDiscount)}</span>
              </div>
            )}

            <div className="border-t-2 border-slate-200 pt-3">
              <div className="flex justify-between items-baseline">
                <span className={`${t.textPrimary} font-bold text-lg`}>Total</span>
                <span className={`${t.textPrimary} font-bold text-3xl`}>{formatCurrency(total)}</span>
              </div>
              <p className={`${t.textMuted} text-xs mt-2`}>
                Your card will be saved on file. You&apos;ll only be charged the final amount after your service is complete.
              </p>
            </div>
          </div>
        </div>

        {/* ── Save Card & Book Button ─────────────────────────── */}
        {!isExpired && (
          <div className="flex flex-col items-center gap-4 pb-4">
            <Button
              size="lg"
              disabled={!canApprove}
              onClick={handleApprove}
              className={`
                w-full sm:w-auto sm:min-w-[340px] h-14 text-base font-bold rounded-xl
                ${t.accentBtn} text-white
                shadow-lg hover:shadow-xl
                transition-all duration-200 border-0
                disabled:opacity-40 disabled:cursor-not-allowed
              `}
            >
              {approving ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="size-5" />
                  Save Card &amp; Book — {formatCurrency(total)}
                </>
              )}
            </Button>

            {!agreementAccepted && !isExpired && (
              <p className="text-amber-600 text-sm font-medium flex items-center gap-1.5 bg-amber-50 px-4 py-2 rounded-lg">
                <AlertTriangle className="size-4" />
                Please accept the service agreement above to continue
              </p>
            )}

            <div className={`flex items-center gap-1.5 ${t.textMuted} text-xs`}>
              <Lock className="size-3" />
              Secure payment powered by Stripe
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="text-center pb-8">
          <p className={`${t.textMuted} text-xs`}>Powered by {businessName}</p>
        </div>
      </div>
    </div>
  )
}

// ── Status Badge ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Quote["status"] }) {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 border border-amber-200 text-xs font-medium px-2.5 py-1 rounded-full">
          <Clock className="size-3" />
          Awaiting Response
        </span>
      )
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-medium px-2.5 py-1 rounded-full">
          <CheckCircle className="size-3" />
          Approved
        </span>
      )
    case "expired":
      return (
        <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 border border-red-200 text-xs font-medium px-2.5 py-1 rounded-full">
          <AlertTriangle className="size-3" />
          Expired
        </span>
      )
    default:
      return null
  }
}
