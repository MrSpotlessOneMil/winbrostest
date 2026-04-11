/**
 * Send Final Payments Cron Job
 *
 * Vercel Cron endpoint that runs every 15 minutes to:
 * 1. Send final payment links for jobs past their scheduled time
 * 2. Auto-retry failed payments (up to 3 retries, 24h apart)
 *
 * Triggered by: Vercel Cron (every 15 minutes)
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { updateJob, getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'
import { isBusinessHours } from '@/lib/config'

// Import extracted core functions — called directly, no mock-request needed
import { executeCompleteJob } from '@/app/api/actions/complete-job/route'
import { executeRetryPayment } from '@/app/api/actions/retry-payment/route'

const MAX_AUTO_RETRIES = 3
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

function extractScheduledFinalPayment(notes?: string): Date | null {
  if (!notes) return null
  const match = notes.match(/SCHEDULED_FINAL_PAYMENT:\s*([^\n]+)/)
  if (!match) return null
  const timestamp = match[1].trim()
  const date = new Date(timestamp)
  return isNaN(date.getTime()) ? null : date
}

function extractPaymentFailedTime(notes?: string): Date | null {
  if (!notes) return null
  const match = notes.match(/PAYMENT_FAILED:\s*([^\s|]+)/)
  if (!match) return null
  const date = new Date(match[1].trim())
  return isNaN(date.getTime()) ? null : date
}

function extractRetryCount(notes?: string): number {
  if (!notes) return 0
  const match = notes.match(/PAYMENT_RETRY_COUNT:\s*(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

async function executeHandler() {
  const now = new Date()

  // Use service client — crons don't have tenant JWT, anon key is blocked by RLS
  const serviceClient = getSupabaseServiceClient()

  let sentCount = 0
  let retryCountTotal = 0
  const errors: Array<{ jobId: string; error: string }> = []

  // --- Part 1: Atomically claim scheduled final payment jobs via RPC ---
  const { data: claimedScheduled, error: schedErr } = await serviceClient
    .rpc('claim_jobs_for_final_payments', { p_batch_size: 20 })

  if (schedErr) {
    console.error('[send-final-payments] RPC claim_jobs_for_final_payments error:', schedErr)
  }

  const scheduledRows = claimedScheduled || []
  console.log(`[send-final-payments] Claimed ${scheduledRows.length} jobs for scheduled final payment`)

  for (const row of scheduledRows) {
    const jobId = String(row.job_id)
    const scheduledTime = extractScheduledFinalPayment(row.job_notes)

    if (!scheduledTime || scheduledTime > now) {
      // Not yet time — release claim
      await updateJob(jobId, { final_payment_claimed_at: null } as Record<string, unknown>, {}, serviceClient)
      continue
    }

    try {
      const result = await executeCompleteJob(jobId)

      if (!result.success) {
        throw new Error(result.error || 'Complete job failed')
      }

      // Clear the SCHEDULED_FINAL_PAYMENT marker
      const updatedNotes = (row.job_notes || '').replace(/SCHEDULED_FINAL_PAYMENT:[^\n]+\n?/, '')
      await updateJob(jobId, { notes: updatedNotes }, {}, serviceClient)

      sentCount++

      await logSystemEvent({
        source: 'cron',
        event_type: 'AUTO_FINAL_PAYMENT_SENT',
        message: `Automatic final payment sent for job ${jobId}`,
        job_id: jobId,
        customer_id: row.customer_id,
        phone_number: row.phone_number,
        metadata: {
          scheduled_time: scheduledTime.toISOString(),
          actual_time: now.toISOString(),
        },
      })
    } catch (error) {
      console.error(`Failed to send final payment for job ${jobId}:`, error)
      // Release claim on failure so next cron run can retry
      await updateJob(jobId, { final_payment_claimed_at: null } as Record<string, unknown>, {}, serviceClient)
      errors.push({
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // --- Part 2: Atomically claim failed payment jobs for auto-retry via RPC ---
  const { data: claimedFailed, error: failErr } = await serviceClient
    .rpc('claim_failed_payments_for_retry', { p_batch_size: 20 })

  if (failErr) {
    console.error('[send-final-payments] RPC claim_failed_payments_for_retry error:', failErr)
  }

  const failedRows = claimedFailed || []
  console.log(`[send-final-payments] Claimed ${failedRows.length} jobs for payment retry`)

  for (const row of failedRows) {
    const jobId = String(row.job_id)
    const retries = extractRetryCount(row.job_notes)
    const failedAt = extractPaymentFailedTime(row.job_notes)

    // Stop after MAX_AUTO_RETRIES
    if (retries >= MAX_AUTO_RETRIES) {
      // Release claim — this job has exhausted retries
      await updateJob(jobId, { payment_retry_claimed_at: null } as Record<string, unknown>, {}, serviceClient)
      continue
    }

    // Wait at least RETRY_INTERVAL_MS since failure before retrying
    if (!failedAt || (now.getTime() - failedAt.getTime()) < RETRY_INTERVAL_MS) {
      // Release claim — not yet time
      await updateJob(jobId, { payment_retry_claimed_at: null } as Record<string, unknown>, {}, serviceClient)
      continue
    }

    try {
      const result = await executeRetryPayment(jobId)

      if (!result.success) {
        throw new Error(result.error || 'Retry payment failed')
      }

      retryCountTotal++

      await logSystemEvent({
        source: 'cron',
        event_type: 'PAYMENT_RETRY_SENT',
        message: `Auto-retry #${retries + 1} sent for job ${jobId}`,
        job_id: jobId,
        customer_id: row.customer_id,
        phone_number: row.phone_number,
        metadata: {
          retry_number: retries + 1,
          max_retries: MAX_AUTO_RETRIES,
          failed_at: failedAt.toISOString(),
        },
      })
    } catch (error) {
      console.error(`Failed to retry payment for job ${jobId}:`, error)
      // Release claim on failure so next cron run can retry
      await updateJob(jobId, { payment_retry_claimed_at: null } as Record<string, unknown>, {}, serviceClient)
      errors.push({
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    scheduled_claimed: scheduledRows.length,
    scheduled_sent: sentCount,
    failed_claimed: failedRows.length,
    retries_sent: retryCountTotal,
    errors: errors.length > 0 ? errors : undefined,
  })
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  // Don't send payment requests outside business hours (9am-5pm)
  if (!isBusinessHours()) {
    return NextResponse.json({ success: true, skipped: true, reason: 'Outside business hours' })
  }

  return executeHandler()
}

export async function POST(request: NextRequest) {
  return GET(request)
}
