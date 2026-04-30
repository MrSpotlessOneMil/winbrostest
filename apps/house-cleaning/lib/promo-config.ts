/**
 * Promo Campaign Configuration — Single Source of Truth
 *
 * ALL promo detection across the entire codebase imports from here.
 * Never hardcode promo logic in individual webhooks.
 *
 * Used by:
 * - app/api/webhooks/website/[slug]/route.ts (first SMS)
 * - app/api/webhooks/openphone/route.ts (quote creation, 3 paths)
 * - app/api/webhooks/stripe/route.ts (job creation)
 * - lib/auto-response.ts (AI context)
 */

export interface PromoConfig {
  /** Price shown to customer */
  price: number
  /** Hours allocated for the job */
  hours: number
  /** Number of cleaners */
  cleaners: number
  /** Exact cleaner pay (per person) — overrides all calculations */
  payOverride: number
  /** Quote tier */
  tier: 'deep' | null
  /** Addons included in the promo (shown as "included" on quote page) */
  addons: string[]
  /** Service agreement terms customer must accept */
  terms: string[]
  /** First SMS template (use {name} and {businessName} placeholders) */
  firstSms: string
  /** AI auto-response context */
  aiContext: string[]
  /** SMS message when sending quote link (use {name} and {url} placeholders) */
  quoteSms: string
}

const DILUTED_ADDONS = ['ceiling_fans', 'light_fixtures', 'window_sills', 'inside_microwave']
const FULL_DEEP_ADDONS = ['baseboards', 'ceiling_fans', 'light_fixtures', 'window_sills', 'inside_microwave', 'inside_fridge', 'inside_oven']

const THREE_HOUR_TERMS = [
  'This is a promotional $99 cleaning service limited to 3 hours with 1 cleaner. Any cleaning time beyond 3 hours will be billed at standard hourly rates.',
  'The scope of this cleaning is based on what can be completed within the 3-hour window. Larger homes may not receive full coverage.',
  'Cancellations within 24 hours of the scheduled appointment are subject to a $50 fee.',
  'This promotional rate applies to the first visit only. Recurring service is at standard pricing.',
]

const DEEP_CLEAN_TERMS = [
  'This is a promotional $149 cleaning with 1 cleaner for up to 4 hours. Includes ceiling fans, light fixtures, window sills, and inside microwave. Fridge, oven, and baseboards are not included at this promotional rate.',
  'Homes larger than 4 bedrooms may require additional time at standard hourly rates.',
  'Cancellations within 24 hours of the scheduled appointment are subject to a $50 fee.',
  'This promotional rate applies to the first visit only. Recurring service is at standard pricing.',
]

