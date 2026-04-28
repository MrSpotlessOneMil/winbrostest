/**
 * Process Scheduled Tasks Cron Job
 *
 * Runs every minute to process tasks scheduled for execution.
 * Replaces QStash for delayed task execution.
 *
 * Endpoint: GET /api/cron/process-scheduled-tasks
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getDueTasks,
  claimTask,
  completeTask,
  failTask,
  scheduleTask,
  scheduleRetargetingSequence,
  RETARGETING_TEMPLATES,
  RETARGETING_SEQUENCES,
  type ScheduledTask,
  type RetargetingSequenceType,
} from '@/lib/scheduler'
import { getTenantById, getTenantServiceDescription, tenantUsesFeature, getCleanerPhoneSet, isCleanerPhone } from '@/lib/tenant'
import { processFollowUp, getPendingFollowups } from '@/integrations/ghl/follow-up-scheduler'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { parseFormData } from '@/lib/utils'
import { canSendToCustomer, recordMessageSent } from '@/lib/lifecycle-engine'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { renderTemplate, resolveAutomatedMessage } from '@/lib/automated-messages'

const DAY_BEFORE_REMINDER_FALLBACK_BODY =
  'Hi {{customer_name}}! This is a reminder that your {{service_type}} with {{business_name}} is scheduled for tomorrow. Please ensure we have access to your home. Reply with any questions!'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: [] as Array<{ taskId: string; type: string; success: boolean; error?: string }>,
  }

  try {
    const startTime = Date.now()
    const MAX_ELAPSED_MS = 45_000 // Stop processing after 45s to avoid Vercel timeout

    // Get tasks that are due (reduced batch size to prevent timeout cascades)
    const dueTasks = await getDueTasks(10)

    if (dueTasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No tasks due',
        ...results,
      })
    }

    console.log(`[process-scheduled-tasks] Found ${dueTasks.length} due tasks`)

    // Process each task with elapsed time guard
    for (const task of dueTasks) {
      // Check if we're running out of time
      if (Date.now() - startTime > MAX_ELAPSED_MS) {
        console.log(`[process-scheduled-tasks] Elapsed time exceeded ${MAX_ELAPSED_MS}ms, deferring remaining tasks to next tick`)
        break
      }

      // Skip tasks for inactive tenants
      if (task.tenant_id) {
        const taskTenant = await getTenantById(task.tenant_id)
        if (!taskTenant || taskTenant.active === false) {
          console.log(`[process-scheduled-tasks] Skipping task ${task.id} (${task.task_type}) — tenant ${task.tenant_id} is inactive`)
          await completeTask(task.id)
          results.skipped++
          continue
        }
      }

      const claimResult = await claimTask(task.id)

      if (!claimResult.success) {
        // Task was claimed by another worker
        results.skipped++
        continue
      }

      results.processed++

      try {
        await processTask(claimResult.task!)
        await completeTask(task.id)
        results.succeeded++
        results.details.push({
          taskId: task.id,
          type: task.task_type,
          success: true,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        await failTask(task.id, errorMessage)
        results.failed++
        results.details.push({
          taskId: task.id,
          type: task.task_type,
          success: false,
          error: errorMessage,
        })
      }
    }

    console.log(
      `[process-scheduled-tasks] Processed ${results.processed}: ${results.succeeded} succeeded, ${results.failed} failed, ${results.skipped} skipped`
    )

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('[process-scheduled-tasks] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// Task types that should only send during personal hours (9am-9pm local time)
// These are marketing/outreach messages — not operational reminders
const PERSONAL_HOURS_TASKS = new Set(['retargeting', 'post_job_review', 'post_job_recurring_push'])
const PERSONAL_HOUR_START = 9  // 9 AM
const PERSONAL_HOUR_END = 21   // 9 PM

/**
 * Check if current time is within personal hours (9am-9pm) in the tenant's timezone.
 * Returns { ok: true } if within hours, or { ok: false, nextWindowUtc } with the next 9am UTC time.
 */
