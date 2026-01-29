/**
 * GHL Follow-up Scheduler
 *
 * Manages the aggressive SDR follow-up sequence:
 * - Detects customer silence (15 min)
 * - Triggers VAPI calls
 * - Schedules follow-up SMS
 * - Handles call outcomes
 */

import {
  createGHLFollowUp,
  getPendingGHLFollowUps,
  updateGHLFollowUp,
  cancelPendingGHLFollowUps,
  updateGHLLead,
  getGHLLeadById,
  getGHLLeadsNeedingFollowUp,
} from '@/lib/supabase'
import type { GHLFollowUp } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getClientConfig } from '@/lib/client-config'
import type { GHLFollowUpType, ScheduleFollowUpInput } from './types'
import {
  GHL_TIMING,
  GHL_SMS_TEMPLATES,
  isWithinBusinessHours,
  getNextBusinessHour,
} from './constants'
import { markLeadLostInGHL, syncLeadStatusToGHL } from './ghl-api'

/**
 * Schedule a follow-up action
 */
export async function scheduleFollowUp(
  input: ScheduleFollowUpInput
): Promise<GHLFollowUp | null> {
  // If outside business hours and it's a call, reschedule to next business hour
  let scheduledAt = input.scheduled_at

  if (input.followup_type === 'trigger_call' && !isWithinBusinessHours()) {
    scheduledAt = getNextBusinessHour()
  }

  return createGHLFollowUp({
    lead_id: input.lead_id,
    phone_number: input.phone_number,
    followup_type: input.followup_type,
    scheduled_at: scheduledAt.toISOString(),
    status: 'pending',
  })
}

/**
 * Cancel pending follow-ups for a lead
 * Used when customer responds or booking is complete
 */
export async function cancelPendingFollowups(
  ghlLeadId: string,
  types?: GHLFollowUpType[]
): Promise<number> {
  return cancelPendingGHLFollowUps(ghlLeadId, types)
}

/**
 * Get all pending follow-ups that are due
 */
export async function getPendingFollowups(
  beforeTime?: Date
): Promise<GHLFollowUp[]> {
  return getPendingGHLFollowUps(beforeTime)
}

/**
 * Process a single follow-up action
 */
export async function processFollowUp(
  followUp: GHLFollowUp
): Promise<{ success: boolean; action: string; error?: string }> {
  // Mark as in progress
  await updateGHLFollowUp(followUp.id!, { status: 'in_progress' })

  try {
    // Get the lead
    const lead = await getGHLLeadById(followUp.lead_id)
    if (!lead) {
      await updateGHLFollowUp(followUp.id!, {
        status: 'failed',
        error_message: 'Lead not found',
        executed_at: new Date().toISOString(),
      })
      return { success: false, action: 'lead_not_found', error: 'Lead not found' }
    }

    // Check if lead is still active
    if (['booked', 'lost', 'unqualified'].includes(lead.status || '')) {
      await updateGHLFollowUp(followUp.id!, {
        status: 'cancelled',
        error_message: `Lead status is ${lead.status}`,
        executed_at: new Date().toISOString(),
      })
      return { success: true, action: 'skipped_inactive_lead' }
    }

    // Process based on follow-up type
    switch (followUp.followup_type) {
      case 'initial_sms':
        return await processInitialSMS(followUp, lead)

      case 'trigger_call':
        return await processTriggerCall(followUp, lead)

      case 'post_voicemail_sms':
      case 'post_no_answer_sms':
        return await processPostCallSMS(followUp, lead)

      case 'followup_sms_1':
      case 'followup_sms_2':
      case 'final_attempt':
        return await processFollowUpSMS(followUp, lead)

      case 'silence_reminder':
        return await processSilenceReminder(followUp, lead)

      default:
        await updateGHLFollowUp(followUp.id!, {
          status: 'failed',
          error_message: `Unknown follow-up type: ${followUp.followup_type}`,
          executed_at: new Date().toISOString(),
        })
        return { success: false, action: 'unknown_type', error: `Unknown type: ${followUp.followup_type}` }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    await updateGHLFollowUp(followUp.id!, {
      status: 'failed',
      error_message: errorMessage,
      executed_at: new Date().toISOString(),
    })
    return { success: false, action: 'error', error: errorMessage }
  }
}

/**
 * Process initial SMS follow-up
 */
async function processInitialSMS(
  followUp: GHLFollowUp,
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; brand?: string }
): Promise<{ success: boolean; action: string; error?: string }> {
  const message = GHL_SMS_TEMPLATES.initial(lead.first_name)
  const result = await sendSMS(followUp.phone_number, message, lead.brand)

  if (result.success) {
    await updateGHLFollowUp(followUp.id!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { message_id: result.messageId },
    })

    await updateGHLLead(lead.id!, {
      status: 'sms_sent',
      last_outreach_at: new Date().toISOString(),
      sms_attempt_count: (lead as { sms_attempt_count?: number }).sms_attempt_count
        ? ((lead as { sms_attempt_count?: number }).sms_attempt_count || 0) + 1
        : 1,
    })

    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_INITIAL_SMS_SENT',
      message: `Initial SMS sent via follow-up scheduler`,
      job_id: lead.job_id,
      customer_id: lead.customer_id,
      phone_number: followUp.phone_number,
      metadata: { lead_id: lead.id },
    })

    return { success: true, action: 'initial_sms_sent' }
  }

  await updateGHLFollowUp(followUp.id!, {
    status: 'failed',
    error_message: result.error,
    executed_at: new Date().toISOString(),
  })

  return { success: false, action: 'sms_failed', error: result.error }
}

