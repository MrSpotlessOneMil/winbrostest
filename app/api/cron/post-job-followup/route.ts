import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { postJobFollowup } from '@/lib/sms-templates'
import { logSystemEvent } from '@/lib/system-events'
import { getDefaultTenant } from '@/lib/tenant'

/**
 * Post-Job Follow-up Cron
 *
 * Runs every 15 minutes to check for completed jobs that need follow-up.
 * Sends combined message: review request + recurring offer + tip prompt
 *
 * Timing: 2 hours after job completion
 */
export async function GET(request: NextRequest) {
  // Verify this is a legitimate cron request
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Post-Job Followup] Starting cron job...')

  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()

  if (!tenant) {
    console.error('[Post-Job Followup] No tenant configured')
    return NextResponse.json({ error: 'No tenant configured' }, { status: 500 })
  }

  // Find jobs completed more than 2 hours ago that haven't had followup sent
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

  const { data: jobs, error } = await client
    .from('jobs')
    .select(`
      id,
      customer_id,
      phone_number,
      team_id,
      completed_at,
      followup_sent_at,
      customers (
        id,
        first_name,
        last_name,
        phone_number
      )
    `)
    .eq('tenant_id', tenant.id)
    .eq('status', 'completed')
    .is('followup_sent_at', null)
    .not('completed_at', 'is', null)
    .lt('completed_at', twoHoursAgo)
    .limit(20) // Process in batches to avoid timeout

  if (error) {
    console.error('[Post-Job Followup] Failed to fetch jobs:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    console.log('[Post-Job Followup] No jobs need follow-up')
    return NextResponse.json({ success: true, processed: 0 })
  }

  console.log(`[Post-Job Followup] Found ${jobs.length} jobs to follow up`)

  let processed = 0
  let errors = 0

  for (const job of jobs) {
    try {
      const customer = Array.isArray(job.customers) ? job.customers[0] : job.customers
      const phone = customer?.phone_number || job.phone_number
      const customerName = customer?.first_name || 'there'

      if (!phone) {
        console.warn(`[Post-Job Followup] No phone for job ${job.id}, skipping`)
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
      const tipLink = `https://spotless-scrubbers-api.vercel.app/tip/${job.id}`
      const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'

      // Send the combined follow-up message
      const message = postJobFollowup(
        customerName,
        cleanerName,
        reviewLink,
        tipLink,
        recurringDiscount
      )

      const smsResult = await sendSMS(phone, message)

      if (smsResult.success) {
        // Mark follow-up as sent
        await client
          .from('jobs')
          .update({ followup_sent_at: new Date().toISOString() })
          .eq('id', job.id)

        await logSystemEvent({
          source: 'cron',
          event_type: 'POST_JOB_FOLLOWUP_SENT',
          message: `Post-job follow-up sent for job ${job.id}`,
          job_id: String(job.id),
          phone_number: phone,
          metadata: {
            customer_name: customerName,
            cleaner_name: cleanerName,
          },
        })

        processed++
        console.log(`[Post-Job Followup] Sent follow-up for job ${job.id}`)
      } else {
        console.error(`[Post-Job Followup] Failed to send SMS for job ${job.id}:`, smsResult.error)
        errors++
      }
    } catch (err) {
      console.error(`[Post-Job Followup] Error processing job ${job.id}:`, err)
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