function checkPersonalHours(tenant: { timezone?: string } | null): { ok: boolean; nextWindowUtc?: Date } {
  const tz = tenant?.timezone || 'America/Chicago'
  const now = new Date()
  const localHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false,
  }).format(now))
  const normalizedHour = localHour === 24 ? 0 : localHour

  if (normalizedHour >= PERSONAL_HOUR_START && normalizedHour < PERSONAL_HOUR_END) {
    return { ok: true }
  }

  // Calculate next 9am local time
  const localYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(now))
  const localMonth = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'numeric' }).format(now))
  const localDay = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(now))

  // If it's before 9am today, next window is today at 9am. If it's after 9pm, next window is tomorrow 9am.
  let targetDay = localDay
  if (normalizedHour >= PERSONAL_HOUR_END) targetDay += 1

  // Build approximate next 9am — use CST guess then adjust like createLocalDate pattern
  const iso = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}T09:00:00`
  const guess = new Date(`${iso}-06:00`)
  const actualHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', hour12: false,
  }).format(guess))
  const adj = actualHour === 24 ? 0 : actualHour
  if (adj !== 9) {
    return { ok: false, nextWindowUtc: new Date(guess.getTime() - (adj - 9) * 60 * 60 * 1000) }
  }
  return { ok: false, nextWindowUtc: guess }
}

/**
 * Process a single task based on its type
 */
async function processTask(task: ScheduledTask): Promise<void> {
  const { task_type, payload, tenant_id } = task

  // Get tenant if specified
  const tenant = tenant_id ? await getTenantById(tenant_id) : null

  // Gate marketing/outreach messages to personal hours (9am-9pm local time)
  if (PERSONAL_HOURS_TASKS.has(task_type) && tenant) {
    const hours = checkPersonalHours(tenant)
    if (!hours.ok && hours.nextWindowUtc) {
      // Reschedule to next 9am window — don't process now
      console.log(`[process-scheduled-tasks] ${task_type} outside personal hours for ${tenant.slug}, rescheduling to ${hours.nextWindowUtc.toISOString()}`)
      const supabase = getSupabaseServiceClient()
      await supabase
        .from('scheduled_tasks')
        .update({ status: 'pending', scheduled_for: hours.nextWindowUtc.toISOString() })
        .eq('id', task.id)
      return
    }
  }

  switch (task_type) {
    case 'lead_followup':
      await processLeadFollowup(payload, tenant, tenant_id)
      break

    case 'job_broadcast':
      await processJobBroadcast(payload, tenant)
      break

    case 'day_before_reminder':
      await processDayBeforeReminder(payload, tenant)
      break

    case 'job_reminder':
      await processJobReminder(payload, tenant)
      break

    case 'sms_retry':
      await processSmsRetry(payload, tenant)
      break

    case 'retargeting':
      await processRetargeting(payload, tenant, tenant_id || null)
      break

    case 'post_job_review':
      await processPostJobReview(payload, tenant)
      break

    case 'post_job_recurring_push':
      await processPostJobRecurringPush(payload, tenant)
      break

    case 'quote_followup_urgent':
      await processQuoteFollowupUrgent(payload, tenant)
      break

    case 'mid_convo_nudge':
      await processMidConvoNudge(payload, tenant)
      break

    case 'manual_call':
      await processManualCall(payload, tenant, tenant_id)
      break

    case 'hot_lead_followup':
      await processHotLeadFollowup(payload, tenant, tenant_id || null)
      break

    case 'ranked_cascade':
      await processRankedCascade(payload, tenant)
      break

    case 'send_sms':
    case 'post_job_tip':
      // Generic SMS task: payload contains { phone, message }
      if (tenant && payload.phone && payload.message) {
        const smsPhone = String(payload.phone)
        const smsMessage = String(payload.message)
        // Pre-insert DB record with source='scheduled_task' BEFORE sending
        // This prevents the outbound webhook from triggering manual_takeover
        // (the isSystemSent check finds this record and skips takeover)
        const { toE164 } = await import('@/lib/phone-utils')
        const e164Phone = toE164(smsPhone) || smsPhone
        const { data: preInsert } = await supabase.from('messages').insert({
          tenant_id: tenantId || tenant.id,
          phone_number: e164Phone,
          role: 'assistant',
          content: smsMessage,
          direction: 'outbound',
          message_type: 'sms',
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: 'scheduled_task',
        }).select('id').single()

        const smsResult = await sendSMS(tenant, smsPhone, smsMessage, { skipDedup: true })
        if (smsResult.success) {
          console.log(`[process-scheduled-tasks] Sent ${task_type} SMS to ${smsPhone}`)
        } else {
          // Clean up pre-inserted record since send failed
          if (preInsert?.id) await supabase.from('messages').delete().eq('id', preInsert.id)
          console.error(`[process-scheduled-tasks] ${task_type} SMS FAILED for ${smsPhone}: ${smsResult.error}`)
          throw new Error(`SMS send failed: ${smsResult.error}`)
        }
      }
      break

    default:
      console.warn(`[process-scheduled-tasks] Unknown task type: ${task_type}`)
  }
}

/**
 * Process lead follow-up task — SMS-only, 6 stages over 14 days
 */
async function processLeadFollowup(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>,
  tenantId?: string
): Promise<void> {
  const { leadId, leadPhone, leadName, stage, action } = payload as {
    leadId: string
    leadPhone: string
    leadName: string
    stage: number
    action: string
  }

  // Graceful legacy skip: old tasks with call/double_call action
  if (action === 'call' || action === 'double_call') {
    console.log(`[lead-followup] Legacy ${action} task for lead ${leadId} stage ${stage} — skipping (calls removed)`)
    return
  }

  // Manual call step — create a call_tasks checklist item instead of sending SMS
  if (action === 'manual_call') {
    await processManualCall({ ...payload, source: 'lead_followup' }, tenant, tenantId)
    return
  }

  console.log(`[lead-followup] Processing stage ${stage} (text) for lead ${leadId}`)

  const client = getSupabaseServiceClient()
  const businessName = tenant?.business_name_short || tenant?.name || 'Our team'
  const serviceType = tenant ? getTenantServiceDescription(tenant) : 'cleaning'

  // Window cleaning tenants (use_hcp_mirror) use service type + sqft; others use bedrooms/bathrooms
  const isWinBros = tenant ? tenantUsesFeature(tenant, 'use_hcp_mirror') : false

  // Build service-specific details request
  const detailsRequest = isWinBros
    ? `Just reply and let us know what service you're interested in and we'll get you set up with pricing!`
    : serviceType === 'house cleaning'
    ? `Reply with your home details (beds/baths/sqft) and we'll send you pricing right away!`
    : `Reply with your address and job details and we'll send you pricing right away!`

  const quoteQuestion = isWinBros
    ? `Are you looking for Window Cleaning, Pressure Washing, or Gutter Cleaning today?`
    : serviceType === 'house cleaning'
    ? `Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`
    : `Can you share your address and some details about the job?`

  const lastChanceDetails = isWinBros
    ? `Reply with what service you need and we'll get you a quick quote, or call us directly!`
    : serviceType === 'house cleaning'
    ? `Reply with your address and beds/baths for an instant quote, or call us directly!`
    : `Reply with your address and job details for an instant quote, or call us directly!`

  // Check if lead has already converted (responded, booked, etc.)
  const { data: lead } = await client
    .from('leads')
    .select('*, customers(*)')
    .eq('id', leadId)
    .single()

  if (!lead) {
    console.log(`[lead-followup] Lead ${leadId} not found, skipping`)
    return
  }

  // Skip follow-up if lead has been contacted recently (within 30 minutes)
  // 30-min window covers the stage 1→2 gap (15 min) with buffer
  if (lead.last_contact_at) {
    const lastContact = new Date(lead.last_contact_at)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)
    if (lastContact > thirtyMinutesAgo) {
      console.log(`[lead-followup] Lead ${leadId} contacted recently (${lead.last_contact_at}), skipping stage ${stage}`)
      return
    }
  }

  // Skip if lead is already booked, lost, escalated to owner, or has responded
  if (['booked', 'lost', 'unqualified', 'responded', 'escalated'].includes(lead.status)) {
    console.log(`[lead-followup] Lead ${leadId} status is ${lead.status}, skipping follow-up`)
    return
  }

  // Skip if lead has already been converted to a job (even if status wasn't updated)
  if (lead.converted_to_job_id) {
    console.log(`[lead-followup] Lead ${leadId} already converted to job ${lead.converted_to_job_id}, skipping follow-up`)
    return
  }

  // Skip if this phone number already has an active job for the tenant
  if (leadPhone && tenant?.id) {
    const { data: customerWithActiveJob } = await client
      .from('customers')
      .select('id, jobs!inner(id, status)')
      .eq('tenant_id', tenant.id)
      .eq('phone_number', leadPhone)
      .in('jobs.status', ['pending', 'scheduled', 'in_progress'])
      .limit(1)
      .maybeSingle()

    if (customerWithActiveJob) {
      console.log(`[lead-followup] Phone ${leadPhone} already has an active job for tenant ${tenant.slug}, skipping follow-up for lead ${leadId}`)
      return
    }
  }

  // Skip if the customer is in an active retargeting sequence or was recently retargeted
  if (leadPhone && tenant?.id) {
    const { data: retargetCustomer } = await client
      .from('customers')
      .select('id, retargeting_sequence, retargeting_completed_at, auto_response_paused, auto_response_disabled')
      .eq('phone_number', leadPhone)
      .eq('tenant_id', tenant.id)
      .maybeSingle()

    if (retargetCustomer?.retargeting_sequence && !retargetCustomer.retargeting_completed_at) {
      console.log(`[lead-followup] Phone ${leadPhone} has active retargeting sequence, skipping lead follow-up for lead ${leadId}`)
      return
    }
    if (retargetCustomer?.auto_response_paused || retargetCustomer?.auto_response_disabled) {
      console.log(`[lead-followup] Phone ${leadPhone} has auto_response_paused/disabled, skipping lead follow-up for lead ${leadId}`)
      return
    }
  }

  // Skip if auto-followup is paused for this lead
  const formData = parseFormData(lead.form_data)
  if (formData.followup_paused === true) {
    console.log(`[lead-followup] Lead ${leadId} has auto-followup paused, skipping scheduled task`)
    return
  }

  // Message-based dedup: skip if ANY outbound text was already sent to this phone recently
  const dedupWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentOutbound } = await client
    .from('messages')
    .select('id, source, timestamp')
    .eq('phone_number', leadPhone)
    .eq('tenant_id', tenant?.id)
    .eq('role', 'assistant')
    .eq('direction', 'outbound')
    .gte('timestamp', dedupWindow)
    .limit(1)
    .maybeSingle()

  if (recentOutbound) {
    console.log(`[lead-followup] Skipping stage ${stage} text for ${leadPhone} — outbound message already sent at ${recentOutbound.timestamp} (source: ${recentOutbound.source}). Advancing followup_stage only.`)
    await client
      .from('leads')
      .update({ followup_stage: stage })
      .eq('id', leadId)
    return
  }

  // Current month for urgency messaging
  const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long' })

  // Check if this is a Spotless Scrubbers website lead — warmer, rapport-first messaging
  const isSpotlessWebLead = tenant?.slug === 'spotless-scrubbers' && lead.source === 'website'
  const serviceRequested = formData.service_type
    ? String(formData.service_type).replace(/-/g, ' ')
    : ''

  let message: string

  if (isSpotlessWebLead) {
    switch (stage) {
      case 1:
        message = serviceRequested
          ? `Hey ${leadName}! This is Dominic from Spotless Scrubbers. Thanks for reaching out about ${serviceRequested} — we'd love to take care of that for you. What does your schedule look like this week?`
          : `Hey ${leadName}! This is Dominic from Spotless Scrubbers. Thanks for reaching out — we'd love to help you out. What kind of cleaning are you looking for?`
        break
      case 2:
        message = `Hey ${leadName}, just wanted to make sure you saw my message! We've got openings this week and I'd love to get you on the schedule. Any questions I can answer?`
        break
      case 4:
        message = `Hi ${leadName}! Dominic here from Spotless Scrubbers — our ${currentMonth} schedule is filling up. If you're still thinking about it, happy to chat and figure out what works best for you. No pressure at all!`
        break
      case 5:
        message = `Last note from me ${leadName}! If you ever need a cleaning down the road, just text this number. We're always here. Have a great one!`
        break
      default:
        message = `Hey ${leadName}, Dominic from Spotless Scrubbers checking in! Let me know if you have any questions — happy to help however I can.`
    }
  } else {
    switch (stage) {
      case 1:
        message = `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your ${serviceType} needs. ${quoteQuestion}`
        break
      case 2:
        message = `Just making sure you got our message — we have openings for ${serviceType} this week. ${detailsRequest}`
        break
      // Stage 3 is manual_call — handled above, never reaches here
      case 4:
        message = `Our schedule is filling up for ${currentMonth}! ${lastChanceDetails}`
        break
      case 5:
        message = `Last check-in from me! Reply if you'd like to get on the schedule, otherwise no worries at all.`
        break
      default:
        message = `Hi ${leadName}, just following up from ${businessName}! Let us know if you have any questions about our ${serviceType} services. We're here to help!`
    }
  }

  // Insert DB record BEFORE sending so outbound webhook dedup finds it
  let msgRecordId: string | null = null
  if (tenant) {
    const { data: msgRecord } = await client.from('messages').insert({
      tenant_id: tenant.id,
      customer_id: lead.customer_id,
      phone_number: leadPhone,
      role: 'assistant',
      content: message,
      direction: 'outbound',
      message_type: 'sms',
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: 'scheduled_followup',
    }).select('id').single()
    msgRecordId = msgRecord?.id || null
  }

  // Send the SMS
  let smsResult
  if (tenant) {
    smsResult = await sendSMS(tenant, leadPhone, message, { skipDedup: true })
  } else {
    console.error(`[lead-followup] No tenant for lead ${leadId} -- skipping SMS`)
    smsResult = { success: false, error: 'No tenant' }
  }

  if (!smsResult.success) {
    // Clean up pre-inserted record since send failed
    if (msgRecordId) {
      await client.from('messages').delete().eq('id', msgRecordId)
    }
    console.error(`[lead-followup] SMS send failed for ${leadPhone}:`, smsResult.error)
  }

  // Update lead's followup_stage + last_contact_at
  await client
    .from('leads')
    .update({
      followup_stage: stage,
      last_contact_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  // Log the event
  await logSystemEvent({
    source: 'scheduler',
    event_type: 'LEAD_FOLLOWUP_EXECUTED',
    message: `Lead follow-up stage ${stage} (text) executed for lead ${leadId}`,
    phone_number: leadPhone,
    metadata: { leadId, stage, action: 'text' },
  })
}

/**
 * Process job broadcast task
 */
async function processJobBroadcast(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>
): Promise<void> {
  const { jobId, teamLeadIds, phase } = payload as {
    jobId: string
    teamLeadIds: string[]
    phase: 'initial' | 'urgent' | 'escalate'
  }

  console.log(`[job-broadcast] Processing ${phase} broadcast for job ${jobId}`)

  if (phase === 'initial' || phase === 'urgent') {
    // Trigger cleaner assignment
    await triggerCleanerAssignment(jobId)
  } else if (phase === 'escalate') {
    // Escalate to owner
    const ownerPhone = tenant?.owner_phone || process.env.OWNER_PHONE
    if (ownerPhone && tenant) {
      await sendSMS(tenant, ownerPhone, `URGENT: Job ${jobId} needs manual assignment. All cleaners are unavailable.`)
    } else if (!tenant) {
      console.error(`[cleaner-retry] No tenant for job ${jobId} — cannot send escalation SMS`)
    }
  }
}

/**
 * Process ranked cascade — auto-advance to next ranked cleaner if no response in 20 min
 */
async function processRankedCascade(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>
): Promise<void> {
  const { jobId, cleanerId, assignmentId } = payload as {
    jobId: string
    cleanerId: string
    assignmentId: string
  }

  console.log(`[ranked-cascade] Checking assignment ${assignmentId} for job ${jobId}`)

  const supabase = getSupabaseServiceClient()

  // Check if assignment is still pending (cleaner hasn't responded)
  const { data: assignment } = await supabase
    .from('cleaner_assignments')
    .select('id, status')
    .eq('id', assignmentId)
    .maybeSingle()

  if (!assignment || assignment.status !== 'pending') {
    console.log(`[ranked-cascade] Assignment ${assignmentId} is ${assignment?.status || 'not found'} — skipping cascade`)
    return
  }

  // Expire the pending assignment
  await supabase
    .from('cleaner_assignments')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('id', assignmentId)

  // Expire the pending SMS assignment too
  await supabase
    .from('pending_sms_assignments')
    .update({ status: 'expired' })
    .eq('assignment_id', assignmentId)
    .eq('status', 'active')

  console.log(`[ranked-cascade] Expired assignment ${assignmentId} for cleaner ${cleanerId}, cascading to next ranked cleaner`)

  // Trigger assignment for the next ranked cleaner
  await triggerCleanerAssignment(jobId)
}

/**
 * Process day-before reminder task
 */
async function processDayBeforeReminder(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>
): Promise<void> {
  const { jobId, customerPhone, customerName, type } = payload as {
    jobId: string
    customerPhone: string
    customerName: string
    type: string
  }

  console.log(`[day-before-reminder] Sending ${type} reminder for job ${jobId}`)

  const businessName = tenant?.business_name_short || tenant?.name || 'Our team'
  const serviceType = tenant ? getTenantServiceDescription(tenant) : 'service'

  // Resolve the editable template (Phase G); admin can pause via is_active
  let body = DAY_BEFORE_REMINDER_FALLBACK_BODY
  if (tenant) {
    const reminderClient = getSupabaseServiceClient()
    const resolved = await resolveAutomatedMessage(reminderClient, {
      tenantId: tenant.id,
      trigger: 'day_before_reminder',
      fallbackBody: DAY_BEFORE_REMINDER_FALLBACK_BODY,
    })
    if (!resolved.isActive) {
      console.log(`[day-before-reminder] tenant ${tenant.slug} paused this template — skipping`)
      return
    }
    body = resolved.body
  }

  const message = renderTemplate(body, {
    customer_name: customerName,
    service_type: serviceType,
    business_name: businessName,
  })

  // Insert DB record BEFORE sending so outbound webhook dedup finds it
  let msgRecordId: string | null = null
  if (tenant) {
    const reminderClient = getSupabaseServiceClient()
    const { data: msgRecord } = await reminderClient.from('messages').insert({
      tenant_id: tenant.id,
      phone_number: customerPhone,
      role: 'assistant',
      content: message,
      direction: 'outbound',
      message_type: 'sms',
      timestamp: new Date().toISOString(),
      source: 'day_before_reminder',
    }).select('id').single()
    msgRecordId = msgRecord?.id || null
  }

  let smsResult
  if (tenant) {
    smsResult = await sendSMS(tenant, customerPhone, message, { skipDedup: true })
  } else {
    console.error(`[day-before-reminder] No tenant for job ${jobId} -- skipping reminder SMS`)
    smsResult = { success: false, error: 'No tenant' }
  }

  if (!smsResult.success && msgRecordId) {
    const cleanupClient = getSupabaseServiceClient()
    await cleanupClient.from('messages').delete().eq('id', msgRecordId)
  }
}

/**
 * Process job reminder task (for cleaners)
 */
async function processJobReminder(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>
): Promise<void> {
  const { jobId, cleanerId, reminderType } = payload as {
    jobId: string
    cleanerId: string
    reminderType: 'one_hour' | 'job_start'
  }

  console.log(`[job-reminder] Sending ${reminderType} reminder for job ${jobId} to cleaner ${cleanerId}`)

  // This would send a Telegram notification to the cleaner
  // Implementation depends on having cleaner info loaded
}

/**
 * Retry a failed SMS send.
 * Payload: { phone, message, messageId? }
 */
async function processSmsRetry(
  payload: Record<string, unknown>,
  tenant: any
) {
  const phone = String(payload.phone || '')
  const message = String(payload.message || '')
  const messageId = payload.messageId as number | undefined

  if (!phone || !message) {
    console.warn('[sms-retry] Missing phone or message in payload')
    return
  }

  console.log(`[sms-retry] Retrying SMS to ${phone.slice(-4)} for tenant ${tenant?.slug}`)

  const result = await sendSMS(tenant, phone, message)

  if (result.success && messageId) {
    // Update the stored failed message to sent status
    const client = getSupabaseServiceClient()
    await client
      .from('messages')
      .update({ status: 'sent', metadata: { retried: true, retry_message_id: result.messageId } })
      .eq('id', messageId)
    console.log(`[sms-retry] Successfully sent retry SMS to ${phone.slice(-4)}`)
  } else if (!result.success) {
    console.error(`[sms-retry] Retry failed for ${phone.slice(-4)}: ${result.error}`)
  }
}

/**
 * Process manual call step — creates a call_tasks checklist item for the VA dashboard.
 * No SMS is sent. The VA sees it on the overview page and calls manually.
 */
async function processManualCall(
  payload: Record<string, unknown>,
  tenant: any,
  tenantId?: string | null,
): Promise<void> {
  const phone = String(payload.leadPhone || payload.customerPhone || '')
  const name = String(payload.leadName || payload.customerName || '')
  const source = String(payload.source || 'lead_followup')

  if (!phone || !tenantId) {
    console.warn('[manual-call] Missing phone or tenant_id — skipping')
    return
  }

  const client = getSupabaseServiceClient()
  const today = new Date().toISOString().split('T')[0]

  // Build call briefing: pull recent conversation + lead/customer info
  let briefing = ''
  try {
    // Get recent messages for context
    const { data: recentMessages } = await client
      .from('messages')
      .select('role, content, timestamp')
      .eq('phone_number', phone)
      .eq('tenant_id', tenantId)
      .order('timestamp', { ascending: false })
      .limit(10)

    // Get lead info if available
    const leadId = payload.leadId as string
    let leadInfo: Record<string, unknown> | null = null
    if (leadId) {
      const { data } = await client
        .from('leads')
        .select('source, form_data, status, created_at')
        .eq('id', leadId)
        .single()
      leadInfo = data
    }

    // Build the briefing
    const parts: string[] = []
    parts.push(`Name: ${name || 'Unknown'}`)
    parts.push(`Phone: ${phone}`)

    if (leadInfo) {
      const formData = (leadInfo.form_data || {}) as Record<string, unknown>
      if (leadInfo.source) parts.push(`Source: ${leadInfo.source}`)
      if (formData.service_type) parts.push(`Service requested: ${String(formData.service_type).replace(/-/g, ' ')}`)
      if (formData.message) parts.push(`Their message: "${formData.message}"`)
      if (formData.address) parts.push(`Address: ${formData.address}`)
    }

    if (recentMessages && recentMessages.length > 0) {
      parts.push('')
      parts.push('--- Recent conversation ---')
      // Show in chronological order
      for (const msg of recentMessages.reverse()) {
        const who = msg.role === 'assistant' ? 'Us' : 'Them'
        parts.push(`${who}: ${msg.content}`)
      }
    } else {
      parts.push('')
      parts.push('No text conversation yet — this is a cold follow-up call.')
    }

    // Add goal based on source
    parts.push('')
    if (source === 'lead_followup') {
      parts.push('GOAL: They reached out but haven\'t booked yet. Be friendly, ask how you can help, and try to get them scheduled.')
    } else if (source.includes('quoted_not_booked')) {
      parts.push('GOAL: They got a quote but didn\'t book. Check if they have questions, address concerns, and see if they\'re ready to get on the schedule.')
    } else if (source.includes('retargeting')) {
      parts.push('GOAL: Past customer who hasn\'t booked in a while. Check in, see if they need anything, and offer to schedule their next cleaning.')
    } else {
      parts.push('GOAL: Follow up and see if they\'re ready to book.')
    }

    briefing = parts.join('\n')
  } catch (briefingErr) {
    console.error('[manual-call] Error building briefing:', briefingErr)
    briefing = `Name: ${name}\nPhone: ${phone}\nGOAL: Follow up and try to book.`
  }

  const { error } = await client.from('call_tasks').insert({
    tenant_id: tenantId,
    phone_number: phone,
    customer_name: name || null,
    customer_id: (payload.customerId as number) || null,
    lead_id: (payload.leadId as string) || null,
    source,
    source_context: { ...payload, briefing },
    scheduled_for: today,
    status: 'pending',
  })

  if (error) {
    console.error(`[manual-call] Failed to create call task for ${phone.slice(-4)}:`, error.message)
    throw error
  }

  console.log(`[manual-call] Created call task for ${phone.slice(-4)} (${source}, tenant ${tenant?.slug})`)
}

/**
 * Process retargeting sequence step
 * Sends segment-specific SMS, updates customer retargeting progress,
 * and auto-stops if customer has converted (booked a job).
 */
async function processRetargeting(
  payload: Record<string, unknown>,
  tenant: any,
  tenantId: string | null,
) {
  const customerId = payload.customerId as number
  const customerPhone = String(payload.customerPhone || '')
  const customerName = String(payload.customerName || '')
  const sequence = payload.sequence as RetargetingSequenceType
  const step = payload.step as number
  const template = String(payload.template || '')
  const variant = (payload.variant as 'a' | 'b') || 'a' // default 'a' for pre-existing tasks

  if (!customerId || !customerPhone || !tenant) {
    console.warn('[retargeting] Missing required payload fields')
    return
  }

  const supabase = getSupabaseServiceClient()

  // Auto-stop check: if customer has booked a job since enrollment, stop the sequence
  const { data: customer } = await supabase
    .from('customers')
    .select('retargeting_enrolled_at, sms_opt_out, retargeting_replied_at, manual_takeover_at')
    .eq('id', customerId)
    .single()

  if (customer?.retargeting_enrolled_at) {
    const { data: recentJob } = await supabase
      .from('jobs')
      .select('id')
      .eq('customer_id', customerId)
      .in('status', ['scheduled', 'in_progress', 'completed'])
      .gte('created_at', customer.retargeting_enrolled_at)
      .limit(1)
      .single()

    if (recentJob) {
      console.log(`[retargeting] Customer ${customerId} converted — stopping sequence`)
      await supabase
        .from('customers')
        .update({
          retargeting_completed_at: new Date().toISOString(),
          retargeting_stopped_reason: 'converted',
        })
        .eq('id', customerId)

      // Cancel remaining tasks in this sequence
      await supabase
        .from('scheduled_tasks')
        .update({ status: 'cancelled' })
        .like('task_key', `retarget-${customerId}-${sequence}-%`)
        .eq('status', 'pending')

      return
    }
  }

  // Auto-stop: customer replied to retargeting -- stop sending automated sequence
  if (customer?.retargeting_replied_at) {
    console.log(`[retargeting] Customer ${customerId} replied -- stopping sequence`)
    await supabase
      .from('customers')
      .update({
        retargeting_completed_at: new Date().toISOString(),
        retargeting_stopped_reason: 'replied',
      })
      .eq('id', customerId)

    await supabase
      .from('scheduled_tasks')
      .update({ status: 'cancelled' })
      .like('task_key', `retarget-${customerId}-${sequence}-%`)
      .eq('status', 'pending')

    return
  }

  // Auto-stop: staff manually took over this customer's conversation
  if (customer?.manual_takeover_at) {
    console.log(`[retargeting] Customer ${customerId} has manual takeover -- stopping sequence`)
    await supabase
      .from('customers')
      .update({
        retargeting_completed_at: new Date().toISOString(),
        retargeting_stopped_reason: 'manual_takeover',
      })
      .eq('id', customerId)

    await supabase
      .from('scheduled_tasks')
      .update({ status: 'cancelled' })
      .like('task_key', `retarget-${customerId}-${sequence}-%`)
      .eq('status', 'pending')

    return
  }

  // Recheck opt-out before sending (customer may have opted out since task was scheduled)
  if (customer?.sms_opt_out) {
    console.log(`[retargeting] Customer ${customerId} opted out — cancelling remaining sequence`)
    await supabase
      .from('scheduled_tasks')
      .update({ status: 'cancelled' })
      .like('task_key', `retarget-${customerId}-${sequence}-%`)
      .eq('status', 'pending')
    return
  }

  // Skip if this phone belongs to a cleaner (never retarget cleaners)
  if (tenantId) {
    const cleanerPhones = await getCleanerPhoneSet(tenantId)
    if (isCleanerPhone(customerPhone, cleanerPhones)) {
      console.log(`[retargeting] Customer ${customerId} is a cleaner — cancelling sequence`)
      await supabase
        .from('scheduled_tasks')
        .update({ status: 'cancelled' })
        .like('task_key', `retarget-${customerId}-${sequence}-%`)
        .eq('status', 'pending')
      return
    }
  }

  // HCP gate: if this tenant uses HCP (WinBros), check if customer already has active jobs/estimates
  if (tenant?.housecall_pro_api_key) {
    try {
      const { data: cust } = await supabase
        .from('customers')
        .select('housecall_pro_customer_id')
        .eq('id', customerId)
        .single()

      if (cust?.housecall_pro_customer_id) {
        const { getCustomerHCPBrain, shouldRetargetCustomer } = await import('@/lib/housecall-pro-api')
        const brain = await getCustomerHCPBrain(tenant, String(cust.housecall_pro_customer_id))
        if (brain && !shouldRetargetCustomer(brain)) {
          console.log(`[retargeting] Customer ${customerId} is ${brain.stage} in HCP (${brain.stageDetail}) — cancelling sequence`)
          await supabase
            .from('customers')
            .update({
              retargeting_completed_at: new Date().toISOString(),
              retargeting_stopped_reason: 'active_in_hcp',
            })
            .eq('id', customerId)
          await supabase
            .from('scheduled_tasks')
            .update({ status: 'cancelled' })
            .like('task_key', `retarget-${customerId}-${sequence}-%`)
            .eq('status', 'pending')
          return
        }
      }
    } catch (hcpErr) {
      console.warn(`[retargeting] HCP check failed for customer ${customerId}:`, hcpErr)
      // Don't block send on HCP failure — proceed with caution
    }
  }

  // Manual call step — create a call_tasks checklist item instead of sending SMS
  if (template === 'manual_call') {
    await processManualCall(
      { customerId, customerPhone, customerName, source: `retargeting_${sequence}`, step, sequence },
      tenant,
      tenantId,
    )
    // Still update retargeting step so the sequence advances
    const steps = RETARGETING_SEQUENCES[sequence]
    const isLastStep = step >= (steps?.length || 0)
    await supabase
      .from('customers')
      .update({
        retargeting_step: step,
        ...(isLastStep ? {
          retargeting_completed_at: new Date().toISOString(),
          retargeting_stopped_reason: 'completed',
        } : {}),
      })
      .eq('id', customerId)
    return
  }

  // Build message from template (A/B variant)
  let serviceDesc = getTenantServiceDescription(tenant)
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name
  const firstName = (customerName.split(' ')[0] || customerName || 'there').trim() || 'there'

  // Personalize: pull actual last service so messages match what the customer actually had done
  // For non-HCP tenants, check the local Osiris jobs table
  if (!tenant.housecall_pro_api_key) {
    try {
      const { data: lastJob } = await supabase
        .from('jobs')
        .select('service_type')
        .eq('customer_id', customerId)
        .eq('tenant_id', tenantId || tenant.id)
        .in('status', ['completed', 'scheduled', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (lastJob?.service_type) {
        serviceDesc = lastJob.service_type.replace(/_/g, ' ')
      }
    } catch (err) {
      console.warn(`[retargeting] Local service lookup failed for ${customerId}:`, err)
    }
  }

  // For HCP tenants (WinBros), pull actual last service from HCP API
  if (tenant.housecall_pro_api_key) {
    try {
      const { data: cust } = await supabase
        .from('customers')
        .select('housecall_pro_customer_id')
        .eq('id', customerId)
        .single()

      if (cust?.housecall_pro_customer_id) {
        const { getCustomerHCPBrain } = await import('@/lib/housecall-pro-api')
        const brain = await getCustomerHCPBrain(tenant, String(cust.housecall_pro_customer_id))
        if (brain?.lastServiceType) {
          // Use their actual last service (e.g. "Exterior Window Cleaning", "Gutter Cleaning", "House Washing")
          serviceDesc = brain.lastServiceType.toLowerCase().replace(/exterior\s+/i, '')
        }
      }
    } catch (hcpErr) {
      console.warn(`[retargeting] HCP service lookup failed for ${customerId}:`, hcpErr)
    }
  }

  const templateObj = RETARGETING_TEMPLATES[template] || RETARGETING_TEMPLATES['9_word']
  const messageTemplate = templateObj[variant] || templateObj.a
  let message = messageTemplate
    .replace('{name}', firstName)
    .replace('{service}', serviceDesc)
    .replace('{business}', businessName)

  // Guard: abort if unreplaced placeholders remain or name is a carrier keyword
  if (message.includes('{')) {
    console.error(`[retargeting] Unreplaced placeholder in message for customer ${customerId}: "${message.slice(0, 80)}"`)
    return
  }
  const lowerFirst = firstName.toLowerCase()
  if (['stop', 'unsubscribe', 'cancel', 'quit', 'end'].includes(lowerFirst)) {
    console.warn(`[retargeting] Customer name "${firstName}" is a carrier keyword — skipping send for ${customerId}`)
    return
  }

  // For quoted_not_booked step 1 (quote_followup), append the quote link
  if (sequence === 'quoted_not_booked' && template === 'quote_followup') {
    const { data: recentQuote } = await supabase
      .from('quotes')
      .select('token, status')
      .eq('customer_id', customerId)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentQuote?.token) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cleanmachine.live')
      message += `\n\nHere's your quote: ${baseUrl}/quote/${recentQuote.token}`
    }
  }

  console.log(`[retargeting] Sending ${sequence} step ${step} to ${customerPhone.slice(-4)} (${tenant.slug})`)

  // Pre-insert message record with source='retargeting' BEFORE sendSMS.
  // This lets the outbound webhook dedup detect it and skip manual takeover,
  // so the AI auto-responder stays active when the customer replies.
  let preInsertedMsgId: string | null = null
  if (tenantId) {
    const { data: msgRecord } = await supabase.from('messages').insert({
      tenant_id: tenantId,
      customer_id: customerId,
      phone_number: customerPhone,
      role: 'assistant',
      content: message,
      direction: 'outbound',
      message_type: 'sms',
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: 'retargeting',
    }).select('id').single()
    preInsertedMsgId = msgRecord?.id || null
  }

  const result = await sendSMS(tenant, customerPhone, message)

  if (!result.success && preInsertedMsgId) {
    // Clean up pre-inserted record since send failed
    await supabase.from('messages').delete().eq('id', preInsertedMsgId)
  }

  if (result.success) {
    // Update customer retargeting step
    const steps = RETARGETING_SEQUENCES[sequence]
    const isLastStep = step >= (steps?.length || 0)

    await supabase
      .from('customers')
      .update({
        retargeting_step: step,
        ...(isLastStep ? {
          retargeting_completed_at: new Date().toISOString(),
          retargeting_stopped_reason: 'completed',
        } : {}),
      })
      .eq('id', customerId)

    console.log(`[retargeting] Sent step ${step}/${steps?.length} to customer ${customerId}`)
  } else {
    console.error(`[retargeting] SMS failed for customer ${customerId}: ${result.error}`)
  }
}

/**
 * Hot lead follow-up -- fires 30 min after a retargeting reply that shows buying intent.
 * If the customer hasn't booked yet and AI isn't actively working, alert the owner.
 */
async function processHotLeadFollowup(
  payload: Record<string, unknown>,
  tenant: any,
  tenantId: string | null,
) {
  const customerId = payload.customerId as number
  const customerPhone = String(payload.customerPhone || '')
  const customerName = String(payload.customerName || '')
  const lastMessage = String(payload.lastMessage || '')

  if (!customerId || !tenant) {
    console.warn('[hot-lead-followup] Missing required payload fields')
    return
  }

  const supabase = getSupabaseServiceClient()

  // Check if customer has booked since the reply -- skip if converted
  const { data: recentJob } = await supabase
    .from('jobs')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['pending', 'scheduled', 'in_progress', 'completed'])
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // last hour
    .limit(1)
    .maybeSingle()

  if (recentJob) {
    console.log(`[hot-lead-followup] Customer ${customerId} already booked (job ${recentJob.id}), skipping alert`)
    return
  }

  // Check if AI is still actively working (recent outbound in last 10 min)
  const recentCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentOutbound } = await supabase
    .from('messages')
    .select('id')
    .eq('phone_number', customerPhone)
    .eq('tenant_id', tenant.id)
    .eq('role', 'assistant')
    .eq('direction', 'outbound')
    .gte('timestamp', recentCutoff)
    .limit(1)
    .maybeSingle()

  if (recentOutbound) {
    // AI still active -- reschedule for another 30 min
    console.log(`[hot-lead-followup] AI still active for customer ${customerId}, rescheduling`)
    await scheduleTask({
      tenantId: tenant.id,
      taskType: 'hot_lead_followup',
      taskKey: `hot-lead-${customerId}-retry`,
      scheduledFor: new Date(Date.now() + 30 * 60 * 1000),
      payload: { customerId, customerPhone, customerName, lastMessage },
    })
    return
  }

  // Nobody closed the deal -- alert owner
  const ownerPhone = tenant.owner_phone || process.env.OWNER_PHONE
  if (!ownerPhone) {
    console.warn(`[hot-lead-followup] No owner phone for tenant ${tenant.slug}`)
    return
  }

  const firstName = customerName.split(' ')[0] || customerName || 'Unknown'
  const preview = lastMessage.length > 100 ? lastMessage.slice(0, 100) + '...' : lastMessage
  const alertMessage = `Hot lead! ${firstName} replied to retargeting and seems interested but hasn't booked yet. Last message: "${preview}". Phone: ${customerPhone}`

  await sendSMS(tenant, ownerPhone, alertMessage)

  await logSystemEvent({
    source: 'scheduler',
    event_type: 'HOT_LEAD_ALERT_SENT',
    message: `Owner alerted about hot lead ${customerId} (${firstName})`,
    tenant_id: tenant.id,
    phone_number: customerPhone,
    metadata: { customerId, customerName, lastMessage: preview },
  })

  console.log(`[hot-lead-followup] Owner alert sent for customer ${customerId} (${firstName})`)
}

