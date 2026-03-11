import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'
import { scheduleRetargetingSequence, type RetargetingSequenceType } from '@/lib/scheduler'

/**
 * Lifecycle Auto-Enrollment Cron
 *
 * Refreshes customer lifecycle stages and auto-enrolls unenrolled customers
 * in matching retargeting sequences.
 *
 * Targets: unresponsive, quoted_not_booked, one_time, lapsed
 * Cap: 20 enrollments per tenant per run
 *
 * Schedule: 0 15 * * * (3pm UTC daily)
 */

const ENROLLABLE_STAGES: RetargetingSequenceType[] = [
  'unresponsive',
  'quoted_not_booked',
  'one_time',
  'lapsed',
]

const MAX_ENROLLMENTS_PER_TENANT = 20

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Lifecycle Auto-Enroll] Starting...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; enrolled: number; skipped: number }> = []

  for (const tenant of tenants) {
    if (!tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
      continue
    }

    let enrolled = 0
    let skipped = 0

    try {
      // Refresh lifecycle stages
      await client.rpc('refresh_customer_lifecycles', { p_tenant_id: tenant.id })

      // Find customers eligible for auto-enrollment
      const { data: candidates, error: queryError } = await client
        .from('customers')
        .select('id, first_name, last_name, phone_number, lifecycle_stage, retargeting_sequence, retargeting_stopped_reason, sms_opt_out')
        .eq('tenant_id', tenant.id)
        .in('lifecycle_stage', ENROLLABLE_STAGES)
        .not('phone_number', 'is', null)
        .order('updated_at', { ascending: true })
        .limit(100) // fetch more than cap to account for filtering

      if (queryError) {
        console.error(`[Lifecycle Auto-Enroll] Query error for ${tenant.slug}:`, queryError.message)
        continue
      }

      if (!candidates || candidates.length === 0) continue

      for (const cust of candidates) {
        if (enrolled >= MAX_ENROLLMENTS_PER_TENANT) break

        // Skip opted-out customers
        if (cust.sms_opt_out) {
          skipped++
          continue
        }

        const stage = cust.lifecycle_stage as RetargetingSequenceType

        // Skip if currently in an active sequence
        if (cust.retargeting_sequence && !cust.retargeting_stopped_reason) {
          skipped++
          continue
        }

        // Skip if they completed the SAME sequence they'd be enrolled in
        // (prevents re-enrollment in the same sequence)
        if (
          cust.retargeting_stopped_reason === 'completed' &&
          cust.retargeting_sequence === stage
        ) {
          skipped++
          continue
        }

        // Never enrolled, or completed a DIFFERENT sequence → eligible
        const customerName = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || 'there'

        try {
          await scheduleRetargetingSequence(
            tenant.id,
            cust.id,
            cust.phone_number,
            customerName,
            stage,
          )
          enrolled++
          console.log(`[Lifecycle Auto-Enroll] Enrolled customer ${cust.id} in ${stage} (${tenant.slug})`)
        } catch (err) {
          console.error(`[Lifecycle Auto-Enroll] Failed to enroll customer ${cust.id}:`, err)
        }
      }
    } catch (err) {
      console.error(`[Lifecycle Auto-Enroll] Error for ${tenant.slug}:`, err)
    }

    if (enrolled > 0 || skipped > 0) {
      summary.push({ tenant: tenant.slug, enrolled, skipped })
    }
  }

  const totalEnrolled = summary.reduce((sum, s) => sum + s.enrolled, 0)
  console.log(`[Lifecycle Auto-Enroll] Done. Total enrolled: ${totalEnrolled}`)

  return NextResponse.json({ success: true, summary, totalEnrolled })
}
