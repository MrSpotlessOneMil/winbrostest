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
import { getAllJobs, updateJob, getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'

// Import the complete-job logic (existing pattern) and retry-payment core function
import { POST as completeJobAction } from '@/app/api/actions/complete-job/route'
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

  const jobs = await getAllJobs(undefined, serviceClient)

  // --- Part 1: Scheduled final payments (existing logic) ---
  const scheduledJobs = jobs.filter(job =>
    (job.status === 'scheduled' || job.status === 'in_progress') &&
    job.paid === true &&
    job.notes?.includes('SCHEDULED_FINAL_PAYMENT')
  )

  console.log(`[send-final-payments] Checking ${scheduledJobs.length} jobs for scheduled final payment`)

  let sentCount = 0
  const errors: Array<{ jobId: string; error: string }> = []

  for (const job of scheduledJobs) {
    const scheduledTime = extractScheduledFinalPayment(job.notes)

    if (!scheduledTime || scheduledTime > now) {
      continue // Not yet time
    }

    if (job.status === 'completed') {
      const updatedNotes = (job.notes || '').replace(/SCHEDULED_FINAL_PAYMENT:[^\n]+\n?/, '')
      await updateJob(job.id!, { notes: updatedNotes }, {}, serviceClient)
      continue
    }

    try {
      const mockRequest = new Request('http://localhost/api/actions/complete-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })

      const response = await completeJobAction(mockRequest as NextRequest)
      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Complete job failed')
      }

      const updatedNotes = (job.notes || '').replace(/SCHEDULED_FINAL_PAYMENT:[^\n]+\n?/, '')
      await updateJob(job.id!, { notes: updatedNotes }, {}, serviceClient)

      sentCount++

      await logSystemEvent({
        source: 'cron',
        event_type: 'AUTO_FINAL_PAYMENT_SENT',
        message: `Automatic final payment sent for job ${job.id}`,
        job_id: job.id,
        customer_id: job.customer_id,
        phone_number: job.phone_number,
        metadata: {
          scheduled_time: scheduledTime.toISOString(),
          actual_time: now.toISOString(),
        },
      })
    } catch (error) {
      console.error(`Failed to send final payment for job ${job.id}:`, error)
      errors.push({
        jobId: job.id!,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // --- Part 2: Auto-retry failed payments ---
  const failedJobs = jobs.filter(job =>
    job.payment_status === 'payment_failed' &&
    job.notes?.includes('PAYMENT_FAILED:')
  )

  console.log(`[send-final-payments] Checking ${failedJobs.length} jobs for payment retry`)

  let retryCount = 0

  for (const job of failedJobs) {
    const retries = extractRetryCount(job.notes)
    const failedAt = extractPaymentFailedTime(job.notes)

    // Stop after MAX_AUTO_RETRIES
    if (retries >= MAX_AUTO_RETRIES) {
      continue
    }

    // Wait at least RETRY_INTERVAL_MS since failure before retrying
    if (!failedAt || (now.getTime() - failedAt.getTime()) < RETRY_INTERVAL_MS) {
      continue
    }

    try {
      const result = await executeRetryPayment(job.id!)

      if (!result.success) {
        throw new Error(result.error || 'Retry payment failed')
      }

      retryCount++

      await logSystemEvent({
        source: 'cron',
        event_type: 'PAYMENT_RETRY_SENT',
        message: `Auto-retry #${retries + 1} sent for job ${job.id}`,
        job_id: job.id,
        customer_id: job.customer_id,
        phone_number: job.phone_number,
        metadata: {
          retry_number: retries + 1,
          max_retries: MAX_AUTO_RETRIES,
          failed_at: failedAt.toISOString(),
        },
      })
    } catch (error) {
      console.error(`Failed to retry payment for job ${job.id}:`, error)
      errors.push({
        jobId: job.id!,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return NextResponse.json({
    success: true,
    scheduled_checked: scheduledJobs.length,
    scheduled_sent: sentCount,
    failed_checked: failedJobs.length,
    retries_sent: retryCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  return executeHandler()
}

export async function POST(request: NextRequest) {
  return GET(request)
}
