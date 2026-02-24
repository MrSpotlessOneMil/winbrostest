import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { postJobFollowup, reviewOnlyFollowup } from '@/lib/sms-templates'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'

/**
 * Post-Job Follow-up Cron
 *
 * Runs every 15 minutes. Loops all active tenants that have
 * post_cleaning_followup_enabled=true and use_review_request=true.
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
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; processed: number; errors: number }> = []

  for (const tenant of tenants) {
    // Skip tenants that don't want post-cleaning follow-ups or review requests
    if (!tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
      console.log(`[Post-Job Followup] Skipping ${tenant.slug} (post_cleaning_followup_enabled=false)`)
      continue
    }
    if (!tenantUsesFeature(tenant, 'use_review_request')) {
      console.log(`[Post-Job Followup] Skipping ${tenant.slug} (use_review_request=false)`)
      continue
    }

    // Atomically claim eligible jobs using FOR UPDATE SKIP LOCKED
    // This prevents duplicate SMS when multiple cron instances fire simultaneously
    const { data: jobs, error } = await client.rpc('claim_jobs_for_followup', {
      p_tenant_id: tenant.id,
      p_batch_size: 20,
    })

    if (error) {
      console.error(`[Post-Job Followup] Failed to claim jobs for ${tenant.slug}:`, error.message)
      continue
    }

    if (!jobs || jobs.length === 0) {
      console.log(`[Post-Job Followup] No jobs need follow-up for ${tenant.slug}`)
      continue
    }

    console.log(`[Post-Job Followup] Claimed ${jobs.length} jobs for ${tenant.slug}`)

    let processed = 0
    let errors = 0

    for (const job of jobs) {
      try {
        // Skip estimate jobs — only send follow-ups for actual cleaning jobs
        if (job.job_type === 'estimate') {
          console.log(`[Post-Job Followup] Skipping estimate job ${job.job_id}`)
          continue
        }

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
        const appDomain = tenant.website_url || process.env.NEXT_PUBLIC_APP_URL || 'https://spotless-scrubbers-api.vercel.app'
        const tipLink = `${appDomain.replace(/\/+$/, '')}/tip/${job.job_id}`
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

        const smsResult = await sendSMS(tenant, phone, message)

        if (smsResult.success) {
          // followup_sent_at already set by the RPC function (atomic claim)
          await logSystemEvent({
            source: 'cron',
            event_type: 'POST_JOB_FOLLOWUP_SENT',
            message: `Post-job follow-up sent for job ${job.job_id}`,
            tenant_id: tenant.id,
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

    summary.push({ tenant: tenant.slug, processed, errors })
    console.log(`[Post-Job Followup] ${tenant.slug}: Processed: ${processed}, Errors: ${errors}`)
  }

  const totalProcessed = summary.reduce((sum, s) => sum + s.processed, 0)
  const totalErrors = summary.reduce((sum, s) => sum + s.errors, 0)

  console.log(`[Post-Job Followup] Done. Total processed: ${totalProcessed}, Total errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    processed: totalProcessed,
    errors: totalErrors,
    tenants: summary,
  })
}
