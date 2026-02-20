/**
 * Multi-Tenant Configuration Module
 *
 * This module provides tenant lookup and configuration management.
 * All tenant-specific API keys and settings are stored in the database.
 *
 * Universal API keys (shared across all tenants) remain in environment variables:
 * - QSTASH_TOKEN, QSTASH_URL, QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY
 * - SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 * - ANTHROPIC_API_KEY, OPENAI_API_KEY
 * - GMAIL_USER, GMAIL_APP_PASSWORD
 */

import { createClient } from "@supabase/supabase-js"

// Use service role for tenant lookups (bypasses RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

// ============================================================================
// TYPES
// ============================================================================

export interface WorkflowConfig {
  // Integration toggles
  use_housecall_pro: boolean
  use_vapi_inbound: boolean
  use_vapi_outbound: boolean
  use_ghl: boolean
  use_stripe: boolean
  use_wave: boolean

  // Lead follow-up settings
  lead_followup_enabled: boolean
  lead_followup_stages: number
  skip_calls_for_sms_leads: boolean
  followup_delays_minutes: number[]

  // Post-cleaning follow-up
  post_cleaning_followup_enabled: boolean
  post_cleaning_delay_hours: number

  // Monthly follow-up
  monthly_followup_enabled: boolean
  monthly_followup_days: number
  monthly_followup_discount: string

  // Cleaner assignment
  cleaner_assignment_auto: boolean
  require_deposit: boolean
  deposit_percentage: number

  // Route optimization (WinBros logistics engine)
  use_route_optimization: boolean

  // Kill switches
  sms_auto_response_enabled: boolean

  // Lifecycle messaging
  seasonal_reminders_enabled?: boolean
  frequency_nudge_enabled?: boolean
  frequency_nudge_days?: number
  review_only_followup_enabled?: boolean
  seasonal_campaigns?: SeasonalCampaign[]
}

export interface SeasonalCampaign {
  id: string
  name: string
  message: string
  start_date: string
  end_date: string
  target_segment: 'all' | 'inactive_30' | 'inactive_60' | 'inactive_90' | 'completed_customers'
  enabled: boolean
  created_at: string
  last_sent_at: string | null
}

export interface Tenant {
  id: string
  name: string
  slug: string
  email: string | null
  password_hash: string | null

  // Business info
  business_name: string | null
  business_name_short: string | null
  service_area: string | null
  sdr_persona: string
  service_description: string | null // e.g., "window cleaning", "house cleaning", "carpet cleaning"

  // API Keys
  openphone_api_key: string | null
  openphone_phone_id: string | null
  openphone_phone_number: string | null

  vapi_api_key: string | null
  vapi_assistant_id: string | null
  vapi_outbound_assistant_id: string | null
  vapi_phone_id: string | null

  housecall_pro_api_key: string | null
  housecall_pro_company_id: string | null
  housecall_pro_webhook_secret: string | null

  stripe_secret_key: string | null
  stripe_webhook_secret: string | null

  ghl_location_id: string | null
  ghl_webhook_secret: string | null

  telegram_bot_token: string | null
  owner_telegram_chat_id: string | null

  wave_api_token: string | null
  wave_business_id: string | null
  wave_income_account_id: string | null

  // Workflow configuration
  workflow_config: WorkflowConfig

  // Owner contact
  owner_phone: string | null
  owner_email: string | null
  google_review_link: string | null

  // Status
  active: boolean
  created_at: string
  updated_at: string
}

// Minimal tenant info for listing
export interface TenantSummary {
  id: string
  name: string
  slug: string
  active: boolean
}

// ============================================================================
// TENANT LOOKUP FUNCTIONS
// ============================================================================

/**
 * Get tenant by ID.
 * By default returns both active and inactive tenants (needed for dashboard access).
 * Pass activeOnly=true for webhook/cron paths that should only process active businesses.
 */
export async function getTenantById(tenantId: string, activeOnly = false): Promise<Tenant | null> {
  const client = getAdminClient()

  let query = client
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.single()

  if (error || !data) {
    if (activeOnly) {
      // Don't log error for activeOnly — tenant may just be inactive
      return null
    }
    console.error(`[Tenant] Error fetching tenant by ID '${tenantId}' (activeOnly=${activeOnly}):`, error?.message || error)
    return null
  }

  return data as Tenant
}

/**
 * Get tenant by slug (used for webhook routing).
 * By default requires active=true (webhooks should only process active tenants).
 * Pass activeOnly=false for dashboard/auth paths that need inactive tenants too.
 */
export async function getTenantBySlug(slug: string, activeOnly = true): Promise<Tenant | null> {
  const client = getAdminClient()

  let query = client
    .from("tenants")
    .select("*")
    .eq("slug", slug)
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.single()

  if (error || !data) {
    if (!activeOnly) {
      // Don't log for dashboard/auth fallback lookups
      return null
    }
    console.error(`[Tenant] Error fetching tenant by slug '${slug}':`, error)
    return null
  }

  return data as Tenant
}

