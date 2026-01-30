/**
 * Monthly Re-engagement Follow-up Cron Job
 *
 * Vercel Cron endpoint that runs daily to send re-engagement SMS messages
 * to customers 30 days after their last completed service.
 *
 * Triggered by: Vercel Cron (daily)
 *
 * Logic:
 * 1. Find completed jobs where completed_at < NOW() - 30 days
 * 2. Ensure monthly_followup_sent_at IS NULL
 * 3. Ensure customer hasn't booked another job since
 * 4. Send re-engagement SMS with configurable discount
 * 5. Update job.monthly_followup_sent_at timestamp
 * 6. Log system event
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseClient, getCustomerByPhone, updateJob } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { sendSMS } from '@/lib/openphone'
import { monthlyFollowup } from '@/lib/sms-templates'

// Default discount if not configured in environment
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
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const discount = process.env.MONTHLY_FOLLOWUP_DISCOUNT || DEFAULT_DISCOUNT

    const results = {
      timestamp: now.toISOString(),
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: [] as Array<{ jobId: string; error: string }>,
    }

    const client = getSupabaseClient()

    // Query completed jobs where:
    // - completed_at < NOW() - 30 days
    // - monthly_followup_sent_at IS NULL
    // - deleted_at IS NULL
    const { data: eligibleJobs, error: queryError } = await client
      .from('jobs')
      .select('*')
      .eq('status', 'completed')
      .lt('completed_at', thirtyDaysAgo.toISOString())
      .is('monthly_followup_sent_at', null)
      .is('deleted_at', null)
      .order('completed_at', { ascending: true })
      .limit(100) // Process in batches to avoid timeout

    if (queryError) {
      console.error('[Monthly Follow-up Cron] Query error:', queryError)
      return NextResponse.json(
        { success: false, error: queryError.message },
        { status: 500 }
      )
    }

    console.log(`[Monthly Follow-up Cron] Found ${eligibleJobs?.length || 0} potential jobs`)

    for (const job of eligibleJobs || []) {
      results.processed++

      try {
        // Check if customer has booked another job since this one was completed
        // (jobs with status 'scheduled' or 'completed' created after this job's completed_at)
        const { data: subsequentJobs, error: subqueryError } = await client
          .from('jobs')
          .select('id')
          .eq('customer_id', job.customer_id)
          .in('status', ['scheduled', 'completed'])
          .gt('created_at', job.completed_at)
          .is('deleted_at', null)
          .limit(1)

        if (subqueryError) {
          console.error(`[Monthly Follow-up Cron] Subquery error for job ${job.id}:`, subqueryError)
          results.errors.push({ jobId: job.id, error: subqueryError.message })
          continue
        }

        // If customer has booked another job, skip sending followup
        if (subsequentJobs && subsequentJobs.length > 0) {
          console.log(`[Monthly Follow-up Cron] Skipping job ${job.id} - customer has subsequent booking`)
          results.skipped++

          // Mark as processed so we don't check again
          await updateJob(job.id, {
            monthly_followup_sent_at: now.toISOString(),
          })
          continue
        }

        // Get customer info
        const customer = await getCustomerByPhone(job.phone_number)
        if (!customer) {
          console.warn(`[Monthly Follow-up Cron] Customer not found for job ${job.id}`)
          results.errors.push({ jobId: job.id, error: 'Customer not found' })
          continue
        }

        const customerName = customer.first_name || 'there'

        // Send re-engagement SMS
        const message = monthlyFollowup(customerName, discount)
        const smsResult = await sendSMS(job.phone_number, message)

        if (!smsResult.success) {
          console.error(`[Monthly Follow-up Cron] SMS failed for job ${job.id}:`, smsResult.error)
          results.errors.push({ jobId: job.id, error: smsResult.error || 'SMS failed' })
          continue
        }

        // Update job.monthly_followup_sent_at
        await updateJob(job.id, {
          monthly_followup_sent_at: now.toISOString(),
        })

        // Log system event
        await logSystemEvent({
          source: 'cron',
          event_type: 'REVIEW_REQUEST_SENT', // Using existing event type for re-engagement
          message: `Monthly re-engagement SMS sent to ${customerName} (${job.phone_number}) with ${discount} discount`,
          job_id: job.id,
          customer_id: job.customer_id,
          phone_number: job.phone_number,
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
        console.log(`[Monthly Follow-up Cron] Sent re-engagement SMS for job ${job.id} to ${job.phone_number}`)
      } catch (error) {
        console.error(`[Monthly Follow-up Cron] Error processing job ${job.id}:`, error)
        results.errors.push({
          jobId: job.id,
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

// POST method for QStash (QStash uses POST by default)
export async function POST(request: NextRequest) {
  return GET(request)
}
