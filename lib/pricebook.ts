/**
 * WinBros Pricebook
 *
 * Pricing tiers for window & exterior cleaning services.
 * Tiers are based on square footage ranges which map to pane counts.
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

// Flat-rate services matched by keywords
const FLAT_SERVICES: FlatService[] = [
  { name: "House Washing", keywords: ["house wash", "siding", "soft wash"], price: 300 },
  { name: "Driveway Cleaning", keywords: ["driveway"], price: 250 },
  { name: "Patio Cleaning", keywords: ["patio"], price: 150 },
  { name: "Sidewalk Cleaning", keywords: ["sidewalk"], price: 100 },
  { name: "Deck Washing", keywords: ["deck"], price: 175 },
  { name: "Fence Cleaning", keywords: ["fence"], price: 250 },
  { name: "Pool Deck Cleaning", keywords: ["pool deck", "pool area"], price: 250 },
  { name: "Retaining Wall Cleaning", keywords: ["retaining wall"], price: 200 },
  { name: "Stone Cleaning", keywords: ["stone clean"], price: 150 },
  { name: "Gutter Cleaning", keywords: ["gutter clean", "gutters"], price: 250 },
  { name: "Gutter and Soffit Washing", keywords: ["soffit", "gutter wash"], price: 200 },
]

function getWindowTier(sqft?: number | null): WindowTier {
  if (!sqft || sqft <= 0) return DEFAULT_WINDOW_TIER
  for (const tier of WINDOW_TIERS) {
    if (sqft <= tier.maxSqft) return tier
  }
  // Above largest tier — use the largest
  return WINDOW_TIERS[WINDOW_TIERS.length - 1]
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()
}

export interface PriceLookupInput {
  serviceType?: string | null
  squareFootage?: number | null
  notes?: string | null
}

export interface PriceLookupResult {
  price: number
  serviceName: string
  tier?: string
}

/**
 * Look up the price for a WinBros service.
 * Returns null if the service cannot be determined.
 */
export function lookupPrice(input: PriceLookupInput): PriceLookupResult | null {
  const serviceRaw = normalizeText(input.serviceType || "")
  const notesRaw = normalizeText(input.notes || "")
  const combined = `${serviceRaw} ${notesRaw}`

  // Check flat-rate services first (pressure washing, gutters, etc.)
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
    const isInterior = combined.includes("interior") || combined.includes("inside")
    const isExterior = combined.includes("exterior") || combined.includes("outside")
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
