/**
 * WinBros Window Cleaning Pricing Model
 *
 * Per-window pricing with adjustments for window type,
 * story height, and add-on services.
 */

// Window types
export type WindowType = 'standard' | 'french' | 'skylights' | 'storm' | 'picture'

// Quote input
export interface WindowCleaningInput {
  windowCount: number
  windowType?: WindowType
  storyCount?: 1 | 2 | 3
  includesScreens?: boolean
  includesTracks?: boolean
  gutterFeet?: number
  hardWaterRemoval?: boolean
  constructionCleanup?: boolean
}

// Quote result
export interface WindowCleaningQuote {
  windowCount: number
  windowType: WindowType
  storyCount: 1 | 2 | 3
  includesScreens: boolean
  includesTracks: boolean
  gutterFeet: number

  // Pricing breakdown
  baseWindowPrice: number
  screenPrice: number
  trackPrice: number
  gutterPrice: number
  additionalServicesPrice: number

  // Totals
  subtotal: number
  estimatedHours: number
  price: number
  pricePerWindow: number

  // Add-ons selected
  addOns: string[]
}

// Pricing configuration
const PRICING = {
  // Base price per window by type
  pricePerWindow: {
    standard: 10,
    french: 15,
    skylights: 25,
    storm: 12,
    picture: 20,
  } as Record<WindowType, number>,

  // Story height multiplier
  storyMultiplier: {
    1: 1.0,
    2: 1.25,
    3: 1.5,
  } as Record<number, number>,

  // Add-on services
  screenCleaningPerWindow: 3,
  trackCleaningPerWindow: 5,
  gutterCleaningPerFoot: 2,

  // Additional services
  hardWaterRemovalPerWindow: 8,
  constructionCleanupMultiplier: 1.5,

  // Minimum charges
  minimumJobPrice: 150,
  minimumWindows: 10,

  // Estimated time
  minutesPerWindow: 5,
  minutesPerScreen: 2,
  minutesPerTrack: 3,
  minutesPerGutterFoot: 0.5,
}

/**
 * Calculate window cleaning price
 */
export function calculateWindowCleaningPrice(
  input: WindowCleaningInput
): WindowCleaningQuote {
  const {
    windowCount,
    windowType = 'standard',
    storyCount = 1,
    includesScreens = false,
    includesTracks = false,
    gutterFeet = 0,
    hardWaterRemoval = false,
    constructionCleanup = false,
  } = input

  // Base window price
  const basePerWindow = PRICING.pricePerWindow[windowType]
  const storyMultiplier = PRICING.storyMultiplier[storyCount] || 1.0
  const adjustedPerWindow = basePerWindow * storyMultiplier
  const baseWindowPrice = windowCount * adjustedPerWindow

  // Add-ons
  const screenPrice = includesScreens
    ? windowCount * PRICING.screenCleaningPerWindow
    : 0
  const trackPrice = includesTracks
    ? windowCount * PRICING.trackCleaningPerWindow
    : 0
  const gutterPrice = gutterFeet * PRICING.gutterCleaningPerFoot

  // Additional services
  let additionalServicesPrice = 0
  const addOns: string[] = []

  if (hardWaterRemoval) {
    additionalServicesPrice += windowCount * PRICING.hardWaterRemovalPerWindow
    addOns.push('Hard water removal')
  }

  // Calculate subtotal
  let subtotal =
    baseWindowPrice +
    screenPrice +
    trackPrice +
    gutterPrice +
    additionalServicesPrice

  // Apply construction cleanup multiplier
  if (constructionCleanup) {
    subtotal *= PRICING.constructionCleanupMultiplier
    addOns.push('Construction cleanup')
  }

  // Track other add-ons
  if (includesScreens) addOns.push('Screen cleaning')
  if (includesTracks) addOns.push('Track cleaning')
  if (gutterFeet > 0) addOns.push(`Gutter cleaning (${gutterFeet} ft)`)

  // Apply minimum
  const price = Math.max(subtotal, PRICING.minimumJobPrice)

  // Estimate time
  let totalMinutes = windowCount * PRICING.minutesPerWindow
  if (includesScreens) totalMinutes += windowCount * PRICING.minutesPerScreen
  if (includesTracks) totalMinutes += windowCount * PRICING.minutesPerTrack
  if (gutterFeet > 0) totalMinutes += gutterFeet * PRICING.minutesPerGutterFoot
  const estimatedHours = Math.ceil(totalMinutes / 60 * 10) / 10 // Round to 1 decimal

  return {
    windowCount,
    windowType,
    storyCount,
    includesScreens,
    includesTracks,
    gutterFeet,

    baseWindowPrice: Math.round(baseWindowPrice * 100) / 100,
    screenPrice: Math.round(screenPrice * 100) / 100,
    trackPrice: Math.round(trackPrice * 100) / 100,
    gutterPrice: Math.round(gutterPrice * 100) / 100,
    additionalServicesPrice: Math.round(additionalServicesPrice * 100) / 100,

    subtotal: Math.round(subtotal * 100) / 100,
    estimatedHours,
    price: Math.round(price * 100) / 100,
    pricePerWindow: Math.round((price / windowCount) * 100) / 100,

    addOns,
  }
}

