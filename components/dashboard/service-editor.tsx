"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Save, Plus, Trash2, X, ChevronUp, Layers, Grid3X3, DollarSign, Puzzle, Crown } from "lucide-react"
import { cn } from "@/lib/utils"
import CubeLoader from "@/components/ui/cube-loader"

// ── Types ────────────────────────────────────────────────────────────

type WindowTierRow = {
  maxSqft: number
  label: string
  exterior: number
  interior: number
  trackDetailing: number
}

type FlatServiceRow = {
  name: string
  keywords: string[]
  price: number
  active?: boolean
}

type AddonRow = {
  id?: number
  addon_key: string
  label: string
  flat_price: number | null
  active: boolean
}

type PricingTierRow = {
  id?: number
  service_type: string
  bedrooms: number
  bathrooms: number
  max_sq_ft: number
  price: number
  price_min: number | null
  price_max: number | null
  labor_hours: number
  cleaners: number
  hours_per_cleaner: number | null
}

type WinBrosAddonRow = {
  addon_key: string
  label: string
  flat_price: number
  active?: boolean
}

type ServicePlan = {
  id?: string
  slug: string
  name: string
  visits_per_year: number
  interval_months: number
  discount_per_visit: number
  free_addons: string[]
  active: boolean
  _isNew?: boolean
  _deleted?: boolean
}

// ── Component ────────────────────────────────────────────────────────

