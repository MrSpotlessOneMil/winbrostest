/**
 * GHL Lead Processor
 *
 * Transforms GHL webhook contact data into our system's
 * customer, job, and lead records.
 */

import {
  upsertCustomer,
  createJob,
  createGHLLead,
  getCustomerByPhone,
} from '@/lib/supabase'
import type { Customer, Job } from '@/lib/supabase'
import { normalizePhone } from '@/lib/phone-utils'
import { logSystemEvent } from '@/lib/system-events'
import type { ExtractedContactData, GHLLead } from './types'
import { GHL_LEAD_SOURCES } from './constants'

export interface ProcessLeadResult {
  success: boolean
  lead?: GHLLead
  customer?: Customer | null
  job?: Job | null
  error?: string
}

/**
 * Process a new lead from GHL webhook
 * Creates customer, job, and GHL lead records
 */
export async function processNewLead(
  contactData: ExtractedContactData,
  brandMode?: string
): Promise<ProcessLeadResult> {
  const phoneNumber = normalizePhone(contactData.phone)

  if (!phoneNumber) {
    return {
      success: false,
      error: `Invalid phone number: ${contactData.phone}`,
    }
  }

  try {
    // 1. Check for existing customer by phone
    let customer = await getCustomerByPhone(phoneNumber)

    // 2. Create or update customer record
    customer = await upsertCustomer(phoneNumber, {
      phone_number: phoneNumber,
      first_name: contactData.firstName || customer?.first_name,
      last_name: contactData.lastName || customer?.last_name,
      email: contactData.email || customer?.email,
    })

    if (!customer) {
      return {
        success: false,
        error: 'Failed to create/update customer record',
      }
    }

    // 3. Create job with 'lead' status
    const job = await createJob({
      phone_number: phoneNumber,
      customer_id: customer.id,
      service_type: 'Standard cleaning', // Default, AI will confirm
      status: 'lead',
      booked: false,
      paid: false,
      invoice_sent: false,
      notes: buildJobNotes(contactData),
    })

    if (!job) {
      return {
        success: false,
        customer,
        error: 'Failed to create job record',
      }
    }

    // 4. Create GHL lead record
    const lead = await createGHLLead({
      source_id: contactData.ghlContactId,
      ghl_location_id: contactData.locationId,
      phone_number: phoneNumber,
      customer_id: customer.id,
      job_id: job.id,
      first_name: contactData.firstName,
      last_name: contactData.lastName,
      email: contactData.email,
      source: detectLeadSource(contactData),
      ad_campaign: contactData.adCampaign,
      ad_set: contactData.adSet,
      ad_name: contactData.adName,
      form_data: contactData.rawFormData,
      status: 'new',
      brand: brandMode,
    })

    if (!lead) {
      return {
        success: false,
        customer,
        job,
        error: 'Failed to create GHL lead record',
      }
    }

    // 5. Log the event
    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_LEAD_RECEIVED',
      message: `New Meta Ads lead: ${contactData.firstName || 'Unknown'} ${contactData.lastName || ''}`.trim(),
      job_id: job.id,
      customer_id: customer.id,
      phone_number: phoneNumber,
      metadata: {
        source_id: contactData.ghlContactId,
        campaign: contactData.adCampaign,
        source: lead.source,
      },
    })

    return {
      success: true,
      lead: lead as GHLLead,
      customer,
      job,
    }
  } catch (error) {
    console.error('Error processing GHL lead:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Create lead from extracted contact data
 * Simpler version that just creates the GHL lead record
 */
export async function createLeadFromContact(
  contactData: ExtractedContactData,
  customerId?: string,
  jobId?: string
): Promise<GHLLead | null> {
  const phoneNumber = normalizePhone(contactData.phone)

  if (!phoneNumber) {
    console.error('Invalid phone number for lead:', contactData.phone)
    return null
  }

  return createGHLLead({
    source_id: contactData.ghlContactId,
    ghl_location_id: contactData.locationId,
    phone_number: phoneNumber,
    customer_id: customerId,
    job_id: jobId,
    first_name: contactData.firstName,
    last_name: contactData.lastName,
    email: contactData.email,
    source: detectLeadSource(contactData),
    ad_campaign: contactData.adCampaign,
    ad_set: contactData.adSet,
    ad_name: contactData.adName,
    form_data: contactData.rawFormData,
    status: 'new',
  }) as Promise<GHLLead | null>
}

/**
 * Build job notes from contact data
 */
function buildJobNotes(contactData: ExtractedContactData): string {
  const parts: string[] = []

  parts.push(`GHL Lead - ${new Date().toISOString()}`)

  if (contactData.adCampaign) {
    parts.push(`Campaign: ${contactData.adCampaign}`)
  }

  if (contactData.adSet) {
    parts.push(`Ad Set: ${contactData.adSet}`)
  }

  if (contactData.adName) {
    parts.push(`Ad: ${contactData.adName}`)
  }

  if (contactData.tags && contactData.tags.length > 0) {
    parts.push(`Tags: ${contactData.tags.join(', ')}`)
  }

  return parts.join('\n')
}

/**
 * Detect lead source from contact data
 */
function detectLeadSource(contactData: ExtractedContactData): string {
  const source = contactData.source?.toLowerCase() || ''
  const campaign = contactData.adCampaign?.toLowerCase() || ''

  // Check for Meta/Facebook
  if (
    source.includes('facebook') ||
    source.includes('meta') ||
    source.includes('fb') ||
    campaign.includes('facebook') ||
    campaign.includes('meta') ||
    campaign.includes('fb')
  ) {
    return GHL_LEAD_SOURCES.META_ADS
  }

  // Check for Google
  if (
    source.includes('google') ||
    campaign.includes('google') ||
    campaign.includes('adwords')
  ) {
    return GHL_LEAD_SOURCES.GOOGLE_ADS
  }

  // Check for referral
  if (source.includes('referral') || source.includes('refer')) {
    return GHL_LEAD_SOURCES.REFERRAL
  }

  // Check for organic
  if (source.includes('organic') || source.includes('seo')) {
    return GHL_LEAD_SOURCES.ORGANIC
  }

  // Default to meta_ads since that's the primary use case
  return GHL_LEAD_SOURCES.META_ADS
}
