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
import { STANDARD_BASE_KEYS, STANDARD_BASE_TASKS, TIER_UPGRADES } from "@/lib/service-scope"

// ── Types ────────────────────────────────────────────────────────────

interface QuoteTier { key: string; name: string; tagline: string; badge?: string; included: string[]; description: string }
interface QuoteAddon { key: string; name: string; description: string; priceType: "flat" | "per_unit"; price: number; unit?: string }
interface CustomAddon { key: string; label: string; price: number; custom: true }
interface TierPrice { price: number; breakdown: { service: string; price: number }[]; tier: string }
interface ServicePlan { id: string; slug: string; name: string; visits_per_year: number; interval_months: number; discount_per_visit: number; free_addons: string[] | null; agreement_text: string | null }
interface ServiceAgreement { cancellation_fee: number; cancellation_window_hours: number; satisfaction_guarantee: boolean; deposit_percentage: number; processing_fee_percentage: number; terms: string[] }
interface Quote { id: string; token: string; status: "pending" | "approved" | "expired" | "cancelled"; customer_name: string | null; customer_phone: string | null; customer_email: string | null; customer_address: string | null; square_footage: number | null; bedrooms: number | null; bathrooms: number | null; selected_tier: string | null; selected_addons: string[]; subtotal: string | null; discount: string | null; total: string | null; membership_discount: string | null; membership_plan: string | null; deposit_amount: string | null; valid_until: string; approved_at: string | null; created_at: string; service_date: string | null; service_time: string | null; notes: string | null }
interface APIResponse { success: boolean; quote: Quote; tierPrices: Record<string, TierPrice>; tiers: QuoteTier[]; addons: QuoteAddon[]; serviceType: "window_cleaning" | "house_cleaning"; servicePlans: ServicePlan[]; serviceAgreement: ServiceAgreement; custom_base_price: number | null; custom_terms: string[] | null; quote_notes: string | null; checklists?: Record<string, string[]>; tenant: { name: string; slug: string; phone: string | null; email: string | null; brand_color?: string | null; brand_color_light?: string | null; logo_url?: string | null; currency?: string | null } }

// ── Helpers ──────────────────────────────────────────────────────────

