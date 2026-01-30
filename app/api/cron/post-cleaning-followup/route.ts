/**
 * Post-Cleaning Review Request Cron Job
 *
 * Sends review request SMS to customers 2+ hours after job completion.
 * Called periodically by Vercel Cron.
 *
 * Endpoint: GET/POST /api/cron/post-cleaning-followup
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseClient, getCustomerByPhone } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { postCleaningReview } from '@/lib/sms-templates'
import { getClientConfig } from '@/lib/client-config'
import { logSystemEvent } from '@/lib/system-events'

interface JobResult {
  jobId: string
  success: boolean
  error?: string
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  return executePostCleaningFollowup()
}

async function executePostCleaningFollowup() {
  const now = new Date()
  const results: JobResult[] = []
  let processed = 0
  let succeeded = 0
  let failed = 0

  try {
    const client = getSupabaseClient()
    const config = getClientConfig()

    // Calculate cutoff time: 2 hours ago
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)

    // Query jobs that:
    // 1. status = 'completed'
    // 2. completed_at < NOW() - 2 hours (at least 2 hours after completion)
    // 3. followup_sent_at IS NULL (haven't sent follow-up yet)
    const { data: jobs, error: queryError } = await client
      .from('jobs')
      .select('id, phone_number, customer_id')
      .eq('status', 'completed')
      .lt('completed_at', twoHoursAgo.toISOString())
      .is('followup_sent_at', null)
      .is('deleted_at', null)

    if (queryError) {
      console.error('[Post-Cleaning Followup] Query error:', queryError)
      return NextResponse.json(
        {
          success: false,
          error: `Database query failed: ${queryError.message}`,
        },
        { status: 500 }
      )
    }

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({
        success: true,
        timestamp: now.toISOString(),
        message: 'No jobs pending review request',
        processed: 0,
        succeeded: 0,
        failed: 0,
      })
    }

    console.log(`[Post-Cleaning Followup] Found ${jobs.length} jobs pending review request`)

    // Get review link from client config
    const reviewLink = config.reviewLink

    if (!reviewLink) {
      console.warn('[Post-Cleaning Followup] No review link configured, skipping review requests')
      return NextResponse.json({
        success: true,
        timestamp: now.toISOString(),
        message: 'No review link configured',
        processed: 0,
        succeeded: 0,
        failed: 0,
      })
    }

    // Process each job
    for (const job of jobs) {
      processed++

      try {
        // Get customer info
        const customer = await getCustomerByPhone(job.phone_number)

        if (!customer) {
          console.warn(`[Post-Cleaning Followup] No customer found for job ${job.id}`)
          results.push({
            jobId: job.id,
            success: false,
            error: 'Customer not found',
          })
          failed++
          continue
        }

        const customerName = customer.first_name || 'there'

        // Generate and send review request SMS
        const message = postCleaningReview(customerName, reviewLink)
        const smsResult = await sendSMS(job.phone_number, message)

        if (!smsResult.success) {
          console.error(`[Post-Cleaning Followup] SMS failed for job ${job.id}:`, smsResult.error)
          results.push({
            jobId: job.id,
            success: false,
            error: smsResult.error || 'SMS send failed',
          })
          failed++
          continue
        }

        // Update job with followup timestamps
        const timestamp = now.toISOString()
        const { error: updateError } = await client
          .from('jobs')
          .update({
            followup_sent_at: timestamp,
            review_requested_at: timestamp,
            updated_at: timestamp,
          })
          .eq('id', job.id)

        if (updateError) {
          console.error(`[Post-Cleaning Followup] Update failed for job ${job.id}:`, updateError)
          // SMS was sent, so we consider this a partial success
          results.push({
            jobId: job.id,
            success: true,
            error: 'SMS sent but database update failed',
          })
          succeeded++
          continue
        }

        // Log system event
        await logSystemEvent({
          source: 'cron',
          event_type: 'REVIEW_REQUEST_SENT',
          message: `Sent review request to ${customerName} for job ${job.id}`,
          job_id: job.id,
          customer_id: customer.id,
          phone_number: job.phone_number,
          metadata: {
            review_link: reviewLink,
            message_id: smsResult.messageId,
          },
        })

        results.push({
          jobId: job.id,
          success: true,
        })
        succeeded++
      } catch (jobError) {
        console.error(`[Post-Cleaning Followup] Error processing job ${job.id}:`, jobError)
        results.push({
          jobId: job.id,
          success: false,
          error: jobError instanceof Error ? jobError.message : 'Unknown error',
        })
        failed++
      }
    }

    console.log(
      `[Post-Cleaning Followup] Processed ${processed}: ${succeeded} succeeded, ${failed} failed`
    )

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      processed,
      succeeded,
      failed,
      results: results.length > 0 ? results : undefined,
    })
  } catch (error) {
    console.error('[Post-Cleaning Followup] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processed,
        succeeded,
        failed,
      },
      { status: 500 }
    )
  }
}

// POST method for QStash (QStash uses POST by default)
export async function POST(request: NextRequest) {
  return GET(request)
}
