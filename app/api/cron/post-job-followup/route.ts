import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, tenantUsesFeature, getCleanerPhoneSet, isCleanerPhone } from '@/lib/tenant'
import { scheduleTask } from '@/lib/scheduler'
import { canSendToCustomer, recordMessageSent } from '@/lib/lifecycle-engine'

/**
 * Post-Job Satisfaction Check Cron
 *
 * Runs every 15 minutes. Sends "How was your cleaning?" SMS instead of
 * blasting review+tip+recurring all at once.
 *
 * Flow: satisfaction check → (positive reply) → review+tip → recurring push
 *       satisfaction check → (negative reply) → apology + owner alert
 *       satisfaction check → (no reply 24h)  → review only → recurring push
 *
 * Uses claim_jobs_for_satisfaction_check() RPC with FOR UPDATE SKIP LOCKED.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Post-Job Followup] Starting satisfaction check cron...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; processed: number; errors: number }> = []

  for (const tenant of tenants) {
    if (!tenantUsesFeature(tenant, 'post_cleaning_followup_enabled')) {
      continue
    }

    // Use new RPC that targets satisfaction_sent_at instead of followup_sent_at
    const { data: jobs, error } = await client.rpc('claim_jobs_for_satisfaction_check', {
      p_tenant_id: tenant.id,
      p_batch_size: 20,
    })

    if (error) {
      console.error(`[Post-Job Followup] Failed to claim jobs for ${tenant.slug}:`, error.message)
      continue
    }

    if (!jobs || jobs.length === 0) {
      continue
    }

    console.log(`[Post-Job Followup] Claimed ${jobs.length} jobs for ${tenant.slug}`)

    // Build cleaner phone set to skip cleaner records
    const cleanerPhones = await getCleanerPhoneSet(tenant.id)

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

        // Skip if phone belongs to a cleaner
        if (isCleanerPhone(phone, cleanerPhones)) {
          console.log(`[Post-Job Followup] Phone ${phone.slice(-4)} is a cleaner, skipping job ${job.job_id}`)
          continue
        }

        // Check lifecycle cooldown
        if (job.customer_id) {
          const canSend = await canSendToCustomer(job.customer_id, 'post_job', 4, tenant.id)
          if (!canSend) {
            console.log(`[Post-Job Followup] Customer ${job.customer_id} in cooldown, skipping job ${job.job_id}`)
            continue
          }
        }

        const businessName = tenant.business_name_short || tenant.name || 'us'
        const message = `Hey ${customerName}! How was your cleaning today?`

        const smsResult = await sendSMS(tenant, phone, message)

        if (smsResult.success) {
          // Update customer post-job stage
          if (job.customer_id) {
            await client
              .from('customers')
              .update({
                post_job_stage: 'satisfaction_sent',
                post_job_stage_updated_at: new Date().toISOString(),
              })
              .eq('id', job.customer_id)

            await recordMessageSent(tenant.id, job.customer_id, phone, 'post_job_satisfaction', 'post_job')
          }

          // Schedule 24hr timeout fallback (if customer never replies)
          await scheduleTask({
            tenantId: tenant.id,
            taskType: 'post_job_review',
            taskKey: `post-job-review-${job.job_id}`,
            scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000),
            payload: {
              jobId: job.job_id,
              customerId: job.customer_id,
              customerPhone: phone,
              customerName,
              tenantId: tenant.id,
              isTimeout: true,
              googleReviewLink: tenant.google_review_link || null,
            },
          })

          await logSystemEvent({
            source: 'cron',
            event_type: 'POST_JOB_SATISFACTION_SENT',
            message: `Satisfaction check sent for job ${job.job_id}`,
            tenant_id: tenant.id,
            job_id: String(job.job_id),
            phone_number: phone,
          })

          processed++
          console.log(`[Post-Job Followup] Satisfaction check sent for job ${job.job_id}`)
        } else {
          // Reset so it gets retried
          await client
            .from('jobs')
            .update({ satisfaction_sent_at: null })
            .eq('id', job.job_id)

          console.error(`[Post-Job Followup] SMS failed for job ${job.job_id}:`, smsResult.error)
          errors++
        }
      } catch (err) {
        await client
          .from('jobs')
          .update({ satisfaction_sent_at: null })
          .eq('id', job.job_id)

        console.error(`[Post-Job Followup] Error processing job ${job.job_id}:`, err)
        errors++
      }
    }

    summary.push({ tenant: tenant.slug, processed, errors })
  }

  const totalProcessed = summary.reduce((sum, s) => sum + s.processed, 0)
  const totalErrors = summary.reduce((sum, s) => sum + s.errors, 0)

  console.log(`[Post-Job Followup] Done. Processed: ${totalProcessed}, Errors: ${totalErrors}`)

  return NextResponse.json({
    success: true,
    processed: totalProcessed,
    errors: totalErrors,
    tenants: summary,
  })
}
