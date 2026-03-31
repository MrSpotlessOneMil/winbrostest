/**
 * WinBros Pricebook
 *
 * Pricing tiers for window cleaning, pressure washing, and gutter cleaning.
 * Window cleaning uses square-footage-based tiers.
 * Pressure washing uses flat-rate per-surface pricing (multiple surfaces can be summed).
 * Gutter cleaning is a flat $250 rate (matches HCP).
 *
 * Supports DB-backed pricing when tenantId is provided, with hardcoded fallback.
 */

// NOTE: Do NOT use top-level import of supabase here.
// pricebook.ts is imported client-side (jobs/page.tsx uses WINBROS_CALENDAR_ADDONS),
// and supabase.ts chains to async_hooks which breaks the browser build.
// Use dynamic import inside DB functions instead.

export type WindowTier = {
  maxSqft: number
  label: string
  exterior: number
  interior: number
  trackDetailing: number
}

export type FlatService = {
  name: string
  keywords: string[]
  price: number
  active?: boolean
}

// Window cleaning tiers ordered by sqft range (hardcoded defaults)
export const WINDOW_TIERS: WindowTier[] = [
  { maxSqft: 2499, label: "Up to 20 Panes", exterior: 275, interior: 80, trackDetailing: 50 },
  { maxSqft: 3499, label: "Up to 40 Panes", exterior: 295, interior: 160, trackDetailing: 100 },
  { maxSqft: 4999, label: "Up to 60 Panes", exterior: 345, interior: 240, trackDetailing: 150 },
  { maxSqft: 6499, label: "Up to 80 Panes", exterior: 445, interior: 320, trackDetailing: 200 },
  { maxSqft: 7999, label: "Up to 100 Panes", exterior: 555, interior: 400, trackDetailing: 250 },
  { maxSqft: 8999, label: "Up to 120 Panes", exterior: 645, interior: 400, trackDetailing: 300 },
]

// Default tier when sqft is unknown (smallest / most common residential)
const DEFAULT_WINDOW_TIER = WINDOW_TIERS[0]

// Custom per-unit pricing (for custom pane counts or individual services)
export const CUSTOM_PER_UNIT: Record<string, { price: number; label: string; unit: string }> = {
  exterior: { price: 5, label: "Exterior Window Cleaning", unit: "pane" },
  interior: { price: 4, label: "Interior Window Cleaning", unit: "pane" },
  track_detailing: { price: 3, label: "Track Detailing", unit: "track" },
  partial_interior_ground: { price: 4, label: "Partial Interior (Ground Level)", unit: "pane" },
  partial_interior_upper: { price: 12, label: "Partial Interior (Upper Level)", unit: "pane" },
  solar_panel: { price: 7, label: "Solar Panel Cleaning", unit: "panel" },
  hard_water_treatment: { price: 12, label: "Hard Water Stain Treatment", unit: "pane" },
}

/**
 * Good / Better / Best tier definitions for interactive quotes.
 * Each tier defines which services are included and optional add-ons.
 */
export interface QuoteTier {
  key: 'good' | 'better' | 'best'
  name: string
  tagline: string
  badge?: string
  included: string[]
  description: string
}

export const QUOTE_TIERS: QuoteTier[] = [
  {
    key: 'good',
    name: 'Exterior Clean',
    tagline: 'Essential curb appeal',
    included: ['exterior', 'screen_cleaning'],
    description: 'Complete exterior window wash — glass, frames, sills, and courtesy screen cleaning.',
  },
  {
    key: 'better',
    name: 'Complete Clean',
    tagline: 'Most popular',
    badge: 'Best Value',
    included: ['exterior', 'interior', 'screen_cleaning', 'rain_repellent'],
    description: 'Full interior & exterior cleaning with rain repellent for lasting clarity.',
  },
  {
    key: 'best',
    name: 'Full Detail',
    tagline: 'The works',
    included: ['exterior', 'interior', 'track_detailing', 'screen_cleaning', 'rain_repellent', 'rain_guarantee'],
    description: 'Everything in Complete Clean plus deep track detailing and 7-day rain guarantee.',
  },
]

/** Optional add-ons customers can toggle on any tier */
export interface QuoteAddon {
  key: string
  name: string
  description: string
  priceType: 'flat' | 'per_unit'
  price: number
  unit?: string
}