function fmtCurrency(amount: number, currency = "USD"): string {
  // Use locale matching currency so domestic customers see "$" not "CA$"
  const locale = currency.toUpperCase() === "CAD" ? "en-CA" : "en-US"
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(amount)
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

// ── Detailed Checklists (what the cleaner actually does) ────────────

const STANDARD_CHECKLIST = [
  "Wipe down all kitchen countertops and stovetop",
  "Clean and sanitize kitchen sink",
  "Wipe exterior of all appliances (fridge, microwave, oven, dishwasher)",
  "Scrub and sanitize all toilets (inside and out)",
  "Clean bathtub and shower surfaces",
  "Clean bathroom vanity, sink, and mirrors",
  "Vacuum all carpeted areas",
  "Mop all hard floors",
  "Dust all reachable surfaces, furniture, and shelves",
  "Empty all trash cans and replace liners",
]

const DEEP_EXTRAS = [
  "Hand-wipe all baseboards throughout home",
  "Dust and wipe all ceiling fan blades",
  "Clean light fixtures and switch plates",
  "Clean all window sills and ledges",
  "Clean inside microwave",
  "Clean inside fridge (shelves, drawers, and door compartments)",
  "Clean inside oven (racks, walls, and door glass)",
]

// Extra Deep removed — those items are now available as individual add-ons

const MOVE_CHECKLIST = [
  "Clean all kitchen countertops, stovetop, and sink",
  "Clean inside microwave",
  "Clean inside oven (racks, walls, door glass)",
  "Clean inside fridge (shelves, drawers, compartments)",
  "Clean inside dishwasher",
  "Wipe all cabinet and drawer interiors and exteriors",
  "Degrease range hood and filter",
  "Clean garbage disposal area",
  "Clean behind and under appliances",
  "Scrub and sanitize all toilets, tubs, and showers",
  "Scrub bathroom grout",
  "Clean bathroom vanity, sink, and all mirrors",
  "Vacuum all carpeted areas and mop all hard floors",
  "Dust all surfaces and remove cobwebs",
  "Detailed hand-wipe all baseboards",
  "Detailed cleaning of all ceiling fans and light fixtures",
  "Clean all window sills, ledges, and window tracks",
  "Clean light switches, door knobs, and outlet covers",
  "Sweep and wipe all closet interiors",
  "Spot clean walls (scuffs and marks)",
  "Empty all trash and replace liners",
]

/**
 * Resolve the detailed checklist for a tier. Prefers the tenant's cleaner-
 * portal checklist from the DB (cleaning_checklists table) so the customer
 * sees the exact same list the cleaner works through in the field. Falls
 * back to hardcoded defaults if the DB is empty for a category.
 */
function tierToServiceCategory(tierKey: string): string {
  if (tierKey === 'deep' || tierKey === 'extra_deep') return 'deep_cleaning'
  if (tierKey.startsWith('move')) return 'move_in_out'
  return 'standard_cleaning'
}

/**
 * Tenant-specific scope-of-work lines that are always included for that tenant
 * on given tiers, regardless of what's in the cleaning_checklists DB table.
 * Keyed by tenant slug → service category → array of checklist strings.
 */
const TENANT_SCOPE_EXTRAS: Record<string, Record<string, string[]>> = {
  'west-niagara': {
    standard_cleaning: ['Clean interior windows (sills & glass)'],
    deep_cleaning: ['Clean interior windows (sills & glass)'],
  },
}

function getDetailedChecklist(
  tierKey: string,
  dbChecklists?: Record<string, string[]>,
  tenantSlug?: string,
): string[] {
  const category = tierToServiceCategory(tierKey)
  const extras = (tenantSlug && TENANT_SCOPE_EXTRAS[tenantSlug]?.[category]) || []
  const withExtras = (items: string[]) => {
    if (extras.length === 0) return items
    // Avoid duplicates if the DB happens to already list the same item.
    const seen = new Set(items.map((s) => s.trim().toLowerCase()))
    const unique = extras.filter((e) => !seen.has(e.trim().toLowerCase()))
    return [...items, ...unique]
  }

  const fromDb = dbChecklists?.[category]
  if (fromDb && fromDb.length > 0) {
    // Deep tier: show STANDARD + DEEP items so the customer sees the full
    // base clean plus the deep upgrades (matches cleaner's actual workflow).
    if (category === 'deep_cleaning') {
      const std = dbChecklists?.['standard_cleaning'] || []
      return withExtras([...std, ...fromDb])
    }
    return withExtras(fromDb)
  }
  // Fallback for tenants whose cleaning_checklists aren't seeded yet.
  switch (tierKey) {
    case 'standard': return withExtras(STANDARD_CHECKLIST)
    case 'deep':
    case 'extra_deep':
      return withExtras([...STANDARD_CHECKLIST, ...DEEP_EXTRAS])
    case 'move':
    case 'move_good':
    case 'move_better':
    case 'move_best':
      return MOVE_CHECKLIST
    default: return []
  }
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
  const [tierLocked, setTierLocked] = useState(false)
  const [membershipLocked, setMembershipLocked] = useState(false)
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [customerName, setCustomerName] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [customerAddress, setCustomerAddress] = useState("")
  const [showTerms, setShowTerms] = useState(false)
  const [serviceDate, setServiceDate] = useState("")
  const [serviceTime, setServiceTime] = useState("")
  const [customerNotes, setCustomerNotes] = useState("")
  const [showAllTiers, setShowAllTiers] = useState(false)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [customAddonsFromQuote, setCustomAddonsFromQuote] = useState<CustomAddon[]>([])
  // Explicit included-flag per addon (from saved_addons on the quote). Undefined means
  // no explicit flag — fall through to tier/custom defaults in isAddonIncluded.
  const [addonIncludedMap, setAddonIncludedMap] = useState<Record<string, boolean>>({})

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
        } else if (json.quote.selected_tier && (json.tiers as QuoteTier[]).some((t) => t.key === json.quote.selected_tier)) {
          // Salesman pre-selected a tier — lock it so customer can't change
          setTierLocked(true)
          const preselectedTier = json.quote.selected_tier as string
          setSelectedTierKey(preselectedTier)
        } else {
          const tierKeys = (json.tiers as QuoteTier[]).map((t) => t.key)
          // Default to the tier matching the quote's service_category (e.g. customer asked for standard on the call)
          // Fall back to middle tier (best value) if no match
          const categoryTierMap: Record<string, string> = { standard: 'standard', deep: 'deep', move_in_out: 'move' }
          const categoryTier = categoryTierMap[json.quote.service_category as string]
          const defaultTier = (categoryTier && tierKeys.includes(categoryTier))
            ? categoryTier
            : tierKeys[Math.min(1, tierKeys.length - 1)] || tierKeys[0]
          setSelectedTierKey(defaultTier)
        }

        // Initialize default per_unit addon quantities (before saved addons may override)
        const defaultQty: Record<string, number> = {}
        json.addons.forEach((a: QuoteAddon) => { if (a.priceType === "per_unit") defaultQty[a.key] = 1 })

        // Pre-select saved addons for ALL quote types (custom-priced, tier-locked, default)
        const savedAddons = json.quote.selected_addons as Array<string | { key: string; quantity?: number; label?: string; price?: number; custom?: boolean; included?: boolean }> | null
        if (savedAddons && savedAddons.length > 0) {
          const inc: Record<string, boolean> = {}
          const qty: Record<string, number> = {}
          const includedMap: Record<string, boolean> = {}
          const customAddonsList: CustomAddon[] = []
          for (const addon of savedAddons) {
            const key = typeof addon === 'string' ? addon : addon.key
            inc[key] = true
            if (typeof addon !== 'string' && addon.quantity) qty[key] = addon.quantity
            if (typeof addon !== 'string' && typeof addon.included === 'boolean') {
              includedMap[key] = addon.included
            }
            // Collect custom add-ons (not in catalog) for separate display
            if (typeof addon !== 'string' && addon.custom && addon.label && addon.price != null) {
              customAddonsList.push({ key: addon.key, label: addon.label, price: addon.price, custom: true })
            }
          }
          setSelectedAddons(inc)
          setAddonQuantities({ ...defaultQty, ...qty })
          setAddonIncludedMap(includedMap)
          if (customAddonsList.length > 0) setCustomAddonsFromQuote(customAddonsList)
        } else {
          // No saved addons — fall back to tier included addons
          const fallbackTierKey = json.quote.selected_tier as string
            || (() => {
              const tierKeys = (json.tiers as QuoteTier[]).map((t: QuoteTier) => t.key)
              const categoryTierMap: Record<string, string> = { standard: 'standard', deep: 'deep', move_in_out: 'move' }
              const categoryTier = categoryTierMap[json.quote.service_category as string]
              return (categoryTier && tierKeys.includes(categoryTier))
                ? categoryTier
                : tierKeys[Math.min(1, tierKeys.length - 1)] || tierKeys[0]
            })()
          const tierDef = (json.tiers as QuoteTier[]).find((t: QuoteTier) => t.key === fallbackTierKey)
          if (tierDef) {
            const inc: Record<string, boolean> = {}
            tierDef.included.forEach((k: string) => { inc[k] = true })
            setSelectedAddons(inc)
          }
        }

        if (json.quote.customer_name) setCustomerName(json.quote.customer_name)
        if (json.quote.customer_email) setCustomerEmail(json.quote.customer_email)
        if (json.quote.customer_address) setCustomerAddress(json.quote.customer_address)
        if (json.quote.service_date) setServiceDate(json.quote.service_date)
        if (json.quote.service_time) setServiceTime(json.quote.service_time)
        if (json.quote.status === "approved") setSelectedTierKey(json.quote.selected_tier)

        // Pre-select and lock membership if salesman already set it
        if (json.quote.membership_plan) {
          setSelectedMembership(json.quote.membership_plan)
          setMembershipLocked(true)
        }

        // Set default quantities if not already set by saved addons
        if (!savedAddons || savedAddons.length === 0) {
          setAddonQuantities(defaultQty)
        }
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
    // Keep membership selection when switching tiers (recurring works on all tiers)
    if (!data) return
    const tierDef = data.tiers.find((t) => t.key === tierKey)
    if (!tierDef) return
    // Reset all add-ons: turn ON included ones, turn OFF everything else
    setSelectedAddons(() => {
      const next: Record<string, boolean> = {}
      tierDef.included.forEach((k) => { next[k] = true })
      return next
    })
  }, [data, membershipLocked])

  // ── Computed values ──────────────────────────────────────────────

  const quote = data?.quote ?? null
  const tiers = data?.tiers ?? []
  const addons = data?.addons ?? []
  const tierPrices = data?.tierPrices ?? {}
  const servicePlans = data?.servicePlans ?? []
  const rawAgreement = data?.serviceAgreement ?? null
  // Use custom terms from the quote if available (custom-priced quotes)
  const serviceAgreement = data?.custom_terms
    ? { ...rawAgreement!, terms: data.custom_terms, satisfaction_guarantee: true }
    : rawAgreement
  const tenant = data?.tenant ?? null
  const tenantCurrency = tenant?.currency?.toUpperCase() || "USD"
  const fmt = (amount: number) => fmtCurrency(amount, tenantCurrency)
  const serviceType = data?.serviceType ?? "house_cleaning"
  const customBasePrice = data?.custom_base_price ?? null
  const isCustomPriced = customBasePrice != null
  const businessName = tenant?.name || "Our Team"

  const selectedTier = tiers.find((t) => t.key === selectedTierKey) ?? null
  const selectedTierPrice = selectedTierKey ? tierPrices[selectedTierKey] : null

  // Single inclusion rule — mirrors server-side service-scope.isEffectivelyIncluded.
  // Resolution order: explicit flag on saved addon → custom-priced default (true) →
  // tier-included fallback. Keeps admin/server/customer views in lockstep.
  const isAddonIncluded = useCallback(
    (addonKey: string): boolean => {
      const explicit = addonIncludedMap[addonKey]
      if (explicit === true) return true
      if (explicit === false) return false
      if (isCustomPriced) return true
      return !!selectedTier && selectedTier.included.includes(addonKey)
    },
    [selectedTier, isCustomPriced, addonIncludedMap]
  )

  const getAddonPrice = useCallback(
    (addon: QuoteAddon): number => {
      if (!selectedTierPrice) {
        // Custom-priced quotes: use the addon's own price (not 0)
        if (addon.priceType === "per_unit") return addon.price * (addonQuantities[addon.key] || 1)
        return addon.price
      }
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

  const catalogAddonTotal = addons.reduce((sum, addon) => {
    if (!selectedAddons[addon.key]) return sum
    if (isAddonIncluded(addon.key)) return sum
    if (STANDARD_BASE_KEYS.has(addon.key)) return sum
    return sum + getAddonPrice(addon)
  }, 0)

  // Custom add-ons (not in catalog) contribute to the total — unless flagged included.
  const customAddonTotal = customAddonsFromQuote.reduce((sum, ca) => {
    if (!selectedAddons[ca.key]) return sum
    if (isAddonIncluded(ca.key)) return sum
    return sum + ca.price
  }, 0)

  const addonTotal = catalogAddonTotal + customAddonTotal

  // Subtotal: tier/custom base + only the add-ons that are NOT included.
  // isAddonIncluded already gates catalog/custom addon totals above, so we can just sum.
  const subtotal = isCustomPriced
    ? customBasePrice + addonTotal
    : selectedTierPrice
      ? selectedTierPrice.price + addonTotal
      : 0

  // Value anchor: sum every INCLUDED add-on's reference price — this is what the
  // customer "would have paid" if nothing was bundled. Used for the struck-through
  // "Regular Price" line so the deal feels like a steal.
  const includedValueTotal = addons.reduce((sum, addon) => {
    if (!selectedAddons[addon.key]) return sum
    if (!isAddonIncluded(addon.key)) return sum
    if (STANDARD_BASE_KEYS.has(addon.key)) return sum
    return sum + getAddonPrice(addon)
  }, 0) + customAddonsFromQuote.reduce((sum, ca) => {
    if (!selectedAddons[ca.key]) return sum
    if (!isAddonIncluded(ca.key)) return sum
    return sum + ca.price
  }, 0)

  const selectedPlan = servicePlans.find((p) => p.slug === selectedMembership) ?? null
  const membershipDiscount = selectedPlan ? Number(selectedPlan.discount_per_visit) || 0 : 0
  const existingDiscount = Number(quote?.discount) || 0
  const total = Math.max(0, subtotal - existingDiscount - membershipDiscount)

  // ── Approve handler ──────────────────────────────────────────────

  async function handleApprove() {
    if (!selectedTierKey || !quote) return
    setApproving(true)
    try {
      const customKeys = new Set(customAddonsFromQuote.map(ca => ca.key))
      // Catalog addons carry an explicit included flag so the server persists it verbatim
      const activeCatalogAddons = Object.entries(selectedAddons)
        .filter(([, v]) => v)
        .map(([key]) => key)
        .filter(key => !customKeys.has(key))
        .map(key => ({ key, quantity: addonQuantities[key] || 1, included: isAddonIncluded(key) }))
      // Custom add-ons: preserve label/price AND carry included flag
      const activeCustomAddons = customAddonsFromQuote
        .filter(ca => selectedAddons[ca.key])
        .map(ca => ({ ...ca, included: isAddonIncluded(ca.key) }))
      const activeAddons = [...activeCatalogAddons, ...activeCustomAddons]
      const res = await fetch(`/api/quotes/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_tier: selectedTierKey,
          selected_addons: activeAddons,
          membership_plan: selectedPlan?.slug || null,
          customer_name: customerName || undefined,
          customer_email: customerEmail || undefined,
          customer_address: customerAddress || undefined,
          service_date: serviceDate || undefined,
          customer_notes: customerNotes || undefined,
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
  const isVapiQuote = (quote.notes || '').toLowerCase().includes('vapi')
  // VAPI quotes show single-price hero; expand to all tiers only on demand
  const singleTierMode = isVapiQuote && !tierLocked && selectedTierKey && !showAllTiers
  const quoteNumber = token.slice(0, 8).toUpperCase()
  const canApprove = selectedTierKey && !approving && agreementAccepted && !isExpired
  const activeExtraAddons = addons.filter((a) => selectedAddons[a.key] && !isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).length
    + customAddonsFromQuote.filter(ca => selectedAddons[ca.key]).length

  // ── Approved ─────────────────────────────────────────────────────

  if (isApproved) {
    // Determine the tier name for the approved quote
    const approvedTier = tiers.find((t) => t.key === quote.selected_tier)
    const approvedTierPrice = quote.selected_tier ? tierPrices[quote.selected_tier] : null
    const approvedBasePrice = isCustomPriced ? customBasePrice : (approvedTierPrice?.price ?? 0)

    // Separate base tasks / included / billable add-ons from the saved selections
    const savedAddons = (quote.selected_addons || []) as Array<string | { key: string; quantity?: number; included?: boolean; custom?: boolean; label?: string; price?: number }>
    const includedAddonObjs = savedAddons
      .map((a) => (typeof a === 'string' ? { key: a } : a))
      .filter((a) => !STANDARD_BASE_KEYS.has(a.key) && a.included === true)
    const paidAddonKeys = savedAddons
      .map((a) => (typeof a === 'string' ? { key: a, included: undefined as boolean | undefined } : a))
      .filter((a) => !STANDARD_BASE_KEYS.has(a.key) && a.included !== true)
      .map((a) => a.key)

    // Get tier upgrade keys for the selected tier
    const tierUpgradeKeys = TIER_UPGRADES[quote.selected_tier || ''] || []

    return (
      <div className="min-h-screen bg-white px-4 py-8" style={{ colorScheme: 'light' }}>
        <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600 fixed top-0 left-0 right-0 z-50" />
        <div className="max-w-lg mx-auto space-y-6 pt-4">
          {/* Success header */}
          <div className="text-center">
            <div className="size-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4 ring-4 ring-emerald-100">
              <CheckCircle className="size-10 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">You&apos;re All Set!</h2>
            <p className="text-slate-500 text-sm">Your card is on file and your cleaning is booked. Here&apos;s a summary of what you booked.</p>
          </div>

          {/* Booking details card */}
          <div className="bg-white border border-blue-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-blue-50 bg-blue-50/50">
              <h3 className="font-bold text-slate-800">Booking Summary</h3>
            </div>
            <div className="p-5 space-y-4">
              {/* Service type & tier */}
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shrink-0 text-white shadow-sm">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{approvedTier?.name || (isCustomPriced ? 'Custom Service Package' : 'Cleaning Service')}</p>
                  {approvedTier?.tagline && <p className="text-xs text-slate-400">{approvedTier.tagline}</p>}
                </div>
              </div>

              {/* Property details */}
              {(quote.bedrooms || quote.bathrooms || quote.customer_address) && (
                <div className="space-y-1.5">
                  {quote.customer_address && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <MapPin className="size-4 text-blue-400 shrink-0" />
                      <span>{quote.customer_address}</span>
                    </div>
                  )}
                  {(quote.bedrooms || quote.bathrooms) && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Home className="size-4 text-blue-400 shrink-0" />
                      <span>{quote.bedrooms || 0} bed / {quote.bathrooms || 0} bath</span>
                    </div>
                  )}
                </div>
              )}

              {/* Scheduled date/time */}
              {(quote.service_date || quote.service_time) && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar className="size-4 text-blue-400 shrink-0" />
                  <span>
                    {quote.service_date && fmtDate(quote.service_date)}
                    {quote.service_time && ` at ${new Date(`2000-01-01T${quote.service_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`}
                  </span>
                </div>
              )}

              {/* Included in Your Clean — mirrors the cleaner's actual field checklist */}
              <div className="border-t border-blue-50 pt-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Included in Your Clean</p>
                <div className="space-y-1.5">
                  {getDetailedChecklist(quote.selected_tier || '', data?.checklists, tenant?.slug).map((task, i) => (
                    <div key={`task-${i}`} className="flex items-center gap-2 text-sm text-slate-600">
                      <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {task}
                    </div>
                  ))}
                  {/* Legacy tier upgrade labels — only render as fallback when DB checklist is empty */}
                  {(!data?.checklists || Object.keys(data.checklists).length === 0) && tierUpgradeKeys.map(key => {
                    const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                    return (
                      <div key={key} className="flex items-center gap-2 text-sm text-slate-600">
                        <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {label}
                      </div>
                    )
                  })}
                  {includedAddonObjs.filter((a) => !tierUpgradeKeys.includes(a.key)).map((a) => {
                    const catalog = addons.find((ad) => ad.key === a.key)
                    const displayLabel = catalog?.name || a.label || a.key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                    const refPrice = catalog ? getAddonPrice(catalog) : (a.price ?? 0)
                    return (
                      <div key={a.key} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                          <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {displayLabel}
                        </div>
                        {refPrice > 0 && (
                          <span className="text-xs text-slate-400 line-through decoration-red-400/70 decoration-[1.5px]">{fmt(refPrice)}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Paid add-ons */}
              {paidAddonKeys.length > 0 && (
                <div className="border-t border-blue-50 pt-4">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Add-Ons</p>
                  <div className="space-y-1.5">
                    {paidAddonKeys.map(key => {
                      // Also filter out tier upgrades from paid add-ons display
                      if (tierUpgradeKeys.includes(key)) return null
                      const addonDef = addons.find(a => a.key === key)
                      const addonPrice = addonDef ? getAddonPrice(addonDef) : 0
                      return (
                        <div key={key} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-slate-600">
                            <Plus className="size-3.5 text-blue-500 shrink-0" />
                            {addonDef?.name || key.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                          </div>
                          {addonPrice > 0 && <span className="text-slate-700 font-medium">{fmt(addonPrice)}</span>}
                        </div>
                      )
                    }).filter(Boolean)}
                  </div>
                </div>
              )}

              {/* Price breakdown */}
              <div className="border-t-2 border-blue-100 pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Base service</span>
                  <span className="text-slate-700">{fmt(approvedBasePrice)}</span>
                </div>
                {paidAddonKeys.filter(k => !tierUpgradeKeys.includes(k)).length > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Add-ons</span>
                    <span className="text-slate-700">
                      {fmt(paidAddonKeys.filter(k => !tierUpgradeKeys.includes(k)).reduce((sum, key) => {
                        const addonDef = addons.find(a => a.key === key)
                        return sum + (addonDef ? getAddonPrice(addonDef) : 0)
                      }, 0))}
                    </span>
                  </div>
                )}
                {Number(quote.discount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600">Discount</span>
                    <span className="text-emerald-600">-{fmt(Number(quote.discount))}</span>
                  </div>
                )}
                {Number(quote.membership_discount) > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600">Membership discount</span>
                    <span className="text-emerald-600">-{fmt(Number(quote.membership_discount))}</span>
                  </div>
                )}
                <div className="border-t border-blue-50 pt-2">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-800 font-bold text-lg">Total</span>
                    <span className="text-slate-800 font-bold text-2xl">{quote.total ? fmt(Number(quote.total)) : fmt(approvedBasePrice)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Contact info */}
          {tenant?.phone && (
            <div className="text-center">
              <p className="text-slate-400 text-sm mb-2">Questions? Give us a call.</p>
              <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium">
                <Phone className="size-4" /> {tenant.phone}
              </a>
            </div>
          )}

          <div className="text-center pb-4">
            <p className="text-slate-300 text-xs">Powered by {businessName}</p>
          </div>
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
        {isCustomPriced ? (() => {
          // Determine checklist from selected_tier (most specific) or service_category
          const tier = (quote as any).selected_tier as string || ''
          const cat = (quote as any).service_category as string || 'standard'
          const tierKeyMap: Record<string, string> = { standard: 'standard', deep: 'deep', extra_deep: 'extra_deep', move: 'move', move_good: 'move', move_better: 'move', move_best: 'move' }
          const catKeyMap: Record<string, string> = { standard: 'standard', move_in_out: 'move' }
          const customTierKey = tierKeyMap[tier] || catKeyMap[cat] || 'standard'
          const customChecklist = getDetailedChecklist(customTierKey, data?.checklists, tenant?.slug)
          // Show service type name
          const nameMap: Record<string, string> = { standard: 'Standard Clean', deep: 'Deep Clean', move: 'Move-Out Clean' }
          const serviceName = nameMap[customTierKey] || 'Custom Service Package'
          return (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Your Custom Quote</h2>
            <p className="text-slate-400 text-sm mb-3">Prepared by our team specifically for your property.</p>
            <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-slate-800 font-bold text-lg">{serviceName}</h3>
                  <p className="text-slate-500 text-sm mt-1">{quote.customer_address || "Your property"}</p>
                </div>
                <span className="text-2xl font-bold text-slate-800">{fmt(customBasePrice)}</span>
              </div>
              {/* What's included — inside the blue box */}
              {serviceType === "house_cleaning" && (
                <div className="border-t border-blue-200 pt-4">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">What&apos;s Included</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {customChecklist.map((task, i) => (
                      <div key={`task-${i}`} className="flex items-center gap-2 text-sm text-slate-600">
                        <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {task}
                      </div>
                    ))}
                    {/* Included add-ons — shown in the customer scope AND the cleaner's portal */}
                    {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => (
                      <div key={`addon-${addon.key}`} className="flex items-center gap-2 text-sm text-slate-600">
                        <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {addon.name}
                      </div>
                    ))}
                    {customAddonsFromQuote.filter(ca => selectedAddons[ca.key] && isAddonIncluded(ca.key)).map((ca) => (
                      <div key={`custom-${ca.key}`} className="flex items-center gap-2 text-sm text-slate-600">
                        <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {ca.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          )
        })() : (
        <div>
          {/* Single-price hero view for VAPI quotes */}
          {singleTierMode && selectedTier && selectedTierPrice ? (
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Your Cleaning Quote</h2>
              <p className="text-slate-400 text-sm mb-4">Based on your {quote.bedrooms || 0} bed / {quote.bathrooms || 0} bath home.</p>

              <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-5 sm:p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="size-12 rounded-xl bg-blue-600 flex items-center justify-center shrink-0 text-white shadow-sm">
                    {TIER_ICONS[tiers.findIndex(t => t.key === selectedTierKey)] ?? <Shield className="size-6" />}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-slate-800 font-bold text-lg">{selectedTier.name}</h3>
                    <p className="text-slate-500 text-sm">{selectedTier.description}</p>
                  </div>
                  <span className="text-3xl font-bold text-slate-800">{fmt(selectedTierPrice.price)}</span>
                </div>

                {/* What's included checklist — mirrors the cleaner's field checklist 1:1 */}
                <div className="border-t border-blue-200 pt-4 space-y-2">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">What&apos;s Included</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {getDetailedChecklist(selectedTierKey || '', data?.checklists, tenant?.slug).map((task, i) => (
                      <div key={`task-${i}`} className="flex items-start gap-2">
                        <Check className="size-3.5 shrink-0 mt-0.5 text-emerald-500" />
                        <span className="text-sm text-slate-600">{task}</span>
                      </div>
                    ))}
                    {/* Included add-ons become checklist items too — cleaner sees these in their portal */}
                    {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => (
                      <div key={`addon-${addon.key}`} className="flex items-start gap-2">
                        <Check className="size-3.5 shrink-0 mt-0.5 text-emerald-500" />
                        <span className="text-sm text-slate-600">{addon.name}</span>
                      </div>
                    ))}
                    {customAddonsFromQuote.filter(ca => selectedAddons[ca.key] && isAddonIncluded(ca.key)).map((ca) => (
                      <div key={`custom-${ca.key}`} className="flex items-start gap-2">
                        <Check className="size-3.5 shrink-0 mt-0.5 text-emerald-500" />
                        <span className="text-sm text-slate-600">{ca.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* "See other options" link */}
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowAllTiers(true)}
                  className="mt-3 text-sm text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 mx-auto"
                >
                  Want to upgrade? See all options <ChevronDown className="size-4" />
                </button>
              )}
            </div>
          ) : (
          /* Full tier selection (locked salesman quotes, expanded view, or non-VAPI) */
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">{tierLocked ? "Your Package" : "Choose Your Package"}</h2>
            <p className="text-slate-400 text-sm mb-5">{tierLocked ? "Selected for your recurring service." : "Select the service level that fits your needs."}</p>

            <div className={`space-y-3 sm:space-y-0 ${tiers.length === 1 ? "sm:max-w-md sm:mx-auto" : tiers.length === 2 ? "sm:grid sm:grid-cols-2 sm:gap-5" : "sm:grid sm:grid-cols-3 sm:gap-4"}`}>
              {tiers.map((tier, idx) => {
                const isSelected = selectedTierKey === tier.key
                const price = tierPrices[tier.key]?.price ?? 0
                const breakdown = tierPrices[tier.key]?.breakdown ?? []
                const colors = TIER_COLORS[idx] || TIER_COLORS[0]

                return (
                  <button
                    key={tier.key}
                    type="button"
                    disabled={isExpired || tierLocked}
                    onClick={() => handleTierChange(tier.key)}
                    className={`
                      relative w-full text-left rounded-2xl border-2 transition-all duration-200 p-5 flex flex-col
                      ${isSelected
                        ? `${colors.bg} ${colors.border} ring-2 ${colors.ring} shadow-lg`
                        : "bg-white border-blue-100 hover:border-blue-200 hover:shadow-md"
                      }
                      ${isExpired ? "opacity-50 cursor-not-allowed" : tierLocked ? "cursor-default" : "cursor-pointer active:scale-[0.98]"}
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

            {/* Collapse back to single view */}
            {showAllTiers && isVapiQuote && (
              <button
                type="button"
                onClick={() => setShowAllTiers(false)}
                className="mt-3 text-sm text-slate-400 hover:text-slate-500 font-medium flex items-center gap-1 mx-auto"
              >
                Show less <ChevronUp className="size-4" />
              </button>
            )}
          </div>
          )}
        </div>
        )}

        {/* ── What's Included (for non-custom quotes that don't have it in the blue box) */}
        {serviceType === "house_cleaning" && !isCustomPriced && !singleTierMode && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Included in your {selectedTier?.name || 'Standard'} Clean</h3>
            <ul className="space-y-1">
              {getDetailedChecklist(selectedTierKey || 'standard', data?.checklists, tenant?.slug).map((task, i) => (
                <li key={`base-${i}`} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <svg className="h-4 w-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {task}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Add-ons (filter out standard base tasks — they're included in every cleaning) */}
        {(addons.filter(a => !STANDARD_BASE_KEYS.has(a.key)).length > 0 || customAddonsFromQuote.length > 0) && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">Customize Your Clean</h2>
            <p className="text-slate-400 text-sm mb-5">Tap to add or remove. Build your perfect package.</p>

            <div className="space-y-2">
              {addons.filter(a => !STANDARD_BASE_KEYS.has(a.key)).map((addon) => {
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

              {/* Custom add-ons from quote (not in catalog) — displayed as read-only checked items */}
              {customAddonsFromQuote.map((ca) => {
                const checked = !!selectedAddons[ca.key]
                return (
                  <div key={ca.key}
                    className={`rounded-xl border-2 transition-all duration-150 overflow-hidden ${
                      checked ? "border-blue-300 bg-blue-50/50" : "border-blue-100 bg-white"
                    } ${isExpired ? "opacity-50" : ""}`}
                  >
                    <div className="w-full text-left p-4 flex items-center gap-3">
                      <div className={`size-7 rounded-lg border-2 flex items-center justify-center shrink-0 transition-all ${
                        checked ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 bg-white"
                      }`}>
                        {checked && <Check className="size-4" />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">{ca.label}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">CUSTOM</span>
                        </div>
                      </div>

                      <span className="text-sm font-bold shrink-0 text-slate-700">
                        {fmt(ca.price)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Membership Plans (hidden for custom-priced — discount already applied) */}
        {!isExpired && !isCustomPriced && servicePlans.length > 0 && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1">{membershipLocked ? "Your Recurring Plan" : "Save with a Membership"}</h2>
            <p className="text-slate-400 text-sm mb-5">{membershipLocked ? "Included with your service." : "Regular service = bigger savings every visit."}</p>

            <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-3">
              {!membershipLocked && (
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
              )}

              {servicePlans.map((plan) => {
                const isSelected = selectedMembership === plan.slug
                const freeAddons = plan.free_addons || []
                if (membershipLocked && !isSelected) return null
                return (
                  <button key={plan.slug} type="button" onClick={() => !membershipLocked && setSelectedMembership(plan.slug)}
                    className={`relative w-full text-left rounded-xl border-2 p-4 transition-all ${membershipLocked ? "cursor-default" : "cursor-pointer active:scale-[0.98]"} ${
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

        {/* ── Preferred Service Date & Time ─────────────────────────── */}
        {!isExpired && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <Calendar className="size-5 text-blue-500" />
              Preferred Service Date & Time
            </h2>
            <p className="text-slate-400 text-sm mb-4">Pick a date and time that works best for you.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={`border-2 rounded-2xl p-4 transition-all ${serviceDate ? "border-blue-300 bg-blue-50/50" : "border-blue-100 bg-white"}`}>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Date</label>
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
              </div>

              <div className={`border-2 rounded-2xl p-4 transition-all ${serviceTime ? "border-blue-300 bg-blue-50/50" : "border-blue-100 bg-white"}`}>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Time</label>
                <input
                  type="time"
                  value={serviceTime}
                  onChange={(e) => setServiceTime(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-blue-200 bg-white text-slate-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                />
                {serviceTime && (
                  <p className="mt-2 text-sm text-blue-600 font-medium flex items-center gap-1.5">
                    <Clock className="size-4" />
                    {new Date(`2000-01-01T${serviceTime}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                  </p>
                )}
              </div>
            </div>

            {!serviceDate && !serviceTime && (
              <p className="mt-2 text-xs text-slate-400">Optional — we&apos;ll contact you to schedule if you skip this.</p>
            )}
          </div>
        )}

        {/* ── Customer Notes ──────────────────────────────────── */}
        {!isExpired && (
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <FileText className="size-5 text-blue-500" />
              Notes
            </h2>
            <p className="text-slate-400 text-sm mb-4">Anything we should know? Special instructions, pets, access codes, etc.</p>
            <textarea
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              placeholder="e.g. Key under the mat, please avoid the back bedroom..."
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl border-2 border-blue-100 bg-white text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 resize-none placeholder:text-slate-300"
            />
            <p className="text-right text-xs text-slate-300 mt-1">{customerNotes.length}/500</p>
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
              <div>
                <button
                  type="button"
                  onClick={() => setSummaryExpanded(!summaryExpanded)}
                  className="w-full flex justify-between items-center text-sm group"
                >
                  <span className="text-slate-600 flex items-center gap-1.5">
                    Custom Service Package
                    {summaryExpanded ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}
                  </span>
                  <span className="text-slate-800 font-semibold">{fmt(customBasePrice)}</span>
                </button>
                {summaryExpanded && (() => {
                  // Mirror the cleaner-portal checklist for the quote's tier.
                  const q = quote as Quote & { selected_tier?: string | null; service_category?: string | null }
                  const tierKey = (q.selected_tier as string) || (q.service_category === 'move_in_out' ? 'move' : 'standard')
                  return (
                  <div className="mt-2.5 ml-1 pl-3 border-l-2 border-emerald-200 space-y-1.5 pb-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What&apos;s included</p>
                    {getDetailedChecklist(tierKey, data?.checklists, tenant?.slug).map((task, i) => (
                      <div key={`task-${i}`} className="flex items-start gap-2">
                        <CheckCircle className="size-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        <span className="text-xs text-slate-600">{task}</span>
                      </div>
                    ))}
                    {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => (
                      <div key={`addon-${addon.key}`} className="flex items-start gap-2">
                        <CheckCircle className="size-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        <span className="text-xs text-slate-600">{addon.name}</span>
                      </div>
                    ))}
                    {customAddonsFromQuote.filter(ca => selectedAddons[ca.key] && isAddonIncluded(ca.key)).map((ca) => (
                      <div key={`custom-${ca.key}`} className="flex items-start gap-2">
                        <CheckCircle className="size-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        <span className="text-xs text-slate-600">{ca.label}</span>
                      </div>
                    ))}
                  </div>
                )})()}
              </div>
            ) : selectedTier && selectedTierPrice ? (
              <div>
                <button
                  type="button"
                  onClick={() => setSummaryExpanded(!summaryExpanded)}
                  className="w-full flex justify-between items-center text-sm group"
                >
                  <span className="text-slate-600 flex items-center gap-1.5">
                    {selectedTier.name}
                    {summaryExpanded ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}
                  </span>
                  <span className="text-slate-800 font-semibold">{fmt(selectedTierPrice.price)}</span>
                </button>
                {summaryExpanded && (
                  <div className="mt-2.5 ml-1 pl-3 border-l-2 border-emerald-200 space-y-1.5 pb-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">What&apos;s included</p>
                    {getDetailedChecklist(selectedTierKey || '', data?.checklists, tenant?.slug).map((task, i) => (
                      <div key={`base-${i}`} className="flex items-start gap-2">
                        <CheckCircle className="size-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        <span className="text-xs text-slate-600">{task}</span>
                      </div>
                    ))}
                    {/* Extra add-ons the admin marked as included */}
                    {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key) && !(selectedTier?.included || []).includes(a.key)).map((addon) => (
                      <div key={`extra-${addon.key}`} className="flex items-start gap-2">
                        <CheckCircle className="size-3.5 shrink-0 mt-0.5 text-emerald-400" />
                        <span className="text-xs text-slate-600">{addon.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {/* Add-on line items — shown for ALL quote types */}
            {addons.filter((a) => selectedAddons[a.key] && !isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => (
              <div key={addon.key} className="flex justify-between text-sm">
                <span className="text-slate-500">+ {addon.name}{addon.priceType === "per_unit" && (addonQuantities[addon.key] || 1) > 1 ? ` x${addonQuantities[addon.key]}` : ""}</span>
                <span className="text-slate-700">{fmt(getAddonPrice(addon))}</span>
              </div>
            ))}

            {/* Custom add-ons line items */}
            {customAddonsFromQuote.filter(ca => selectedAddons[ca.key]).map((ca) => (
              <div key={ca.key} className="flex justify-between text-sm">
                <span className="text-slate-500">+ {ca.label} <span className="text-[10px] text-blue-500">(Custom)</span></span>
                <span className="text-slate-700">{fmt(ca.price)}</span>
              </div>
            ))}

            {addons.filter((a) => selectedAddons[a.key] && isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => {
              const refPrice = getAddonPrice(addon)
              return (
                <div key={addon.key} className="flex justify-between text-sm">
                  <span className="text-slate-500">{addon.name}</span>
                  <span className="text-xs font-medium flex items-center gap-2">
                    {refPrice > 0 && <span className="text-slate-400 line-through decoration-red-400/70 decoration-[1.5px]">{fmt(refPrice)}</span>}
                    <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">Included</span>
                  </span>
                </div>
              )
            })}
            {customAddonsFromQuote.filter(ca => selectedAddons[ca.key] && isAddonIncluded(ca.key)).map((ca) => (
              <div key={ca.key} className="flex justify-between text-sm">
                <span className="text-slate-500">{ca.label} <span className="text-[10px] text-blue-500">(Custom)</span></span>
                <span className="text-xs font-medium flex items-center gap-2">
                  {ca.price > 0 && <span className="text-slate-400 line-through decoration-red-400/70 decoration-[1.5px]">{fmt(ca.price)}</span>}
                  <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">Included</span>
                </span>
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
              {includedValueTotal > 0 && (
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-slate-400 text-xs">Regular Price</span>
                  <span className="text-slate-400 text-sm line-through decoration-red-400/70 decoration-[1.5px]">{fmt(total + includedValueTotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline">
                <span className="text-slate-800 font-bold text-lg">Total</span>
                <span className="text-slate-800 font-bold text-3xl">{fmt(total)}</span>
              </div>
              {includedValueTotal > 0 && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1">
                  <Sparkles className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-700 text-xs font-bold">You save {fmt(includedValueTotal)}</span>
                </div>
              )}
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
        {/* Line-item breakdown on mobile */}
        {addonTotal > 0 && (
          <div className="mb-2 pb-2 border-b border-blue-50 space-y-0.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Base Service</span>
              <span>{fmt(isCustomPriced ? customBasePrice : (selectedTierPrice?.price || 0))}</span>
            </div>
            {addons.filter((a) => selectedAddons[a.key] && !isAddonIncluded(a.key) && !STANDARD_BASE_KEYS.has(a.key)).map((addon) => (
              <div key={addon.key} className="flex justify-between text-xs text-slate-500">
                <span>+ {addon.name}</span>
                <span>{fmt(getAddonPrice(addon))}</span>
              </div>
            ))}
            {customAddonsFromQuote.filter(ca => selectedAddons[ca.key]).map((ca) => (
              <div key={ca.key} className="flex justify-between text-xs text-slate-500">
                <span>+ {ca.label}</span>
                <span>{fmt(ca.price)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mb-2.5">
          <div>
            <span className="text-xs text-slate-400">Total</span>
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-bold text-slate-800">{fmt(total)}</p>
              {includedValueTotal > 0 && (
                <span className="text-[11px] text-slate-400 line-through decoration-red-400/70 decoration-[1.5px]">{fmt(total + includedValueTotal)}</span>
              )}
            </div>
          </div>
          {includedValueTotal > 0 ? (
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">Save {fmt(includedValueTotal)}</span>
          ) : activeExtraAddons > 0 ? (
            <span className="text-xs text-slate-400 bg-blue-50 px-2 py-1 rounded-full">{activeExtraAddons} add-on{activeExtraAddons !== 1 ? "s" : ""}</span>
          ) : null}
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
