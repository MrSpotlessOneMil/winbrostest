/**
 * User API Keys
 *
 * Fetches and caches user-specific API keys from the database.
 * Falls back to environment variables for backward compatibility.
 */

import { getSupabaseServiceClient } from './supabase'

export interface UserApiKeys {
  // Business Configuration
  businessName?: string
  businessNameShort?: string
  businessTagline?: string
  ownerPhone?: string
  adminEmail?: string
  domain?: string
  reviewLink?: string
  timezone?: string

  // Housecall Pro
  housecallProApiKey?: string
  housecallProCompanyId?: string
  housecallProWebhookSecret?: string

  // GoHighLevel
  ghlApiKey?: string
  ghlLocationId?: string
  ghlWebhookSecret?: string

  // HubSpot
  hubspotAccessToken?: string

  // OpenPhone
  openphoneApiKey?: string
  openphonePhoneNumberId?: string

  // VAPI
  vapiApiKey?: string
  vapiPhoneId?: string
  vapiAssistantId?: string
  vapiOutboundPhoneId?: string

  // Telegram
  telegramBotToken?: string
  telegramControlBotToken?: string
  telegramChatId?: string

  // Stripe
  stripeSecretKey?: string
  stripeWebhookSecret?: string

  // DocuSign
  docusignAccessToken?: string
  docusignAccountId?: string
  docusignTemplateId?: string
  docusignBaseUrl?: string

  // Connecteam
  connecteamApiKey?: string
  connecteamSchedulerId?: string

  // Feature flags
  enableHousecallPro?: boolean
  enableGhl?: boolean
  enableHubspot?: boolean
  enableDocusign?: boolean
  enableConnecteam?: boolean
  enableVapiInbound?: boolean
  enableVapiOutbound?: boolean
}

// Cache for user API keys (userId -> keys)
const apiKeysCache = new Map<number, { keys: UserApiKeys; fetchedAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get API keys for a specific user from the database
 * Falls back to environment variables if not found
 */
export async function getUserApiKeys(userId: number): Promise<UserApiKeys> {
  // Check cache first
  const cached = apiKeysCache.get(userId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.keys
  }

  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('user_api_keys')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !data) {
    // Fall back to environment variables
    return getEnvFallbackKeys()
  }

  const keys: UserApiKeys = {
    // Business Configuration
    businessName: data.business_name || process.env.BUSINESS_NAME,
    businessNameShort: data.business_name_short || process.env.BUSINESS_NAME_SHORT,
    businessTagline: data.business_tagline || process.env.BUSINESS_TAGLINE,
    ownerPhone: data.owner_phone || process.env.OWNER_PHONE,
    adminEmail: data.admin_email || process.env.ADMIN_EMAIL,
    domain: data.domain || process.env.NEXT_PUBLIC_DOMAIN,
    reviewLink: data.review_link || process.env.REVIEW_LINK,
    timezone: data.timezone || process.env.TZ || 'America/Los_Angeles',

    // Housecall Pro
    housecallProApiKey: data.housecall_pro_api_key || process.env.HOUSECALL_PRO_API_KEY,
    housecallProCompanyId: data.housecall_pro_company_id || process.env.HOUSECALL_PRO_COMPANY_ID,
    housecallProWebhookSecret: data.housecall_pro_webhook_secret || process.env.HOUSECALL_PRO_WEBHOOK_SECRET,

    // GoHighLevel
    ghlApiKey: data.ghl_api_key || process.env.GHL_API_KEY,
    ghlLocationId: data.ghl_location_id || process.env.GHL_LOCATION_ID,
    ghlWebhookSecret: data.ghl_webhook_secret || process.env.GHL_WEBHOOK_SECRET,

    // HubSpot
    hubspotAccessToken: data.hubspot_access_token || process.env.HUBSPOT_ACCESS_TOKEN,

    // OpenPhone
    openphoneApiKey: data.openphone_api_key || process.env.OPENPHONE_API_KEY,
    openphonePhoneNumberId: data.openphone_phone_number_id || process.env.OPENPHONE_PHONE_NUMBER_ID,

    // VAPI
    vapiApiKey: data.vapi_api_key || process.env.VAPI_API_KEY,
    vapiPhoneId: data.vapi_phone_id || process.env.VAPI_PHONE_ID,
    vapiAssistantId: data.vapi_assistant_id || process.env.VAPI_ASSISTANT_ID,
    vapiOutboundPhoneId: data.vapi_outbound_phone_id || process.env.VAPI_OUTBOUND_PHONE_ID,

    // Telegram
    telegramBotToken: data.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN,
    telegramControlBotToken: data.telegram_control_bot_token || process.env.TELEGRAM_CONTROL_BOT_TOKEN,
    telegramChatId: data.telegram_chat_id || process.env.TELEGRAM_CHAT_ID,

    // Stripe
    stripeSecretKey: data.stripe_secret_key || process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: data.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET,

    // DocuSign
    docusignAccessToken: data.docusign_access_token || process.env.DOCUSIGN_ACCESS_TOKEN,
    docusignAccountId: data.docusign_account_id || process.env.DOCUSIGN_ACCOUNT_ID,
    docusignTemplateId: data.docusign_template_id || process.env.DOCUSIGN_TEMPLATE_ID,
    docusignBaseUrl: data.docusign_base_url || process.env.DOCUSIGN_BASE_URL,

    // Connecteam
    connecteamApiKey: data.connecteam_api_key || process.env.CONNECTEAM_API_KEY,
    connecteamSchedulerId: data.connecteam_scheduler_id || process.env.CONNECTEAM_SCHEDULER_ID,

    // Feature flags
    enableHousecallPro: data.enable_housecall_pro ?? (process.env.ENABLE_HOUSECALL_PRO === 'true'),
    enableGhl: data.enable_ghl ?? (process.env.ENABLE_GHL === 'true'),
    enableHubspot: data.enable_hubspot ?? (process.env.ENABLE_HUBSPOT === 'true'),
    enableDocusign: data.enable_docusign ?? (process.env.ENABLE_DOCUSIGN === 'true'),
    enableConnecteam: data.enable_connecteam ?? (process.env.ENABLE_CONNECTEAM === 'true'),
    enableVapiInbound: data.enable_vapi_inbound ?? (process.env.ENABLE_VAPI_INBOUND === 'true'),
    enableVapiOutbound: data.enable_vapi_outbound ?? (process.env.ENABLE_VAPI_OUTBOUND === 'true'),
  }

  // Update cache
  apiKeysCache.set(userId, { keys, fetchedAt: Date.now() })

  return keys
}