/**
 * Post-job review (24hr timeout fallback)
 * If customer never replied to satisfaction check, send review link only (no tip).
 */
async function processPostJobReview(
  payload: Record<string, unknown>,
  tenant: any
): Promise<void> {
  const { jobId, customerId, customerPhone, customerName, isTimeout } = payload as {
    jobId: number
    customerId: number
    customerPhone: string
    customerName: string
    isTimeout?: boolean
  }

  if (!tenant || !customerPhone) return

  const client = getSupabaseServiceClient()

  // Check if customer already replied (stage moved past satisfaction_sent)
  if (customerId) {
    const { data: customer } = await client
      .from('customers')
      .select('post_job_stage')
      .eq('id', customerId)
      .single()

    if (customer?.post_job_stage && customer.post_job_stage !== 'satisfaction_sent') {
      console.log(`[post-job-review] Customer ${customerId} already replied (stage: ${customer.post_job_stage}), skipping timeout`)
      return
    }
  }

  // Check cooldown
  if (customerId) {
    const canSend = await canSendToCustomer(customerId, 'post_job', 4, tenant?.id)
    if (!canSend) return
  }

  const reviewLink = payload.googleReviewLink || tenant.google_review_link || 'https://g.page/review'
  const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'
  const message = `Hi ${customerName}! Thanks for choosing us. A quick review really helps our small business grow: ${reviewLink}\n\nBy the way, a lot of our customers love setting up recurring cleanings — you'd get ${recurringDiscount} off every visit and never have to think about scheduling. Would that be something you'd be interested in?`

  const result = await sendSMS(tenant, customerPhone, message)

  if (result.success) {
    await client.from('jobs').update({
      review_sent_at: new Date().toISOString(),
      recurring_offered_at: new Date().toISOString(),
    }).eq('id', jobId)

    if (customerId) {
      await client.from('customers').update({
        post_job_stage: 'recurring_offered',
        post_job_stage_updated_at: new Date().toISOString(),
      }).eq('id', customerId)

      await recordMessageSent(tenant.id, customerId, customerPhone, 'post_job_review', 'post_job')
    }

    console.log(`[post-job-review] Review + recurring offer sent for job ${jobId} (timeout: ${isTimeout})`)
  }
}

