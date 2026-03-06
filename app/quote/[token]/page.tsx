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
} from "lucide-react"

// ── Types matching our API response ─────────────────────────────────

interface QuoteTier {
  key: "good" | "better" | "best"
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

interface Quote {
  id: string
  token: string
  status: "pending" | "approved" | "expired" | "cancelled"
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  square_footage: number | null
  selected_tier: string | null
  selected_addons: string[]
  subtotal: string | null
  discount: string | null
  total: string | null
  membership_discount: string | null
  membership_plan: string | null
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

const TIER_ICONS: Record<string, React.ReactNode> = {
  good: <Shield className="size-6" />,
  better: <Star className="size-6" />,
  best: <Crown className="size-6" />,
}

const TIER_COLORS: Record<string, { ring: string; bg: string; glow: string; text: string }> = {
  good: {
    ring: "ring-blue-500/60",
    bg: "bg-blue-500/10",
    glow: "shadow-[0_0_30px_rgba(59,130,246,0.15)]",
    text: "text-blue-400",
  },
  better: {
    ring: "ring-violet-500/60",
    bg: "bg-violet-500/10",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.2)]",
    text: "text-violet-400",
  },
  best: {
    ring: "ring-amber-500/60",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_30px_rgba(245,158,11,0.15)]",
    text: "text-amber-400",
  },
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
  const [approved, setApproved] = useState(false)

  // ── Fetch quote ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchQuote() {
      try {
        const res = await fetch(`/api/quotes/${token}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Quote not found")
        setData(json)

        // Default to "better" (middle tier)
        setSelectedTierKey("better")

        if (json.quote.status === "approved") {
          setApproved(true)
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
      // For flat-price addons that are part of a tier (interior, track_detailing),
      // get price from the tier's pricebook tier
      if (addon.key === "interior" && selectedTierPrice) {
        const interiorItem = selectedTierPrice.breakdown.find(
          (b) => b.service === "Interior Window Cleaning"
        )
        if (interiorItem) return interiorItem.price
        // Fallback: compute from tier prices
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

  const discountAmount =
    (Number(quote?.discount) || 0) + (Number(quote?.membership_discount) || 0)
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
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to approve quote")

      setApproved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve quote")
    } finally {
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

  if (error || !quote) {
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

  const isExpired = quote.status === "expired"
  const quoteNumber = token.slice(0, 8).toUpperCase()

  // ── Approved confirmation ────────────────────────────────────────

  if (approved) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <Card className="max-w-lg w-full">
          <CardContent className="flex flex-col items-center gap-6 py-12">
            <div className="size-20 rounded-full bg-emerald-500/10 flex items-center justify-center ring-2 ring-emerald-500/30">
              <CheckCircle className="size-10 text-emerald-400" />
            </div>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-white">Quote Approved!</h2>
              <p className="text-zinc-400">
                Thank you, {quote.customer_name}. Your quote #{quoteNumber} has been
                approved for {formatCurrency(total)}.
              </p>
            </div>
            {selectedTier && (
              <div className="bg-zinc-900/60 rounded-lg px-6 py-4 w-full max-w-sm">
                <p className="text-sm text-zinc-400 mb-1">Selected Package</p>
                <p className="text-white font-semibold text-lg">{selectedTier.name}</p>
                <p className="text-zinc-400 text-sm">{selectedTier.tagline}</p>
              </div>
            )}
            <p className="text-zinc-500 text-xs mt-4">
              We will be in touch shortly to schedule your service.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

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
                WinBros Window Cleaning
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

        {/* ── Tier Selection ──────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Choose Your Package</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Select the service level that fits your needs.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {tiers.map((tier) => {
              const isSelected = selectedTierKey === tier.key
              const colors = TIER_COLORS[tier.key] ?? TIER_COLORS.good
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
                  {/* Best Value badge */}
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
                      {TIER_ICONS[tier.key] ?? <Shield className="size-6" />}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-lg">{tier.name}</h3>
                      <p className="text-zinc-400 text-xs">{tier.tagline}</p>
                    </div>
                  </div>

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
                          {item.price === 0 && (
                            <span className="text-emerald-400 text-xs ml-1">FREE</span>
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
                      <div
                        className={`size-6 rounded-full flex items-center justify-center ${
                          tier.key === "good"
                            ? "bg-blue-500"
                            : tier.key === "better"
                            ? "bg-violet-500"
                            : "bg-amber-500"
                        }`}
                      >
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
                            <p className="text-xs text-zinc-500 mt-0.5">{addon.description}</p>
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
                    {selectedTier.name} Package
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

              {/* Discount */}
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-emerald-400">
                    {quote.membership_plan
                      ? `${quote.membership_plan} Discount`
                      : "Discount"}
                  </span>
                  <span className="text-emerald-400">
                    -{formatCurrency(discountAmount)}
                  </span>
                </div>
              )}

              {/* Total */}
              <div className="border-t border-white/[0.06] pt-3">
                <div className="flex justify-between">
                  <span className="text-white font-semibold text-lg">Total</span>
                  <span className="text-white font-bold text-2xl">
                    {formatCurrency(total)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Approve Button ──────────────────────────────────────── */}
        {!isExpired && (
          <div className="flex justify-center pb-8">
            <Button
              size="lg"
              disabled={!selectedTierKey || approving}
              onClick={handleApprove}
              className="
                w-full sm:w-auto sm:min-w-[280px] h-14 text-base font-semibold
                bg-gradient-to-r from-emerald-600 to-emerald-500
                hover:from-emerald-500 hover:to-emerald-400
                shadow-[0_0_30px_rgba(16,185,129,0.25)]
                hover:shadow-[0_0_40px_rgba(16,185,129,0.35)]
                transition-all duration-200 border-0
              "
            >
              {approving ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  Approving...
                </>
              ) : (
                <>
                  <CheckCircle className="size-5" />
                  Approve Quote
                </>
              )}
            </Button>
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="text-center pb-8">
          <p className="text-zinc-600 text-xs">
            Powered by WinBros Window Cleaning
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
