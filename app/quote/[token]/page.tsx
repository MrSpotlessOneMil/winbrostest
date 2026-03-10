"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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

// ── Types matching the tenant-aware API response ─────────────────────

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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

// Dynamic tier visuals — works for 3 tiers (WinBros) or 4+ tiers (house cleaning)
const TIER_ICON_MAP: Record<string, React.ReactNode> = {
  good: <Shield className="size-6" />,
  better: <Star className="size-6" />,
  best: <Crown className="size-6" />,
  standard: <Shield className="size-6" />,
  deep: <Star className="size-6" />,
  extra_deep: <Crown className="size-6" />,
  move_good: <Shield className="size-6" />,
  move_better: <Star className="size-6" />,
  move_best: <Crown className="size-6" />,
}

const TIER_COLOR_MAP: Record<string, { ring: string; bg: string; glow: string; text: string; indicator: string }> = {
  good: {
    ring: "ring-blue-500/60",
    bg: "bg-blue-500/10",
    glow: "shadow-[0_0_30px_rgba(59,130,246,0.15)]",
    text: "text-blue-400",
    indicator: "bg-blue-500",
  },
  better: {
    ring: "ring-violet-500/60",
    bg: "bg-violet-500/10",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.2)]",
    text: "text-violet-400",
    indicator: "bg-violet-500",
  },
  best: {
    ring: "ring-amber-500/60",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]",
    text: "text-amber-400",
    indicator: "bg-amber-500",
  },
  standard: {
    ring: "ring-blue-500/60",
    bg: "bg-blue-500/10",
    glow: "shadow-[0_0_30px_rgba(59,130,246,0.15)]",
    text: "text-blue-400",
    indicator: "bg-blue-500",
  },
  deep: {
    ring: "ring-violet-500/60",
    bg: "bg-violet-500/10",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.2)]",
    text: "text-violet-400",
    indicator: "bg-violet-500",
  },
  extra_deep: {
    ring: "ring-amber-500/60",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]",
    text: "text-amber-400",
    indicator: "bg-amber-500",
  },
  move_good: {
    ring: "ring-blue-500/60",
    bg: "bg-blue-500/10",
    glow: "shadow-[0_0_30px_rgba(59,130,246,0.15)]",
    text: "text-blue-400",
    indicator: "bg-blue-500",
  },
  move_better: {
    ring: "ring-violet-500/60",
    bg: "bg-violet-500/10",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.2)]",
    text: "text-violet-400",
    indicator: "bg-violet-500",
  },
  move_best: {
    ring: "ring-amber-500/60",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]",
    text: "text-amber-400",
    indicator: "bg-amber-500",
  },
}

