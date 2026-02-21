/**
 * WinBros Pricebook
 *
 * Pricing tiers for window cleaning, pressure washing, and gutter cleaning.
 * Window cleaning uses square-footage-based tiers.
 * Pressure washing uses flat-rate per-surface pricing (multiple surfaces can be summed).
 * Gutter cleaning uses property-type-based tiers.
 */

type WindowTier = {
  maxSqft: number
  label: string
  exterior: number
  interior: number
  trackDetailing: number
}

type FlatService = {
  name: string
  keywords: string[]
  price: number
}

// Window cleaning tiers ordered by sqft range
const WINDOW_TIERS: WindowTier[] = [
  { maxSqft: 2499, label: "Up to 20 Panes", exterior: 275, interior: 80, trackDetailing: 50 },
  { maxSqft: 3499, label: "Up to 40 Panes", exterior: 295, interior: 160, trackDetailing: 100 },
  { maxSqft: 4999, label: "Up to 60 Panes", exterior: 345, interior: 240, trackDetailing: 150 },
  { maxSqft: 6499, label: "Up to 80 Panes", exterior: 445, interior: 320, trackDetailing: 200 },
  { maxSqft: 7999, label: "Up to 100 Panes", exterior: 555, interior: 400, trackDetailing: 250 },
  { maxSqft: 8999, label: "Up to 120 Panes", exterior: 645, interior: 400, trackDetailing: 300 },
]

// Default tier when sqft is unknown (smallest / most common residential)
const DEFAULT_WINDOW_TIER = WINDOW_TIERS[0]

// Flat-rate services matched by keywords (pressure washing surfaces)
const FLAT_SERVICES: FlatService[] = [
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

// Gutter cleaning prices by property type (matches SMS prompt pricing)
const GUTTER_TIERS: Record<string, { price: number; label: string }> = {
  single_story:     { price: 200, label: 'Single-story gutter cleaning' },
  two_story:        { price: 250, label: 'Standard two-story gutter cleaning' },
  larger_two_story: { price: 325, label: 'Larger two-story gutter cleaning' },
}

const DEFAULT_GUTTER_PRICE = 250

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

function getWindowTier(sqft?: number | null): WindowTier {
  if (!sqft || sqft <= 0) return DEFAULT_WINDOW_TIER
  for (const tier of WINDOW_TIERS) {
    if (sqft <= tier.maxSqft) return tier
  }
  // Above largest tier — use the largest
  return WINDOW_TIERS[WINDOW_TIERS.length - 1]
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
  surfaces: string[]
): PriceLookupResult | null {
  if (!surfaces || surfaces.length === 0) return null

  let totalPrice = 0
  const serviceNames: string[] = []

  for (const surface of surfaces) {
    const keyword = SURFACE_KEYWORD_MAP[surface]
    if (!keyword) continue

    const svc = FLAT_SERVICES.find(s => s.keywords.includes(keyword))
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
 * Look up gutter cleaning price by property type.
 */
export function lookupGutterPrice(
  propertyType?: string | null
): PriceLookupResult {
  const tier = propertyType ? GUTTER_TIERS[propertyType] : null

  return {
    price: tier?.price ?? DEFAULT_GUTTER_PRICE,
    serviceName: tier?.label ?? 'Gutter cleaning',
  }
}

/**
 * Look up the price for a WinBros service.
 * Returns null if the service cannot be determined.
 */
export function lookupPrice(input: PriceLookupInput): PriceLookupResult | null {
  const serviceRaw = normalizeText(input.serviceType || "")
  const notesRaw = normalizeText(input.notes || "")
  const combined = `${serviceRaw} ${notesRaw}`

  // Route to multi-surface lookup for pressure washing
  if (serviceRaw.includes('pressure') || serviceRaw.includes('power wash')) {
    if (input.pressureWashingSurfaces && input.pressureWashingSurfaces.length > 0) {
      return lookupPressureWashingPrice(input.pressureWashingSurfaces)
    }
    // Fall through to keyword match if no structured surfaces provided
  }

  // Route to tier-based lookup for gutter cleaning
  if (serviceRaw.includes('gutter')) {
    return lookupGutterPrice(input.propertyType)
  }

  // Check flat-rate services (keyword match for legacy/unstructured lookups)
  for (const svc of FLAT_SERVICES) {
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
    const tier = getWindowTier(input.squareFootage)

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
