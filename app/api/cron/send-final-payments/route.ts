/**
 * Send Final Payments Cron Job
 *
 * QStash endpoint that runs every 15 minutes to check for jobs
 * that have passed their scheduled final payment time and sends
 * the final payment link automatically.
 *
 * Triggered by: QStash schedule (every 15 minutes)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAllJobs, updateJob } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'

// Import the complete-job logic
import { POST as completeJobAction } from '@/app/api/actions/complete-job/route'

function extractScheduledFinalPayment(notes?: string): Date | null {
  if (!notes) return null
  const match = notes.match(/SCHEDULED_FINAL_PAYMENT:\s*([^\n]+)/)
  if (!match) return null
  const timestamp = match[1].trim()
  const date = new Date(timestamp)
  return isNaN(date.getTime()) ? null : date
}

async function handleRequest(request: NextRequest) {
  const now = new Date()

  // Get all jobs with status scheduled or in_progress
  const jobs = await getAllJobs()
  const eligibleJobs = jobs.filter(job =>
    (job.status === 'scheduled' || job.status === 'in_progress') &&
    job.paid === true &&
    job.notes?.includes('SCHEDULED_FINAL_PAYMENT')
  )

  console.log(`Checking ${eligibleJobs.length} jobs for final payment scheduling`)

  let sentCount = 0
  const errors: Array<{ jobId: string; error: string }> = []

  for (const job of eligibleJobs) {
    const scheduledTime = extractScheduledFinalPayment(job.notes)

    if (!scheduledTime || scheduledTime > now) {
      continue // Not yet time
    }

    // Check if final payment already sent (job is completed)
    if (job.status === 'completed') {
      // Remove the scheduled tag since it's done
      const updatedNotes = (job.notes || '').replace(/SCHEDULED_FINAL_PAYMENT:[^\n]+\n?/, '')
      await updateJob(job.id!, { notes: updatedNotes })
      continue
    }

    try {
      // Call complete-job action
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

      // Remove scheduled tag from notes
      const updatedNotes = (job.notes || '').replace(/SCHEDULED_FINAL_PAYMENT:[^\n]+\n?/, '')
      await updateJob(job.id!, { notes: updatedNotes })

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

  return NextResponse.json({
    success: true,
    checked: eligibleJobs.length,
    sent: sentCount,
    errors: errors.length > 0 ? errors : undefined,
  })
}

// Apply QStash signature verification if configured
export const POST = (async (request: NextRequest) => {
  // Check if QStash is configured
  const qstashKey = process.env.QSTASH_CURRENT_SIGNING_KEY

  if (qstashKey) {
    // Dynamically import and apply verification
    const { verifySignatureAppRouter } = await import('@upstash/qstash/nextjs')
    return verifySignatureAppRouter(handleRequest)(request)
  }

  // No QStash verification - just run the handler
  return handleRequest(request)
}) as (request: NextRequest) => Promise<Response>

export async function GET() {
  return NextResponse.json({
    endpoint: 'send-final-payments',
    schedule: 'Every 15 minutes via QStash',
    description: 'Automatically sends final payment links for completed jobs',
  })
}