/**
 * Recurring service push — sent 24hr after review link
 */
async function processPostJobRecurringPush(
  payload: Record<string, unknown>,
  tenant: any
): Promise<void> {
  const { jobId, customerId, customerPhone, customerName } = payload as {
    jobId: number
    customerId: number
    customerPhone: string
    customerName: string
  }

  if (!tenant || !customerPhone) return

  // Check cooldown
  if (customerId) {
    const canSend = await canSendToCustomer(customerId, 'post_job', 12, tenant?.id)
    if (!canSend) return
  }

  const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'
  const message = `Hi ${customerName}! A lot of our customers love setting up recurring cleanings — you'd get ${recurringDiscount} off every visit and never have to worry about scheduling. Would that be something you'd be interested in?`

  const result = await sendSMS(tenant, customerPhone, message)

  if (result.success) {
    const client = getSupabaseServiceClient()
    await client.from('jobs').update({ recurring_offered_at: new Date().toISOString() }).eq('id', jobId)

    if (customerId) {
      await client.from('customers').update({
        post_job_stage: 'recurring_offered',
        post_job_stage_updated_at: new Date().toISOString(),
      }).eq('id', customerId)

      await recordMessageSent(tenant.id, customerId, customerPhone, 'recurring_push', 'post_job')
    }

    console.log(`[post-job-recurring] Recurring push sent for job ${jobId}`)
  }
}

