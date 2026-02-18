import { getSupabaseClient } from './supabase'
import { toE164 } from './phone-utils'

export type SystemEventSource =
  | 'vapi'
  | 'openphone'
  | 'stripe'
  | 'telegram'
  | 'cron'
  | 'actions'
  | 'system'
  | 'ghl'
  | 'housecall_pro'
  | 'job_updates'
  | 'lead_followup'
  | 'scheduler'
  | 'lead_actions'

export type SystemEventType =
  | 'CALL_COMPLETED'
  | 'CALL_SKIPPED'
  | 'SMS_RECEIVED'
  | 'SMS_IGNORED_UNKNOWN'
  | 'SMS_IGNORED_BLOCKLIST'
  | 'EMAIL_CAPTURED'
  | 'INVOICE_SENT'
  | 'PAYMENT_LINKS_SENT'
  | 'CONFIRMATION_EMAIL_SENT'
  | 'ADDONS_REQUESTED'
  | 'ADDON_PAYMENT_LINK_SENT'
  | 'INVOICE_PAID'
  | 'PAYMENT_FAILED'
  | 'DEPOSIT_PAID'
  | 'ADDON_PAID'
  | 'FINAL_PAID'
  | 'CARD_ON_FILE_SAVED'
  | 'CLEANER_BROADCAST'
  | 'CLEANER_ACCEPTED'
  | 'CLEANER_DECLINED'
  | 'CLEANER_CANCELLED'
  | 'CLEANER_AWARDED'
  | 'URGENT_FOLLOWUP_SENT'
  | 'REMINDER_SENT'
  | 'OWNER_ALERT'
  | 'CUSTOMER_DELAY_NOTICE'
  | 'JOB_COMPLETED'
  | 'JOB_DETAILS_CHANGED'
  | 'FINAL_PAYMENT_LINK_SENT'
  | 'FINAL_PAYMENT_SCHEDULED'
  | 'AUTO_FINAL_PAYMENT_SENT'
  | 'SKIP_TO_FINAL_PAYMENT'
  | 'REVIEW_REQUEST_SENT'
  | 'RESCHEDULE_REQUESTED'
  | 'RESCHEDULE_CONFIRMED'
  | 'RESCHEDULE_DECLINED'
  | 'OWNER_ACTION_REQUIRED'
  | 'CONNECTEAM_SHIFT_CREATED'
  | 'DOCUSIGN_SENT'
  | 'PRICING_INSIGHT'
  | 'TELEGRAM_MESSAGE'
  | 'TELEGRAM_RESPONSE'
  | 'SYSTEM_DISABLED'
  | 'SYSTEM_ENABLED'
  | 'SYSTEM_RESET'
  // GHL (GoHighLevel) Meta Ads Integration Events
  | 'GHL_LEAD_RECEIVED'
  | 'GHL_LEAD_DUPLICATE'
  | 'GHL_INITIAL_SMS_SENT'
  | 'GHL_SILENCE_DETECTED'
  | 'GHL_CALL_TRIGGERED'
  | 'GHL_CALL_COMPLETED'
  | 'GHL_CALL_VOICEMAIL'
  | 'GHL_CALL_NO_ANSWER'
  | 'GHL_POST_CALL_SMS_SENT'
  | 'GHL_FOLLOWUP_SMS_SENT'
  | 'GHL_LEAD_BOOKED'
  | 'GHL_LEAD_LOST'
  | 'GHL_MAX_ATTEMPTS'
  | 'GHL_CUSTOMER_RESPONSE'
  // Housecall Pro Events
  | 'HCP_LEAD_RECEIVED'
  // Lead Follow-up Automation Events
  | 'LEAD_FOLLOWUP_STAGE_1'
  | 'LEAD_FOLLOWUP_STAGE_2'
  | 'LEAD_FOLLOWUP_STAGE_3'
  | 'LEAD_FOLLOWUP_STAGE_4'
  | 'LEAD_FOLLOWUP_STAGE_5'
  | 'LEAD_FOLLOWUP_ERROR'
  | 'MONTHLY_FOLLOWUP_SENT'
  | 'CUSTOMER_NOTIFIED'
  | 'LEAD_FOLLOWUP_EXECUTED'
  | 'LEAD_FOLLOWUP_PAUSED'
  | 'LEAD_FOLLOWUP_RESUMED'
  // VAPI Events
  | 'VAPI_CALL_RECEIVED'
  | 'LEAD_CREATED_FROM_CALL'
  | 'JOB_CREATED_FROM_CALL'
  | 'EXISTING_LEAD_BOOKED'
  // SMS/OpenPhone Events
  | 'SMS_INTENT_ANALYZED'
  | 'LEAD_CREATED_FROM_SMS'
  | 'AUTO_RESPONSE_SENT'
  // Post-job automation
  | 'POST_JOB_FOLLOWUP_SENT'
  | 'MONTHLY_REENGAGEMENT_SENT'
  // Lead stage changes
  | 'LEAD_STAGE_CHANGED'
  | 'PAYMENT_LINK_SENT'
  | 'SMS_ROUTING'
  // Telegram Onboarding
  | 'TELEGRAM_ONBOARDING'

export interface SystemEventInput {
  tenant_id?: string
  event_type: SystemEventType
  source: SystemEventSource
  message: string
  job_id?: string
  customer_id?: string
  cleaner_id?: string
  phone_number?: string
  metadata?: Record<string, unknown>
}

export async function logSystemEvent(input: SystemEventInput): Promise<void> {
  try {
    const client = getSupabaseClient()
    const normalizedPhone = input.phone_number ? toE164(input.phone_number) : null
    const payload = {
      ...input,
      phone_number: normalizedPhone || input.phone_number || null,
      created_at: new Date().toISOString(),
    }

    const { error } = await client.from('system_events').insert(payload)
    if (error) {
      console.error('Error logging system event:', error)
    }
  } catch (error) {
    console.error('Error logging system event:', error)
  }
}

export type TelegramTranscriptEntry = {
  message: string
  direction: 'inbound' | 'outbound' | 'unknown'
  created_at?: string | null
}

export async function getTelegramConversation(
  telegramUserId: string,
  limit = 12
): Promise<TelegramTranscriptEntry[]> {
  try {
    const client = getSupabaseClient()
    const { data, error } = await client
      .from('system_events')
      .select('message, metadata, event_type, created_at')
      .eq('source', 'telegram')
      .eq('metadata->>telegram_user_id', telegramUserId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Error fetching telegram transcript:', error)
      return []
    }

    const rows: TelegramTranscriptEntry[] = (data || [])
      .map((row) => {
        const metadata = (row.metadata || {}) as Record<string, unknown>
        const directionRaw =
          typeof metadata.direction === 'string' ? metadata.direction : undefined
        const eventType = row.event_type as string | undefined
        const direction: TelegramTranscriptEntry['direction'] =
          directionRaw === 'inbound' || directionRaw === 'outbound'
            ? directionRaw
            : eventType === 'TELEGRAM_RESPONSE'
              ? 'outbound'
              : eventType === 'TELEGRAM_MESSAGE'
                ? 'inbound'
                : 'unknown'

        return {
          message: row.message as string,
          direction,
          created_at: row.created_at as string | null | undefined,
        }
      })
      .filter((entry) => typeof entry.message === 'string' && entry.message.trim().length > 0)
      .reverse()

    return rows
  } catch (error) {
    console.error('Error fetching telegram transcript:', error)
    return []
  }
}
