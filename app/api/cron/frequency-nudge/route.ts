/**
 * Service Frequency Nudge Cron Job
 *
 * Sends re-engagement SMS to customers who are due for repeat service
 * based on tenant-configured nudge window (default 21 days).
 *
 * Avoids double-sending with monthly re-engagement by checking monthly_followup_sent_at.
 *
 * Race-condition safe: Uses claim_jobs_for_frequency_nudge() RPC with
 * SELECT FOR UPDATE SKIP LOCKED to prevent duplicate SMS.
 *
 * Schedule: Daily at 6:30pm UTC (10:30am Pacific)
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { frequencyNudge } from '@/lib/sms-templates'
import { getAllActiveTenants, getTenantBusinessName } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  console.log('[Frequency Nudge] Starting cron job...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  let totalSent = 0
  let totalErrors = 0

  for (const tenant of tenants) {
    if (!tenant.workflow_config.frequency_nudge_enabled) continue

    const nudgeDays = tenant.workflow_config.frequency_nudge_days || 21
    const nudgeWindowStart = new Date(Date.now() - (nudgeDays + 7) * 24 * 60 * 60 * 1000).toISOString()
    const nudgeWindowEnd = new Date(Date.now() - nudgeDays * 24 * 60 * 60 * 1000).toISOString()
    const businessName = getTenantBusinessName(tenant, true)

    console.log(`[Frequency Nudge] Tenant '${tenant.slug}': checking jobs completed ${nudgeDays}-${nudgeDays + 7} days ago`)

    // Atomically claim eligible jobs using FOR UPDATE SKIP LOCKED
    const { data: jobs, error } = await client.rpc('claim_jobs_for_frequency_nudge', {
      p_tenant_id: tenant.id,
      p_window_start: nudgeWindowStart,
      p_window_end: nudgeWindowEnd,
      p_batch_size: 30,
    })

    if (error) {
      console.error(`[Frequency Nudge] Query error for ${tenant.slug}:`, error.message)
      totalErrors++
      continue
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[Frequency Nudge] No jobs need nudging for ${tenant.slug}`)
      continue
    }

    console.log(`[Frequency Nudge] Claimed ${jobs.length} jobs for ${tenant.slug}`)

    for (const job of jobs) {
      try {
        const phone = job.customer_phone || job.job_phone_number
        const customerName = job.customer_first_name || 'there'

        if (!phone) {
          console.warn(`[Frequency Nudge] No phone for job ${job.job_id}, skipping`)
          continue
        }

        // Check if customer has booked another job since this one
        const { data: newerJobs } = await client
          .from('jobs')
          .select('id')
          .eq('customer_id', job.customer_id)
          .eq('tenant_id', tenant.id)
          .gt('created_at', job.completed_at!)
          .limit(1)

        if (newerJobs && newerJobs.length > 0) {
          // Customer already booked again — already claimed by RPC, no action needed
          continue
        }

        const daysSince = Math.floor((Date.now() - new Date(job.completed_at!).getTime()) / (24 * 60 * 60 * 1000))
        const message = frequencyNudge(customerName, daysSince, businessName)

        const smsResult = await sendSMS(tenant, phone, message)

        if (smsResult.success) {
          // frequency_nudge_sent_at already set by RPC
          await logSystemEvent({
            source: 'cron',
            event_type: 'FREQUENCY_NUDGE_SENT',
            message: `Frequency nudge sent to ${customerName} (${daysSince} days since last service)`,
            job_id: String(job.job_id),
            phone_number: phone,
            metadata: {
              tenant_slug: tenant.slug,
              days_since: daysSince,
              nudge_window: nudgeDays,
            },
          })

          totalSent++
          console.log(`[Frequency Nudge] Sent nudge for job ${job.job_id} (${daysSince} days)`)
        } else {
          // SMS failed — reset so it gets retried
          await client
            .from('jobs')
            .update({ frequency_nudge_sent_at: null })
            .eq('id', job.job_id)

          console.error(`[Frequency Nudge] SMS failed for job ${job.job_id}:`, smsResult.error)
          totalErrors++
        }
      } catch (err) {
        // Unexpected error — reset so it gets retried
        await client
          .from('jobs')
          .update({ frequency_nudge_sent_at: null })
          .eq('id', job.job_id)

        console.error(`[Frequency Nudge] Error processing job ${job.job_id}:`, err)
        totalErrors++
      }
    }
  }

  console.log(`[Frequency Nudge] Complete. Sent: ${totalSent}, Errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    totalSent,
    totalErrors,
  })
}

// POST method for compatibility
export async function POST(request: NextRequest) {
  return GET(request)
}