/**
 * Calculate gutter upsell price
 */
export function calculateGutterUpsell(linearFeet: number): {
  price: number
  description: string
} {
  const price = linearFeet * PRICING.gutterCleaningPerFoot
  return {
    price: Math.round(price * 100) / 100,
    description: `Gutter cleaning - ${linearFeet} linear feet`,
  }
}

/**
 * Generate quote summary for customer
 */
export function generateQuoteSummary(quote: WindowCleaningQuote): string {
  const lines = [
    `Window Cleaning Quote`,
    `─────────────────────`,
    ``,
    `Windows: ${quote.windowCount} (${quote.windowType})`,
    `Story height: ${quote.storyCount}`,
    ``,
    `Base price: $${quote.baseWindowPrice.toFixed(2)}`,
  ]

  if (quote.screenPrice > 0) {
    lines.push(`Screen cleaning: $${quote.screenPrice.toFixed(2)}`)
  }
  if (quote.trackPrice > 0) {
    lines.push(`Track cleaning: $${quote.trackPrice.toFixed(2)}`)
  }
  if (quote.gutterPrice > 0) {
    lines.push(`Gutter cleaning: $${quote.gutterPrice.toFixed(2)}`)
  }
  if (quote.additionalServicesPrice > 0) {
    lines.push(`Additional services: $${quote.additionalServicesPrice.toFixed(2)}`)
  }

  lines.push(``)
  lines.push(`─────────────────────`)
  lines.push(`Total: $${quote.price.toFixed(2)}`)
  lines.push(`Estimated time: ${quote.estimatedHours} hours`)

  if (quote.addOns.length > 0) {
    lines.push(``)
    lines.push(`Includes:`)
    quote.addOns.forEach((addon) => {
      lines.push(`  • ${addon}`)
    })
  }

  return lines.join('\n')
}

/**
 * Parse window count from text (for VAPI extraction)
 */
export function parseWindowCount(text: string): number | null {
  // Try to find patterns like "25 windows", "about 30 windows", etc.
  const patterns = [
    /(\d+)\s*windows?/i,
    /windows?[:\s]+(\d+)/i,
    /about\s+(\d+)\s+windows?/i,
    /around\s+(\d+)\s+windows?/i,
    /approximately\s+(\d+)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return parseInt(match[1], 10)
    }
  }

  return null
}

/**
 * Detect story count from text
 */
export function parseStoryCount(text: string): 1 | 2 | 3 {
  const lower = text.toLowerCase()

  if (
    lower.includes('three story') ||
    lower.includes('3 story') ||
    lower.includes('3-story')
  ) {
    return 3
  }
  if (
    lower.includes('two story') ||
    lower.includes('2 story') ||
    lower.includes('2-story')
  ) {
    return 2
  }

  return 1 // Default to single story
}

/**
 * Detect if customer wants screens cleaned
 */
export function parseScreensIncluded(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('screen') ||
    lower.includes('screens') ||
    lower.includes('inside and out')
  )
}

/**
 * Detect if customer wants tracks cleaned
 */
export function parseTracksIncluded(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('track') ||
    lower.includes('tracks') ||
    lower.includes('sill') ||
    lower.includes('sills')
  )
}

/**
 * Detect gutter mention and estimate linear feet
 */
export function parseGutterRequest(text: string): number {
  const lower = text.toLowerCase()

  if (!lower.includes('gutter')) {
    return 0
  }

  // Try to find linear feet mentioned
  const feetMatch = lower.match(/(\d+)\s*(?:feet|ft|foot|linear)/i)
  if (feetMatch) {
    return parseInt(feetMatch[1], 10)
  }

  // Default estimate based on home size mentions
  if (lower.includes('large') || lower.includes('big')) {
    return 200
  }
  if (lower.includes('small') || lower.includes('condo')) {
    return 80
  }

  return 120 // Default estimate
}

// Export pricing config for reference
export const WINDOW_PRICING_CONFIG = PRICING
