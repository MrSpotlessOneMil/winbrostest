/**
 * GHL Webhook Handler
 *
 * Processes incoming GHL webhooks for contact creation events.
 * Extracts contact data and triggers lead processing.
 */

import { getGHLLeadByContactId } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { normalizePhone } from '@/lib/phone-utils'
import { sendSMS } from '@/lib/openphone'
import type {
  GHLWebhookPayload,
  GHLContactData,
  ExtractedContactData,
} from './types'
import { GHL_API_CONFIG, GHL_SMS_TEMPLATES, GHL_TIMING } from './constants'
import { processNewLead } from './lead-processor'
import { scheduleFollowUp } from './follow-up-scheduler'

export interface WebhookProcessResult {
  success: boolean
  action: string
  leadId?: string
  jobId?: string
  customerId?: string
  error?: string
}

/**
 * Process incoming GHL webhook
 * Main entry point for webhook handling
 */
export async function processGHLWebhook(
  payload: GHLWebhookPayload,
  brandMode?: string
): Promise<WebhookProcessResult> {
  // 1. Validate event type
  const eventType = payload.type?.toLowerCase() || ''
  const isContactCreate = GHL_API_CONFIG.WEBHOOK_EVENTS.some(
    event => eventType.includes(event.toLowerCase())
  )

  if (!isContactCreate) {
    return {
      success: true,
      action: 'ignored_event_type',
    }
  }

  // 2. Extract contact data
  const contactData = extractContactData(payload)

  if (!contactData) {
    return {
      success: false,
      action: 'invalid_payload',
      error: 'Could not extract contact data from payload',
    }
  }

  // 3. Validate phone number
  const phoneNumber = normalizePhone(contactData.phone)
  if (!phoneNumber) {
    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_LEAD_RECEIVED',
      message: 'Invalid phone number - lead skipped',
      metadata: {
        raw_phone: contactData.phone,
        source_id: contactData.ghlContactId,
      },
    })

    return {
      success: false,
      action: 'invalid_phone',
      error: `Invalid phone number: ${contactData.phone}`,
    }
  }

  // 4. Check for duplicate (by GHL contact ID)
  const existingLead = await getGHLLeadByContactId(contactData.ghlContactId)
  if (existingLead) {
    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_LEAD_DUPLICATE',
      message: `Duplicate lead ignored: ${contactData.ghlContactId}`,
      phone_number: phoneNumber,
    })

    return {
      success: true,
      action: 'duplicate_ignored',
      leadId: existingLead.id,
    }
  }

  // 5. Process the new lead
  const result = await processNewLead(contactData, brandMode)

  if (!result.success || !result.lead) {
    return {
      success: false,
      action: 'lead_creation_failed',
      error: result.error,
    }
  }

  // 6. Send immediate SMS
  const initialMessage = GHL_SMS_TEMPLATES.initial(contactData.firstName)
  const smsResult = await sendSMS(phoneNumber, initialMessage, brandMode)

  if (smsResult.success) {
    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_INITIAL_SMS_SENT',
      message: `Initial SMS sent to ${contactData.firstName || 'lead'}`,
      job_id: result.job?.id,
      customer_id: result.customer?.id,
      phone_number: phoneNumber,
      metadata: {
        lead_id: result.lead.id,
        message_preview: initialMessage.slice(0, 100),
      },
    })
  } else {
    console.error('Failed to send initial SMS:', smsResult.error)
  }

  // 7. Schedule 15-minute follow-up call
  const followUpTime = new Date(Date.now() + GHL_TIMING.SILENCE_BEFORE_CALL_MS)
  await scheduleFollowUp({
    lead_id: result.lead.id!,
    phone_number: phoneNumber,
    followup_type: 'trigger_call',
    scheduled_at: followUpTime,
  })

  return {
    success: true,
    action: 'lead_created',
    leadId: result.lead.id,
    jobId: result.job?.id,
    customerId: result.customer?.id,
  }
}

/**
 * Extract normalized contact data from GHL webhook payload
 * Handles various payload formats from GHL
 */
export function extractContactData(
  payload: GHLWebhookPayload
): ExtractedContactData | null {
  // GHL sends contact data in different locations depending on webhook version
  const contact: GHLContactData | undefined = payload.contact || payload.data

  if (!contact) {
    console.error('No contact data in webhook payload')
    return null
  }

  // Extract phone (try multiple fields)
  const phone = contact.phone
  if (!phone) {
    console.error('No phone number in contact data')
    return null
  }

  // Extract location ID
  const locationId =
    contact.locationId ||
    contact.location_id ||
    payload.locationId ||
    payload.location_id

  // Extract names
  const firstName = contact.firstName || contact.first_name
  const lastName = contact.lastName || contact.last_name

  // Extract attribution/source
  const attribution = contact.attributionSource
  const source = attribution?.source || contact.source || 'meta_ads'

  // Extract ad campaign info
  const adCampaign =
    attribution?.campaign ||
    attribution?.campaignId ||
    attribution?.campaign_id
  const adSet =
    attribution?.adSet ||
    attribution?.adSetId ||
    attribution?.ad_set_id
  const adName = attribution?.adName || attribution?.ad_name

  // Extract custom fields as form data
  const customFields = contact.customFields || contact.custom_fields || []
  const formData: Record<string, unknown> = {}
  for (const field of customFields) {
    const key = field.key || field.field_key || field.id
    formData[key] = field.value
  }

  return {
    ghlContactId: contact.id,
    locationId,
    firstName,
    lastName,
    email: contact.email,
    phone,
    source,
    adCampaign,
    adSet,
    adName,
    tags: contact.tags,
    rawFormData: {
      ...formData,
      _raw: contact,
    },
  }
}

/**
 * Validate GHL webhook request
 * GHL uses API key in headers or webhook secrets
 */
export function validateGHLRequest(
  headers: Headers,
  apiKey?: string
): boolean {
  if (!apiKey) {
    // No API key configured, allow all requests (for development)
    return true
  }

  // Check for API key in various header locations
  const authHeader = headers.get('authorization') || ''
  const apiKeyHeader = headers.get('x-api-key') || ''
  const ghlApiKey = headers.get('x-ghl-api-key') || ''

  // Check Bearer token
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '')
    if (token === apiKey) return true
  }

  // Check direct API key headers
  if (apiKeyHeader === apiKey) return true
  if (ghlApiKey === apiKey) return true

  return false
}
