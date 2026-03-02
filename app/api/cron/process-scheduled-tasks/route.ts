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
  type ScheduledTask,
} from '@/lib/scheduler'
import { getTenantById, getTenantServiceDescription, tenantUsesFeature } from '@/lib/tenant'
import { processFollowUp, getPendingFollowups } from '@/integrations/ghl/follow-up-scheduler'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { sendSMS } from '@/lib/openphone'
import { initiateOutboundCall } from '@/lib/vapi'
import { logSystemEvent } from '@/lib/system-events'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { createDepositPaymentLink, calculateJobEstimate } from '@/lib/stripe-client'
import { parseFormData } from '@/lib/utils'

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

    default:
      console.warn(`[process-scheduled-tasks] Unknown task type: ${task_type}`)
  }
}

/**
 * Process lead follow-up task
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
    action: 'text' | 'call' | 'double_call'
  }

  console.log(`[lead-followup] Processing stage ${stage} (${action}) for lead ${leadId}`)

  const client = getSupabaseServiceClient()
  const businessName = tenant?.business_name_short || tenant?.name || 'Our team'
  const serviceType = tenant ? getTenantServiceDescription(tenant) : 'cleaning'

  // Window cleaning tenants (use_hcp_mirror) use service type + sqft; others use bedrooms/bathrooms
  const isWinBros = tenant ? tenantUsesFeature(tenant, 'use_hcp_mirror') : false

  // Build service-specific quote question
  const quoteQuestion = isWinBros
    ? `Are you looking for Window Cleaning, Pressure Washing, or Gutter Cleaning today?`
    : serviceType === 'house cleaning'
    ? `Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`
    : `Can you share your address and some details about the job?`

  const detailsRequest = isWinBros
    ? `Just reply and let us know what service you're interested in and we'll get you set up with pricing!`
    : serviceType === 'house cleaning'
    ? `Reply with your home details (beds/baths/sqft) and we'll send you pricing right away!`
    : `Reply with your address and job details and we'll send you pricing right away!`

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

  // Skip follow-up if lead has been contacted recently (within 12 minutes)
  // This prevents follow-up from firing when customer is actively texting
  // or when another path (HCP webhook, auto-response) already sent a message
  // 12-minute window covers the shortest text-to-text gap (stage 1→2 = 10 min)
  if (lead.last_contact_at) {
    const lastContact = new Date(lead.last_contact_at)
    const twelveMinutesAgo = new Date(Date.now() - 12 * 60 * 1000)
    if (lastContact > twelveMinutesAgo) {
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
  // (catches cases where a different lead for the same customer was booked)
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
  // Use parseFormData to handle both string and object form_data
  const formData = parseFormData(lead.form_data)
  if (formData.followup_paused === true) {
    console.log(`[lead-followup] Lead ${leadId} has auto-followup paused, skipping scheduled task`)
    return
  }

  // For ANY call stage, check if the customer already answered a previous call.
  // If they did, don't call again — they've already engaged with the AI.
  if (action === 'call' || action === 'double_call') {
    const { data: recentCalls } = await client
      .from('calls')
      .select('outcome, created_at')
      .eq('phone_number', leadPhone)
      .order('created_at', { ascending: false })
      .limit(1)

    const lastCall = recentCalls?.[0]
    if (lastCall) {
      const answeredOutcomes = ['answered', 'completed', 'human-answered', 'booked', 'interested']
      const wasAnswered = answeredOutcomes.some(o =>
        lastCall.outcome?.toLowerCase().includes(o.toLowerCase())
      )

      if (wasAnswered) {
        console.log(`[lead-followup] Lead ${leadId} previous call was answered (outcome: ${lastCall.outcome}), cancelling all remaining call follow-ups`)

        // Cancel all remaining call stages
        const { cancelTask } = await import('@/lib/scheduler')
        for (const key of [
          `lead-${leadId}-stage-2`,
          `lead-${leadId}-stage-3`,
          `lead-${leadId}-stage-5`,
          `lead-${leadId}-double-call-2`,
        ]) {
          await cancelTask(key)
        }

        // Move lead to "contacted" (customer engaged via phone)
        await client
          .from('leads')
          .update({
            followup_stage: 6,
            status: 'contacted',
            last_contact_at: new Date().toISOString(),
          })
          .eq('id', leadId)

        console.log(`[lead-followup] Lead ${leadId} moved to stage 6 (responded) after previous answered call`)
        return
      }
      console.log(`[lead-followup] Lead ${leadId} last call was not answered (outcome: ${lastCall.outcome}), proceeding with ${action}`)
    }
  }

  // Also check if customer has been texting recently (inbound SMS engagement)
  // If they're actively texting, don't call — they prefer SMS
  if (action === 'call' || action === 'double_call') {
    const smsWindow = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30 minutes
    const { data: recentInbound } = await client
      .from('messages')
      .select('id')
      .eq('phone_number', leadPhone)
      .eq('tenant_id', tenant?.id)
      .eq('direction', 'inbound')
      .gte('timestamp', smsWindow)
      .limit(1)
      .maybeSingle()

    if (recentInbound) {
      console.log(`[lead-followup] Lead ${leadId} has recent inbound SMS (within 30 min), skipping call stage ${stage} — customer engaged via text`)
      return
    }
  }

  if (action === 'text') {
    // Message-based dedup: skip if ANY outbound text was already sent to this phone recently
    // This prevents duplicates regardless of source (HCP webhook, OpenPhone auto-response, etc.)
    const dedupWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 minutes
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
      // Still advance followup_stage so the task doesn't retry
      await client
        .from('leads')
        .update({ followup_stage: stage })
        .eq('id', leadId)
      return
    }

    let message: string

    if (stage === 1) {
      // Initial greeting (Text 1)
      message = `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your ${serviceType} needs. ${quoteQuestion}`
    } else if (stage === 2) {
      // Second follow-up text (Text 2)
      message = `Hi ${leadName}, just checking in! We have openings this week for ${serviceType} services. ${detailsRequest}`
    } else if (stage === 5) {
      // Final stage - try to create a quote and send payment link
      // formData is already parsed above, reuse it
      const extractedInfo = formData.extracted_info as Record<string, unknown> | null
      const intentAnalysis = formData.intent_analysis as Record<string, unknown> | null

      // Try to get property details from form data
      const intentExtractedInfo = intentAnalysis?.extractedInfo as Record<string, unknown> | null
      const bedrooms = extractedInfo?.bedrooms || intentExtractedInfo?.bedrooms
      const bathrooms = extractedInfo?.bathrooms || intentExtractedInfo?.bathrooms
      const serviceType = extractedInfo?.serviceType || intentExtractedInfo?.serviceType || 'Standard cleaning'
      const address = extractedInfo?.address || intentExtractedInfo?.address || lead.customers?.address

      if (bedrooms && bathrooms) {
        // We have enough info to generate a quote
        try {
          const estimate = calculateJobEstimate({
            service_type: String(serviceType),
            notes: '',
          }, {
            bedrooms: Number(bedrooms),
            bathrooms: Number(bathrooms),
          })

          // Create a job from the lead
          const { data: job, error: jobErr } = await client
            .from('jobs')
            .insert({
              tenant_id: tenant?.id,
              customer_id: lead.customer_id,
              phone_number: leadPhone,
              address: address || null,
              service_type: String(serviceType),
              price: estimate.totalPrice,
              hours: estimate.totalHours,
              cleaners: estimate.cleaners,
              status: 'pending',
              booked: false,
              paid: false,
              payment_status: 'pending',
              notes: `Created from lead follow-up. Original inquiry: ${formData?.original_message || 'N/A'}`,
            })
            .select('id')
            .single()

          if (jobErr || !job) {
            console.error(`[lead-followup] Failed to create job from lead:`, jobErr?.message)
            message = `Hi ${leadName}, last chance to book your ${serviceType} with ${businessName}! We have limited availability this week. Reply "BOOK" to secure your spot or call us to discuss your needs.`
          } else {
            // Update lead with job reference
            await client
              .from('leads')
              .update({
                converted_to_job_id: job.id,
                status: 'qualified',
              })
              .eq('id', leadId)

            // Create Stripe payment link
            const customer = lead.customers || { email: null, phone_number: leadPhone }

            if (customer.email) {
              const paymentResult = await createDepositPaymentLink(
                customer,
                { id: String(job.id), price: estimate.totalPrice, phone_number: leadPhone, service_type: String(serviceType) } as any
              )

              if (paymentResult.success && paymentResult.url) {
                // Update job with payment link
                await client
                  .from('jobs')
                  .update({ stripe_payment_link: paymentResult.url })
                  .eq('id', job.id)

                // Update lead with payment link
                await client
                  .from('leads')
                  .update({ stripe_payment_link: paymentResult.url })
                  .eq('id', leadId)

                const depositAmount = paymentResult.amount?.toFixed(2) || (estimate.totalPrice / 2 * 1.03).toFixed(2)
                message = `Hi ${leadName}! Your ${serviceType} quote is ready: $${estimate.totalPrice}. Pay just $${depositAmount} deposit to confirm your booking: ${paymentResult.url}`

                await logSystemEvent({
                  source: 'scheduler',
                  event_type: 'PAYMENT_LINKS_SENT',
                  message: `Stripe payment link sent to ${leadPhone} for $${estimate.totalPrice}`,
                  phone_number: leadPhone,
                  metadata: { leadId, jobId: job.id, amount: estimate.totalPrice, paymentUrl: paymentResult.url },
                })
              } else {
                message = `Hi ${leadName}! Your ${serviceType} quote is $${estimate.totalPrice}. We need your email to send the payment link. Reply with your email or call us to book!`
              }
            } else {
              message = `Hi ${leadName}! Your ${serviceType} quote is $${estimate.totalPrice}. Reply with your email address and we'll send you a secure payment link to confirm your booking!`
            }
          }
        } catch (err) {
          console.error(`[lead-followup] Error creating quote:`, err)
          message = `Hi ${leadName}, last chance to book your ${serviceType} with ${businessName}! We have limited availability this week. Reply "BOOK" to secure your spot or call us to discuss your needs.`
        }
      } else {
        // Don't have enough info for a quote, send generic final message
        message = `Hi ${leadName}, last chance to book your ${serviceType} with ${businessName}! We have limited availability this week. ${lastChanceDetails}`
      }
    } else {
      message = `Hi ${leadName}, just following up from ${businessName}! Let us know if you have any questions about our ${serviceType} services. We're here to help!`
    }

    // Send the SMS
    let smsResult
    if (tenant) {
      smsResult = await sendSMS(tenant, leadPhone, message)
    } else {
      console.error(`[lead-followup] No tenant for lead ${leadId} — skipping SMS`)
      smsResult = { success: false, error: 'No tenant' }
    }

    // Save the outbound message to the database so it shows in the UI
    // MUST include all required fields: direction, message_type, ai_generated, source
    if (smsResult.success) {
      console.log(`[lead-followup] Attempting to save message to DB for phone ${leadPhone}, customer_id ${lead.customer_id}, tenant_id ${tenant?.id}`)
      const { error: msgError } = await client.from('messages').insert({
        tenant_id: tenant?.id,
        customer_id: lead.customer_id,
        phone_number: leadPhone,
        role: 'assistant',
        content: message,
        direction: 'outbound',
        message_type: 'sms',
        ai_generated: false,
        timestamp: new Date().toISOString(),
        source: 'scheduled_followup',
      })
      if (msgError) {
        console.error(`[lead-followup] Failed to save message to DB:`, msgError)
      } else {
        console.log(`[lead-followup] Successfully saved outbound message to database for ${leadPhone}`)
      }
    } else {
      console.error(`[lead-followup] SMS send failed for ${leadPhone}:`, smsResult.error)
    }
  } else if (action === 'call' || action === 'double_call') {
    // Initiate VAPI call
    const assistantId = tenant?.vapi_assistant_id || process.env.VAPI_ASSISTANT_ID
    const vapiPhoneId = tenant?.vapi_phone_id || process.env.VAPI_PHONE_ID

    if (assistantId && vapiPhoneId) {
      await initiateOutboundCall(leadPhone, leadName, {
        leadId,
      })

      // For double call, schedule a second call 30s from now instead of blocking
      if (action === 'double_call') {
        await scheduleTask({
          tenantId: tenantId || undefined,
          taskType: 'lead_followup',
          taskKey: `lead-${leadId}-double-call-2`,
          scheduledFor: new Date(Date.now() + 30_000),
          payload: {
            leadId,
            leadPhone,
            leadName,
            stage,
            action: 'call', // Single call — the second leg of the double
          },
        })
        console.log(`[lead-followup] Scheduled second call for lead ${leadId} in 30s`)
      }
    }
  }

  // Update lead's followup_stage + last_contact_at (so dedup checks work for subsequent stages)
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
    message: `Lead follow-up stage ${stage} (${action}) executed for lead ${leadId}`,
    phone_number: leadPhone,
    metadata: { leadId, stage, action },
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

  let smsResult
  if (tenant) {
    smsResult = await sendSMS(tenant, customerPhone, message)
  } else {
    console.error(`[day-before-reminder] No tenant for job ${jobId} — skipping reminder SMS`)
    smsResult = { success: false, error: 'No tenant' }
  }

  // Save the outbound message to the database
  if (smsResult.success) {
    const client = getSupabaseServiceClient()
    await client.from('messages').insert({
      tenant_id: tenant?.id,
      phone_number: customerPhone,
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString(),
    })
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

// POST method for compatibility
export async function POST(request: NextRequest) {
  return GET(request)
}