/**
 * Get tenant by email (used for authentication)
 */
export async function getTenantByEmail(email: string): Promise<Tenant | null> {
  const client = getAdminClient()

  const { data, error } = await client
    .from("tenants")
    .select("*")
    .eq("email", email.toLowerCase())
    .eq("active", true)
    .single()

  if (error || !data) {
    return null
  }

  return data as Tenant
}

/**
 * Get tenant by OpenPhone phone number (used for SMS routing)
 * Normalizes the phone number to match various formats in the database
 */
export async function getTenantByPhoneNumber(phoneNumber: string): Promise<Tenant | null> {
  const client = getAdminClient()

  // Normalize the phone number - remove all non-digit characters
  const digitsOnly = phoneNumber.replace(/\D/g, "")
  // Get last 10 digits (the actual phone number without country code)
  const last10 = digitsOnly.slice(-10)

  // Try to find by exact match first, then by partial match
  const { data, error } = await client
    .from("tenants")
    .select("*")
    .eq("active", true)

  if (error || !data) {
    console.error("[Tenant] Error fetching tenants by phone:", error)
    return null
  }

  // Find tenant whose openphone_phone_number matches
  for (const tenant of data) {
    if (!tenant.openphone_phone_number) continue
    const tenantDigits = tenant.openphone_phone_number.replace(/\D/g, "")
    const tenantLast10 = tenantDigits.slice(-10)
    if (tenantLast10 === last10) {
      return tenant as Tenant
    }
  }

  return null
}

/**
 * Get tenant by OpenPhone phone ID (the internal ID OpenPhone uses)
 * This is needed because OpenPhone webhooks may send phoneNumberId instead of the actual phone number
 */
export async function getTenantByOpenPhoneId(phoneId: string): Promise<Tenant | null> {
  const client = getAdminClient()

  const { data, error } = await client
    .from("tenants")
    .select("*")
    .eq("openphone_phone_id", phoneId)
    .eq("active", true)
    .single()

  if (error || !data) {
    // Not found is expected, don't log as error
    return null
  }

  return data as Tenant
}

/**
 * Get all active tenants (for cron jobs)
 */
export async function getAllActiveTenants(): Promise<Tenant[]> {
  const client = getAdminClient()

  const { data, error } = await client
    .from("tenants")
    .select("*")
    .eq("active", true)
    .order("name")

  if (error || !data) {
    console.error("[Tenant] Error fetching active tenants:", error)
    return []
  }

  return data as Tenant[]
}

/**
 * List tenants (summary only, for admin dashboard)
 */
export async function listTenants(): Promise<TenantSummary[]> {
  const client = getAdminClient()

  const { data, error } = await client
    .from("tenants")
    .select("id, name, slug, active")
    .order("name")

  if (error || !data) {
    console.error("[Tenant] Error listing tenants:", error)
    return []
  }

  return data as TenantSummary[]
}

// ============================================================================
// TENANT CONFIGURATION HELPERS
// ============================================================================

/**
 * Check if tenant has a specific integration enabled
 */
export function tenantHasIntegration(
  tenant: Tenant,
  integration: "housecall_pro" | "vapi" | "ghl" | "stripe" | "wave"
): boolean {
  const config = tenant.workflow_config

  switch (integration) {
    case "housecall_pro":
      return config.use_housecall_pro && !!tenant.housecall_pro_api_key
    case "vapi":
      return (config.use_vapi_inbound || config.use_vapi_outbound) && !!tenant.vapi_api_key
    case "ghl":
      return config.use_ghl && !!tenant.ghl_location_id
    case "stripe":
      return config.use_stripe && !!tenant.stripe_secret_key
    case "wave":
      return config.use_wave && !!tenant.wave_api_token
    default:
      return false
  }
}

/**
 * Get the business name for customer-facing messages
 */
export function getTenantBusinessName(tenant: Tenant, short = false): string {
  if (short) {
    return tenant.business_name_short || tenant.name
  }
  return tenant.business_name || tenant.name
}

/**
 * Get the SDR persona name for automated messages
 */
export function getTenantSdrName(tenant: Tenant): string {
  return tenant.sdr_persona || "Mary"
}

/**
 * Get the service type/description for this tenant
 * Used in AI prompts and templates to customize messaging
 */
export function getTenantServiceDescription(tenant: Tenant): string {
  // Use explicit service_description if set
  if (tenant.service_description) {
    return tenant.service_description
  }

  // Infer from business name as fallback
  const name = (tenant.business_name || tenant.name || '').toLowerCase()
  if (name.includes('window')) return 'window cleaning'
  if (name.includes('carpet')) return 'carpet cleaning'
  if (name.includes('pressure') || name.includes('power wash')) return 'pressure washing'
  if (name.includes('maid') || name.includes('house')) return 'house cleaning'

  // Default
  return 'cleaning'
}

