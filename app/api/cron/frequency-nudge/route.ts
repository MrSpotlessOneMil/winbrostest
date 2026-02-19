/**
 * Service Frequency Nudge Cron Job
 *
 * Sends re-engagement SMS to customers who are due for repeat service
 * based on tenant-configured nudge window (default 21 days).
 *
 * Avoids double-sending with monthly re-engagement by checking monthly_followup_sent_at.
 *
 * Schedule: Daily at 6:30pm UTC (10:30am Pacific)
 * Endpoint: GET /api/cron/frequency-nudge
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { frequencyNudge } from '@/lib/sms-templates'
import { getAllActiveTenants, getTenantBusinessName } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  console.log('[Frequency Nudge] Starting cron job...')

  const client = getSupabaseClient()
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

    // Find completed jobs in the nudge window that haven't been nudged or monthly-followed-up
    const { data: jobs, error } = await client
      .from('jobs')
      .select(`
        id,
        customer_id,
        phone_number,
        completed_at,
        customers (
          id,
          first_name,
          phone_number
        )
      `)
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .is('frequency_nudge_sent_at', null)
      .is('monthly_followup_sent_at', null)
      .not('completed_at', 'is', null)
      .gte('completed_at', nudgeWindowStart)
      .lte('completed_at', nudgeWindowEnd)
      .limit(30)

    if (error) {
      console.error(`[Frequency Nudge] Query error for ${tenant.slug}:`, error.message)
      totalErrors++
      continue
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[Frequency Nudge] No jobs need nudging for ${tenant.slug}`)
      continue
    }

    console.log(`[Frequency Nudge] Found ${jobs.length} jobs to nudge for ${tenant.slug}`)

    for (const job of jobs) {
      try {
        const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
        const phone = customer?.phone_number || job.phone_number
        const customerName = customer?.first_name || 'there'

        if (!phone) {
          console.warn(`[Frequency Nudge] No phone for job ${job.id}, skipping`)
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
          // Customer already booked again - mark as nudged to skip in future
          await client
            .from('jobs')
            .update({ frequency_nudge_sent_at: new Date().toISOString() })
            .eq('id', job.id)
          continue
        }

        const daysSince = Math.floor((Date.now() - new Date(job.completed_at!).getTime()) / (24 * 60 * 60 * 1000))
        const message = frequencyNudge(customerName, daysSince, businessName)

        const smsResult = await sendSMS(tenant, phone, message)

        if (smsResult.success) {
          await client
            .from('jobs')
            .update({ frequency_nudge_sent_at: new Date().toISOString() })
            .eq('id', job.id)

          await logSystemEvent({
            source: 'cron',
            event_type: 'FREQUENCY_NUDGE_SENT',
            message: `Frequency nudge sent to ${customerName} (${daysSince} days since last service)`,
            job_id: String(job.id),
            phone_number: phone,
            metadata: {
              tenant_slug: tenant.slug,
              days_since: daysSince,
              nudge_window: nudgeDays,
            },
          })

          totalSent++
          console.log(`[Frequency Nudge] Sent nudge for job ${job.id} (${daysSince} days)`)
        } else {
          console.error(`[Frequency Nudge] SMS failed for job ${job.id}:`, smsResult.error)
          totalErrors++
        }
      } catch (err) {
        console.error(`[Frequency Nudge] Error processing job ${job.id}:`, err)
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
