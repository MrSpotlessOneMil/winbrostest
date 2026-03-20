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

// Verify cron authorization
function verifyCronAuth(request: NextRequest): boolean {
  // Vercel Cron sets this header
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // If no CRON_SECRET configured, allow in development
  if (!cronSecret) {
    return process.env.NODE_ENV !== 'production'
  }

  return authHeader === `Bearer ${cronSecret}`
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

/**
 * Process a single task based on its type
 */
async function processTask(task: ScheduledTask): Promise<void> {
  const { task_type, payload, tenant_id } = task

  // Get tenant if specified
  const tenant = tenant_id ? await getTenantById(tenant_id) : null

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

    case 'send_sms':
    case 'post_job_tip':
      // Generic SMS task: payload contains { phone, message }
      if (tenant && payload.phone && payload.message) {
        await sendSMS(tenant, payload.phone as string, payload.message as string)
        console.log(`[process-scheduled-tasks] Sent ${task_type} SMS to ${payload.phone}`)
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

  let message: string

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

  const message = `Hi ${customerName}! This is a reminder that your ${serviceType} with ${businessName} is scheduled for tomorrow. Please ensure we have access to your home. Reply with any questions!`

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

  const { error } = await client.from('call_tasks').insert({
    tenant_id: tenantId,
    phone_number: phone,
    customer_name: name || null,
    customer_id: (payload.customerId as number) || null,
    lead_id: (payload.leadId as string) || null,
    source,
    source_context: payload,
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
  const serviceDesc = getTenantServiceDescription(tenant)
  const firstName = customerName.split(' ')[0] || customerName
  const templateObj = RETARGETING_TEMPLATES[template] || RETARGETING_TEMPLATES['9_word']
  const messageTemplate = templateObj[variant] || templateObj.a
  let message = messageTemplate
    .replace('{name}', firstName)
    .replace('{service}', serviceDesc)

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

  const result = await sendSMS(tenant, customerPhone, message)

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