export const QUOTE_ADDONS: QuoteAddon[] = [
  // Window cleaning add-ons
  { key: 'interior', name: 'Interior Window Cleaning', description: 'Streak-free interior glass cleaning with non-toxic solutions', priceType: 'flat', price: 0 }, // price from tier
  { key: 'track_detailing', name: 'Track Detailing', description: 'Deep clean window tracks - remove dirt, debris, and mildew', priceType: 'flat', price: 0 },
  { key: 'solar_panel', name: 'Solar Panel Cleaning', description: 'Maximize energy output by removing dirt and debris from panels', priceType: 'per_unit', price: 7, unit: 'panel' },
  { key: 'hard_water_treatment', name: 'Hard Water Stain Treatment', description: 'Specialized treatment to restore glass clarity', priceType: 'per_unit', price: 12, unit: 'pane' },
  { key: 'rain_repellent', name: 'Rain Repellent', description: 'Hydrophobic coating that repels water and keeps windows cleaner longer', priceType: 'flat', price: 0 },
  { key: 'rain_guarantee', name: '7-Day Rain Guarantee', description: 'Free re-clean if it rains within 7 days of service', priceType: 'flat', price: 0 },
  // Pressure washing add-ons
  { key: 'house_wash', name: 'House Washing / Soft Wash', description: 'Full exterior house wash with safe soft-wash technique', priceType: 'flat', price: 300 },
  { key: 'driveway', name: 'Driveway Cleaning', description: 'High-pressure driveway cleaning to remove oil, dirt, and stains', priceType: 'flat', price: 250 },
  { key: 'patio', name: 'Patio Cleaning', description: 'Restore your patio surface to like-new condition', priceType: 'flat', price: 150 },
  { key: 'sidewalk', name: 'Sidewalk Cleaning', description: 'Remove grime and algae from walkways', priceType: 'flat', price: 100 },
  { key: 'deck', name: 'Deck Washing', description: 'Gentle pressure wash to clean and brighten your deck', priceType: 'flat', price: 175 },
  { key: 'fence', name: 'Fence Cleaning', description: 'Pressure wash fencing to remove dirt and mildew', priceType: 'flat', price: 250 },
  { key: 'pool_deck', name: 'Pool Deck Cleaning', description: 'Clean and sanitize pool deck surfaces', priceType: 'flat', price: 250 },
  // Gutter cleaning
  { key: 'gutter_cleaning', name: 'Gutter Cleaning', description: 'Full gutter cleanout with debris removal and downspout flush', priceType: 'flat', price: 250 },
]

/**
 * Compute price for a specific tier given property square footage.
 * When tenantId is provided, loads tiers from DB; otherwise uses hardcoded defaults.
 */
export function computeTierPrice(tierKey: 'good' | 'better' | 'best', sqft?: number | null, windowTiers?: WindowTier[]): {
  price: number
  breakdown: { service: string; price: number }[]
  tier: string
} {
  const tiers = windowTiers || WINDOW_TIERS
  const windowTier = getWindowTier(sqft, tiers)
  const quoteTier = QUOTE_TIERS.find(t => t.key === tierKey)!
  const breakdown: { service: string; price: number }[] = []
  let price = 0

  if (quoteTier.included.includes('exterior')) {
    breakdown.push({ service: 'Exterior Window Cleaning', price: windowTier.exterior })
    price += windowTier.exterior
  }
  if (quoteTier.included.includes('interior')) {
    breakdown.push({ service: 'Interior Window Cleaning', price: windowTier.interior })
    price += windowTier.interior
  }
  if (quoteTier.included.includes('track_detailing')) {
    breakdown.push({ service: 'Track Detailing', price: windowTier.trackDetailing })
    price += windowTier.trackDetailing
  }
  // Free included services
  if (quoteTier.included.includes('screen_cleaning')) {
    breakdown.push({ service: 'Exterior Screen Cleaning', price: 0 })
  }
  if (quoteTier.included.includes('rain_repellent')) {
    breakdown.push({ service: 'Rain Repellent', price: 0 })
  }
  if (quoteTier.included.includes('rain_guarantee')) {
    breakdown.push({ service: '7-Day Rain Guarantee', price: 0 })
  }

  return { price, breakdown, tier: windowTier.label }
}

