/**
 * GoHighLevel Integration Types
 *
 * Types for GHL webhook payloads, lead status tracking,
 * and follow-up scheduling.
 */

// GHL Contact/Lead status in our system
export type GHLLeadStatus =
  | 'new'              // Just received from webhook
  | 'sms_sent'         // Initial SMS sent, waiting for response
  | 'in_conversation'  // Customer is actively responding
  | 'call_triggered'   // VAPI call initiated
  | 'call_completed'   // Call finished (any outcome)
  | 'booked'           // Successfully scheduled a job
  | 'lost'             // Max attempts reached, gave up
  | 'unqualified'      // Not a valid lead (spam, wrong number, etc.)

// Follow-up types for the queue
export type GHLFollowUpType =
  | 'initial_sms'       // First contact message
  | 'silence_reminder'  // Reminder before calling
  | 'trigger_call'      // Time to make the call
  | 'post_voicemail_sms' // SMS after leaving voicemail
  | 'post_no_answer_sms' // SMS after no answer
  | 'followup_sms_1'    // First follow-up text
  | 'followup_sms_2'    // Second follow-up text
  | 'final_attempt'     // Last try before marking lost

// Follow-up queue status
export type GHLFollowUpStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'

// GHL Lead record (matches ghl_leads table)
export interface GHLLead {
  id: string
  source_id: string
  ghl_location_id?: string
  phone_number: string
  customer_id?: string
  job_id?: string

  // Lead data from GHL
  first_name?: string
  last_name?: string
  email?: string
  source: string
  ad_campaign?: string
  ad_set?: string
  ad_name?: string
  form_data?: Record<string, unknown>

  // Multi-brand support
  brand?: string

  // Follow-up state
  status: GHLLeadStatus
  last_customer_response_at?: string
  last_outreach_at?: string
  next_followup_at?: string
  call_attempt_count: number
  sms_attempt_count: number

  created_at: string
  updated_at: string
}

// Follow-up queue record (matches ghl_followup_queue table)
export interface GHLFollowUp {
  id: string
  lead_id: string
  phone_number: string
  followup_type: GHLFollowUpType
  scheduled_at: string
  executed_at?: string
  status: GHLFollowUpStatus
  result?: Record<string, unknown>
  error_message?: string
  created_at: string
}

// Input for creating a new GHL lead
export interface CreateGHLLeadInput {
  source_id: string
  ghl_location_id?: string
  phone_number: string
  customer_id?: string
  job_id?: string
  first_name?: string
  last_name?: string
  email?: string
  source?: string
  ad_campaign?: string
  ad_set?: string
  ad_name?: string
  form_data?: Record<string, unknown>
  brand?: string
  status?: string
}

// Input for scheduling a follow-up
export interface ScheduleFollowUpInput {
  lead_id: string
  phone_number: string
  followup_type: GHLFollowUpType
  scheduled_at: Date
}

// GHL Webhook Payload Types
// Based on GHL contact.created webhook format

export interface GHLWebhookPayload {
  type: string // 'ContactCreate', 'contact.created', etc.
  locationId?: string
  location_id?: string
  contact?: GHLContactData
  data?: GHLContactData
}

export interface GHLContactData {
  id: string
  locationId?: string
  location_id?: string
  firstName?: string
  first_name?: string
  lastName?: string
  last_name?: string
  email?: string
  phone?: string
  tags?: string[]
  source?: string
  customFields?: GHLCustomField[]
  custom_fields?: GHLCustomField[]
  attributionSource?: {
    campaign?: string
    campaignId?: string
    campaign_id?: string
    adSet?: string
    adSetId?: string
    ad_set_id?: string
    adName?: string
    ad_name?: string
    medium?: string
    source?: string
  }
  dateAdded?: string
  date_added?: string
  createdAt?: string
  created_at?: string
}

export interface GHLCustomField {
  id: string
  key?: string
  field_key?: string
  value: string | number | boolean
}

// Extracted contact data (normalized from webhook)
export interface ExtractedContactData {
  ghlContactId: string
  locationId?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  source: string
  adCampaign?: string
  adSet?: string
  adName?: string
  tags?: string[]
  rawFormData?: Record<string, unknown>
}

// VAPI Outbound Call Result
export interface VAPIOutboundCallResult {
  success: boolean
  callId?: string
  error?: string
}

// Call outcome from VAPI webhook
export type CallOutcome =
  | 'answered'
  | 'voicemail'
  | 'no_answer'
  | 'busy'
  | 'failed'
