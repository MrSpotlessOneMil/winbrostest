/**
 * Unified Offers Module
 *
 * Shared logic for VAPI free-next-cleaning and Meta $99 deep clean offers.
 * Both webhook paths (VAPI + website) use these helpers.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { logSystemEvent } from './system-events'

export interface CreateOfferParams {
  tenantId: string
  customerId: number
  offerType: string        // 'free_standard_cleaning' | '$99_deep_clean'
  description: string
  source: string           // 'vapi_booking' | 'meta_ad' | 'meta_ad_phone'
  sourceJobId?: number
  expiresDays: number
}

export interface Offer {
  id: number
  tenant_id: string
  customer_id: number
  offer_type: string
  description: string | null
  source: string
  source_job_id: number | null
  redeemed_job_id: number | null
  status: string
  created_at: string
  redeemed_at: string | null
  expires_at: string | null
}

/**
 * Create a new offer for a customer.
 * Inserts the row and logs OFFER_CREATED system event.
 */
export async function createOffer(
  client: SupabaseClient,
  params: CreateOfferParams
): Promise<Offer | null> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + params.expiresDays)

  const { data, error } = await client
    .from('offers')
    .insert({
      tenant_id: params.tenantId,
      customer_id: params.customerId,
      offer_type: params.offerType,
      description: params.description,
      source: params.source,
      source_job_id: params.sourceJobId || null,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    console.error('[Offers] Failed to create offer:', error.message)
    return null
  }

  await logSystemEvent({
    tenant_id: params.tenantId,
    source: 'system',
    event_type: 'OFFER_CREATED',
    message: `Offer created: ${params.offerType} for customer ${params.customerId} (source: ${params.source})`,
    customer_id: String(params.customerId),
    metadata: {
      offer_id: data.id,
      offer_type: params.offerType,
      source: params.source,
      source_job_id: params.sourceJobId,
      expires_at: expiresAt.toISOString(),
    },
  })

  return data as Offer
}

/**
 * Check for a pending, non-expired offer for a customer.
 * Optionally filter by offer_type.
 */
export async function checkPendingOffer(
  client: SupabaseClient,
  tenantId: string,
  customerId: number,
  offerType?: string
): Promise<Offer | null> {
  let query = client
    .from('offers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(1)

  if (offerType) {
    query = query.eq('offer_type', offerType)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error('[Offers] Error checking pending offer:', error.message)
    return null
  }

  return data as Offer | null
}

/**
 * Redeem an offer by linking it to a job.
 * Sets status='redeemed', redeemed_job_id, redeemed_at.
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
    .select('id, tenant_id, customer_id, offer_type')
    .single()

  if (error || !data) {
    console.error('[Offers] Failed to redeem offer:', error?.message || 'offer not pending')
    return false
  }

  await logSystemEvent({
    tenant_id: data.tenant_id,
    source: 'system',
    event_type: 'OFFER_REDEEMED',
    message: `Offer ${offerId} redeemed: ${data.offer_type} on job ${jobId}`,
    customer_id: String(data.customer_id),
    job_id: String(jobId),
    metadata: {
      offer_id: offerId,
      offer_type: data.offer_type,
      job_id: jobId,
    },
  })

  return true
}

/**
 * Check if a customer is first-time (no completed/scheduled jobs).
 * Used for $99 deep clean eligibility.
 */
export async function checkFirstTimeCustomer(
  client: SupabaseClient,
  tenantId: string,
  phone: string
): Promise<boolean> {
  const { count, error } = await client
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('phone_number', phone)

  if (error) {
    console.error('[Offers] Error checking first-time customer:', error.message)
    return false // Fail closed — don't give offer if unsure
  }

  return (count ?? 0) === 0
}