// Flat-rate services matched by keywords (pressure washing surfaces, hardcoded defaults)
export const FLAT_SERVICES: FlatService[] = [
  { name: "House Washing", keywords: ["house wash", "house_wash", "siding", "soft wash"], price: 300 },
  { name: "Driveway Cleaning", keywords: ["driveway"], price: 250 },
  { name: "Patio Cleaning", keywords: ["patio"], price: 150 },
  { name: "Sidewalk Cleaning", keywords: ["sidewalk"], price: 100 },
  { name: "Deck Washing", keywords: ["deck"], price: 175 },
  { name: "Fence Cleaning", keywords: ["fence"], price: 250 },
  { name: "Pool Deck Cleaning", keywords: ["pool deck", "pool_deck", "pool area"], price: 250 },
  { name: "Retaining Wall Cleaning", keywords: ["retaining wall", "retaining_wall"], price: 200 },
  { name: "Stone Cleaning", keywords: ["stone clean", "stone"], price: 150 },
  { name: "Gutter and Soffit Washing", keywords: ["soffit", "gutter wash"], price: 200 },
]

// Flat gutter cleaning price (matches HCP)
const DEFAULT_GUTTER_PRICE = 250

/** WinBros add-ons for calendar job creation (QUOTE_ADDONS + FLAT_SERVICES + gutter) */
export const WINBROS_CALENDAR_ADDONS: { addon_key: string; label: string; flat_price: number; minutes: number; group: string }[] = [
  // Window cleaning add-ons
  { addon_key: 'interior', label: 'Interior Window Cleaning', flat_price: 0, minutes: 0, group: 'Window Cleaning' },
  { addon_key: 'track_detailing', label: 'Track Detailing', flat_price: 0, minutes: 0, group: 'Window Cleaning' },
  { addon_key: 'solar_panel', label: 'Solar Panel Cleaning', flat_price: 7, minutes: 0, group: 'Window Cleaning' },
  { addon_key: 'hard_water_treatment', label: 'Hard Water Stain Treatment', flat_price: 12, minutes: 0, group: 'Window Cleaning' },
  { addon_key: 'rain_repellent', label: 'Rain Repellent', flat_price: 0, minutes: 0, group: 'Window Cleaning' },
  { addon_key: 'rain_guarantee', label: '7-Day Rain Guarantee', flat_price: 0, minutes: 0, group: 'Window Cleaning' },
  // Pressure washing surfaces
  { addon_key: 'house_wash', label: 'House Washing / Soft Wash', flat_price: 300, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'driveway', label: 'Driveway Cleaning', flat_price: 250, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'patio', label: 'Patio Cleaning', flat_price: 150, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'sidewalk', label: 'Sidewalk Cleaning', flat_price: 100, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'deck', label: 'Deck Washing', flat_price: 175, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'fence', label: 'Fence Cleaning', flat_price: 250, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'pool_deck', label: 'Pool Deck Cleaning', flat_price: 250, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'retaining_wall', label: 'Retaining Wall Cleaning', flat_price: 200, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'stone', label: 'Stone Cleaning', flat_price: 150, minutes: 0, group: 'Pressure Washing' },
  { addon_key: 'gutter_soffit', label: 'Gutter and Soffit Washing', flat_price: 200, minutes: 0, group: 'Pressure Washing' },
  // Gutter cleaning
  { addon_key: 'gutter_cleaning', label: 'Gutter Cleaning', flat_price: DEFAULT_GUTTER_PRICE, minutes: 0, group: 'Gutter' },
]

// Map from structured surface identifiers to FLAT_SERVICES keywords
const SURFACE_KEYWORD_MAP: Record<string, string> = {
  house_wash: 'house_wash',
  driveway: 'driveway',
  patio: 'patio',
  sidewalk: 'sidewalk',
  deck: 'deck',
  fence: 'fence',
  pool_deck: 'pool_deck',
  retaining_wall: 'retaining_wall',
  stone: 'stone',
}

// DB loader functions moved to lib/pricebook-db.ts (server-only)
// to avoid pulling supabase into the client bundle.

function getWindowTier(sqft?: number | null, tiers?: WindowTier[]): WindowTier {
  const tierList = tiers || WINDOW_TIERS
  const defaultTier = tierList[0] || DEFAULT_WINDOW_TIER
  if (!sqft || sqft <= 0) return defaultTier
  for (const tier of tierList) {
    if (sqft <= tier.maxSqft) return tier
  }
  // Above largest tier — use the largest
  return tierList[tierList.length - 1]
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s_]/g, "").trim()
}

export interface PriceLookupInput {
  serviceType?: string | null
  squareFootage?: number | null
  notes?: string | null
  /** Explicit scope override — when set, takes priority over keyword sniffing from notes */
  scope?: 'exterior' | 'interior' | 'interior_and_exterior' | string | null
  /** Structured pressure washing surfaces for multi-surface price summing */
  pressureWashingSurfaces?: string[] | null
  /** Property type for gutter cleaning tier pricing */
  propertyType?: string | null
}

export interface PriceLookupResult {
  price: number
  serviceName: string
  tier?: string
}

