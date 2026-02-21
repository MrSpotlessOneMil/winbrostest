/**
 * Cron Job: Check for assignment timeouts
 *
 * This endpoint is called every 5 minutes by Vercel Cron.
 * It checks for pending cleaner assignments and:
 * 1. Sends urgent follow-ups to unresponsive cleaners
 * 2. Alerts owner if no one responds within the timeout window
 * 3. Handles cleaner cancellation re-broadcasts
 *
 * Scheduled via: Vercel Cron (vercel.json)
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import {
  getSupabaseServiceClient,
  getJobById,
  getCleanerById,
  getCustomerByPhone,
  updateCleanerAssignment,
  getAcceptedAssignmentForJob,
  appendToTextingTranscript,
  createCleanerAssignment,
  getCleanerAssignmentsForJob,
  getCleaners,
} from '@/lib/supabase'
import type { Job } from '@/lib/supabase'
import { sendUrgentFollowUp, notifyCleanerAssignment } from '@/lib/telegram'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getTenantById, getTenantBusinessName } from '@/lib/tenant'

const STANDARD_TIMEOUT_MINUTES = 30
const URGENT_TIMEOUT_MINUTES = 15
const OWNER_ALERT_MINUTES = 30
const MAX_FOLLOWUP_ATTEMPTS = 10
const CANCEL_REASSIGN_INTERVAL_MINUTES = 20
const CANCEL_REASSIGN_ALERT_MINUTES = CANCEL_REASSIGN_INTERVAL_MINUTES * 2
const CANCEL_REASSIGN_LOOKBACK_MINUTES = 180
const PACIFIC_TIME_ZONE = 'America/Los_Angeles'
const OWNER_PHONE = process.env.OWNER_PHONE || ''

// Main GET handler - supports Vercel Cron and manual CRON_SECRET triggers
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  return await executeCheckTimeouts(request)
}

// Main execution logic (shared by both QStash and manual triggers)
async function executeCheckTimeouts(request: NextRequest) {

  try {
    const client = getSupabaseServiceClient()
    const now = new Date()
    const cutoffTime = new Date(now.getTime() - URGENT_TIMEOUT_MINUTES * 60 * 1000).toISOString()

    // Find pending assignments older than the shortest timeout window
    const { data: pendingAssignments, error } = await client
      .from('cleaner_assignments')
      .select('*, jobs!inner(*)')
      .eq('status', 'pending')
      .lt('created_at', cutoffTime)

    if (error) {
      console.error('Error fetching pending assignments:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }

    console.log(`Found ${pendingAssignments?.length || 0} pending assignments past minimum timeout`)

    const processedJobs = new Set<string>()
    let urgentsSent = 0
    let ownerAlerts = 0

    const cancelCutoff = new Date(
      now.getTime() - CANCEL_REASSIGN_LOOKBACK_MINUTES * 60 * 1000
    ).toISOString()
    const { data: recentCancels } = await client
      .from('system_events')
      .select('job_id, created_at, cleaner_id')
      .eq('event_type', 'CLEANER_CANCELLED')
      .gte('created_at', cancelCutoff)
      .order('created_at', { ascending: false })

    for (const cancelEvent of recentCancels || []) {
      const jobId = cancelEvent.job_id
      if (!jobId || processedJobs.has(jobId)) continue
      const job = await getJobById(jobId)
      if (!job) continue

      const result = await handleCancelReassign(client, job, {
        created_at: cancelEvent.created_at,
        cleaner_id: cancelEvent.cleaner_id,
      }, now)
      if (result.ownerAlerted) {
        ownerAlerts += 1
      }
      processedJobs.add(jobId)
    }

    for (const assignment of pendingAssignments || []) {
      const jobId = assignment.job_id

      // Skip if we already processed this job in this run
      if (processedJobs.has(jobId)) continue
      processedJobs.add(jobId)

      const job = await getJobById(jobId)
      if (!job) continue

      const cancelEvent = await getLatestSystemEvent(client, 'CLEANER_CANCELLED', jobId)
      if (cancelEvent) {
        const result = await handleCancelReassign(client, job, cancelEvent, now)
        if (result.ownerAlerted) {
          ownerAlerts += 1
        }
        continue
      }

      // Send urgent follow-up to all pending cleaners for this job
      const { data: allPending } = await client
        .from('cleaner_assignments')
        .select('*')
        .eq('job_id', jobId)
        .eq('status', 'pending')

      if (!allPending || allPending.length === 0) {
        continue
      }

      const acceptedAssignment = await getAcceptedAssignmentForJob(jobId)
      if (acceptedAssignment) {
        await updateCleanerAssignment(assignment.id, 'declined')
        continue
      }

      const timeoutMinutes = getTimeoutMinutes(job)
      const oldestCreatedAt = getOldestPendingCreatedAt(allPending)
      if (!oldestCreatedAt) {
        continue
      }

      const ageMs = now.getTime() - new Date(oldestCreatedAt).getTime()
      const timeoutMs = timeoutMinutes * 60 * 1000
      const ownerAlertMs = OWNER_ALERT_MINUTES * 60 * 1000

      if (ageMs < timeoutMs) {
        continue
      }

      // Count how many follow-up rounds have already been sent for this job
      const { data: followupEvents } = await client
        .from('system_events')
        .select('id')
        .eq('event_type', 'URGENT_FOLLOWUP_SENT')
        .eq('job_id', jobId)

      const followupCount = followupEvents?.length || 0

      const pendingCleanerNames: string[] = []
      for (const pending of allPending || []) {
        const cleaner = await getCleanerById(pending.cleaner_id)
        if (cleaner?.name) {
          pendingCleanerNames.push(cleaner.name)
        }
      }

      // If we've hit the max follow-up limit, stop messaging cleaners and alert the owner
      if (followupCount >= MAX_FOLLOWUP_ATTEMPTS) {
        const maxReached = await hasSystemEvent(client, 'OWNER_ALERT', jobId, {
          key: 'reason',
          value: 'max_followups_exhausted',
        })

        if (!maxReached && OWNER_PHONE) {
          const customer = await getCustomerByPhone(job.phone_number)
          const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Unknown'
          const dateStr = job.date
            ? new Date(job.date).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })
            : 'TBD'
          const pendingList = pendingCleanerNames.length > 0 ? pendingCleanerNames.join(', ') : 'none'

          const alertMessage = [
            `UNCLAIMED JOB: After ${MAX_FOLLOWUP_ATTEMPTS} follow-up attempts, no employee has responded on Telegram.`,
            `Customer: ${customerName} | ${job.phone_number || 'no phone'}`,
            `Service: ${job.service_type || 'Cleaning'} | ${dateStr} at ${job.scheduled_at || 'TBD'}`,
            `Address: ${job.address || 'not available'}`,
            `Contacted: ${pendingList}`,
            `This job still needs to be assigned manually.`,
          ].join(' ')

          await sendSMS(OWNER_PHONE, alertMessage)
          ownerAlerts++

          await logSystemEvent({
            source: 'cron',
            event_type: 'OWNER_ALERT',
            message: `Max follow-ups (${MAX_FOLLOWUP_ATTEMPTS}) reached. Owner texted about unclaimed job.`,
            job_id: jobId,
            phone_number: OWNER_PHONE,
            metadata: {
              reason: 'max_followups_exhausted',
              followup_count: followupCount,
              pending_cleaners: pendingCleanerNames,
              date: dateStr,
              scheduled_at: job.scheduled_at,
            },
          })
        }
        continue
      }

      // Send urgent follow-up (under the limit)
      let jobUrgentsSent = 0
      for (const pending of allPending || []) {
        const cleaner = await getCleanerById(pending.cleaner_id)
        if (cleaner?.telegram_id) {
          const result = await sendUrgentFollowUp(cleaner, job)
          if (result.success) {
            urgentsSent++
            jobUrgentsSent++
          }
        }
      }

      if (jobUrgentsSent > 0) {
        await logSystemEvent({
          source: 'cron',
          event_type: 'URGENT_FOLLOWUP_SENT',
          message: `Urgent follow-up sent to ${jobUrgentsSent} cleaners. (${followupCount + 1}/${MAX_FOLLOWUP_ATTEMPTS})`,
          job_id: jobId,
          phone_number: job.phone_number,
          metadata: {
            timeout_minutes: timeoutMinutes,
            cleaners: pendingCleanerNames,
            sent_count: jobUrgentsSent,
            attempt_number: followupCount + 1,
          },
        })
      }

      const shouldAlertOwner = ageMs >= ownerAlertMs
      if (shouldAlertOwner && OWNER_PHONE) {
        const ownerAlerted = await hasSystemEvent(client, 'OWNER_ALERT', jobId)
        if (!ownerAlerted) {
          const dateStr = job.date
            ? new Date(job.date).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })
            : 'TBD'

          const urgencyTag = timeoutMinutes === URGENT_TIMEOUT_MINUTES ? 'URGENT' : 'ALERT'
          const pendingList = pendingCleanerNames.length > 0 ? pendingCleanerNames.join(', ') : 'no names recorded'
          const alertMessage = `${urgencyTag}: No cleaner response within ${OWNER_ALERT_MINUTES} minutes for ${dateStr} at ${job.scheduled_at || 'TBD'}. Pending: ${pendingList}. Manual follow-up needed.`
          await sendSMS(OWNER_PHONE, alertMessage)
          ownerAlerts++

          await logSystemEvent({
            source: 'cron',
            event_type: 'OWNER_ALERT',
            message: 'Owner alerted: no cleaner response within timeout.',
            job_id: jobId,
            phone_number: OWNER_PHONE,
            metadata: {
              timeout_minutes: OWNER_ALERT_MINUTES,
              date: dateStr,
              scheduled_at: job.scheduled_at,
              pending_cleaners: pendingCleanerNames,
            },
          })
        }
      }

      const customerDelayMs = OWNER_ALERT_MINUTES * 2 * 60 * 1000
      const shouldNotifyCustomer = ageMs >= customerDelayMs
      if (shouldNotifyCustomer) {
        const customerAlerted = await hasSystemEvent(client, 'CUSTOMER_DELAY_NOTICE', jobId)
        if (!customerAlerted) {
          const customer = await getCustomerByPhone(job.phone_number)
          if (customer?.phone_number) {
            const dateStr = job.date
              ? new Date(job.date).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
              : 'TBD'

            const customerMessage = `We're still confirming your cleaner for ${dateStr}. We'll update you shortly!`
            const jobTenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
            if (jobTenant) {
              await sendSMS(jobTenant, customer.phone_number, customerMessage)
            } else {
              await sendSMS(customer.phone_number, customerMessage)
            }
            const businessNameShort = jobTenant ? getTenantBusinessName(jobTenant, true) : 'Team'
            await appendToTextingTranscript(
              customer.phone_number,
              `[${new Date().toISOString()}] ${businessNameShort}: ${customerMessage}`
            )

            await logSystemEvent({
              source: 'cron',
              event_type: 'CUSTOMER_DELAY_NOTICE',
              message: 'Customer notified of cleaner delay.',
              job_id: jobId,
              phone_number: customer.phone_number,
              metadata: {
                date: dateStr,
                scheduled_at: job.scheduled_at,
              },
            })
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedJobs.size,
      urgentFollowUpsSent: urgentsSent,
      ownerAlerts,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Also allow POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}

function getTimeoutMinutes(job: Job): number {
  const sameDay = isSameDayJob(job.date)
  const urgent = isUrgentJob(job)

  if (sameDay || urgent) {
    return URGENT_TIMEOUT_MINUTES
  }

  return STANDARD_TIMEOUT_MINUTES
}

function isSameDayJob(date: string | null | undefined): boolean {
  if (!date) return false
  return date === getPacificDateString(new Date())
}

function isUrgentJob(job: Job): boolean {
  const notes = (job.notes || '').toLowerCase()
  const urgentKeywords = ['urgent', 'asap', 'same day', 'sameday', 'today', 'rush']
  return urgentKeywords.some(keyword => notes.includes(keyword))
}

function getPacificDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getOldestPendingCreatedAt(
  assignments: Array<{ created_at?: string | null }>
): string | null {
  let oldest: string | null = null

  for (const assignment of assignments) {
    if (!assignment.created_at) continue
    if (!oldest || assignment.created_at < oldest) {
      oldest = assignment.created_at
    }
  }

  return oldest
}

async function hasSystemEvent(
  client: ReturnType<typeof getSupabaseServiceClient>,
  eventType: 'OWNER_ALERT' | 'CUSTOMER_DELAY_NOTICE' | 'CLEANER_BROADCAST',
  jobId: string,
  metadataFilter?: { key: string; value: string },
  metadataFilterTwo?: { key: string; value: string }
): Promise<boolean> {
  let query = client
    .from('system_events')
    .select('id')
    .eq('event_type', eventType)
    .eq('job_id', jobId)
    .limit(1)

  if (metadataFilter) {
    query = query.eq(`metadata->>${metadataFilter.key}`, metadataFilter.value)
  }
  if (metadataFilterTwo) {
    query = query.eq(`metadata->>${metadataFilterTwo.key}`, metadataFilterTwo.value)
  }

  const { data, error } = await query

  if (error) {
    console.error(`Error checking ${eventType} events:`, error)
    return false
  }

  return (data?.length || 0) > 0
}

async function getLatestSystemEvent(
  client: ReturnType<typeof getSupabaseServiceClient>,
  eventType: 'CLEANER_CANCELLED',
  jobId: string
): Promise<{ created_at: string; cleaner_id?: string | null } | null> {
  const { data, error } = await client
    .from('system_events')
    .select('created_at, cleaner_id')
    .eq('event_type', eventType)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    console.error(`Error fetching ${eventType} event:`, error)
    return null
  }

  if (!data || data.length === 0) {
    return null
  }

  return {
    created_at: data[0].created_at,
    cleaner_id: data[0].cleaner_id,
  }
}

function minutesSince(timestamp: string, now: Date): number {
  const parsed = new Date(timestamp)
  if (!Number.isFinite(parsed.getTime())) {
    return 0
  }
  const diffMs = now.getTime() - parsed.getTime()
  return Math.floor(diffMs / 60000)
}

async function handleCancelReassign(
  client: ReturnType<typeof getSupabaseServiceClient>,
  job: Job,
  cancelEvent: { created_at: string; cleaner_id?: string | null },
  now: Date
): Promise<{ ownerAlerted: boolean }> {
  if (!job.id) {
    return { ownerAlerted: false }
  }

  const jobId = String(job.id)
  const acceptedAssignment = await getAcceptedAssignmentForJob(jobId)
  if (acceptedAssignment) {
    return { ownerAlerted: false }
  }

  const minutesSinceCancel = minutesSince(cancelEvent.created_at, now)
  const round2Sent = await hasSystemEvent(
    client,
    'CLEANER_BROADCAST',
    jobId,
    { key: 'reason', value: 'cancelled' },
    { key: 'round', value: '2' }
  )

  if (minutesSinceCancel >= CANCEL_REASSIGN_INTERVAL_MINUTES && !round2Sent) {
    await rebroadcastJobToCleaners(job, 'cancelled', 2, cancelEvent.cleaner_id || undefined)
  }

  if (minutesSinceCancel >= CANCEL_REASSIGN_ALERT_MINUTES && OWNER_PHONE) {
    const ownerAlerted = await hasSystemEvent(client, 'OWNER_ALERT', jobId, {
      key: 'reason',
      value: 'cancelled',
    })
    if (!ownerAlerted) {
      const alertMessage = await buildOwnerCancelAlert(job, cancelEvent.cleaner_id)
      await sendSMS(OWNER_PHONE, alertMessage)

      await logSystemEvent({
        source: 'cron',
        event_type: 'OWNER_ALERT',
        message: 'Owner alerted: no cleaner response after cancellation.',
        job_id: jobId,
        phone_number: OWNER_PHONE,
        metadata: {
          reason: 'cancelled',
          minutes_since_cancel: minutesSinceCancel,
          scheduled_at: job.scheduled_at,
        },
      })

      return { ownerAlerted: true }
    }
  }

  return { ownerAlerted: false }
}

async function rebroadcastJobToCleaners(
  job: Job,
  reason: string,
  round: number,
  excludeCleanerId?: string
): Promise<void> {
  if (!job.id) {
    return
  }
  const jobId = String(job.id)
  const allCleaners = await getCleaners()
  const eligibleCleaners = allCleaners.filter(
    (cleaner) =>
      cleaner.telegram_id &&
      cleaner.id &&
      (!excludeCleanerId || String(cleaner.id) !== String(excludeCleanerId))
  )
  if (eligibleCleaners.length === 0) {
    return
  }

  const existingAssignments = await getCleanerAssignmentsForJob(jobId)
  const customer = await getCustomerByPhone(job.phone_number)
  let sentCount = 0
  const failedNotifications: Array<{ cleanerId: string; error: string }> = []

  for (const cleaner of eligibleCleaners) {
    const existing = existingAssignments.find(a => a.cleaner_id === cleaner.id)
    if (existing) {
      if (existing.status === 'accepted' || existing.status === 'confirmed') {
        continue
      }
      if (existing.status === 'declined' || existing.status === 'cancelled') {
        // Re-offer to previously declined cleaners only on cancellation re-broadcasts
        if (reason === 'cancelled') {
          await updateCleanerAssignment(existing.id!, 'pending')
          const result = await notifyCleanerAssignment(cleaner, job, customer || undefined, existing.id)
          if (result.success) {
            sentCount += 1
          } else {
            console.error(`Failed to notify cleaner ${cleaner.id} (previously ${existing.status}):`, result.error)
            failedNotifications.push({ cleanerId: cleaner.id!, error: result.error || 'Unknown error' })
          }
        }
        continue
      }

      await updateCleanerAssignment(existing.id!, 'pending')
      const result = await notifyCleanerAssignment(cleaner, job, customer || undefined, existing.id)
      if (result.success) {
        sentCount += 1
      } else {
        console.error(`Failed to notify cleaner ${cleaner.id} (existing):`, result.error)
        failedNotifications.push({ cleanerId: cleaner.id!, error: result.error || 'Unknown error' })
      }
      continue
    }

    const assignment = await createCleanerAssignment(jobId, cleaner.id!)
    if (!assignment) {
      console.error(`Failed to create assignment for cleaner ${cleaner.id}`)
      failedNotifications.push({ cleanerId: cleaner.id!, error: 'Failed to create assignment' })
      continue
    }

    const result = await notifyCleanerAssignment(cleaner, job, customer || undefined, assignment.id)
    if (result.success) {
      sentCount += 1
    } else {
      console.error(`Failed to notify cleaner ${cleaner.id} (new assignment):`, result.error)
      failedNotifications.push({ cleanerId: cleaner.id!, error: result.error || 'Unknown error' })
    }
  }

  await logSystemEvent({
    source: 'cron',
    event_type: 'CLEANER_BROADCAST',
    message: `Cleaner reassign broadcast round ${round}.`,
    job_id: jobId,
    customer_id: job.customer_id,
    phone_number: job.phone_number,
    metadata: {
      reason,
      round,
      sent_count: sentCount,
      failed_count: failedNotifications.length,
      cleaner_count: eligibleCleaners.length,
      excluded_cleaner_id: excludeCleanerId || null,
      failures: failedNotifications.length > 0 ? failedNotifications : undefined,
    },
  })
}

async function buildOwnerCancelAlert(
  job: Job,
  cancelledCleanerId?: string | null
): Promise<string> {
  const customer = await getCustomerByPhone(job.phone_number)
  const cancelledCleaner = cancelledCleanerId ? await getCleanerById(cancelledCleanerId) : null

  const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Unknown'
  const customerPhone = customer?.phone_number || job.phone_number || 'Unknown'
  const customerEmail = customer?.email || 'Unknown'
  const address = job.address || customer?.address || 'Address not available'
  const service = job.service_type || 'Cleaning'
  const dateStr = job.date
    ? new Date(job.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'TBD'
  const timeStr = job.scheduled_at || 'TBD'
  const notes = job.notes ? job.notes.replace(/\s+/g, ' ').slice(0, 140) : 'None'
  const cancelledCleanerName = cancelledCleaner?.name || 'Unknown'
  const jobId = job.id ? String(job.id) : 'unknown'

  return [
    `URGENT: No cleaner confirmed after 2 attempts (40 min) for job ${jobId}.`,
    `Customer: ${customerName} | ${customerPhone} | ${customerEmail}`,
    `Service: ${service} | ${dateStr} at ${timeStr}`,
    `Address: ${address}`,
    `Notes: ${notes}`,
    `Previous cleaner: ${cancelledCleanerName}`,
  ].join(' ')
}
