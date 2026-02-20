import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { monthlyReengagement } from '@/lib/sms-templates'
import { logSystemEvent } from '@/lib/system-events'
import { getDefaultTenant } from '@/lib/tenant'

/**
 * Monthly Re-engagement Cron
 *
 * Runs daily at 10am to check for customers who had a job completed 30+ days ago
 * and haven't booked again. Sends a re-engagement offer with discount.
 *
 * Race-condition safe: Uses claim_jobs_for_monthly_reengagement() RPC with
 * SELECT FOR UPDATE SKIP LOCKED to prevent duplicate SMS.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Monthly Reengagement] Starting cron job...')

  const client = getSupabaseServiceClient()
  const tenant = await getDefaultTenant()

  if (!tenant) {
    console.error('[Monthly Reengagement] No tenant configured')
    return NextResponse.json({ error: 'No tenant configured' }, { status: 500 })
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
    console.error('[Monthly Reengagement] Failed to claim jobs:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!candidates || candidates.length === 0) {
    console.log('[Monthly Reengagement] No customers need re-engagement today')
    return NextResponse.json({ success: true, processed: 0 })
  }

  console.log(`[Monthly Reengagement] Claimed ${candidates.length} jobs`)

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
        .gt('created_at', job.completed_at)
        .limit(1)

      if (recentJobs && recentJobs.length > 0) {
        console.log(`[Monthly Reengagement] Customer ${customerId} has recent booking, skipping`)
        // Already claimed/marked by RPC — no duplicate risk
        skipped++
        continue
      }

      // Calculate days since last cleaning
      const daysSince = Math.floor(
        (Date.now() - new Date(job.completed_at!).getTime()) / (24 * 60 * 60 * 1000)
      )

      const message = monthlyReengagement(customerName, discount, daysSince)
      const smsResult = await sendSMS(phone, message)

      if (smsResult.success) {
        // monthly_followup_sent_at already set by RPC
        await logSystemEvent({
          source: 'cron',
          event_type: 'MONTHLY_REENGAGEMENT_SENT',
          message: `Monthly re-engagement sent to ${customerName} (${phone})`,
          phone_number: phone,
          metadata: {
            job_id: job.job_id,
            customer_id: customerId,
            days_since_last_clean: daysSince,
            discount,
          },
        })

        processed++
        console.log(`[Monthly Reengagement] Sent re-engagement to ${phone} (${daysSince} days since last clean)`)
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

  console.log(`[Monthly Reengagement] Completed. Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`)

  return NextResponse.json({
    success: true,
    processed,
    skipped,
    errors,
    total: candidates.length,
  })
}