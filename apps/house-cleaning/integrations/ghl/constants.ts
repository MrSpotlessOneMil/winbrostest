/**
 * GoHighLevel Integration Constants
 *
 * Timing settings, SMS templates, and configuration
 * for the aggressive SDR follow-up sequence.
 */

import { getClientConfig } from '@/lib/client-config'

// Follow-up timing constants
export const GHL_TIMING = {
  // How long to wait for customer response before calling
  SILENCE_BEFORE_CALL_MS: 15 * 60 * 1000, // 15 minutes

  // Delay after call attempts
  POST_CALL_SMS_DELAY_MS: 2 * 60 * 1000, // 2 minutes after call

  // Follow-up SMS delays
  FOLLOWUP_SMS_1_DELAY_MS: 30 * 60 * 1000, // 30 minutes
  FOLLOWUP_SMS_2_DELAY_MS: 2 * 60 * 60 * 1000, // 2 hours
  FINAL_ATTEMPT_DELAY_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Limits
  MAX_SMS_ATTEMPTS: 5,
  MAX_CALL_ATTEMPTS: 2,

  // Business hours (Pacific time) - only call during these hours
  BUSINESS_HOURS_START: 8, // 8 AM
  BUSINESS_HOURS_END: 20, // 8 PM
  TIMEZONE: 'America/Los_Angeles',
} as const

export function getClientServices(): string[] {
  return getClientConfig().services
}

export function getClientFrequencies(): string[] {
  return getClientConfig().frequencies
}

function formatServiceList(): string {
  const services = getClientServices()
  if (services.length === 0) return 'Standard, Deep clean, or Move-In/Move-Out'
  if (services.length === 1) return services[0]
  if (services.length === 2) return `${services[0]} or ${services[1]}`
  const allButLast = services.slice(0, -1)
  const last = services[services.length - 1]
  return `${allButLast.join(', ')}, or ${last}`
}

// SMS Templates for GHL leads - collect info then transition to existing booking flow
export const GHL_SMS_TEMPLATES = {
  // Initial contact (immediate) - friendly opener asking for service type
  initial: (firstName?: string) => {
    const config = getClientConfig()
    const name = firstName || 'there'
    return `Hey ${name}! This is ${config.sdrPersona} from ${config.businessName}. Thanks for reaching out! What kind of cleaning are you looking for - ${formatServiceList()}?`
  },

  // Before call (if no response to initial)
  silenceWarning: (firstName?: string) => {
    const name = firstName || 'there'
    return `Hey ${name}, just checking in! We'd love to help get your place sparkling clean. What type of cleaning - ${formatServiceList()}?`
  },

  // After voicemail
  postVoicemail: (firstName?: string) => {
    const name = firstName || 'there'
    return `Hey ${name}! Just tried calling - sorry I missed you! Text me back when you get a chance. What kind of cleaning were you looking for - ${formatServiceList()}?`
  },

  // After no answer (no voicemail left)
  postNoAnswer: (firstName?: string) => {
    const name = firstName || 'there'
    return `Hey ${name}! Tried to reach you - no worries if now's not a good time. Just text me your cleaning needs and I'll help get you booked!`
  },

  // Follow-up #1 (30 min after call)
  followUp1: (firstName?: string) => {
    const config = getClientConfig()
    const name = firstName || 'friend'
    const founded = config.foundedYear ? `since ${config.foundedYear}` : ''
    const ownership = config.tagline ? `${config.tagline}` : 'family-owned'
    const suffix = [ownership, founded].filter(Boolean).join(' ')
    return `Still thinking it over, ${name}? We're ${suffix} and use eco-friendly products safe for kids and pets. Just need a few quick details to get you a quote!`
  },

  // Follow-up #2 (2 hours)
  followUp2: (firstName?: string) => {
    const name = firstName || 'there'
    return `Hey ${name} - last check-in for today! Our cleaners are licensed, insured, and background-checked. We have a 100% satisfaction guarantee. Ready to get you scheduled?`
  },

  // Final attempt (next day)
  finalAttempt: (firstName?: string) => {
    const config = getClientConfig()
    const name = firstName || 'there'
    return `Hi ${name}, just wanted to reach out one more time! If cleaning isn't what you need right now, no worries. We're here when you're ready! -${config.businessNameShort}`
  },

  // Ask for bedrooms/bathrooms
  askBedBath: (firstName?: string, serviceType?: string) => {
    const name = firstName || 'there'
    const service = serviceType || 'cleaning'
    return `Great choice on the ${service}, ${name}! To get you an accurate quote, how many bedrooms and bathrooms do you have?`
  },

  // Ask for square footage
  askSqFt: (firstName?: string) => {
    const name = firstName || 'there'
    return `Thanks ${name}! And what's the approximate square footage? (Even a rough estimate works!)`
  },

  // Ask for address
  askAddress: (firstName?: string) => {
    const name = firstName || 'there'
    return `Perfect! What's the address we'll be cleaning?`
  },

  // Ask for frequency
  askFrequency: (firstName?: string) => {
    const config = getClientConfig()
    const name = firstName || 'there'
    return `Got it, ${name}! How often would you like us to come - ${config.frequencies.join(', ')}?`
  },

  // Ask for date/time
  askDateTime: (firstName?: string) => {
    const name = firstName || 'there'
    return `Awesome! When would you like us to come? Give me a date and time that works best for you.`
  },

  // Ask for email (to send quote) - triggers transition to existing flow
  askEmail: (firstName?: string) => {
    const name = firstName || 'there'
    return `Almost done, ${name}! What's your email? I'll send over your quote and payment link there.`
  },

  // Price inquiry response (don't give prices, collect info first)
  priceInquiry: (firstName?: string) => {
    const name = firstName || 'there'
    return `Great question, ${name}! Pricing depends on a few things. What type of cleaning - ${formatServiceList()}? And how many bedrooms/bathrooms?`
  },
} as const