/**
 * Process call trigger
 */
async function processTriggerCall(
  followUp: GHLFollowUp,
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; call_attempt_count?: number; brand?: string }
): Promise<{ success: boolean; action: string; error?: string }> {
  // Check if within business hours
  if (!isWithinBusinessHours()) {
    // Reschedule to next business hour
    const nextHour = getNextBusinessHour()
    await updateGHLFollowUp(followUp.id!, {
      scheduled_at: nextHour.toISOString(),
      status: 'pending',
    })
    return { success: true, action: 'rescheduled_outside_hours' }
  }

  // Check max call attempts
  const callAttempts = lead.call_attempt_count || 0
  if (callAttempts >= GHL_TIMING.MAX_CALL_ATTEMPTS) {
    // Skip call, schedule follow-up SMS instead
    await updateGHLFollowUp(followUp.id!, {
      status: 'cancelled',
      error_message: 'Max call attempts reached',
      executed_at: new Date().toISOString(),
    })

    // Schedule follow-up SMS
    await scheduleFollowUp({
      lead_id: lead.id!,
      phone_number: followUp.phone_number,
      followup_type: 'followup_sms_1',
      scheduled_at: new Date(Date.now() + GHL_TIMING.FOLLOWUP_SMS_1_DELAY_MS),
    })

    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_MAX_ATTEMPTS',
      message: 'Max call attempts reached, switching to SMS follow-up',
      job_id: lead.job_id,
      customer_id: lead.customer_id,
      phone_number: followUp.phone_number,
      metadata: { lead_id: lead.id, call_attempts: callAttempts },
    })

    return { success: true, action: 'max_calls_reached' }
  }

  // Trigger VAPI outbound call
  // Note: This requires VAPI outbound call API integration
  // For now, we'll simulate and schedule post-call SMS
  const callResult = await triggerVAPIOutboundCall(lead)

  if (callResult.success) {
    await updateGHLFollowUp(followUp.id!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { call_id: callResult.callId },
    })

    await updateGHLLead(lead.id!, {
      status: 'call_triggered',
      call_attempt_count: callAttempts + 1,
      last_outreach_at: new Date().toISOString(),
    })

    // Sync call status to GHL for tracking
    const leadData = await getGHLLeadById(lead.id!)
    if (leadData?.source_id) {
      await syncLeadStatusToGHL(leadData.source_id, 'call_completed')
    }

    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_CALL_TRIGGERED',
      message: `VAPI call triggered for lead`,
      job_id: lead.job_id,
      customer_id: lead.customer_id,
      phone_number: followUp.phone_number,
      metadata: {
        lead_id: lead.id,
        call_id: callResult.callId,
        attempt: callAttempts + 1,
      },
    })

    return { success: true, action: 'call_triggered' }
  }

  // Call failed - schedule SMS follow-up instead
  await updateGHLFollowUp(followUp.id!, {
    status: 'failed',
    error_message: callResult.error,
    executed_at: new Date().toISOString(),
  })

  // Schedule post-no-answer SMS
  await scheduleFollowUp({
    lead_id: lead.id!,
    phone_number: followUp.phone_number,
    followup_type: 'post_no_answer_sms',
    scheduled_at: new Date(Date.now() + GHL_TIMING.POST_CALL_SMS_DELAY_MS),
  })

  return { success: false, action: 'call_failed', error: callResult.error }
}

/**
 * Process post-call SMS (after voicemail or no answer)
 */