/**
 * Get fallback keys from environment variables (for backward compatibility)
 */
function getEnvFallbackKeys(): UserApiKeys {
  return {
    businessName: process.env.BUSINESS_NAME,
    businessNameShort: process.env.BUSINESS_NAME_SHORT,
    businessTagline: process.env.BUSINESS_TAGLINE,
    ownerPhone: process.env.OWNER_PHONE,
    adminEmail: process.env.ADMIN_EMAIL,
    domain: process.env.NEXT_PUBLIC_DOMAIN,
    reviewLink: process.env.REVIEW_LINK,
    timezone: process.env.TZ || 'America/Los_Angeles',

    housecallProApiKey: process.env.HOUSECALL_PRO_API_KEY,
    housecallProCompanyId: process.env.HOUSECALL_PRO_COMPANY_ID,
    housecallProWebhookSecret: process.env.HOUSECALL_PRO_WEBHOOK_SECRET,

    ghlApiKey: process.env.GHL_API_KEY,
    ghlLocationId: process.env.GHL_LOCATION_ID,
    ghlWebhookSecret: process.env.GHL_WEBHOOK_SECRET,

    hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN,

    openphoneApiKey: process.env.OPENPHONE_API_KEY,
    openphonePhoneNumberId: process.env.OPENPHONE_PHONE_NUMBER_ID,

    vapiApiKey: process.env.VAPI_API_KEY,
    vapiPhoneId: process.env.VAPI_PHONE_ID,
    vapiAssistantId: process.env.VAPI_ASSISTANT_ID,
    vapiOutboundPhoneId: process.env.VAPI_OUTBOUND_PHONE_ID,

    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramControlBotToken: process.env.TELEGRAM_CONTROL_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,

    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,

    docusignAccessToken: process.env.DOCUSIGN_ACCESS_TOKEN,
    docusignAccountId: process.env.DOCUSIGN_ACCOUNT_ID,
    docusignTemplateId: process.env.DOCUSIGN_TEMPLATE_ID,
    docusignBaseUrl: process.env.DOCUSIGN_BASE_URL,

    connecteamApiKey: process.env.CONNECTEAM_API_KEY,
    connecteamSchedulerId: process.env.CONNECTEAM_SCHEDULER_ID,

    enableHousecallPro: process.env.ENABLE_HOUSECALL_PRO === 'true',
    enableGhl: process.env.ENABLE_GHL === 'true',
    enableHubspot: process.env.ENABLE_HUBSPOT === 'true',
    enableDocusign: process.env.ENABLE_DOCUSIGN === 'true',
    enableConnecteam: process.env.ENABLE_CONNECTEAM === 'true',
    enableVapiInbound: process.env.ENABLE_VAPI_INBOUND === 'true',
    enableVapiOutbound: process.env.ENABLE_VAPI_OUTBOUND === 'true',
  }
}

/**
 * Clear the API keys cache for a user (call after updating keys)
 */
export function clearUserApiKeysCache(userId?: number): void {
  if (userId !== undefined) {
    apiKeysCache.delete(userId)
  } else {
    apiKeysCache.clear()
  }
}

// ============================================
// Request-scoped API keys context
// ============================================

// AsyncLocalStorage for request-scoped user context
import { AsyncLocalStorage } from 'async_hooks'

interface UserContext {
  userId: number
  apiKeys: UserApiKeys
}

const userContextStorage = new AsyncLocalStorage<UserContext>()

/**
 * Run a function with user-specific API keys in context
 * Use this in API route handlers after authentication
 */
export async function withUserApiKeys<T>(
  userId: number,
  fn: () => Promise<T>
): Promise<T> {
  const apiKeys = await getUserApiKeys(userId)
  return userContextStorage.run({ userId, apiKeys }, fn)
}

/**
 * Get the current user's API keys from context
 * Falls back to environment variables if no context is set
 */
export function getCurrentUserApiKeys(): UserApiKeys {
  const context = userContextStorage.getStore()
  if (context) {
    return context.apiKeys
  }
  // Fallback for webhooks, cron jobs, etc.
  return getEnvFallbackKeys()
}

/**
 * Get a specific API key value, preferring user context over env
 */
export function getApiKey<K extends keyof UserApiKeys>(key: K): UserApiKeys[K] {
  return getCurrentUserApiKeys()[key]
}