export function ServiceEditor() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [isWindowCleaning, setIsWindowCleaning] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))

  // WinBros state
  const [windowTiers, setWindowTiers] = useState<WindowTierRow[]>([])
  const [flatServices, setFlatServices] = useState<FlatServiceRow[]>([])
  const [plans, setPlans] = useState<ServicePlan[]>([])
  const [jobServiceTypes, setJobServiceTypes] = useState<string[]>([])
  const [winbrosAddons, setWinbrosAddons] = useState<WinBrosAddonRow[]>([])

  // House cleaning state
  const [serviceTypes, setServiceTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>("")
  const [tiers, setTiers] = useState<Record<string, PricingTierRow[]>>({})
  const [addons, setAddons] = useState<AddonRow[]>([])

  // New type input
  const ALLOWED_SERVICE_TYPES = ["standard", "deep", "move"]
  const [newTypeName, setNewTypeName] = useState("")
  const [showNewType, setShowNewType] = useState(false)

  // Cleaner pay state
  const [cleanerPayModel, setCleanerPayModel] = useState<'percentage' | 'hourly'>('hourly')
  const [cleanerPayPct, setCleanerPayPct] = useState<number>(35)
  const [cleanerPayStd, setCleanerPayStd] = useState<number>(25)
  const [cleanerPayDeep, setCleanerPayDeep] = useState<number>(25)
  const [currencySymbol, setCurrencySymbol] = useState('$')

  // ── Load data ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      // Detect tenant type
      const settingsRes = await fetch("/api/actions/settings")
      const settingsData = await settingsRes.json()
      const desc = (settingsData.service_description || "").toLowerCase()
      const isWindow = desc.includes("window")
      setIsWindowCleaning(isWindow)

      if (isWindow) {
        // WinBros: load window tiers and flat services from workflow_config
        const storedTiers = settingsData.window_tiers as WindowTierRow[] | null
        if (storedTiers && Array.isArray(storedTiers) && storedTiers.length > 0) {
          setWindowTiers(storedTiers)
        } else {
          // Load hardcoded defaults
          setWindowTiers([
            { maxSqft: 2499, label: "Up to 20 Panes", exterior: 275, interior: 80, trackDetailing: 50 },
            { maxSqft: 3499, label: "Up to 40 Panes", exterior: 295, interior: 160, trackDetailing: 100 },
            { maxSqft: 4999, label: "Up to 60 Panes", exterior: 345, interior: 240, trackDetailing: 150 },
            { maxSqft: 6499, label: "Up to 80 Panes", exterior: 445, interior: 320, trackDetailing: 200 },
            { maxSqft: 7999, label: "Up to 100 Panes", exterior: 555, interior: 400, trackDetailing: 250 },
            { maxSqft: 8999, label: "Up to 120 Panes", exterior: 645, interior: 400, trackDetailing: 300 },
          ])
        }

        const storedFlat = settingsData.flat_services as FlatServiceRow[] | null
        if (storedFlat && Array.isArray(storedFlat) && storedFlat.length > 0) {
          setFlatServices(storedFlat)
        } else {
          // Defaults — keywords must match SURFACE_KEYWORD_MAP in pricebook.ts
          setFlatServices([
            { name: "House Washing", keywords: ["house_wash", "house wash", "soft wash"], price: 300 },
            { name: "Driveway Cleaning", keywords: ["driveway"], price: 250 },
            { name: "Patio Cleaning", keywords: ["patio"], price: 150 },
            { name: "Sidewalk Cleaning", keywords: ["sidewalk"], price: 100 },
            { name: "Deck Washing", keywords: ["deck"], price: 175 },
            { name: "Fence Cleaning", keywords: ["fence"], price: 250 },
            { name: "Pool Deck Cleaning", keywords: ["pool_deck", "pool deck"], price: 250 },
            { name: "Retaining Wall Cleaning", keywords: ["retaining_wall", "retaining wall"], price: 200 },
            { name: "Stone Cleaning", keywords: ["stone"], price: 150 },
            { name: "Gutter and Soffit Washing", keywords: ["soffit", "gutter wash"], price: 200 },
            { name: "Gutter Cleaning", keywords: ["gutter_cleaning"], price: 250 },
          ])
        }

        // Load job service types (calendar create-job dropdown)
        const storedJobTypes = settingsData.job_service_types as string[] | null
        if (storedJobTypes && Array.isArray(storedJobTypes) && storedJobTypes.length > 0) {
          setJobServiceTypes(storedJobTypes)
        } else {
          setJobServiceTypes(["Window cleaning", "Pressure washing", "Gutter cleaning", "Walkthru"])
        }

        // Load WinBros add-ons
        const storedAddons = settingsData.winbros_addons as WinBrosAddonRow[] | null
        if (storedAddons && Array.isArray(storedAddons) && storedAddons.length > 0) {
          setWinbrosAddons(storedAddons)
        } else {
          setWinbrosAddons([
            { addon_key: "interior", label: "Interior Window Cleaning", flat_price: 0 },
            { addon_key: "track_detailing", label: "Track Detailing", flat_price: 0 },
            { addon_key: "solar_panel", label: "Solar Panel Cleaning", flat_price: 7 },
            { addon_key: "hard_water_treatment", label: "Hard Water Stain Treatment", flat_price: 12 },
            { addon_key: "rain_repellent", label: "Rain Repellent", flat_price: 0 },
            { addon_key: "rain_guarantee", label: "7-Day Rain Guarantee", flat_price: 0 },
          ])
        }

        // Load membership plans
        const plansRes = await fetch("/api/service-plans")
        const plansData = await plansRes.json()
        setPlans((plansData.plans || []).map((p: any) => ({ ...p, _isNew: false, _deleted: false })))
      } else {
        // House cleaning: load tiers grouped by service_type
        const pricingRes = await fetch("/api/pricing")
        const pricingData = await pricingRes.json()
        const tiersData: Record<string, PricingTierRow[]> = pricingData.data?.tiers || {}
        setTiers(tiersData)
        const types = Object.keys(tiersData)
        setServiceTypes(types)
        setSelectedType(types[0] || "")

        // Load addons
        const addonsData: AddonRow[] = (pricingData.data?.addons || []).map((a: any) => ({
          id: a.id,
          addon_key: a.addon_key,
          label: a.label,
          flat_price: a.flat_price,
          active: a.active ?? true,
        }))
        setAddons(addonsData)

        // Load cleaner pay config
        const cp = settingsData.cleaner_pay
        if (cp) {
          setCleanerPayModel(cp.model || 'hourly')
          if (cp.percentage != null) setCleanerPayPct(cp.percentage)
          if (cp.hourly_standard != null) setCleanerPayStd(cp.hourly_standard)
          if (cp.hourly_deep != null) setCleanerPayDeep(cp.hourly_deep)
        }
        setCurrencySymbol(settingsData.currency === 'cad' ? 'C$' : '$')
      }
    } catch {
      setError("Failed to load pricing data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // ── Save ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true)
    setError("")
    setSuccess(false)

    try {
      if (isWindowCleaning) {
        // Save window tiers and flat services to workflow_config via settings API
        const settingsRes = await fetch("/api/actions/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            window_tiers: windowTiers,
            flat_services: flatServices.map((f) => ({
              name: f.name,
              keywords: f.keywords && f.keywords.length > 0
                ? f.keywords
                : [f.name.toLowerCase().replace(/[^a-z0-9\s]+/g, "").trim().replace(/\s+/g, "_")],
              price: f.price,
              active: f.active !== false,
            })),
            job_service_types: jobServiceTypes.filter((t) => t.trim() !== ""),
            winbros_addons: winbrosAddons
              .filter((a) => a.label.trim() !== "")
              .map((a) => ({
                ...a,
                addon_key: a.addon_key || a.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
              })),
          }),
        })
        const settingsResult = await settingsRes.json()
        if (!settingsResult.success) {
          setError(settingsResult.error || "Failed to save pricing")
          return
        }

        // Save membership plans
        for (const plan of plans) {
          if (plan._deleted && plan.id) {
            await fetch("/api/service-plans", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: plan.id }),
            })
          } else if (plan._isNew && !plan._deleted) {
            await fetch("/api/service-plans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: plan.name,
                visits_per_year: plan.visits_per_year,
                interval_months: plan.interval_months,
                discount_per_visit: plan.discount_per_visit,
                free_addons: plan.free_addons,
              }),
            })
          } else if (plan.id && !plan._deleted) {
            await fetch("/api/service-plans", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: plan.id,
                name: plan.name,
                visits_per_year: plan.visits_per_year,
                interval_months: plan.interval_months,
                discount_per_visit: plan.discount_per_visit,
                free_addons: plan.free_addons,
              }),
            })
          }
        }
      } else {
        // House cleaning: save tiers + addons
        const pricingRes = await fetch("/api/pricing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tiers,
            addons: addons.map((a) => ({
              addon_key: a.addon_key,
              label: a.label,
              minutes: 0,
              flat_price: a.flat_price,
              price_multiplier: 1,
              included_in: null,
              keywords: null,
              active: a.active,
            })),
          }),
        })
        const result = await pricingRes.json()
        if (!result.success) {
          setError(result.error || "Failed to save pricing")
          return
        }

        // Save cleaner pay config via settings API
        const cpRes = await fetch("/api/actions/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cleaner_pay: {
              model: cleanerPayModel,
              percentage: cleanerPayPct,
              hourly_standard: cleanerPayStd,
              hourly_deep: cleanerPayDeep,
            },
          }),
        })
        const cpResult = await cpRes.json()
        if (!cpResult.success) {
          setError(cpResult.error || "Failed to save cleaner pay")
          return
        }
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
      // Reload to get fresh IDs
      await loadData()
    } catch {
      setError("Failed to save changes")
    } finally {
      setSaving(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  const prettifyType = (t: string) =>
    t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select()

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[300px]">
        <CubeLoader />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <div className="space-y-4">
        {isWindowCleaning ? (
          <>
            {/* ── WinBros: Job Service Types ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.jobTypes ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("jobTypes")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 transition-colors duration-300">
                  <Layers className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Job Service Types</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.jobTypes ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {jobServiceTypes.length} types configured
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setJobServiceTypes([...jobServiceTypes, ""]); setOpenSections((prev) => ({ ...prev, jobTypes: true })) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.jobTypes ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.jobTypes ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Type Name</th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {jobServiceTypes.map((type, i) => (
                            <tr
                              key={i}
                              className={cn(
                                "border-b border-white/[0.04]",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.jobTypes ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.jobTypes ? `${i * 50}ms` : "0ms" }}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={type}
                                  onChange={(e) => {
                                    const updated = [...jobServiceTypes]
                                    updated[i] = e.target.value
                                    setJobServiceTypes(updated)
                                  }}
                                  className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setJobServiceTypes(jobServiceTypes.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── WinBros: Window Tiers ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.tiers ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("tiers")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 transition-colors duration-300">
                  <Grid3X3 className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Window Cleaning Tiers</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.tiers ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {windowTiers.length} tiers · sqft-based pricing
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setWindowTiers([...windowTiers, { maxSqft: 0, label: "", exterior: 0, interior: 0, trackDetailing: 0 }])
                    setOpenSections((prev) => ({ ...prev, tiers: true }))
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.tiers ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.tiers ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Max Sqft</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Label</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Exterior $</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Interior $</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Track $</th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {windowTiers.map((tier, i) => (
                            <tr
                              key={i}
                              className={cn(
                                "border-b border-white/[0.04]",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.tiers ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.tiers ? `${i * 50}ms` : "0ms" }}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  value={tier.maxSqft}
                                  onChange={(e) => {
                                    const updated = [...windowTiers]
                                    updated[i] = { ...tier, maxSqft: Number(e.target.value) || 0 }
                                    setWindowTiers(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={tier.label}
                                  onChange={(e) => {
                                    const updated = [...windowTiers]
                                    updated[i] = { ...tier, label: e.target.value }
                                    setWindowTiers(updated)
                                  }}
                                  className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  value={tier.exterior}
                                  onChange={(e) => {
                                    const updated = [...windowTiers]
                                    updated[i] = { ...tier, exterior: Number(e.target.value) || 0 }
                                    setWindowTiers(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  value={tier.interior}
                                  onChange={(e) => {
                                    const updated = [...windowTiers]
                                    updated[i] = { ...tier, interior: Number(e.target.value) || 0 }
                                    setWindowTiers(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  value={tier.trackDetailing}
                                  onChange={(e) => {
                                    const updated = [...windowTiers]
                                    updated[i] = { ...tier, trackDetailing: Number(e.target.value) || 0 }
                                    setWindowTiers(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setWindowTiers(windowTiers.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── WinBros: Flat Services ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.flatServices ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("flatServices")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 transition-colors duration-300">
                  <DollarSign className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Flat Rate Services</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.flatServices ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {flatServices.length} services · pressure washing & more
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setFlatServices([...flatServices, { name: "", keywords: [], price: 0, active: true }]); setOpenSections((prev) => ({ ...prev, flatServices: true })) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.flatServices ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.flatServices ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Service Name</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Price $</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Status</th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {flatServices.map((svc, i) => (
                            <tr
                              key={i}
                              className={cn(
                                "border-b border-white/[0.04]",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.flatServices ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.flatServices ? `${i * 50}ms` : "0ms" }}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={svc.name}
                                  onChange={(e) => {
                                    const updated = [...flatServices]
                                    updated[i] = { ...svc, name: e.target.value }
                                    setFlatServices(updated)
                                  }}
                                  className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  placeholder="Service name"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  value={svc.price}
                                  onChange={(e) => {
                                    const updated = [...flatServices]
                                    updated[i] = { ...svc, price: Number(e.target.value) || 0 }
                                    setFlatServices(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => {
                                    const updated = [...flatServices]
                                    updated[i] = { ...svc, active: svc.active === false ? true : false }
                                    setFlatServices(updated)
                                  }}
                                  className={cn(
                                    "text-xs px-2 py-1 rounded-md border transition-colors",
                                    svc.active !== false
                                      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                                      : "text-zinc-500 border-zinc-700/50 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-zinc-300",
                                  )}
                                >
                                  {svc.active !== false ? "Active" : "Off"}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setFlatServices(flatServices.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── WinBros: Add-Ons ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.addons ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("addons")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 transition-colors duration-300">
                  <Puzzle className="h-5 w-5 text-amber-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Add-Ons</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.addons ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {winbrosAddons.length} extras · optional job add-ons
                  </p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setWinbrosAddons([...winbrosAddons, { addon_key: "", label: "", flat_price: 0, active: true }]); setOpenSections((prev) => ({ ...prev, addons: true })) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.addons ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.addons ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Add-On Name</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Price $</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Status</th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {winbrosAddons.map((addon, i) => (
                            <tr
                              key={i}
                              className={cn(
                                "border-b border-white/[0.04]",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.addons ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.addons ? `${i * 50}ms` : "0ms" }}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={addon.label}
                                  onChange={(e) => {
                                    const updated = [...winbrosAddons]
                                    updated[i] = { ...addon, label: e.target.value }
                                    setWinbrosAddons(updated)
                                  }}
                                  className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  placeholder="Add-on name"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  min={0}
                                  value={addon.flat_price}
                                  onChange={(e) => {
                                    const updated = [...winbrosAddons]
                                    updated[i] = { ...addon, flat_price: Number(e.target.value) || 0 }
                                    setWinbrosAddons(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => {
                                    const updated = [...winbrosAddons]
                                    updated[i] = { ...addon, active: addon.active === false ? true : false }
                                    setWinbrosAddons(updated)
                                  }}
                                  className={cn(
                                    "text-xs px-2 py-1 rounded-md border transition-colors",
                                    addon.active !== false
                                      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                                      : "text-zinc-500 border-zinc-700/50 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-zinc-300",
                                  )}
                                >
                                  {addon.active !== false ? "Active" : "Off"}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setWinbrosAddons(winbrosAddons.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── WinBros: Membership Plans ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.plans ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("plans")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 transition-colors duration-300">
                  <Crown className="h-5 w-5 text-violet-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Membership Plans</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.plans ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {plans.filter((p) => !p._deleted).length} plans · recurring service
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setPlans([...plans, {
                      slug: "", name: "", visits_per_year: 1, interval_months: 12,
                      discount_per_visit: 0, free_addons: [], active: true, _isNew: true, _deleted: false,
                    }])
                    setOpenSections((prev) => ({ ...prev, plans: true }))
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.plans ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.plans ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-4 pb-4" onClick={(e) => e.stopPropagation()}>
                    <p className="text-xs text-amber-500/80 mb-3">
                      Changes to active plans affect existing memberships
                    </p>
                    <div className="space-y-3">
                      {plans
                        .filter((p) => !p._deleted)
                        .map((plan, i) => {
                          const actualIndex = plans.findIndex((p) => p === plan)
                          return (
                            <div
                              key={plan.id || `new-${i}`}
                              className={cn(
                                "rounded-xl border border-white/[0.06] bg-zinc-800/30 p-4",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.plans ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.plans ? `${i * 75}ms` : "0ms" }}
                            >
                              <div className="flex items-start justify-between gap-4 mb-4">
                                <input
                                  type="text"
                                  value={plan.name}
                                  onChange={(e) => {
                                    const updated = [...plans]
                                    updated[actualIndex] = { ...plan, name: e.target.value }
                                    setPlans(updated)
                                  }}
                                  placeholder="Plan name"
                                  className="text-sm font-medium bg-transparent border-b border-zinc-700/50 text-zinc-200 focus:outline-none focus:border-purple-500/50 pb-1 flex-1"
                                />
                                <button
                                  onClick={() => {
                                    const updated = [...plans]
                                    updated[actualIndex] = { ...plan, _deleted: true }
                                    setPlans(updated)
                                  }}
                                  className="text-zinc-600 hover:text-red-400 transition-colors shrink-0 p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                  <label className="text-xs text-zinc-500 mb-1 block">Visits/Year</label>
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={1}
                                    value={plan.visits_per_year}
                                    onChange={(e) => {
                                      const updated = [...plans]
                                      updated[actualIndex] = { ...plan, visits_per_year: Math.max(1, Number(e.target.value) || 1) }
                                      setPlans(updated)
                                    }}
                                    className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-zinc-500 mb-1 block">Interval (months)</label>
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={1}
                                    value={plan.interval_months}
                                    onChange={(e) => {
                                      const updated = [...plans]
                                      updated[actualIndex] = { ...plan, interval_months: Math.max(1, Number(e.target.value) || 1) }
                                      setPlans(updated)
                                    }}
                                    className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-zinc-500 mb-1 block">Discount/Visit $</label>
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={0}
                                    value={plan.discount_per_visit}
                                    onChange={(e) => {
                                      const updated = [...plans]
                                      updated[actualIndex] = { ...plan, discount_per_visit: Math.max(0, Number(e.target.value) || 0) }
                                      setPlans(updated)
                                    }}
                                    className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-zinc-500 mb-1 block">Free Add-ons</label>
                                  <input
                                    type="text"
                                    value={(plan.free_addons || []).join(", ")}
                                    onChange={(e) => {
                                      const updated = [...plans]
                                      updated[actualIndex] = {
                                        ...plan,
                                        free_addons: e.target.value
                                          .split(",")
                                          .map((s) => s.trim())
                                          .filter(Boolean),
                                      }
                                      setPlans(updated)
                                    }}
                                    placeholder="comma separated"
                                    className="w-full px-3 py-2 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ── House Cleaning: Service Types ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.serviceTypes ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("serviceTypes")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 transition-colors duration-300">
                  <Layers className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Service Types</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.serviceTypes ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {serviceTypes.length} types · {Object.values(tiers).reduce((sum, rows) => sum + rows.length, 0)} pricing tiers
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    const updated = { ...tiers }
                    if (selectedType) {
                      updated[selectedType] = [
                        ...(updated[selectedType] || []),
                        {
                          service_type: selectedType,
                          bedrooms: 1,
                          bathrooms: 1,
                          max_sq_ft: 1000,
                          price: 100,
                          price_min: null,
                          price_max: null,
                          labor_hours: 2,
                          cleaners: 1,
                          hours_per_cleaner: null,
                        },
                      ]
                      setTiers(updated)
                    }
                    setOpenSections((prev) => ({ ...prev, serviceTypes: true }))
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Row
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.serviceTypes ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.serviceTypes ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    {/* Pill slider for Standard / Deep */}
                    <div className="flex items-center gap-2 px-1 mb-3">
                      <div className="inline-flex rounded-lg bg-zinc-800/80 border border-zinc-700/50 p-0.5">
                        {serviceTypes.map((type) => (
                          <button
                            key={type}
                            onClick={() => setSelectedType(type)}
                            className={cn(
                              "px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-300",
                              selectedType === type
                                ? "bg-purple-500/20 text-purple-300 shadow-sm"
                                : "text-zinc-400 hover:text-zinc-200",
                            )}
                          >
                            {prettifyType(type)}
                          </button>
                        ))}
                      </div>
                      {(() => {
                        const availableTypes = ALLOWED_SERVICE_TYPES.filter((t) => !serviceTypes.includes(t))
                        if (availableTypes.length === 0) return null
                        return showNewType ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={newTypeName}
                              onChange={(e) => {
                                const val = e.target.value
                                if (val && !serviceTypes.includes(val)) {
                                  setServiceTypes([...serviceTypes, val])
                                  setTiers({ ...tiers, [val]: [] })
                                  setSelectedType(val)
                                }
                                setNewTypeName("")
                                setShowNewType(false)
                              }}
                              autoFocus
                              className="w-32 px-2 py-1 text-xs bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            >
                              <option value="">Select type...</option>
                              {availableTypes.map((t) => (
                                <option key={t} value={t}>{prettifyType(t)}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => {
                                setNewTypeName("")
                                setShowNewType(false)
                              }}
                              className="text-zinc-500 hover:text-zinc-300"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowNewType(true)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-zinc-800/40 rounded-lg border border-dashed border-zinc-700/50 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Add Type
                          </button>
                        )
                      })()}
                      {serviceTypes.length > 1 && selectedType && (
                        <button
                          onClick={() => {
                            const updated = { ...tiers }
                            delete updated[selectedType]
                            setTiers(updated)
                            const newTypes = serviceTypes.filter((t) => t !== selectedType)
                            setServiceTypes(newTypes)
                            setSelectedType(newTypes[0] || "")
                          }}
                          className="ml-auto text-xs text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Pricing grid for selected type */}
                    {selectedType && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/[0.06]">
                              <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Beds</th>
                              <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Baths</th>
                              <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Price {currencySymbol}</th>
                              <th className="px-3 py-2.5 w-10" />
                            </tr>
                          </thead>
                          <tbody>
                            {(tiers[selectedType] || []).map((row, i) => (
                              <tr
                                key={i}
                                className={cn(
                                  "border-b border-white/[0.04]",
                                  "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                  openSections.serviceTypes ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                                )}
                                style={{ transitionDelay: openSections.serviceTypes ? `${i * 50}ms` : "0ms" }}
                              >
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={1}
                                    value={row.bedrooms}
                                    onChange={(e) => {
                                      const updated = { ...tiers }
                                      updated[selectedType] = [...(updated[selectedType] || [])]
                                      updated[selectedType][i] = { ...row, bedrooms: Math.max(1, Number(e.target.value) || 1) }
                                      setTiers(updated)
                                    }}
                                    className="w-16 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={1}
                                    step={0.5}
                                    value={row.bathrooms}
                                    onChange={(e) => {
                                      const updated = { ...tiers }
                                      updated[selectedType] = [...(updated[selectedType] || [])]
                                      updated[selectedType][i] = { ...row, bathrooms: Math.max(1, Number(e.target.value) || 1) }
                                      setTiers(updated)
                                    }}
                                    className="w-16 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    onFocus={selectOnFocus}
                                    min={1}
                                    value={row.price}
                                    onChange={(e) => {
                                      const updated = { ...tiers }
                                      updated[selectedType] = [...(updated[selectedType] || [])]
                                      updated[selectedType][i] = { ...row, price: Math.max(1, Number(e.target.value) || 1) }
                                      setTiers(updated)
                                    }}
                                    className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <button
                                    onClick={() => {
                                      const updated = { ...tiers }
                                      updated[selectedType] = (updated[selectedType] || []).filter((_, j) => j !== i)
                                      setTiers(updated)
                                    }}
                                    className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── House Cleaning: Add-Ons ── */}
            <div
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden",
                "shadow-xl shadow-black/10",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.hcAddons ? "rounded-3xl" : "rounded-2xl",
              )}
            >
              <div className="flex items-center gap-4 p-4 cursor-pointer select-none" onClick={() => toggleSection("hcAddons")}>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 transition-colors duration-300">
                  <Puzzle className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <h3 className="text-base font-semibold text-zinc-100">Add-Ons</h3>
                  <p className={cn(
                    "text-sm text-zinc-500",
                    "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.hcAddons ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
                  )}>
                    {addons.length} add-ons configured
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddons([...addons, { addon_key: "", label: "", flat_price: 0, active: true }])
                    setOpenSections((prev) => ({ ...prev, hcAddons: true }))
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-purple-400 hover:text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
                <div className="flex h-8 w-8 items-center justify-center">
                  <ChevronUp className={cn(
                    "h-5 w-5 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                    openSections.hcAddons ? "rotate-0" : "rotate-180",
                  )} />
                </div>
              </div>

              <div className={cn(
                "grid",
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                openSections.hcAddons ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}>
                <div className="overflow-hidden">
                  <div className="px-2 pb-4" onClick={(e) => e.stopPropagation()}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Add-On Name</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Price $</th>
                            <th className="px-3 py-2.5 text-left text-xs font-medium text-zinc-400">Status</th>
                            <th className="px-3 py-2.5 w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {addons.map((addon, i) => (
                            <tr
                              key={addon.addon_key + i}
                              className={cn(
                                "border-b border-white/[0.04]",
                                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                                openSections.hcAddons ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                              )}
                              style={{ transitionDelay: openSections.hcAddons ? `${i * 50}ms` : "0ms" }}
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={addon.label}
                                  onChange={(e) => {
                                    const updated = [...addons]
                                    updated[i] = {
                                      ...addon,
                                      label: e.target.value,
                                      addon_key: addon.id
                                        ? addon.addon_key
                                        : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
                                    }
                                    setAddons(updated)
                                  }}
                                  placeholder="Add-on name"
                                  className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  onFocus={selectOnFocus}
                                  min={0}
                                  value={addon.flat_price ?? 0}
                                  onChange={(e) => {
                                    const updated = [...addons]
                                    updated[i] = { ...addon, flat_price: Number(e.target.value) || 0 }
                                    setAddons(updated)
                                  }}
                                  className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => {
                                    const updated = [...addons]
                                    updated[i] = { ...addon, active: !addon.active }
                                    setAddons(updated)
                                  }}
                                  className={cn(
                                    "text-xs px-2 py-1 rounded-md border transition-colors",
                                    addon.active
                                      ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 hover:shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                                      : "text-zinc-500 border-zinc-700/50 bg-zinc-800/50 hover:bg-zinc-700/50 hover:text-zinc-300",
                                  )}
                                >
                                  {addon.active ? "Active" : "Off"}
                                </button>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => setAddons(addons.filter((_, j) => j !== i))}
                                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Cleaner Pay (house cleaning only) ── */}
        {!isWindowCleaning && (
          <div className="space-y-3">
            <button
              onClick={() => toggleSection("cleanerPay")}
              className="flex items-center gap-2.5 w-full text-left group"
            >
              <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <DollarSign className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">
                Cleaner Pay
              </span>
              <ChevronUp className={cn("w-4 h-4 text-zinc-500 ml-auto transition-transform", !openSections.cleanerPay && "rotate-180")} />
            </button>

            {openSections.cleanerPay && (
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs font-medium text-zinc-400 w-24">Pay Model</label>
                  <select
                    value={cleanerPayModel}
                    onChange={(e) => setCleanerPayModel(e.target.value as 'percentage' | 'hourly')}
                    className="px-3 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50"
                  >
                    <option value="percentage">% of Job Price</option>
                    <option value="hourly">Hourly Rate</option>
                  </select>
                </div>

                {cleanerPayModel === 'percentage' ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-zinc-400 w-24">Cleaner gets</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0} max={100}
                          value={cleanerPayPct}
                          onFocus={selectOnFocus}
                          onChange={(e) => setCleanerPayPct(Number(e.target.value) || 0)}
                          className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 text-right"
                        />
                        <span className="text-xs text-zinc-500">%</span>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500 pl-[108px]">
                      Ex: {currencySymbol}300 job = {currencySymbol}{Math.round(300 * cleanerPayPct / 100)} to cleaner ({cleanerPayPct}%)
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-zinc-400 w-24">Standard</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={cleanerPayStd}
                          onFocus={selectOnFocus}
                          onChange={(e) => setCleanerPayStd(Number(e.target.value) || 0)}
                          className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 text-right"
                        />
                        <span className="text-xs text-zinc-500">{currencySymbol}/hr</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium text-zinc-400 w-24">Deep / Move</label>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={cleanerPayDeep}
                          onFocus={selectOnFocus}
                          onChange={(e) => setCleanerPayDeep(Number(e.target.value) || 0)}
                          className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-lg text-zinc-200 focus:outline-none focus:border-purple-500/50 text-right"
                        />
                        <span className="text-xs text-zinc-500">{currencySymbol}/hr</span>
                      </div>
                    </div>
                    <p className="text-xs text-zinc-500 pl-[108px]">
                      Ex: 3hr standard = {currencySymbol}{cleanerPayStd * 3} to cleaner ({currencySymbol}{cleanerPayStd}/hr)
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* ── Save bar ── */}
        <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-all",
              success
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "btn-glow glow-pulse text-white disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : success ? (
              "Saved!"
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