/**
 * Look up the price for multiple pressure washing surfaces and sum them.
 * Returns null if no valid surfaces are found.
 */
export function lookupPressureWashingPrice(
  surfaces: string[],
  flatServices?: FlatService[]
): PriceLookupResult | null {
  if (!surfaces || surfaces.length === 0) return null
  const services = (flatServices || FLAT_SERVICES).filter(s => s.active !== false)

  let totalPrice = 0
  const serviceNames: string[] = []

  for (const surface of surfaces) {
    const keyword = SURFACE_KEYWORD_MAP[surface]
    if (!keyword) continue

    const svc = services.find(s => s.keywords.includes(keyword))
    if (svc) {
      totalPrice += svc.price
      serviceNames.push(svc.name)
    }
  }

  if (totalPrice === 0) return null

  return {
    price: totalPrice,
    serviceName: serviceNames.join(' + '),
  }
}

/**
 * Look up gutter cleaning price (flat $250, matches HCP).
 */
export function lookupGutterPrice(
  _propertyType?: string | null
): PriceLookupResult {
  return {
    price: DEFAULT_GUTTER_PRICE,
    serviceName: 'Gutter cleaning',
  }
}

/**
 * Look up the price for a WinBros service.
 * When tenantId is provided, loads pricing from DB; otherwise uses hardcoded defaults.
 * Returns null if the service cannot be determined.
 */
export function lookupPrice(input: PriceLookupInput, opts?: { windowTiers?: WindowTier[]; flatServices?: FlatService[] }): PriceLookupResult | null {
  const serviceRaw = normalizeText(input.serviceType || "")
  const notesRaw = normalizeText(input.notes || "")
  const combined = `${serviceRaw} ${notesRaw}`

  // Use pre-loaded data or hardcoded defaults
  const windowTiers = opts?.windowTiers || WINDOW_TIERS
  const flatServices = (opts?.flatServices || FLAT_SERVICES).filter(s => s.active !== false)

  // Route to multi-surface lookup for pressure washing
  if (serviceRaw.includes('pressure') || serviceRaw.includes('power wash')) {
    if (input.pressureWashingSurfaces && input.pressureWashingSurfaces.length > 0) {
      return lookupPressureWashingPrice(input.pressureWashingSurfaces, flatServices)
    }
    // Fall through to keyword match if no structured surfaces provided
  }

  // Route to tier-based lookup for gutter cleaning
  if (serviceRaw.includes('gutter')) {
    return lookupGutterPrice(input.propertyType)
  }

  // Check flat-rate services (keyword match for legacy/unstructured lookups)
  for (const svc of flatServices) {
    for (const kw of svc.keywords) {
      if (combined.includes(kw)) {
        return { price: svc.price, serviceName: svc.name }
      }
    }
  }

  // Window cleaning — determine if exterior, interior, or both
  const isWindow =
    combined.includes("window") ||
    combined.includes("pane") ||
    combined.includes("glass") ||
    serviceRaw === "" || // Default service for WinBros is window cleaning
    combined.includes("cleaning") // Generic "cleaning" at WinBros = windows

  if (isWindow) {
    const tier = getWindowTier(input.squareFootage, windowTiers)

    // Use explicit scope if provided, otherwise sniff from notes (less reliable)
    const scopeNorm = normalizeText(input.scope || "")
    let isInterior: boolean
    let isExterior: boolean
    if (scopeNorm) {
      // Explicit scope: only trust exact values
      isInterior = scopeNorm === "interior_and_exterior" || scopeNorm === "interior"
      isExterior = scopeNorm === "interior_and_exterior" || scopeNorm === "exterior" || scopeNorm === ""
    } else {
      // Fallback: sniff from notes, but default to exterior-only (most common)
      isInterior = combined.includes("interior and exterior") || combined.includes("inside and out")
      isExterior = true // Default to exterior
    }
    const hasTrack = combined.includes("track")

    let price = 0
    const parts: string[] = []

    if (isInterior && isExterior) {
      price = tier.exterior + tier.interior
      parts.push("Interior & Exterior Window Cleaning")
    } else if (isInterior) {
      price = tier.interior
      parts.push("Interior Window Cleaning")
    } else {
      // Default to exterior (most common WinBros service)
      price = tier.exterior
      parts.push("Exterior Window Cleaning")
    }

    if (hasTrack) {
      price += tier.trackDetailing
      parts.push("Track Detailing")
    }

    return {
      price,
      serviceName: parts.join(" + "),
      tier: tier.label,
    }
  }

  return null
}
