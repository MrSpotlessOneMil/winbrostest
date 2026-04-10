import { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from './system-events'

/**
 * Unified Offers System
 *
 * Manages promotional offers (free cleaning, $99 deep clean, etc.)
 * Only fires for tenants with the relevant workflow_config flag enabled.
 * WinBros and Cedar Rapids are unaffected — they have no offer config.
 */

interface Offer {
  id: number
  tenant_id: string
  customer_id: number
  offer_type: string
  description: string | null
  source: string
  source_job_id: number | null
  redeemed_job_id: number | null
  status: 'pending' | 'redeemed' | 'expired' | 'cancelled'
  created_at: string
  redeemed_at: string | null
  expires_at: string | null
}

interface VapiBookingOfferConfig {
  enabled: boolean
  offer_type: string
  description: string
  expires_days: number
}

/**
 * Create a pending offer for a customer after a VAPI booking.
 * Only creates if:
 * 1. Tenant has vapi_booking_offer enabled in workflow_config
 * 2. Customer doesn't already have a pending offer of this type
 */
export async function createOfferFromBooking(
  client: SupabaseClient,
  tenantId: string,
  customerId: number,
  sourceJobId: number,
  workflowConfig: Record<string, unknown>
): Promise<{ created: boolean; offer?: Offer; error?: string }> {
  // Check if tenant has offer config
  const offerConfig = parseOfferConfig(workflowConfig?.vapi_booking_offer)
  if (!offerConfig?.enabled) {
    return { created: false }
  }

  // Check for existing pending offer of same type
  const { data: existing } = await client
    .from('offers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('offer_type', offerConfig.offer_type)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()

  if (existing) {
    return { created: false, error: 'Customer already has a pending offer' }
  }

  const expiresAt = new Date(Date.now() + offerConfig.expires_days * 24 * 60 * 60 * 1000).toISOString()

  const { data: offer, error } = await client
    .from('offers')
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      offer_type: offerConfig.offer_type,
      description: offerConfig.description,
      source: 'vapi_booking',
      source_job_id: sourceJobId,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (error) {
    console.error(`[Offers] Failed to create offer for customer ${customerId}:`, error.message)
    return { created: false, error: error.message }
  }

  await logSystemEvent({
    tenant_id: tenantId,
    source: 'offers',
    event_type: 'OFFER_CREATED',
    message: `Created ${offerConfig.offer_type} offer for customer ${customerId} (expires ${new Date(expiresAt).toLocaleDateString()})`,
    metadata: { offer_id: offer.id, customer_id: customerId, source_job_id: sourceJobId },
  })

  return { created: true, offer }
}

/**
 * Create an offer directly (for manual creation, tests, or non-VAPI sources).
 */
export async function createOffer(
  client: SupabaseClient,
  params: {
    tenantId: string
    customerId: number
    offerType: string
    description?: string
    source: string
    sourceJobId?: number
    expiresDays?: number
  }
): Promise<Offer | null> {
  const expiresAt = new Date(Date.now() + (params.expiresDays || 90) * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await client
    .from('offers')
    .insert({
      tenant_id: params.tenantId,
      customer_id: params.customerId,
      offer_type: params.offerType,
      description: params.description || null,
      source: params.source,
      source_job_id: params.sourceJobId || null,
      status: 'pending',
      expires_at: expiresAt,
    })
    .select('*')
    .single()

  if (error) {
    console.error(`[Offers] Failed to create offer:`, error.message)
    return null
  }

  await logSystemEvent({
    tenant_id: params.tenantId,
    source: 'offers',
    event_type: 'OFFER_CREATED',
    message: `Created ${params.offerType} offer for customer ${params.customerId}`,
    metadata: { offer_id: data.id, customer_id: params.customerId },
  })

  return data as Offer
}

/**
 * Check if a customer has a pending offer that can be redeemed.
 */
export async function checkPendingOffer(
  client: SupabaseClient,
  tenantId: string,
  customerId: number
): Promise<Offer | null> {
  const { data } = await client
    .from('offers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data as Offer | null
}

/**
 * Redeem an offer — link it to a job and mark as redeemed.
 */
export async function redeemOffer(
  client: SupabaseClient,
  offerId: number,
  jobId: number
): Promise<boolean> {
  const { data, error } = await client
    .from('offers')
    .update({
      status: 'redeemed',
      redeemed_job_id: jobId,
      redeemed_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .eq('status', 'pending') // Atomic: only redeem if still pending
    .select('id, tenant_id')
    .maybeSingle()

  if (error) {
    console.error(`[Offers] Failed to redeem offer ${offerId}:`, error.message)
    return false
  }

  if (!data) {
    console.warn(`[Offers] Offer ${offerId} not redeemed — not in pending status`)
    return false
  }

  await logSystemEvent({
    tenant_id: data.tenant_id,
    source: 'offers',
    event_type: 'OFFER_REDEEMED',
    message: `Offer ${offerId} redeemed on job ${jobId}`,
    job_id: String(jobId),
    metadata: { offer_id: offerId, job_id: jobId },
  })

  return true
}

/**
 * Check if a customer is a first-time customer (no completed jobs).
 * Accepts either customer_id (number) or phone_number (string).
 */
export async function checkFirstTimeCustomer(
  client: SupabaseClient,
  tenantId: string,
  customerIdOrPhone: number | string
): Promise<boolean> {
  let query = client
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')

  if (typeof customerIdOrPhone === 'string') {
    query = query.eq('phone_number', customerIdOrPhone)
  } else {
    query = query.eq('customer_id', customerIdOrPhone)
  }

  const { count } = await query
  return (count || 0) === 0
}

/**
 * Parse the vapi_booking_offer config from workflow_config.
 * Handles both string and object formats.
 */
function parseOfferConfig(config: unknown): VapiBookingOfferConfig | null {
  if (!config) return null
  if (typeof config === 'string') {
    try { return JSON.parse(config) } catch { return null }
  }
  if (typeof config === 'object') return config as VapiBookingOfferConfig
  return null
}
