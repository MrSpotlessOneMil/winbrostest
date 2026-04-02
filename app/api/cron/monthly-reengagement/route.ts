import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { monthlyReengagement } from '@/lib/sms-templates'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'

/**
 * Monthly Re-engagement Cron — DISABLED
 *
 * Disabled 2026-04-02: Overlaps with lifecycle-auto-enroll retargeting sequences.
 * Multiple re-engagement crons were sending overlapping SMS to the same customers,
 * causing confusion and eroding trust. Keeping lifecycle-auto-enroll as the single path.
 *
 * Previously: Runs daily at 10am. Loops all active tenants that have
 * monthly_followup_enabled=true and use_retargeting=true.
 * Sends a re-engagement offer with discount to customers 30+ days since last job.
 *
 * Race-condition safe: Uses claim_jobs_for_monthly_reengagement() RPC with
 * SELECT FOR UPDATE SKIP LOCKED to prevent duplicate SMS.
 */
export async function GET(request: NextRequest) {
  // DISABLED: Overlaps with lifecycle-auto-enroll. See comment at top of file.
  return NextResponse.json({ success: true, disabled: true, reason: 'Overlaps with lifecycle-auto-enroll retargeting' })

  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Monthly Reengagement] Starting cron job...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; processed: number; skipped: number; errors: number }> = []

  for (const tenant of tenants) {
    // Skip tenants that don't want monthly re-engagement or retargeting
    if (!tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
      console.log(`[Monthly Reengagement] Skipping ${tenant.slug} (monthly_followup_enabled=false)`)
      continue
    }
    if (!tenantUsesFeature(tenant, 'use_retargeting')) {
      console.log(`[Monthly Reengagement] Skipping ${tenant.slug} (use_retargeting=false)`)
      continue
    }

    const reengagementDays = tenant.workflow_config?.monthly_followup_days || 30
    const discount = tenant.workflow_config?.monthly_followup_discount || '15%'

    // Calculate the date range window
    const windowEnd = new Date(Date.now() - reengagementDays * 24 * 60 * 60 * 1000).toISOString()
    const windowStart = new Date(Date.now() - (reengagementDays + 1) * 24 * 60 * 60 * 1000).toISOString()

    // Atomically claim eligible jobs using FOR UPDATE SKIP LOCKED
    const { data: candidates, error } = await client.rpc('claim_jobs_for_monthly_reengagement', {
      p_tenant_id: tenant.id,
      p_window_start: windowStart,
      p_window_end: windowEnd,
      p_batch_size: 30,
    })

    if (error) {
      console.error(`[Monthly Reengagement] Failed to claim jobs for ${tenant.slug}:`, error.message)
      continue
    }

    if (!candidates || candidates.length === 0) {
      console.log(`[Monthly Reengagement] No customers need re-engagement for ${tenant.slug}`)
      continue
    }

    console.log(`[Monthly Reengagement] Claimed ${candidates.length} jobs for ${tenant.slug}`)

    let processed = 0
    let skipped = 0
    let errors = 0

    for (const job of candidates) {
      try {
        const phone = job.customer_phone || job.job_phone_number
        const customerName = job.customer_first_name || 'there'
        const customerId = job.customer_id

        if (!phone) {
          console.warn(`[Monthly Reengagement] No phone for job ${job.job_id}, skipping`)
          skipped++
          continue
        }

        // Check if customer has any upcoming/recent jobs (skip if they've booked again)
        const { data: recentJobs } = await client
          .from('jobs')
          .select('id')
          .eq('customer_id', customerId)
          .eq('tenant_id', tenant.id)
          .gt('created_at', job.completed_at)
          .limit(1)

        if (recentJobs && recentJobs.length > 0) {
          console.log(`[Monthly Reengagement] Customer ${customerId} has recent booking, skipping`)
          skipped++
          continue
        }

        // Calculate days since last cleaning
        const daysSince = Math.floor(
          (Date.now() - new Date(job.completed_at!).getTime()) / (24 * 60 * 60 * 1000)
        )

        const message = monthlyReengagement(customerName, discount, daysSince)
        const smsResult = await sendSMS(tenant, phone, message)

        if (smsResult.success) {
          // monthly_followup_sent_at already set by RPC
          await logSystemEvent({
            source: 'cron',
            event_type: 'MONTHLY_REENGAGEMENT_SENT',
            message: `Monthly re-engagement sent to ${customerName} (${phone})`,
            tenant_id: tenant.id,
            phone_number: phone,
            metadata: {
              job_id: job.job_id,
              customer_id: customerId,
              days_since_last_clean: daysSince,
              discount,
            },
          })

          processed++
          console.log(`[Monthly Reengagement] Sent re-engagement to ${phone} (${daysSince} days)`)
        } else {
          // SMS failed — reset so it gets retried
          await client
            .from('jobs')
            .update({ monthly_followup_sent_at: null })
            .eq('id', job.job_id)

          console.error(`[Monthly Reengagement] Failed to send SMS to ${phone}:`, smsResult.error)
          errors++
        }
      } catch (err) {
        // Unexpected error — reset so it gets retried
        await client
          .from('jobs')
          .update({ monthly_followup_sent_at: null })
          .eq('id', job.job_id)

        console.error(`[Monthly Reengagement] Error processing job ${job.job_id}:`, err)
        errors++
      }
    }

    summary.push({ tenant: tenant.slug, processed, skipped, errors })
    console.log(`[Monthly Reengagement] ${tenant.slug}: Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`)
  }

  const totalProcessed = summary.reduce((sum, s) => sum + s.processed, 0)
  const totalErrors = summary.reduce((sum, s) => sum + s.errors, 0)

  console.log(`[Monthly Reengagement] Done. Total processed: ${totalProcessed}, Total errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    processed: totalProcessed,
    errors: totalErrors,
    tenants: summary,
  })
}