async function processPostCallSMS(
  followUp: GHLFollowUp,
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; sms_attempt_count?: number; brand?: string }
): Promise<{ success: boolean; action: string; error?: string }> {
  const isVoicemail = followUp.followup_type === 'post_voicemail_sms'
  const message = isVoicemail
    ? GHL_SMS_TEMPLATES.postVoicemail(lead.first_name)
    : GHL_SMS_TEMPLATES.postNoAnswer(lead.first_name)

  const result = await sendSMS(followUp.phone_number, message, lead.brand)

  if (result.success) {
    await updateGHLFollowUp(followUp.id!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { message_id: result.messageId },
    })

    const smsCount = (lead.sms_attempt_count || 0) + 1
    await updateGHLLead(lead.id!, {
      status: 'call_completed',
      last_outreach_at: new Date().toISOString(),
      sms_attempt_count: smsCount,
    })

    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_POST_CALL_SMS_SENT',
      message: `Post-call SMS sent (${followUp.followup_type})`,
      job_id: lead.job_id,
      customer_id: lead.customer_id,
      phone_number: followUp.phone_number,
      metadata: { lead_id: lead.id },
    })

    // Schedule next follow-up
    await scheduleFollowUp({
      lead_id: lead.id!,
      phone_number: followUp.phone_number,
      followup_type: 'followup_sms_1',
      scheduled_at: new Date(Date.now() + GHL_TIMING.FOLLOWUP_SMS_1_DELAY_MS),
    })

    return { success: true, action: 'post_call_sms_sent' }
  }

  await updateGHLFollowUp(followUp.id!, {
    status: 'failed',
    error_message: result.error,
    executed_at: new Date().toISOString(),
  })

  return { success: false, action: 'sms_failed', error: result.error }
}

/**
 * Process follow-up SMS sequence
 */
async function processFollowUpSMS(
  followUp: GHLFollowUp,
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; sms_attempt_count?: number; brand?: string }
): Promise<{ success: boolean; action: string; error?: string }> {
  // Select message based on follow-up type
  let message: string
  let nextType: GHLFollowUpType | null = null
  let nextDelay = 0

  switch (followUp.followup_type) {
    case 'followup_sms_1':
      message = GHL_SMS_TEMPLATES.followUp1(lead.first_name)
      nextType = 'followup_sms_2'
      nextDelay = GHL_TIMING.FOLLOWUP_SMS_2_DELAY_MS
      break
    case 'followup_sms_2':
      message = GHL_SMS_TEMPLATES.followUp2(lead.first_name)
      nextType = 'final_attempt'
      nextDelay = GHL_TIMING.FINAL_ATTEMPT_DELAY_MS
      break
    case 'final_attempt':
      message = GHL_SMS_TEMPLATES.finalAttempt(lead.first_name)
      nextType = null // No more follow-ups
      break
    default:
      message = GHL_SMS_TEMPLATES.followUp1(lead.first_name)
  }

  const result = await sendSMS(followUp.phone_number, message, lead.brand)

  if (result.success) {
    await updateGHLFollowUp(followUp.id!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { message_id: result.messageId },
    })

    const smsCount = (lead.sms_attempt_count || 0) + 1
    await updateGHLLead(lead.id!, {
      last_outreach_at: new Date().toISOString(),
      sms_attempt_count: smsCount,
    })

    await logSystemEvent({
      source: 'ghl',
      event_type: 'GHL_FOLLOWUP_SMS_SENT',
      message: `Follow-up SMS sent (${followUp.followup_type})`,
      job_id: lead.job_id,
      customer_id: lead.customer_id,
      phone_number: followUp.phone_number,
      metadata: { lead_id: lead.id, sms_count: smsCount },
    })

    // Schedule next follow-up or mark as lost
    if (nextType) {
      await scheduleFollowUp({
        lead_id: lead.id!,
        phone_number: followUp.phone_number,
        followup_type: nextType,
        scheduled_at: new Date(Date.now() + nextDelay),
      })
    } else {
      // Final attempt sent - mark as lost after some time
      // (They could still respond, so we don't immediately mark as lost)
      if (smsCount >= GHL_TIMING.MAX_SMS_ATTEMPTS) {
        await updateGHLLead(lead.id!, { status: 'lost' })

        // Sync status back to GHL for ROI tracking
        const leadData = await getGHLLeadById(lead.id!)
        if (leadData?.source_id) {
          await markLeadLostInGHL(leadData.source_id, 'No response after max attempts')
        }

        await logSystemEvent({
          source: 'ghl',
          event_type: 'GHL_LEAD_LOST',
          message: 'Lead marked as lost after max attempts',
          job_id: lead.job_id,
          customer_id: lead.customer_id,
          phone_number: followUp.phone_number,
          metadata: { lead_id: lead.id, total_sms: smsCount },
        })
      }
    }

    return { success: true, action: 'followup_sms_sent' }
  }

  await updateGHLFollowUp(followUp.id!, {
    status: 'failed',
    error_message: result.error,
    executed_at: new Date().toISOString(),
  })

  return { success: false, action: 'sms_failed', error: result.error }
}

