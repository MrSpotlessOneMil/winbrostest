import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, getTenantServiceDescription, tenantUsesFeature, getCleanerPhoneSet, isCleanerPhone } from '@/lib/tenant'
import { canSendToCustomer, recordMessageSent } from '@/lib/lifecycle-engine'

/**
 * Lifecycle Re-engagement Cron
 *
 * Replaces: frequency-nudge, monthly-reengagement, monthly-followup
 *
 * Runs daily at 6pm UTC. Per tenant:
 * 1. Query customers with last completed job 30+ days ago, no upcoming jobs
 * 2. Check canSendToCustomer (30-day cooldown for reengagement phase)
 * 3. Escalating offers: 30d = nudge, 60d = 10%, 90d = 15%, 120+ = 20%
 * 4. Skip customers with post_job_stage = 'recurring_accepted'
 *
 * Schedule: 0 18 * * *
 */

// route-check:no-vercel-cron

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Lifecycle Reengagement] Starting...')

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  const summary: Array<{ tenant: string; sent: number; skipped: number; errors: number }> = []

  for (const tenant of tenants) {
    if (!tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
      continue
    }

    let sent = 0
    let skipped = 0
    let errors = 0

    try {
      const serviceDesc = getTenantServiceDescription(tenant)
      const businessName = tenant.business_name_short || tenant.name || 'us'
      const defaultDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'

      // Find customers with last completed job 30+ days ago
      // who don't have upcoming jobs and haven't opted into recurring
      const { data: candidates, error: queryError } = await client
        .from('customers')
        .select(`
          id, first_name, phone_number, post_job_stage, sms_opt_out,
          jobs!inner(id, completed_at, status)
        `)
        .eq('tenant_id', tenant.id)
        .neq('post_job_stage', 'recurring_accepted')
        .not('phone_number', 'is', null)

      if (queryError) {
        console.error(`[Lifecycle Reengagement] Query error for ${tenant.slug}:`, queryError.message)
        continue
      }

      if (!candidates || candidates.length === 0) continue

      // Filter to customers whose MOST RECENT completed job is 30+ days ago
      // and who have no upcoming scheduled jobs
      const now = Date.now()
      const eligibleCustomers: Array<{
        id: number
        first_name: string | null
        phone_number: string
        daysSinceLastJob: number
      }> = []

      for (const cust of candidates) {
        if ((cust as any).sms_opt_out) continue

        const jobs = cust.jobs as Array<{ id: number; completed_at: string | null; status: string }>
        if (!jobs || jobs.length === 0) continue

        // Check for upcoming jobs
        const hasUpcoming = jobs.some(j => ['scheduled', 'in_progress', 'pending'].includes(j.status))
        if (hasUpcoming) continue

        // Find most recent completed job
        const completedJobs = jobs.filter(j => j.status === 'completed' && j.completed_at)
        if (completedJobs.length === 0) continue

        const latestCompleted = completedJobs.reduce((latest, j) =>
          new Date(j.completed_at!).getTime() > new Date(latest.completed_at!).getTime() ? j : latest
        )

        const daysSince = (now - new Date(latestCompleted.completed_at!).getTime()) / (24 * 60 * 60 * 1000)
        if (daysSince >= 30) {
          eligibleCustomers.push({
            id: cust.id,
            first_name: cust.first_name,
            phone_number: cust.phone_number,
            daysSinceLastJob: Math.floor(daysSince),
          })
        }
      }

      // --- Pass 2: Never-booked customers who completed retargeting 30+ days ago ---
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

      const { data: neverBookedCandidates } = await client
        .from('customers')
        .select('id, first_name, phone_number, retargeting_completed_at, sms_opt_out')
        .eq('tenant_id', tenant.id)
        .not('phone_number', 'is', null)
        .eq('retargeting_stopped_reason', 'completed')
        .not('retargeting_completed_at', 'is', null)
        .lte('retargeting_completed_at', thirtyDaysAgo)
        .neq('post_job_stage', 'recurring_accepted')

      if (neverBookedCandidates && neverBookedCandidates.length > 0) {
        for (const nb of neverBookedCandidates) {
          if (nb.sms_opt_out) continue

          // Confirm they have NO completed jobs (truly never-booked)
          const { data: completedJob } = await client
            .from('jobs')
            .select('id')
            .eq('customer_id', nb.id)
            .eq('status', 'completed')
            .limit(1)
            .maybeSingle()

          if (completedJob) continue // has completed jobs — handled by pass 1

          // Already in eligible list? skip
          if (eligibleCustomers.some(e => e.id === nb.id)) continue

          const daysSinceRetargeting = Math.floor(
            (now - new Date(nb.retargeting_completed_at!).getTime()) / (24 * 60 * 60 * 1000)
          )

          eligibleCustomers.push({
            id: nb.id,
            first_name: nb.first_name,
            phone_number: nb.phone_number,
            daysSinceLastJob: daysSinceRetargeting, // reuse field for discount escalation
          })
        }
      }

      // Filter out cleaner phone numbers so cleaners never get customer retargeting
      const cleanerPhones = await getCleanerPhoneSet(tenant.id)
      const filteredCustomers = eligibleCustomers.filter(c => !isCleanerPhone(c.phone_number, cleanerPhones))

      console.log(`[Lifecycle Reengagement] ${tenant.slug}: ${filteredCustomers.length} eligible customers (${eligibleCustomers.length - filteredCustomers.length} cleaners excluded)`)

      for (const cust of filteredCustomers) {
        try {
          // Check cooldown (30 days = 720 hours)
          const canSend = await canSendToCustomer(cust.id, 'reengagement', 720, tenant.id)
          if (!canSend) {
            skipped++
            continue
          }

          const firstName = cust.first_name || 'there'

          // Escalating offers based on days since last job
          let message: string
          if (cust.daysSinceLastJob < 60) {
            // 30-59 days: standard nudge
            message = `Hi ${firstName}! It's been a while since your last ${serviceDesc} with ${businessName}. We'd love to have you back — we have openings this week! Reply YES to book.`
          } else if (cust.daysSinceLastJob < 90) {
            // 60-89 days: 10% discount
            message = `Hey ${firstName}, we miss you! It's been ${Math.round(cust.daysSinceLastJob / 7)} weeks since your last ${serviceDesc}. Book this week and get 10% off! Reply YES to grab a spot.`
          } else if (cust.daysSinceLastJob < 120) {
            // 90-119 days: 15% discount
            message = `Hi ${firstName}, it's been a while! We'd love to welcome you back to ${businessName}. Book your ${serviceDesc} this week and get ${defaultDiscount} off. Reply YES!`
          } else {
            // 120+ days: 20% discount
            message = `Hey ${firstName}! We haven't seen you in a while and would love to have you back. Book your next ${serviceDesc} with ${businessName} and get 20% off — our biggest discount! Reply YES.`
          }

          const result = await sendSMS(tenant, cust.phone_number, message)

          if (result.success) {
            await recordMessageSent(tenant.id, cust.id, cust.phone_number, 'lifecycle_reengagement', 'reengagement')
            sent++
          } else {
            errors++
          }
        } catch (err) {
          console.error(`[Lifecycle Reengagement] Error for customer ${cust.id}:`, err)
          errors++
        }
      }
    } catch (err) {
      console.error(`[Lifecycle Reengagement] Error for ${tenant.slug}:`, err)
    }

    if (sent > 0 || errors > 0) {
      summary.push({ tenant: tenant.slug, sent, skipped, errors })
    }
  }

  const totalSent = summary.reduce((sum, s) => sum + s.sent, 0)
  console.log(`[Lifecycle Reengagement] Done. Total sent: ${totalSent}`)

  return NextResponse.json({ success: true, summary, totalSent })
}