/**
 * Urgent quote follow-up — sent 7 minutes after quote
 */
async function processQuoteFollowupUrgent(
  payload: Record<string, unknown>,
  tenant: any
): Promise<void> {
  const { quoteId, customerId, customerPhone, customerName } = payload as {
    quoteId: number
    customerId: number
    customerPhone: string
    customerName: string
  }

  if (!tenant || !customerPhone) return

  const client = getSupabaseServiceClient()

  // Check if quote already accepted
  const { data: quote } = await client
    .from('quotes')
    .select('status')
    .eq('id', quoteId)
    .single()

  if (quote?.status === 'approved') {
    console.log(`[quote-followup] Quote ${quoteId} already approved, skipping urgent nudge`)
    return
  }

  // Check cooldown
  if (customerId) {
    const canSend = await canSendToCustomer(customerId, 'quote_followup', 1, tenant?.id)
    if (!canSend) return
  }

  const message = `Hey ${customerName || 'there'}! Did you get a chance to look at your quote? We only have a few spots left this week — let me know if you have any questions!`

  const result = await sendSMS(tenant, customerPhone, message)

  if (result.success && customerId) {
    await recordMessageSent(tenant.id, customerId, customerPhone, 'quote_followup_urgent', 'quote_followup')
    console.log(`[quote-followup] Urgent nudge sent for quote ${quoteId}`)
  }
}