export const PROMO_CAMPAIGNS: Record<string, PromoConfig> = {
  '99-deep-clean': {
    price: 99,
    hours: 3,
    cleaners: 1,
    payOverride: 75,
    tier: 'deep',
    addons: DILUTED_ADDONS,
    terms: THREE_HOUR_TERMS,
    firstSms: 'Hey {name}! This is {businessName}. Thanks for claiming your $99 clean! What\'s your address and how many bedrooms and bathrooms? I\'ll get you booked right away!',
    aiContext: [
      'ACTIVE PROMOTIONAL OFFER FOR THIS CUSTOMER:',
      'This customer came from our $99 First Clean promotion.',
      'They are expecting a $99 cleaning (3 hours, 1 cleaner). This is a legitimate promotional offer.',
      'HONOR THE $99 PRICE. Do NOT quote the standard rate.',
      'This is a 3-HOUR cleaning session — NOT a full deep clean. Do NOT promise fridge, oven, or baseboard cleaning.',
      'After the first clean, recurring service is at the regular rate (varies by home size).',
      'The offer includes: ceiling fans, light fixtures, window sills, and inside microwave.',
      'Do NOT ask them to prove the offer or send a screenshot. Just confirm the $99 price.',
      'SAFETY NET: If the customer has 5+ bedrooms, use [ESCALATE:large-home-promo] so the owner can review.',
    ],
    quoteSms: 'Hey {name}! Your $99 clean is ready to book! Tap here to pick your date and confirm: {url}',
  },
  '99-3hr-clean': {
    price: 99,
    hours: 3,
    cleaners: 1,
    payOverride: 75,
    tier: 'deep',
    addons: DILUTED_ADDONS,
    terms: THREE_HOUR_TERMS,
    firstSms: 'Hey {name}! This is {businessName}. Thanks for claiming your $99 clean! What\'s your address and how many bedrooms and bathrooms? I\'ll get you booked right away!',
    aiContext: [
      'ACTIVE PROMOTIONAL OFFER FOR THIS CUSTOMER:',
      'This customer came from our $99 for 3 Hours promotion.',
      'They are expecting a $99 cleaning (3 hours, 1 cleaner). This is a legitimate promotional offer.',
      'HONOR THE $99 PRICE. Do NOT quote the standard rate.',
      'This is a 3-HOUR cleaning session — NOT a full deep clean. Do NOT promise fridge, oven, or baseboard cleaning.',
      'After the first clean, recurring service is at the regular rate (varies by home size).',
      'The offer includes: ceiling fans, light fixtures, window sills, and inside microwave.',
      'Do NOT ask them to prove the offer or send a screenshot. Just confirm the $99 price.',
      'SAFETY NET: If the customer has 5+ bedrooms, use [ESCALATE:large-home-promo] so the owner can review.',
    ],
    quoteSms: 'Hey {name}! Your $99 clean is ready to book! Tap here to pick your date and confirm: {url}',
  },
  '149-deep-clean': {
    price: 149,
    hours: 4,
    cleaners: 1,
    payOverride: 100,
    tier: 'deep',
    addons: DILUTED_ADDONS,
    terms: DEEP_CLEAN_TERMS,
    firstSms: 'Hey {name}! This is {businessName}. Thanks for claiming your $149 deep clean! What\'s your address and how many bedrooms and bathrooms? I\'ll get you booked right away!',
    aiContext: [
      'ACTIVE PROMOTIONAL OFFER FOR THIS CUSTOMER:',
      'This customer came from our $149 First Clean promotion (normally $250+).',
      'They are expecting a $149 cleaning. This is a legitimate promotional offer.',
      'HONOR THE $149 PRICE. Do NOT quote the standard rate.',
      'This is a 4-HOUR cleaning session with 1 cleaner. It is NOT a full deep clean.',
      'Includes: ceiling fans, light fixtures, window sills, inside microwave.',
      'Does NOT include: fridge, oven, or baseboards. Do NOT promise these.',
      'After the first clean, recurring service is at the regular rate (varies by home size).',
      'Do NOT ask them to prove the offer. Just confirm the $149 price.',
      'SAFETY NET: If the customer has 5+ bedrooms, use [ESCALATE:large-home-promo] so the owner can review.',
    ],
    quoteSms: 'Hey {name}! Your $149 deep clean is ready to book! Tap here to pick your date and confirm: {url}',
  },
}

/**
 * Look up promo config from a lead's form_data.
 * Returns null if this is not a promo lead.
 *
 * HARD GATE — added 2026-04-30 after Ebony g incident:
 * If the form payload includes `booking_data` (the regular booking widget
 * with bed/bath/address), the customer is treating Spotless as a normal
 * cleaning service. They must NEVER be silently downgraded to a $149
 * diluted-deep promo just because their URL had a stale `utm_campaign=
 * 149-deep-clean` tag they didn't even know about. Promo only applies to
 * the dedicated promo claim form (no booking_data).
 */
export function getPromoConfig(formData: Record<string, unknown> | null | undefined): PromoConfig | null {
  if (!formData) return null

  // Hard gate: full booking widget = regular lead, never promo.
  if (formData.booking_data && typeof formData.booking_data === 'object') {
    return null
  }

  const campaign = formData.utm_campaign as string | undefined
  if (campaign && PROMO_CAMPAIGNS[campaign]) {
    return PROMO_CAMPAIGNS[campaign]
  }
  // Fallback: check source_detail + service_type for Meta leads without utm_campaign
  // ONLY trigger when utm_campaign is absent — if a campaign IS set (like book-now),
  // it already went through the lookup above and didn't match a promo. Don't override.
  if (!campaign && formData.source_detail === 'meta' && formData.service_type === 'deep-cleaning') {
    return PROMO_CAMPAIGNS['99-3hr-clean'] // default Meta promo
  }
  return null
}

/** Non-promo campaign contexts for AI auto-response */
export const CAMPAIGN_CONTEXTS: Record<string, string[]> = {
  'book-now': [], // No special context — regular lead
  'airbnb-turnover': [
    'This customer is an Airbnb/short-term rental HOST looking for turnover cleaning service.',
    'They need reliable, consistent cleaning between guest stays.',
    'Focus on: same-day availability, consistent team, protecting their 5-star reviews.',
    'Quote them standard cleaning rates — no promotional discount.',
    'Ask about: number of properties, turnover frequency, property size.',
  ],
}