// GHL API configuration
export const GHL_API_CONFIG = {
  BASE_URL: 'https://services.leadconnectorhq.com',
  ALT_BASE_URL: 'https://rest.gohighlevel.com/v1',

  // Rate limits (per GHL docs)
  RATE_LIMIT_BURST: 100, // requests per 10 seconds
  RATE_LIMIT_DAILY: 200000, // requests per day

  // Webhook event types we care about
  WEBHOOK_EVENTS: [
    'ContactCreate',
    'contact.created',
    'ContactUpdate',
    'contact.updated',
  ],
} as const

// Lead sources to track
export const GHL_LEAD_SOURCES = {
  META_ADS: 'meta_ads',
  GOOGLE_ADS: 'google_ads',
  FACEBOOK: 'facebook',
  ORGANIC: 'organic',
  REFERRAL: 'referral',
  UNKNOWN: 'unknown',
} as const

// Helper to check if within business hours
export function isWithinBusinessHours(): boolean {
  const now = new Date()
  const pacificTime = new Intl.DateTimeFormat('en-US', {
    timeZone: GHL_TIMING.TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(now)

  const hour = parseInt(pacificTime, 10)
  return hour >= GHL_TIMING.BUSINESS_HOURS_START && hour < GHL_TIMING.BUSINESS_HOURS_END
}

// Helper to get next business hour
export function getNextBusinessHour(): Date {
  const now = new Date()
  const pacificFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: GHL_TIMING.TIMEZONE,
    hour: 'numeric',
    hour12: false,
  })

  const currentHour = parseInt(pacificFormatter.format(now), 10)

  // If before business hours today, schedule for start of business
  if (currentHour < GHL_TIMING.BUSINESS_HOURS_START) {
    const result = new Date(now)
    result.setHours(GHL_TIMING.BUSINESS_HOURS_START, 0, 0, 0)
    return result
  }

  // If after business hours, schedule for tomorrow 9 AM
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0) // 9 AM gives buffer
  return tomorrow
}

// Helper to calculate silence duration
export function calculateSilenceDuration(lastResponseAt: string | undefined): number {
  if (!lastResponseAt) return Infinity

  const lastResponse = new Date(lastResponseAt).getTime()
  const now = Date.now()
  return now - lastResponse
}

// Check if lead has been silent long enough to call
export function shouldTriggerCall(lastResponseAt: string | undefined): boolean {
  const silenceMs = calculateSilenceDuration(lastResponseAt)
  return silenceMs >= GHL_TIMING.SILENCE_BEFORE_CALL_MS
}
