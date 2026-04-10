/**
 * Monthly Re-engagement Follow-up Cron Job
 *
 * Sends re-engagement SMS to customers 30 days after their last completed service.
 * Skips customers who have booked another job since.
 *
 * Loops all active tenants; respects monthly_followup_enabled + use_retargeting flags.
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
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'

export async function GET(request: NextRequest) {
  // DISABLED 2026-04-02: Overlaps with lifecycle-auto-enroll retargeting sequences.
  // Multiple re-engagement crons were bombarding the same customers.
  return NextResponse.json({ success: true, disabled: true, reason: 'Overlaps with lifecycle-auto-enroll retargeting' })

  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  return executeMonthlyFollowup()
}

async function executeMonthlyFollowup() {
  try {
    const now = new Date()
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()

    const summary: Array<{ tenant: string; sent: number; skipped: number; errors: number }> = []

    for (const tenant of tenants) {
      // Skip tenants that don't want monthly follow-up or retargeting
      if (!tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
        console.log(`[Monthly Follow-up Cron] Skipping ${tenant.slug} (monthly_followup_enabled=false)`)
        continue
      }
      if (!tenantUsesFeature(tenant, 'use_retargeting')) {
        console.log(`[Monthly Follow-up Cron] Skipping ${tenant.slug} (use_retargeting=false)`)
        continue
      }

      const discount = tenant.workflow_config?.monthly_followup_discount || '15%'

      // Atomically claim eligible jobs scoped to this tenant using FOR UPDATE SKIP LOCKED
      const { data: eligibleJobs, error: queryError } = await client.rpc(
        'claim_jobs_for_monthly_followup',
        { p_batch_size: 100, p_tenant_id: tenant.id }
      )

      if (queryError) {
        console.error(`[Monthly Follow-up Cron] Query error for ${tenant.slug}:`, queryError)
        continue
      }

      console.log(`[Monthly Follow-up Cron] Claimed ${(eligibleJobs || []).length} jobs for ${tenant.slug}`)

      let sent = 0
      let skipped = 0
      let errors = 0

      for (const job of (eligibleJobs || [])) {
        try {
          // Check if customer has booked another job since this one was completed
          const { data: subsequentJobs } = await client
            .from('jobs')
            .select('id')
            .eq('customer_id', job.customer_id)
            .eq('tenant_id', tenant.id)
            .in('status', ['scheduled', 'completed'])
            .gt('created_at', job.completed_at)
            .limit(1)

          if (subsequentJobs && subsequentJobs.length > 0) {
            console.log(`[Monthly Follow-up Cron] Skipping job ${job.job_id} - customer has subsequent booking`)
            skipped++
            continue
          }

          const phone = job.customer_phone || job.job_phone_number
          const customerName = job.customer_first_name || 'there'

          if (!phone) {
            console.warn(`[Monthly Follow-up Cron] No phone for job ${job.job_id}`)
            errors++
            continue
          }

          // Send re-engagement SMS using correct tenant's phone number
          const message = monthlyFollowup(customerName, discount)
          const smsResult = await sendSMS(tenant, phone, message)

          if (!smsResult.success) {
            // SMS failed — reset so it gets retried
            await client
              .from('jobs')
              .update({ monthly_followup_sent_at: null })
              .eq('id', job.job_id)

            console.error(`[Monthly Follow-up Cron] SMS failed for job ${job.job_id}:`, smsResult.error)
            errors++
            continue
          }

          // monthly_followup_sent_at already set by RPC
          await logSystemEvent({
            source: 'cron',
            event_type: 'REVIEW_REQUEST_SENT',
            message: `Monthly re-engagement SMS sent to ${customerName} (${phone}) with ${discount} discount`,
            tenant_id: tenant.id,
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

          sent++
          console.log(`[Monthly Follow-up Cron] Sent re-engagement SMS for job ${job.job_id} to ${phone}`)
        } catch (error) {
          console.error(`[Monthly Follow-up Cron] Error processing job ${job.job_id}:`, error)
          errors++
        }
      }

      summary.push({ tenant: tenant.slug, sent, skipped, errors })
      console.log(`[Monthly Follow-up Cron] ${tenant.slug}: Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`)
    }

    const totalSent = summary.reduce((sum, s) => sum + s.sent, 0)
    const totalErrors = summary.reduce((sum, s) => sum + s.errors, 0)

    console.log(`[Monthly Follow-up Cron] Done. Total sent: ${totalSent}, Total errors: ${totalErrors}`)

    return NextResponse.json({
      success: true,
      sent: totalSent,
      errors: totalErrors,
      tenants: summary,
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