/**
 * Process silence reminder
 */
async function processSilenceReminder(
  followUp: GHLFollowUp,
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; sms_attempt_count?: number; brand?: string }
): Promise<{ success: boolean; action: string; error?: string }> {
  const message = GHL_SMS_TEMPLATES.silenceWarning(lead.first_name)
  const result = await sendSMS(followUp.phone_number, message, lead.brand)

  if (result.success) {
    await updateGHLFollowUp(followUp.id!, {
      status: 'completed',
      executed_at: new Date().toISOString(),
      result: { message_id: result.messageId },
    })

    await updateGHLLead(lead.id!, {
      last_outreach_at: new Date().toISOString(),
      sms_attempt_count: (lead.sms_attempt_count || 0) + 1,
    })

    return { success: true, action: 'silence_reminder_sent' }
  }

  await updateGHLFollowUp(followUp.id!, {
    status: 'failed',
    error_message: result.error,
    executed_at: new Date().toISOString(),
  })

  return { success: false, action: 'sms_failed', error: result.error }
}

/**
 * Check for leads that have been silent and need follow-up
 */
export async function checkAndTriggerSilenceFollowups(): Promise<number> {
  const silentLeads = await getGHLLeadsNeedingFollowUp(GHL_TIMING.SILENCE_BEFORE_CALL_MS)
  let triggeredCount = 0

  for (const lead of silentLeads) {
    // Check if there's already a pending call scheduled
    const pendingFollowups = await getPendingGHLFollowUps()
    const hasPendingCall = pendingFollowups.some(
      f => f.lead_id === lead.id && f.followup_type === 'trigger_call'
    )

    if (!hasPendingCall && (lead.call_attempt_count || 0) < GHL_TIMING.MAX_CALL_ATTEMPTS) {
      await scheduleFollowUp({
        lead_id: lead.id!,
        phone_number: lead.phone_number,
        followup_type: 'trigger_call',
        scheduled_at: new Date(), // Trigger immediately
      })

      await logSystemEvent({
        source: 'ghl',
        event_type: 'GHL_SILENCE_DETECTED',
        message: `Silence detected, triggering call`,
        job_id: lead.job_id,
        customer_id: lead.customer_id,
        phone_number: lead.phone_number,
        metadata: { lead_id: lead.id },
      })

      triggeredCount++
    }
  }

  return triggeredCount
}

/**
 * Trigger VAPI outbound call
 * This integrates with VAPI's outbound call API
 */
export async function triggerVAPIOutboundCall(
  lead: { id?: string; first_name?: string; phone_number: string; job_id?: string; customer_id?: string; brand?: string }
): Promise<{ success: boolean; callId?: string; error?: string }> {
  // Get brand-specific configuration
  const config = getClientConfig(lead.brand)
  const vapiApiKey = process.env.VAPI_API_KEY
  const phoneId = config.vapiPhoneId
  const assistantId = config.vapiAssistantId

  if (!vapiApiKey) {
    console.error('VAPI_API_KEY not configured')
    return { success: false, error: 'VAPI not configured' }
  }

  if (!phoneId) {
    console.error(`VAPI_OUTBOUND_PHONE_ID not configured for brand: ${config.brandMode}`)
    return { success: false, error: 'VAPI outbound phone not configured' }
  }

  if (!assistantId) {
    console.error(`VAPI assistant ID not configured for brand: ${config.brandMode}`)
    return { success: false, error: 'VAPI assistant not configured' }
  }

  try {
    // Normalize phone number to E.164 format (+1XXXXXXXXXX)
    const digits = lead.phone_number.replace(/\D/g, '')
    const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : digits.startsWith('+') ? lead.phone_number : `+${digits}`

    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vapiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId: phoneId,
        assistantId: assistantId,
        customer: {
          number: e164,
          name: lead.first_name,
        },
        metadata: {
          lead_id: lead.id,
          job_id: lead.job_id,
          customer_id: lead.customer_id,
          source: 'ghl_followup',
          brand: config.brandMode,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('VAPI call API error:', errorText)
      return { success: false, error: `VAPI API error: ${response.status}` }
    }

    const data = await response.json()
    return { success: true, callId: data.id }
  } catch (error) {
    console.error('Error triggering VAPI call:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