/**
 * Get a prompt-friendly description of the business for AI
 */
export function getTenantBusinessContext(tenant: Tenant): string {
  const serviceType = getTenantServiceDescription(tenant)
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name
  const area = tenant.service_area || 'the local area'

  return `${businessName} is a professional ${serviceType} service in ${area}`
}

/**
 * Get the follow-up discount for this tenant
 */
export function getTenantDiscount(tenant: Tenant): string {
  return tenant.workflow_config.monthly_followup_discount || "15%"
}

/**
 * Check if SMS auto-response is enabled for this tenant
 */
export function isSmsAutoResponseEnabled(tenant: Tenant): boolean {
  // Default to true if not explicitly set to false
  return tenant.workflow_config.sms_auto_response_enabled !== false
}

// ============================================================================
// TENANT UPDATE FUNCTIONS
// ============================================================================

/**
 * Update tenant's Telegram chat ID (for escalations)
 */
export async function updateTenantTelegramChatId(
  tenantId: string,
  chatId: string
): Promise<boolean> {
  const client = getAdminClient()

  const { error } = await client
    .from("tenants")
    .update({ owner_telegram_chat_id: chatId })
    .eq("id", tenantId)

  if (error) {
    console.error("[Tenant] Error updating Telegram chat ID:", error)
    return false
  }

  return true
}

/**
 * Update tenant workflow config
 */
export async function updateTenantWorkflowConfig(
  tenantId: string,
  config: Partial<WorkflowConfig>
): Promise<boolean> {
  const client = getAdminClient()

  // Get current config
  const tenant = await getTenantById(tenantId)
  if (!tenant) return false

  const newConfig = { ...tenant.workflow_config, ...config }

  const { error } = await client
    .from("tenants")
    .update({ workflow_config: newConfig })
    .eq("id", tenantId)

  if (error) {
    console.error("[Tenant] Error updating workflow config:", error)
    return false
  }

  return true
}

// ============================================================================
// TENANT CONTEXT FOR REQUEST HANDLING
// ============================================================================

/**
 * Extract tenant slug from webhook URL path
 * e.g., /api/webhooks/vapi/winbros -> "winbros"
 */
export function extractTenantSlugFromPath(pathname: string): string | null {
  // Match patterns like /api/webhooks/{type}/{slug}
  const match = pathname.match(/\/api\/webhooks\/[^/]+\/([^/]+)/)
  return match ? match[1] : null
}

/**
 * Verify webhook signature for a tenant
 */
export function verifyTenantWebhookSignature(
  tenant: Tenant,
  webhookType: "housecall_pro" | "stripe" | "ghl",
  signature: string,
  payload: string
): boolean {
  let secret: string | null = null

  switch (webhookType) {
    case "housecall_pro":
      secret = tenant.housecall_pro_webhook_secret
      break
    case "stripe":
      secret = tenant.stripe_webhook_secret
      break
    case "ghl":
      secret = tenant.ghl_webhook_secret
      break
  }

  if (!secret) {
    // No secret configured, skip validation (with warning)
    console.warn(`[Tenant] No ${webhookType} webhook secret configured for ${tenant.slug}`)
    return true
  }

  // Import crypto for HMAC
  const { createHmac, timingSafeEqual } = require("crypto")

  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex")

  const sigLower = signature.toLowerCase()
  const expectedLower = expectedSignature.toLowerCase()

  if (sigLower.length !== expectedLower.length) {
    return false
  }

  return timingSafeEqual(Buffer.from(sigLower), Buffer.from(expectedLower))
}

// ============================================================================
// DEFAULT/FALLBACK TENANT (for backwards compatibility during migration)
// ============================================================================

// Cache the default tenant to avoid repeated lookups
let defaultTenantCache: Tenant | null = null
let defaultTenantCacheTime = 0
const CACHE_TTL = 60000 // 1 minute

/**
 * Get the default tenant (winbros) for backwards compatibility
 * This is used during the migration period when some code paths
 * don't have tenant context yet.
 */
export async function getDefaultTenant(): Promise<Tenant | null> {
  const now = Date.now()

  // Return cached if valid
  if (defaultTenantCache && now - defaultTenantCacheTime < CACHE_TTL) {
    return defaultTenantCache
  }

  // Fetch and cache
  defaultTenantCache = await getTenantBySlug("winbros")
  defaultTenantCacheTime = now

  return defaultTenantCache
}

/**
 * Require a tenant - throws if not found
 */
export async function requireTenant(slugOrId: string, bySlug = true): Promise<Tenant> {
  const tenant = bySlug
    ? await getTenantBySlug(slugOrId)
    : await getTenantById(slugOrId)

  if (!tenant) {
    throw new Error(`Tenant not found: ${slugOrId}`)
  }

  return tenant
}
