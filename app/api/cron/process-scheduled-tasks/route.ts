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
  type ScheduledTask,
} from '@/lib/scheduler'
import { getTenantById } from '@/lib/tenant'
import { processFollowUp, getPendingFollowups } from '@/integrations/ghl/follow-up-scheduler'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { sendSMS } from '@/lib/openphone'
import { initiateOutboundCall } from '@/lib/vapi'
import { logSystemEvent } from '@/lib/system-events'
import { getSupabaseClient } from '@/lib/supabase'
import { createDepositPaymentLink, calculateJobEstimate } from '@/lib/stripe-client'

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
    // Get tasks that are due
    const dueTasks = await getDueTasks(50)

    if (dueTasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No tasks due',
        ...results,
      })
    }

    console.log(`[process-scheduled-tasks] Found ${dueTasks.length} due tasks`)

    // Process each task
    for (const task of dueTasks) {
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
      await processLeadFollowup(payload, tenant)
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

    default:
      console.warn(`[process-scheduled-tasks] Unknown task type: ${task_type}`)
  }
}

/**
 * Process lead follow-up task
 */
async function processLeadFollowup(
  payload: Record<string, unknown>,
  tenant: Awaited<ReturnType<typeof getTenantById>>
): Promise<void> {
  const { leadId, leadPhone, leadName, stage, action } = payload as {
    leadId: string
    leadPhone: string
    leadName: string
    stage: number
    action: 'text' | 'call' | 'double_call'
  }

  console.log(`[lead-followup] Processing stage ${stage} (${action}) for lead ${leadId}`)

  const client = getSupabaseClient()
  const businessName = tenant?.business_name_short || tenant?.name || 'Our team'

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

  // Skip follow-up if lead has been contacted recently (within 5 minutes)
  // This prevents follow-up if customer has already responded
  if (lead.last_contact_at) {
    const lastContact = new Date(lead.last_contact_at)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    if (lastContact > fiveMinutesAgo && stage > 1) {
      console.log(`[lead-followup] Lead ${leadId} contacted recently, skipping stage ${stage}`)
      return
    }
  }

  // Skip if lead is already booked or lost
  if (lead.status === 'booked' || lead.status === 'lost' || lead.status === 'unqualified') {
    console.log(`[lead-followup] Lead ${leadId} status is ${lead.status}, skipping follow-up`)
    return
  }

  if (action === 'text') {
    let message: string

    if (stage === 1) {
      // Initial greeting (Text 1)
      message = `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. Can you share your address and number of bedrooms/bathrooms so we can give you an instant quote?`
    } else if (stage === 2) {
      // Second follow-up text (Text 2)
      message = `Hi ${leadName}, just checking in! We have openings this week for cleaning services. Reply with your home details (beds/baths/sqft) and we'll send you pricing right away!`
    } else if (stage === 5) {
      // Final stage - try to create a quote and send payment link
      const formData = lead.form_data as Record<string, unknown> | null
      const extractedInfo = formData?.extracted_info as Record<string, unknown> | null
      const intentAnalysis = formData?.intent_analysis as Record<string, unknown> | null

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
            message = `Hi ${leadName}, last chance to book your cleaning with ${businessName}! We have limited availability this week. Reply "BOOK" to secure your spot or call us to discuss your needs.`
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
          message = `Hi ${leadName}, last chance to book your cleaning with ${businessName}! We have limited availability this week. Reply "BOOK" to secure your spot or call us to discuss your needs.`
        }
      } else {
        // Don't have enough info for a quote, send generic final message
        message = `Hi ${leadName}, last chance to book your cleaning with ${businessName}! We have limited availability this week. Reply with your address and beds/baths for an instant quote, or call us directly!`
      }
    } else {
      message = `Hi ${leadName}, just following up from ${businessName}! Let us know if you have any questions about our cleaning services. We're here to help!`
    }

    // Send the SMS
    let smsResult
    if (tenant) {
      smsResult = await sendSMS(tenant, leadPhone, message)
    } else {
      smsResult = await sendSMS(leadPhone, message)
    }

    // Save the outbound message to the database so it shows in the UI
    if (smsResult.success) {
      console.log(`[lead-followup] Attempting to save message to DB for phone ${leadPhone}, customer_id ${lead.customer_id}, tenant_id ${tenant?.id}`)
      const { error: msgError } = await client.from('messages').insert({
        tenant_id: tenant?.id,
        customer_id: lead.customer_id,
        phone_number: leadPhone,
        role: 'business',
        content: message,
        timestamp: new Date().toISOString(),
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

      // For double call, wait 30 seconds and call again
      if (action === 'double_call') {
        await new Promise((resolve) => setTimeout(resolve, 30000))
        await initiateOutboundCall(leadPhone, leadName, {
          leadId,
        })
      }
    }
  }

  // Update lead's followup_stage
  await client
    .from('leads')
    .update({ followup_stage: stage })
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
    if (ownerPhone) {
      if (tenant) {
        await sendSMS(tenant, ownerPhone, `URGENT: Job ${jobId} needs manual assignment. All cleaners are unavailable.`)
      } else {
        await sendSMS(ownerPhone, `URGENT: Job ${jobId} needs manual assignment. All cleaners are unavailable.`)
      }
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

  const message = `Hi ${customerName}! This is a reminder that your cleaning with ${businessName} is scheduled for tomorrow. Please ensure we have access to your home. Reply with any questions!`

  let smsResult
  if (tenant) {
    smsResult = await sendSMS(tenant, customerPhone, message)
  } else {
    smsResult = await sendSMS(customerPhone, message)
  }

  // Save the outbound message to the database
  if (smsResult.success) {
    const client = getSupabaseClient()
    await client.from('messages').insert({
      tenant_id: tenant?.id,
      phone_number: customerPhone,
      role: 'business',
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

// POST method for compatibility
export async function POST(request: NextRequest) {
  return GET(request)
}
