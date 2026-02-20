/**
 * Monthly Re-engagement Follow-up Cron Job
 *
 * Sends re-engagement SMS to customers 30 days after their last completed service.
 * Skips customers who have booked another job since.
 *
 * Race-condition safe: Uses claim_jobs_for_monthly_followup() RPC with
 * SELECT FOR UPDATE SKIP LOCKED to prevent duplicate SMS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { sendSMS } from '@/lib/openphone'
import { monthlyFollowup } from '@/lib/sms-templates'

const DEFAULT_DISCOUNT = '15%'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  return executeMonthlyFollowup()
}

async function executeMonthlyFollowup() {
  try {
    const now = new Date()
    const discount = process.env.MONTHLY_FOLLOWUP_DISCOUNT || DEFAULT_DISCOUNT
    const client = getSupabaseServiceClient()

    const results = {
      timestamp: now.toISOString(),
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: [] as Array<{ jobId: string; error: string }>,
    }

    // Atomically claim eligible jobs using FOR UPDATE SKIP LOCKED
    const { data: eligibleJobs, error: queryError } = await client.rpc(
      'claim_jobs_for_monthly_followup',
      { p_batch_size: 100 }
    )

    if (queryError) {
      console.error('[Monthly Follow-up Cron] Query error:', queryError)
      return NextResponse.json(
        { success: false, error: queryError.message },
        { status: 500 }
      )
    }

    console.log(`[Monthly Follow-up Cron] Claimed ${eligibleJobs?.length || 0} jobs`)

    for (const job of eligibleJobs || []) {
      results.processed++

      try {
        // Check if customer has booked another job since this one was completed
        const { data: subsequentJobs, error: subqueryError } = await client
          .from('jobs')
          .select('id')
          .eq('customer_id', job.customer_id)
          .in('status', ['scheduled', 'completed'])
          .gt('created_at', job.completed_at)
          .limit(1)

        if (subqueryError) {
          console.error(`[Monthly Follow-up Cron] Subquery error for job ${job.job_id}:`, subqueryError)
          results.errors.push({ jobId: job.job_id, error: subqueryError.message })
          continue
        }

        // If customer has booked another job, skip sending (already claimed/marked)
        if (subsequentJobs && subsequentJobs.length > 0) {
          console.log(`[Monthly Follow-up Cron] Skipping job ${job.job_id} - customer has subsequent booking`)
          results.skipped++
          continue
        }

        const phone = job.customer_phone || job.job_phone_number
        const customerName = job.customer_first_name || 'there'

        if (!phone) {
          console.warn(`[Monthly Follow-up Cron] No phone for job ${job.job_id}`)
          results.errors.push({ jobId: job.job_id, error: 'No phone number' })
          continue
        }

        // Send re-engagement SMS
        const message = monthlyFollowup(customerName, discount)
        const smsResult = await sendSMS(phone, message)

        if (!smsResult.success) {
          // SMS failed — reset so it gets retried
          await client
            .from('jobs')
            .update({ monthly_followup_sent_at: null })
            .eq('id', job.job_id)

          console.error(`[Monthly Follow-up Cron] SMS failed for job ${job.job_id}:`, smsResult.error)
          results.errors.push({ jobId: job.job_id, error: smsResult.error || 'SMS failed' })
          continue
        }

        // monthly_followup_sent_at already set by RPC
        await logSystemEvent({
          source: 'cron',
          event_type: 'REVIEW_REQUEST_SENT',
          message: `Monthly re-engagement SMS sent to ${customerName} (${phone}) with ${discount} discount`,
          job_id: job.job_id,
          customer_id: job.customer_id,
          phone_number: phone,
          metadata: {
            followup_type: 'monthly_reengagement',
            discount,
            days_since_completion: Math.floor(
              (now.getTime() - new Date(job.completed_at).getTime()) / (24 * 60 * 60 * 1000)
            ),
            sms_message_id: smsResult.messageId,
          },
        })

        results.sent++
        console.log(`[Monthly Follow-up Cron] Sent re-engagement SMS for job ${job.job_id} to ${phone}`)
      } catch (error) {
        console.error(`[Monthly Follow-up Cron] Error processing job ${job.job_id}:`, error)
        results.errors.push({
          jobId: job.job_id,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    console.log(
      `[Monthly Follow-up Cron] Completed: ${results.sent} sent, ${results.skipped} skipped, ${results.errors.length} errors`
    )

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('[Monthly Follow-up Cron] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// POST method for QStash
export async function POST(request: NextRequest) {
  return GET(request)
}