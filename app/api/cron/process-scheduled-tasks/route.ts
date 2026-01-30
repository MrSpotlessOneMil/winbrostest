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

  // Get tenant-specific config
  const tenantConfig = tenant?.workflow_config as Record<string, unknown> | undefined
  const businessName = tenant?.business_name_short || tenant?.name || 'Our team'

  if (action === 'text') {
    // Send SMS
    const message =
      stage === 1
        ? `Hi ${leadName}! Thanks for reaching out to ${businessName}. We'd love to help with your cleaning needs. When would be a good time to chat?`
        : `Hi ${leadName}, just following up! Let us know if you have any questions about our services. We're here to help!`

    await sendSMS(leadPhone, message)
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
      await sendSMS(
        ownerPhone,
        `URGENT: Job ${jobId} needs manual assignment. All cleaners are unavailable.`
      )
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

  await sendSMS(customerPhone, message)
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