const DEFAULT_COLORS = {
  ring: "ring-violet-500/60",
  bg: "bg-violet-500/10",
  glow: "shadow-[0_0_30px_rgba(139,92,246,0.2)]",
  text: "text-violet-400",
  indicator: "bg-violet-500",
}

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

  // ── Fetch quote ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/quotes/${token}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Quote not found")
        setData(json)

        // Default to middle tier
        const tierKeys = (json.tiers as QuoteTier[]).map((t) => t.key)
        const middleIndex = Math.min(1, tierKeys.length - 1)
        setSelectedTierKey(tierKeys[middleIndex] || tierKeys[0])

        // Pre-fill customer info
        if (json.quote.customer_name) setCustomerName(json.quote.customer_name)
        if (json.quote.customer_email) setCustomerEmail(json.quote.customer_email)

        if (json.quote.status === "approved") {
          setSelectedTierKey(json.quote.selected_tier)
        }

        // Initialize addon quantities for per-unit addons
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

  const isAddonIncluded = useCallback(
    (addon: QuoteAddon): boolean => {
      return !!selectedTier && selectedTier.included.includes(addon.key)
    },
    [selectedTier]
  )

  const getAddonPrice = useCallback(
    (addon: QuoteAddon): number => {
      if (!selectedTierPrice) return 0
      // For WinBros flat-price addons that are part of tier breakdowns
      if (addon.key === "interior" && selectedTierPrice) {
        const interiorItem = selectedTierPrice.breakdown.find(
          (b) => b.service === "Interior Window Cleaning"
        )
        if (interiorItem) return interiorItem.price
        const betterPrice = tierPrices.better?.breakdown.find(
          (b) => b.service === "Interior Window Cleaning"
        )
        return betterPrice?.price ?? 0
      }
      if (addon.key === "track_detailing" && selectedTierPrice) {
        const trackItem = selectedTierPrice.breakdown.find(
          (b) => b.service === "Track Detailing"
        )
        if (trackItem) return trackItem.price
        const bestPrice = tierPrices.best?.breakdown.find(
          (b) => b.service === "Track Detailing"
        )
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
        if (isAddonIncluded(addon)) return sum
        if (selectedAddons[addon.key]) return sum + getAddonPrice(addon)
        return sum
      }, 0)
    : 0

  const selectedPlan = servicePlans.find((p) => p.slug === selectedMembership) ?? null
  const membershipDiscount = selectedPlan ? Number(selectedPlan.discount_per_visit) || 0 : 0
  const existingDiscount = Number(quote?.discount) || 0
  const discountAmount = existingDiscount + membershipDiscount
  const total = Math.max(0, subtotal - discountAmount)

  // Deposit calculation (mirrors server-side)
  const depositPct = serviceAgreement?.deposit_percentage ? serviceAgreement.deposit_percentage / 100 : 0.5
  const processingFeePct = serviceAgreement?.processing_fee_percentage ? serviceAgreement.processing_fee_percentage / 100 : 0.03
  const depositBase = total * depositPct
  const depositWithFee = depositBase * (1 + processingFeePct)
  const depositAmount = Math.round(depositWithFee * 100) / 100

  // ── Approve handler — redirects to Stripe Checkout ─────────────

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

      // Redirect to Stripe Checkout
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

  // ── Loading state ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="size-8 animate-spin text-violet-400" />
          <p className="text-zinc-400 text-sm">Loading your quote...</p>
        </div>
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────────────

  if (error && !quote) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <Card className="max-w-md w-full">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <AlertTriangle className="size-12 text-red-400" />
            <h2 className="text-lg font-semibold text-white">Quote Not Found</h2>
            <p className="text-zinc-400 text-sm text-center">
              {error || "This quote may have been removed or the link is invalid."}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!quote) return null

  const isExpired = quote.status === "expired"
  const isApproved = quote.status === "approved"
  const quoteNumber = token.slice(0, 8).toUpperCase()

  // Grid columns: 3 for WinBros (good/better/best), 2x2 for house cleaning (4 tiers)
  const tierGridCols = tiers.length <= 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4"

  // ── Approved state — redirect to success page ──────────────────

  if (isApproved) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <Card className="max-w-lg w-full">
          <CardContent className="flex flex-col items-center gap-6 py-12">
            <div className="size-20 rounded-full bg-emerald-500/10 flex items-center justify-center ring-2 ring-emerald-500/30">
              <CheckCircle className="size-10 text-emerald-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white">Quote Approved</h2>
              <p className="text-zinc-400">
                This quote has been approved
                {quote.deposit_amount ? ` and a deposit of ${formatCurrency(Number(quote.deposit_amount))} has been paid` : ""}.
                We&apos;ll be in touch to schedule your service.
              </p>
            </div>
            {tenant?.phone && (
              <a
                href={`tel:${tenant.phone}`}
                className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
              >
                <Phone className="size-4" />
                {tenant.phone}
              </a>
            )}
            <p className="text-zinc-600 text-xs mt-4">
              Powered by {businessName}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Determine whether approve button should be enabled ──────────

  const canApprove =
    selectedTierKey &&
    !approving &&
    agreementAccepted &&
    !isExpired

  // ── Main quote page ──────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Top gradient accent */}
      <div className="h-1 bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-600" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                <Sparkles className="size-5 text-white" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">
                {businessName}
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-zinc-400 text-sm">
                <FileText className="size-4" />
                <span>Quote #{quoteNumber}</span>
              </div>
              <StatusBadge status={quote.status} />
            </div>

            <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
              <Clock className="size-3.5" />
              <span>Valid until {formatDate(quote.valid_until)}</span>
            </div>
          </div>

          {/* Customer info */}
          <div className="bg-zinc-900/60 backdrop-blur rounded-lg px-5 py-4 space-y-2 sm:text-right">
            {quote.customer_name && (
              <div className="flex items-center gap-2 sm:justify-end text-white font-medium">
                <User className="size-4 text-zinc-400" />
                {quote.customer_name}
              </div>
            )}
            {quote.customer_address && (
              <div className="flex items-center gap-2 sm:justify-end text-zinc-400 text-sm">
                <MapPin className="size-4" />
                {quote.customer_address}
              </div>
            )}
            {quote.customer_phone && (
              <div className="flex items-center gap-2 sm:justify-end text-zinc-400 text-sm">
                <Phone className="size-4" />
                {quote.customer_phone}
              </div>
            )}
            {/* Bed/bath info for house cleaning */}
            {serviceType === "house_cleaning" && (quote.bedrooms || quote.bathrooms) && (
              <div className="flex items-center gap-2 sm:justify-end text-zinc-400 text-sm">
                <Home className="size-4" />
                {quote.bedrooms || 0} bed / {quote.bathrooms || 0} bath
              </div>
            )}
          </div>
        </div>

        {/* ── Expired Banner ──────────────────────────────────────── */}
        {isExpired && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-400 shrink-0" />
            <div>
              <p className="text-red-400 font-medium text-sm">This quote has expired</p>
              <p className="text-red-400/70 text-xs">
                Please contact us for an updated quote.
              </p>
            </div>
          </div>
        )}

        {/* ── Error Banner ────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="size-5 text-red-400 shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* ── Tier Selection ──────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Choose Your Package</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Select the service level that fits your needs.
          </p>

          <div className={`grid grid-cols-1 ${tierGridCols} gap-4`}>
            {tiers.map((tier) => {
              const isSelected = selectedTierKey === tier.key
              const colors = TIER_COLOR_MAP[tier.key] ?? DEFAULT_COLORS
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
                    relative text-left rounded-xl border transition-all duration-200
                    ${
                      isSelected
                        ? `ring-2 ${colors.ring} border-white/10 ${colors.glow} ${colors.bg}`
                        : "border-white/[0.06] bg-zinc-900/40 hover:border-white/[0.12] hover:bg-zinc-900/60"
                    }
                    ${isExpired ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
                    p-6 flex flex-col
                  `}
                >
                  {/* Badge */}
                  {isBestValue && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-violet-600 text-white border-violet-500 text-xs px-3 py-0.5">
                        {tier.badge}
                      </Badge>
                    </div>
                  )}

                  {/* Tier icon + name */}
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`
                        size-10 rounded-lg flex items-center justify-center
                        ${isSelected ? colors.bg : "bg-zinc-800/60"}
                        ${isSelected ? colors.text : "text-zinc-400"}
                      `}
                    >
                      {TIER_ICON_MAP[tier.key] ?? <Shield className="size-6" />}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-lg">{tier.name}</h3>
                      <p className="text-zinc-400 text-xs">{tier.tagline}</p>
                    </div>
                  </div>

                  {/* Description for house cleaning tiers */}
                  {serviceType === "house_cleaning" && tier.description && (
                    <p className="text-zinc-500 text-xs leading-relaxed mb-4">
                      {tier.description}
                    </p>
                  )}

                  {/* Services list */}
                  <div className="flex-1 space-y-2 mb-5">
                    {breakdown.map((item) => (
                      <div key={item.service} className="flex items-start gap-2">
                        <Check
                          className={`size-4 shrink-0 mt-0.5 ${
                            isSelected ? colors.text : "text-zinc-500"
                          }`}
                        />
                        <span className="text-sm text-zinc-300">
                          {item.service}
                          {item.price > 0 && (
                            <span className="text-zinc-500 text-xs ml-1">
                              +{formatCurrency(item.price)}
                            </span>
                          )}
                          {item.price === 0 && (
                            <span className="text-emerald-400 text-xs ml-1">Included</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Price */}
                  <div className="border-t border-white/[0.06] pt-4 mt-auto">
                    <div className="text-2xl font-bold text-white">
                      {formatCurrency(price)}
                    </div>
                    {tierPrices[tier.key]?.tier && (
                      <p className="text-zinc-500 text-xs mt-1">
                        {tierPrices[tier.key].tier}
                      </p>
                    )}
                  </div>

                  {/* Select indicator */}
                  {isSelected && (
                    <div className="absolute top-4 right-4">
                      <div className={`size-6 rounded-full flex items-center justify-center ${colors.indicator}`}>
                        <Check className="size-4 text-white" />
                      </div>
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Add-ons Section ─────────────────────────────────────── */}
        {addons.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Add-ons</h2>
            <p className="text-zinc-400 text-sm mb-6">
              Customize your service with optional extras.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {addons.map((addon) => {
                const included = isAddonIncluded(addon)
                const checked = included || !!selectedAddons[addon.key]
                const addonPrice = getAddonPrice(addon)

                return (
                  <div
                    key={addon.key}
                    className={`
                      rounded-lg border p-4 transition-all duration-150
                      ${
                        checked
                          ? "border-violet-500/30 bg-violet-500/5"
                          : "border-white/[0.06] bg-zinc-900/30 hover:border-white/[0.1]"
                      }
                      ${isExpired ? "opacity-50" : ""}
                    `}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">
                        <Checkbox
                          checked={checked}
                          disabled={included || isExpired}
                          onCheckedChange={(val) => {
                            if (included) return
                            setSelectedAddons((prev) => ({
                              ...prev,
                              [addon.key]: !!val,
                            }))
                          }}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <Label className="text-sm font-medium text-white">
                              {addon.name}
                            </Label>
                            {addon.description && (
                              <p className="text-xs text-zinc-500 mt-0.5">{addon.description}</p>
                            )}
                          </div>
                          {included ? (
                            <Badge variant="secondary" className="text-xs shrink-0">
                              Included
                            </Badge>
                          ) : addonPrice === 0 ? (
                            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs shrink-0">
                              FREE
                            </Badge>
                          ) : (
                            <span className="text-sm font-medium text-zinc-300 shrink-0">
                              {addon.priceType === "per_unit"
                                ? `${formatCurrency(addon.price)}/${addon.unit || "unit"}`
                                : formatCurrency(addonPrice)}
                            </span>
                          )}
                        </div>

                        {/* Per-unit quantity controls */}
                        {addon.priceType === "per_unit" &&
                          !included &&
                          selectedAddons[addon.key] && (
                            <div className="flex items-center gap-2 mt-3">
                              <span className="text-xs text-zinc-400">Qty:</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  disabled={
                                    isExpired ||
                                    (addonQuantities[addon.key] || 1) <= 1
                                  }
                                  onClick={() =>
                                    setAddonQuantities((prev) => ({
                                      ...prev,
                                      [addon.key]: Math.max(
                                        1,
                                        (prev[addon.key] || 1) - 1
                                      ),
                                    }))
                                  }
                                >
                                  <Minus className="size-3" />
                                </Button>
                                <Input
                                  type="number"
                                  min={1}
                                  value={addonQuantities[addon.key] || 1}
                                  onChange={(e) =>
                                    setAddonQuantities((prev) => ({
                                      ...prev,
                                      [addon.key]: Math.max(
                                        1,
                                        parseInt(e.target.value) || 1
                                      ),
                                    }))
                                  }
                                  className="w-14 h-7 text-center text-sm bg-zinc-900/60 border-white/[0.08]"
                                  disabled={isExpired}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  disabled={isExpired}
                                  onClick={() =>
                                    setAddonQuantities((prev) => ({
                                      ...prev,
                                      [addon.key]: (prev[addon.key] || 1) + 1,
                                    }))
                                  }
                                >
                                  <Plus className="size-3" />
                                </Button>
                              </div>
                              <span className="text-xs text-zinc-500">
                                ={" "}
                                {formatCurrency(
                                  addon.price * (addonQuantities[addon.key] || 1)
                                )}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Membership Plans ───────────────────────────────────── */}
        {!isExpired && servicePlans.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Save with a Membership
            </h2>
            <p className="text-zinc-400 text-sm mb-6">
              Commit to regular service and save on every visit.
            </p>

            <div className={`grid grid-cols-1 sm:grid-cols-2 ${servicePlans.length >= 3 ? 'lg:grid-cols-4' : ''} gap-3`}>
              {/* No Membership option */}
              <button
                type="button"
                onClick={() => {
                  setSelectedMembership(null)
                }}
                className={`
                  relative text-left rounded-xl border p-5 transition-all duration-200
                  ${
                    selectedMembership === null
                      ? "ring-2 ring-zinc-500/60 border-white/10 bg-zinc-800/40"
                      : "border-white/[0.06] bg-zinc-900/40 hover:border-white/[0.12] hover:bg-zinc-900/60"
                  }
                  cursor-pointer
                `}
              >
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-white font-semibold">No Membership</h3>
                </div>
                <p className="text-zinc-400 text-xs mb-3">One-time service at regular price</p>
                <p className="text-zinc-500 text-sm">No commitment</p>
                {selectedMembership === null && (
                  <div className="absolute top-3 right-3">
                    <div className="size-5 rounded-full bg-zinc-500 flex items-center justify-center">
                      <Check className="size-3 text-white" />
                    </div>
                  </div>
                )}
              </button>

              {/* Membership plan cards from API */}
              {servicePlans.map((plan) => {
                const isSelected = selectedMembership === plan.slug
                const freeAddons = plan.free_addons || []
                return (
                  <button
                    key={plan.slug}
                    type="button"
                    onClick={() => {
                      setSelectedMembership(plan.slug)
                    }}
                    className={`
                      relative text-left rounded-xl border p-5 transition-all duration-200
                      ${
                        isSelected
                          ? "ring-2 ring-emerald-500/60 border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_30px_rgba(16,185,129,0.1)]"
                          : "border-white/[0.06] bg-zinc-900/40 hover:border-white/[0.12] hover:bg-zinc-900/60"
                      }
                      cursor-pointer
                    `}
                    style={
                      isSelected
                        ? {}
                        : {
                            backgroundImage:
                              "linear-gradient(135deg, rgba(16,185,129,0.03) 0%, transparent 50%)",
                          }
                    }
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-white font-semibold text-sm">{plan.name}</h3>
                    </div>
                    <p className="text-zinc-400 text-xs mb-3">
                      {plan.visits_per_year} visits/year &middot; Every {plan.interval_months} month{plan.interval_months !== 1 ? 's' : ''}
                    </p>
                    <div className="mb-3">
                      <span className="text-emerald-400 font-semibold text-sm">
                        Save {formatCurrency(Number(plan.discount_per_visit))}/visit
                      </span>
                    </div>
                    {freeAddons.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-zinc-500 text-xs font-medium">Free perks:</p>
                        {freeAddons.map((perk) => (
                          <div key={perk} className="flex items-center gap-1.5">
                            <Check className="size-3 text-emerald-400 shrink-0" />
                            <span className="text-zinc-400 text-xs">{perk}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isSelected && (
                      <div className="absolute top-3 right-3">
                        <div className="size-5 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check className="size-3 text-white" />
                        </div>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Membership Agreement Text */}
            {selectedPlan?.agreement_text && (
              <div className="mt-6">
                <div className="border border-white/[0.08] rounded-lg overflow-hidden">
                  <div className="px-4 py-2.5 bg-zinc-900/60 border-b border-white/[0.06]">
                    <p className="text-sm font-medium text-white">
                      Membership Agreement &mdash; {selectedPlan.name}
                    </p>
                  </div>
                  <div
                    className="px-4 py-3 max-h-[200px] overflow-y-auto text-sm text-zinc-400 leading-relaxed"
                    style={{ scrollbarWidth: "thin" }}
                  >
                    {selectedPlan.agreement_text}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Customer Info (optional — pre-fill or collect) ───── */}
        {!isExpired && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Your Information</h2>
            <p className="text-zinc-400 text-sm mb-4">
              Confirm your details for the service.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <div className="space-y-1.5">
                <Label htmlFor="customer-name" className="text-sm text-zinc-300">Name</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Your full name"
                  className="bg-zinc-900/60 border-white/[0.08]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-email" className="text-sm text-zinc-300">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="bg-zinc-900/60 border-white/[0.08]"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Service Agreement ────────────────────────────────────── */}
        {!isExpired && serviceAgreement && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-400" />
              Service Agreement
            </h2>
            <p className="text-zinc-400 text-sm mb-4">
              Please review and accept our terms before proceeding to payment.
            </p>

            <div className="border border-white/[0.08] rounded-xl overflow-hidden">
              {/* Terms list */}
              <div className="p-5 space-y-4">
                {serviceAgreement.terms.map((term, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="size-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-zinc-400 text-xs font-bold">{i + 1}</span>
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed">{term}</p>
                  </div>
                ))}

                {/* Satisfaction guarantee highlight */}
                {serviceAgreement.satisfaction_guarantee && (
                  <div className="flex items-start gap-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-4 mt-4">
                    <ShieldCheck className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-emerald-400 font-medium text-sm">100% Satisfaction Guarantee</p>
                      <p className="text-zinc-400 text-xs mt-1">
                        If you&apos;re not happy with the service, we&apos;ll come back and make it right at no extra charge.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Acceptance checkbox */}
              <div className="border-t border-white/[0.06] px-5 py-4 bg-zinc-900/40">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="service-agreement"
                    checked={agreementAccepted}
                    onCheckedChange={(val) => setAgreementAccepted(!!val)}
                  />
                  <Label
                    htmlFor="service-agreement"
                    className="text-sm text-zinc-300 cursor-pointer leading-snug"
                  >
                    I have read and agree to the service terms, cancellation policy, and payment terms above.
                  </Label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Price Summary ───────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Price Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Tier line */}
              {selectedTier && selectedTierPrice && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">
                    {selectedTier.name}
                  </span>
                  <span className="text-white font-medium">
                    {formatCurrency(selectedTierPrice.price)}
                  </span>
                </div>
              )}

              {/* Addon lines */}
              {addons
                .filter((a) => !isAddonIncluded(a) && selectedAddons[a.key])
                .map((addon) => (
                  <div key={addon.key} className="flex justify-between text-sm">
                    <span className="text-zinc-400">
                      {addon.name}
                      {addon.priceType === "per_unit" &&
                      (addonQuantities[addon.key] || 1) > 1
                        ? ` x${addonQuantities[addon.key]}`
                        : ""}
                    </span>
                    <span className="text-zinc-300">
                      {formatCurrency(getAddonPrice(addon))}
                    </span>
                  </div>
                ))}

              {/* Included addons */}
              {addons
                .filter((a) => isAddonIncluded(a))
                .map((addon) => (
                  <div key={addon.key} className="flex justify-between text-sm">
                    <span className="text-zinc-500">{addon.name}</span>
                    <span className="text-emerald-400 text-xs">Included</span>
                  </div>
                ))}

              <div className="border-t border-white/[0.06] my-2" />

              {/* Subtotal */}
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Subtotal</span>
                <span className="text-zinc-300">{formatCurrency(subtotal)}</span>
              </div>

              {/* Existing discount */}
              {existingDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-400">Discount</span>
                  <span className="text-emerald-400">
                    -{formatCurrency(existingDiscount)}
                  </span>
                </div>
              )}

              {/* Membership discount */}
              {membershipDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-400">
                    Membership ({selectedPlan?.name})
                  </span>
                  <span className="text-emerald-400">
                    -{formatCurrency(membershipDiscount)}
                  </span>
                </div>
              )}

              {/* Total */}
              <div className="border-t border-white/[0.06] pt-3">
                <div className="flex justify-between">
                  <span className="text-white font-semibold text-lg">Service Total</span>
                  <span className="text-white font-bold text-2xl">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>

              {/* Deposit breakdown */}
              {!isExpired && total > 0 && (
                <div className="border-t border-white/[0.06] pt-3 mt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">
                      Deposit ({Math.round(depositPct * 100)}%)
                    </span>
                    <span className="text-zinc-300">{formatCurrency(depositBase)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">
                      Processing fee ({Math.round(processingFeePct * 100)}%)
                    </span>
                    <span className="text-zinc-300">{formatCurrency(depositWithFee - depositBase)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-medium pt-1">
                    <span className="text-white">Due today (deposit)</span>
                    <span className="text-white">{formatCurrency(depositAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Remaining balance (due on completion)</span>
                    <span className="text-zinc-500">{formatCurrency(total - (total * depositPct))}</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Approve & Pay Button ──────────────────────────────── */}
        {!isExpired && (
          <div className="flex flex-col items-center gap-4 pb-8">
            <Button
              size="lg"
              disabled={!canApprove}
              onClick={handleApprove}
              className="
                w-full sm:w-auto sm:min-w-[320px] h-14 text-base font-semibold
                bg-gradient-to-r from-emerald-600 to-emerald-500
                hover:from-emerald-500 hover:to-emerald-400
                shadow-[0_0_30px_rgba(16,185,129,0.25)]
                hover:shadow-[0_0_40px_rgba(16,185,129,0.35)]
                transition-all duration-200 border-0
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {approving ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <CreditCard className="size-5" />
                  Approve &amp; Pay Deposit — {formatCurrency(depositAmount)}
                </>
              )}
            </Button>

            {!agreementAccepted && !isExpired && (
              <p className="text-zinc-500 text-xs flex items-center gap-1.5">
                <Lock className="size-3" />
                Accept the service agreement above to continue
              </p>
            )}

            <div className="flex items-center gap-1.5 text-zinc-600 text-xs">
              <Lock className="size-3" />
              Secure payment powered by Stripe
            </div>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="text-center pb-8">
          <p className="text-zinc-600 text-xs">
            Powered by {businessName}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Status Badge Sub-component ───────────────────────────────────────

function StatusBadge({ status }: { status: Quote["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">
          <Clock className="size-3" />
          Awaiting Response
        </Badge>
      )
    case "approved":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
          <CheckCircle className="size-3" />
          Approved
        </Badge>
      )
    case "expired":
      return (
        <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
          <AlertTriangle className="size-3" />
          Expired
        </Badge>
      )
    default:
      return null
  }
}
