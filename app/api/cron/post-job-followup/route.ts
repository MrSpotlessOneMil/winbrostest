import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { postJobFollowup, reviewOnlyFollowup } from '@/lib/sms-templates'
import { logSystemEvent } from '@/lib/system-events'
import { getDefaultTenant } from '@/lib/tenant'

/**
 * Post-Job Follow-up Cron
 *
 * Runs every 15 minutes to check for completed jobs that need follow-up.
 * Sends combined message: review request + recurring offer + tip prompt
 *
 * Timing: 2 hours after job completion
 *
 * Race-condition safe: Uses claim_jobs_for_followup() RPC with
 * SELECT FOR UPDATE SKIP LOCKED to prevent duplicate SMS.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Post-Job Followup] Starting cron job...')

  const client = getSupabaseServiceClient()
  const tenant = await getDefaultTenant()

  if (!tenant) {
    console.error('[Post-Job Followup] No tenant configured')
    return NextResponse.json({ error: 'No tenant configured' }, { status: 500 })
  }

  // Atomically claim eligible jobs using FOR UPDATE SKIP LOCKED
  // This prevents duplicate SMS when multiple cron instances fire simultaneously
  const { data: jobs, error } = await client.rpc('claim_jobs_for_followup', {
    p_tenant_id: tenant.id,
    p_batch_size: 20,
  })

  if (error) {
    console.error('[Post-Job Followup] Failed to claim jobs:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    console.log('[Post-Job Followup] No jobs need follow-up')
    return NextResponse.json({ success: true, processed: 0 })
  }

  console.log(`[Post-Job Followup] Claimed ${jobs.length} jobs to follow up`)

  let processed = 0
  let errors = 0

  for (const job of jobs) {
    try {
      const phone = job.customer_phone || job.job_phone_number
      const customerName = job.customer_first_name || 'there'

      if (!phone) {
        console.warn(`[Post-Job Followup] No phone for job ${job.job_id}, skipping`)
        continue
      }

      // Get the cleaner name for the tip message
      let cleanerName = 'your cleaner'
      if (job.team_id) {
        const { data: teamMembers } = await client
          .from('team_members')
          .select('cleaners (name)')
          .eq('team_id', job.team_id)
          .eq('is_active', true)
          .limit(1)

        const member = teamMembers?.[0]
        if (member && typeof member.cleaners === 'object' && member.cleaners !== null) {
          cleanerName = (member.cleaners as { name?: string }).name || 'your cleaner'
        }
      }

      // Get review link and tip link from tenant config
      const reviewLink = tenant.google_review_link || 'https://g.page/review'
      const tipLink = `https://spotless-scrubbers-api.vercel.app/tip/${job.job_id}`
      const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'

      // Check if this job has payment info - if not and review-only is enabled, send simpler message
      const hasPaymentInfo = !!job.paid || !!job.stripe_payment_intent_id
      const reviewOnlyEnabled = tenant.workflow_config?.review_only_followup_enabled

      let message: string
      if (!hasPaymentInfo && reviewOnlyEnabled) {
        message = reviewOnlyFollowup(customerName, reviewLink)
        console.log(`[Post-Job Followup] Using review-only template for job ${job.job_id} (no payment info)`)
      } else {
        message = postJobFollowup(
          customerName,
          cleanerName,
          reviewLink,
          tipLink,
          recurringDiscount
        )
      }

      const smsResult = await sendSMS(phone, message)

      if (smsResult.success) {
        // followup_sent_at already set by the RPC function (atomic claim)
        await logSystemEvent({
          source: 'cron',
          event_type: 'POST_JOB_FOLLOWUP_SENT',
          message: `Post-job follow-up sent for job ${job.job_id}`,
          job_id: String(job.job_id),
          phone_number: phone,
          metadata: {
            customer_name: customerName,
            cleaner_name: cleanerName,
          },
        })

        processed++
        console.log(`[Post-Job Followup] Sent follow-up for job ${job.job_id}`)
      } else {
        // SMS failed — reset followup_sent_at so it gets retried next run
        await client
          .from('jobs')
          .update({ followup_sent_at: null })
          .eq('id', job.job_id)

        console.error(`[Post-Job Followup] Failed to send SMS for job ${job.job_id}:`, smsResult.error)
        errors++
      }
    } catch (err) {
      // Unexpected error — reset followup_sent_at so it gets retried next run
      await client
        .from('jobs')
        .update({ followup_sent_at: null })
        .eq('id', job.job_id)

      console.error(`[Post-Job Followup] Error processing job ${job.job_id}:`, err)
      errors++
    }
  }

  console.log(`[Post-Job Followup] Completed. Processed: ${processed}, Errors: ${errors}`)

  return NextResponse.json({
    success: true,
    processed,
    errors,
    total: jobs.length,
  })
}