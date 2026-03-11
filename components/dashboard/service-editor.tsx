"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Save, Plus, Trash2, X } from "lucide-react"

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

  // WinBros state
  const [windowTiers, setWindowTiers] = useState<WindowTierRow[]>([])
  const [flatServices, setFlatServices] = useState<FlatServiceRow[]>([])
  const [plans, setPlans] = useState<ServicePlan[]>([])

  // House cleaning state
  const [serviceTypes, setServiceTypes] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string>("")
  const [tiers, setTiers] = useState<Record<string, PricingTierRow[]>>({})
  const [addons, setAddons] = useState<AddonRow[]>([])

  // New type input — only 'standard' and 'deep' are allowed by DB constraint
  const ALLOWED_SERVICE_TYPES = ["standard", "deep"]
  const [newTypeName, setNewTypeName] = useState("")
  const [showNewType, setShowNewType] = useState(false)

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

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <div className="space-y-10">
        {isWindowCleaning ? (
          <>
            {/* ── WinBros: Window Tiers ── */}
            <section>
              <h2 className="text-base font-semibold text-zinc-100 mb-1">Window Cleaning Tiers</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Square footage-based pricing for exterior, interior, and track detailing
              </p>
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Max Sqft</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Label</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Exterior $</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Interior $</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Track $</th>
                      <th className="px-4 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {windowTiers.map((tier, i) => (
                      <tr key={i} className="border-b border-white/[0.04]">
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={tier.maxSqft}
                            onChange={(e) => {
                              const updated = [...windowTiers]
                              updated[i] = { ...tier, maxSqft: Number(e.target.value) || 0 }
                              setWindowTiers(updated)
                            }}
                            className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={tier.label}
                            onChange={(e) => {
                              const updated = [...windowTiers]
                              updated[i] = { ...tier, label: e.target.value }
                              setWindowTiers(updated)
                            }}
                            className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={tier.exterior}
                            onChange={(e) => {
                              const updated = [...windowTiers]
                              updated[i] = { ...tier, exterior: Number(e.target.value) || 0 }
                              setWindowTiers(updated)
                            }}
                            className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={tier.interior}
                            onChange={(e) => {
                              const updated = [...windowTiers]
                              updated[i] = { ...tier, interior: Number(e.target.value) || 0 }
                              setWindowTiers(updated)
                            }}
                            className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={tier.trackDetailing}
                            onChange={(e) => {
                              const updated = [...windowTiers]
                              updated[i] = { ...tier, trackDetailing: Number(e.target.value) || 0 }
                              setWindowTiers(updated)
                            }}
                            className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => setWindowTiers(windowTiers.filter((_, j) => j !== i))}
                            className="text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t border-white/[0.04]">
                  <button
                    onClick={() =>
                      setWindowTiers([...windowTiers, { maxSqft: 0, label: "", exterior: 0, interior: 0, trackDetailing: 0 }])
                    }
                    className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Tier
                  </button>
                </div>
              </div>
            </section>

            {/* ── WinBros: Flat Services ── */}
            <section>
              <h2 className="text-base font-semibold text-zinc-100 mb-1">Flat Rate Services</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Pressure washing surfaces and other flat-rate services
              </p>
              <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Service Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Price $</th>
                      <th className="px-4 py-3 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {flatServices.map((svc, i) => (
                      <tr key={i} className="border-b border-white/[0.04]">
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={svc.name}
                            onChange={(e) => {
                              const updated = [...flatServices]
                              updated[i] = { ...svc, name: e.target.value }
                              setFlatServices(updated)
                            }}
                            className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            value={svc.price}
                            onChange={(e) => {
                              const updated = [...flatServices]
                              updated[i] = { ...svc, price: Number(e.target.value) || 0 }
                              setFlatServices(updated)
                            }}
                            className="w-24 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => setFlatServices(flatServices.filter((_, j) => j !== i))}
                            className="text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-3 border-t border-white/[0.04]">
                  <button
                    onClick={() => setFlatServices([...flatServices, { name: "", keywords: [], price: 0 }])}
                    className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Service
                  </button>
                </div>
              </div>
            </section>

            {/* ── WinBros: Membership Plans ── */}
            <section>
              <h2 className="text-base font-semibold text-zinc-100 mb-1">Membership Plans</h2>
              <p className="text-sm text-zinc-500 mb-3">
                Recurring service plans for customers
              </p>
              <p className="text-xs text-amber-500/80 mb-5">
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
                        className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-5"
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
                            className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Visits/Year</label>
                            <input
                              type="number"
                              min={1}
                              value={plan.visits_per_year}
                              onChange={(e) => {
                                const updated = [...plans]
                                updated[actualIndex] = { ...plan, visits_per_year: Math.max(1, Number(e.target.value) || 1) }
                                setPlans(updated)
                              }}
                              className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Interval (months)</label>
                            <input
                              type="number"
                              min={1}
                              value={plan.interval_months}
                              onChange={(e) => {
                                const updated = [...plans]
                                updated[actualIndex] = { ...plan, interval_months: Math.max(1, Number(e.target.value) || 1) }
                                setPlans(updated)
                              }}
                              className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-1 block">Discount/Visit $</label>
                            <input
                              type="number"
                              min={0}
                              value={plan.discount_per_visit}
                              onChange={(e) => {
                                const updated = [...plans]
                                updated[actualIndex] = { ...plan, discount_per_visit: Math.max(0, Number(e.target.value) || 0) }
                                setPlans(updated)
                              }}
                              className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
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
                              className="w-full px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                <button
                  onClick={() =>
                    setPlans([
                      ...plans,
                      {
                        slug: "",
                        name: "",
                        visits_per_year: 1,
                        interval_months: 12,
                        discount_per_visit: 0,
                        free_addons: [],
                        active: true,
                        _isNew: true,
                        _deleted: false,
                      },
                    ])
                  }
                  className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Plan
                </button>
              </div>
            </section>
          </>
        ) : (
          <>
            {/* ── House Cleaning: Service Types ── */}
            <section>
              <h2 className="text-base font-semibold text-zinc-100 mb-1">Service Types</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Manage service types and their bed/bath pricing
              </p>

              {/* Type pills */}
              <div className="flex items-center gap-2 flex-wrap mb-5">
                {serviceTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      selectedType === type
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                        : "bg-zinc-800/60 text-zinc-400 border border-transparent hover:text-zinc-200"
                    }`}
                  >
                    {prettifyType(type)}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        const updated = { ...tiers }
                        delete updated[type]
                        setTiers(updated)
                        const newTypes = serviceTypes.filter((t) => t !== type)
                        setServiceTypes(newTypes)
                        if (selectedType === type) setSelectedType(newTypes[0] || "")
                      }}
                      className="ml-1 text-zinc-600 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </button>
                ))}

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
              </div>

              {/* Pricing grid for selected type */}
              {selectedType && (
                <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Beds</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Baths</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Max Sqft</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-zinc-400">Price $</th>
                        <th className="px-4 py-3 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {(tiers[selectedType] || []).map((row, i) => (
                        <tr key={i} className="border-b border-white/[0.04]">
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min={1}
                              value={row.bedrooms}
                              onChange={(e) => {
                                const updated = { ...tiers }
                                updated[selectedType] = [...(updated[selectedType] || [])]
                                updated[selectedType][i] = { ...row, bedrooms: Math.max(1, Number(e.target.value) || 1) }
                                setTiers(updated)
                              }}
                              className="w-16 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min={1}
                              step={0.5}
                              value={row.bathrooms}
                              onChange={(e) => {
                                const updated = { ...tiers }
                                updated[selectedType] = [...(updated[selectedType] || [])]
                                updated[selectedType][i] = { ...row, bathrooms: Math.max(1, Number(e.target.value) || 1) }
                                setTiers(updated)
                              }}
                              className="w-16 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min={1}
                              value={row.max_sq_ft}
                              onChange={(e) => {
                                const updated = { ...tiers }
                                updated[selectedType] = [...(updated[selectedType] || [])]
                                updated[selectedType][i] = { ...row, max_sq_ft: Math.max(1, Number(e.target.value) || 1) }
                                setTiers(updated)
                              }}
                              className="w-24 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              min={1}
                              value={row.price}
                              onChange={(e) => {
                                const updated = { ...tiers }
                                updated[selectedType] = [...(updated[selectedType] || [])]
                                updated[selectedType][i] = { ...row, price: Math.max(1, Number(e.target.value) || 1) }
                                setTiers(updated)
                              }}
                              className="w-24 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={() => {
                                const updated = { ...tiers }
                                updated[selectedType] = (updated[selectedType] || []).filter((_, j) => j !== i)
                                setTiers(updated)
                              }}
                              className="text-zinc-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-3 border-t border-white/[0.04]">
                    <button
                      onClick={() => {
                        const updated = { ...tiers }
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
                      }}
                      className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Row
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* ── House Cleaning: Add-Ons ── */}
            <section>
              <h2 className="text-base font-semibold text-zinc-100 mb-1">Add-Ons</h2>
              <p className="text-sm text-zinc-500 mb-5">
                Optional services customers can add to their booking
              </p>
              <div className="space-y-3">
                {addons.map((addon, i) => (
                  <div
                    key={addon.addon_key + i}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-zinc-900/50 px-4 py-3"
                  >
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
                      className="flex-1 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-zinc-500">$</span>
                      <input
                        type="number"
                        min={0}
                        value={addon.flat_price ?? 0}
                        onChange={(e) => {
                          const updated = [...addons]
                          updated[i] = { ...addon, flat_price: Number(e.target.value) || 0 }
                          setAddons(updated)
                        }}
                        className="w-20 px-2 py-1.5 text-sm bg-zinc-800/80 border border-zinc-700/50 rounded-md text-zinc-200 focus:outline-none focus:border-purple-500/50"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const updated = [...addons]
                        updated[i] = { ...addon, active: !addon.active }
                        setAddons(updated)
                      }}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        addon.active
                          ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                          : "text-zinc-500 border-zinc-700/50 bg-zinc-800/50"
                      }`}
                    >
                      {addon.active ? "Active" : "Off"}
                    </button>
                    <button
                      onClick={() => setAddons(addons.filter((_, j) => j !== i))}
                      className="text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    setAddons([
                      ...addons,
                      { addon_key: "", label: "", flat_price: 0, active: true },
                    ])
                  }
                  className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Add-On
                </button>
              </div>
            </section>
          </>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* ── Save bar ── */}
        <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-4 bg-zinc-950">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-3 text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-all ${
              success
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-purple-500 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white"
            }`}
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
