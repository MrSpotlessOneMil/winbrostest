import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS, SMS_TEMPLATES } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getAllActiveTenants, tenantUsesFeature } from '@/lib/tenant'

// route-check:no-vercel-cron

/**
 * Follow-Up Quoted Jobs Cron
 *
 * Runs hourly. Finds jobs stuck at "quoted" (unpaid) and sends follow-up
 * SMS nudges at 1hr, 4hr, 24hr, and 3 days. After 7 days, marks as abandoned.
 *
 * This addresses the critical pipeline gap where 30+ customers "booked" on VAPI
 * calls but never received follow-up after the initial quote text.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tag = '[Follow-Up Quoted]'

  // GUARD: Only send between 9 AM and 7 PM in each tenant's timezone
  // Default to Pacific Time for safety
  const pacificHour = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
  const currentHourPT = parseInt(pacificHour)
  if (currentHourPT < 9 || currentHourPT >= 19) {
    console.log(`${tag} Outside business hours (${currentHourPT}:00 PT) — skipping`)
    return NextResponse.json({ success: true, skipped: 'outside_business_hours', currentHourPT })
  }

  console.log(`${tag} Starting follow-up check (${currentHourPT}:00 PT)...`)

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const appDomain = process.env.NEXT_PUBLIC_APP_URL || 'https://cleanmachine.live'

  const summary: Array<{ tenant: string; checked: number; nudged: number; abandoned: number }> = []

  // WinBros does NOT use automated quote follow-up — Jack handles his own outreach
  const EXCLUDED_TENANTS = ['winbros']

  for (const tenant of tenants) {
    if (EXCLUDED_TENANTS.includes(tenant.slug)) continue

    let checked = 0
    let nudged = 0
    let abandoned = 0

    // Find jobs that are quoted but not booked/paid, created in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: quotedJobs, error } = await client
      .from('jobs')
      .select('id, customer_id, phone_number, service_type, created_at, price, quote_followup_count, last_quote_followup_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'quoted')
      .eq('booked', false)
      .eq('paid', false)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true })
      .limit(30)

    if (error) {
      console.error(`${tag} Failed to query quoted jobs for ${tenant.slug}:`, error.message)
      continue
    }

    if (!quotedJobs || quotedJobs.length === 0) continue

    console.log(`${tag} Found ${quotedJobs.length} quoted jobs for ${tenant.slug}`)

    for (const job of quotedJobs) {
      checked++
      const followupCount = job.quote_followup_count || 0
      const phone = job.phone_number

      if (!phone) continue

      // Use time since LAST follow-up (not creation) to prevent rapid-fire on old jobs
      const lastAction = job.last_quote_followup_at || job.created_at
      const hoursSinceLastAction = (Date.now() - new Date(lastAction).getTime()) / (1000 * 60 * 60)

      // Determine which follow-up to send — each step requires minimum gap since LAST action
      let templateFn: ((name: string, url: string) => string) | null = null
      let followupStep = 0

      if (followupCount === 0 && hoursSinceLastAction >= 1) {
        templateFn = SMS_TEMPLATES.quoteFollowUp1hr
        followupStep = 1
      } else if (followupCount === 1 && hoursSinceLastAction >= 3) {
        // 3 hours after first follow-up (not 4 hours after creation)
        templateFn = SMS_TEMPLATES.quoteFollowUp4hr
        followupStep = 2
      } else if (followupCount === 2 && hoursSinceLastAction >= 20) {
        // ~20 hours after second follow-up (next day)
        templateFn = SMS_TEMPLATES.quoteFollowUp24hr
        followupStep = 3
      } else if (followupCount === 3 && hoursSinceLastAction >= 48) {
        // 2 days after third follow-up
        templateFn = SMS_TEMPLATES.quoteFollowUp3day
        followupStep = 4
      }

      if (!templateFn) continue

      // Get customer name
      const { data: customer } = await client
        .from('customers')
        .select('first_name')
        .eq('id', job.customer_id)
        .single()

      const name = customer?.first_name || ''

      // Find existing quote URL — if no quote exists, skip this job (nothing to link to)
      const { data: existingQuote } = await client
        .from('quotes')
        .select('token')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!existingQuote?.token) {
        console.log(`${tag} No quote found for job ${job.id} — skipping follow-up (no link to send)`)
        continue
      }

      const quoteUrl = `${appDomain}/quote/${existingQuote.token}`

      const message = templateFn(name, quoteUrl)

      // Pre-insert message record before sending
      const nowIso = new Date().toISOString()
      const { data: msgRecord } = await client.from('messages').insert({
        tenant_id: tenant.id,
        customer_id: job.customer_id,
        phone_number: phone,
        role: 'assistant',
        content: message,
        direction: 'outbound',
        message_type: 'sms',
        ai_generated: false,
        timestamp: nowIso,
        source: `quote_followup_step_${followupStep}`,
      }).select('id').single()

      const smsResult = await sendSMS(tenant, phone, message, { skipDedup: true })

      if (smsResult.success) {
        nudged++
        console.log(`${tag} Sent step ${followupStep} follow-up to ${phone} for job ${job.id}`)

        // Update job with follow-up tracking
        await client
          .from('jobs')
          .update({
            quote_followup_count: followupStep,
            last_quote_followup_at: nowIso,
          })
          .eq('id', job.id)
      } else {
        console.error(`${tag} Failed to send follow-up to ${phone}:`, smsResult.error)
        // Clean up pre-inserted message
        if (msgRecord?.id) {
          await client.from('messages').delete().eq('id', msgRecord.id)
        }
      }
    }

    // Abandon jobs older than 7 days that are still quoted
    const { data: staleJobs } = await client
      .from('jobs')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'quoted')
      .eq('booked', false)
      .eq('paid', false)
      .lt('created_at', sevenDaysAgo)
      .limit(50)

    if (staleJobs && staleJobs.length > 0) {
      const staleIds = staleJobs.map(j => j.id)
      await client
        .from('jobs')
        .update({ status: 'cancelled', notes: 'Auto-abandoned: no payment after 7 days of follow-up' })
        .in('id', staleIds)
      abandoned = staleIds.length
      console.log(`${tag} Abandoned ${abandoned} stale quoted jobs for ${tenant.slug}`)
    }

    if (checked > 0 || abandoned > 0) {
      summary.push({ tenant: tenant.slug, checked, nudged, abandoned })
    }
  }

  if (summary.length > 0) {
    await logSystemEvent({
      source: 'cron',
      event_type: 'QUOTE_FOLLOWUP_RUN',
      message: `Quote follow-up cron: ${summary.map(s => `${s.tenant}: ${s.nudged} nudged, ${s.abandoned} abandoned`).join('; ')}`,
      metadata: { summary },
    })
  }

  console.log(`${tag} Done.`, summary)
  return NextResponse.json({ success: true, summary })
}