/**
 * Mid-conversation nudge — sent 5 min after system replied and customer went silent
 */
async function processMidConvoNudge(
  payload: Record<string, unknown>,
  tenant: any
): Promise<void> {
  const { customerId, customerPhone } = payload as {
    customerId: number
    customerPhone: string
  }

  if (!tenant || !customerPhone) return

  const client = getSupabaseServiceClient()

  // Re-check: customer may have replied since scheduling
  const { data: customer } = await client
    .from('customers')
    .select('awaiting_reply_since')
    .eq('id', customerId)
    .single()

  if (!customer?.awaiting_reply_since) {
    console.log(`[mid-convo-nudge] Customer ${customerId} already replied, skipping nudge`)
    return
  }

  // Check cooldown (1hr between nudges)
  const canSend = await canSendToCustomer(customerId, 'conversation', 1, tenant?.id)
  if (!canSend) {
    // Clear flag to prevent infinite loop if cooldown blocks us
    await client.from('customers').update({ awaiting_reply_since: null }).eq('id', customerId)
    return
  }

  const message = `Still here if you have any questions!`

  // Insert DB record BEFORE sending so outbound webhook dedup finds it
  const { data: nudgeRecord } = await client.from('messages').insert({
    tenant_id: tenant.id,
    customer_id: customerId,
    phone_number: customerPhone,
    role: 'assistant',
    content: message,
    direction: 'outbound',
    message_type: 'sms',
    ai_generated: false,
    timestamp: new Date().toISOString(),
    source: 'mid_convo_nudge',
  }).select('id').single()

  const result = await sendSMS(tenant, customerPhone, message, { skipDedup: true })

  // Always clear awaiting_reply_since to prevent infinite nudge loop
  await client
    .from('customers')
    .update({ awaiting_reply_since: null })
    .eq('id', customerId)

  if (result.success) {
    await recordMessageSent(tenant.id, customerId, customerPhone, 'mid_convo_nudge', 'conversation')
    console.log(`[mid-convo-nudge] Nudge sent to customer ${customerId}`)
  } else if (nudgeRecord?.id) {
    // Clean up pre-inserted record since send failed
    await client.from('messages').delete().eq('id', nudgeRecord.id)
  }
}

// POST method for compatibility
export async function POST(request: NextRequest) {
  return GET(request)
}
