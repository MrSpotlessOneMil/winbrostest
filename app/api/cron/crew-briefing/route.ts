/**
 * Crew Briefing Cron
 *
 * Sends a morning briefing to all active team leads via SMS.
 * Includes: today's job count, yesterday's upsell total, and any
 * jobs still needing crew assignment.
 *
 * Also runs daily alert checks (underfilled days, stacked reschedules).
 *
 * Called by unified-daily cron at 8am PST.
 */
// route-check:no-vercel-cron

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { sendSMS } from '@/lib/openphone'
import { runDailyAlertChecks } from '@/lib/winbros-alerts'
import { getTenantById } from '@/lib/tenant'

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseClient()
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const results = {
    briefingsSent: 0,
    briefingErrors: 0,
    alertsCreated: 0,
  }

  try {
    // 1. Run daily alert checks (underfilled days, rain days)
    const alertResult = await runDailyAlertChecks()
    results.alertsCreated = alertResult.alertsCreated
    console.log(`[crew-briefing] Alert checks done — ${alertResult.alertsCreated} alert(s) created`)

    // 2. Fetch all active team leads with a phone number
    const { data: teamLeads, error: leadErr } = await client
      .from('cleaners')
      .select('id, name, phone, team_id, tenant_id, portal_token, is_team_lead, employee_type')
      .eq('active', true)
      .not('phone', 'is', null)

    if (leadErr || !teamLeads?.length) {
      console.log('[crew-briefing] No active cleaners/technicians with phone numbers found')
      return NextResponse.json({ success: true, results })
    }

    // Group by tenant to check if tenant has team leads. If not, send to all active workers.
    const tenantHasLeads: Record<string, boolean> = {}
    for (const lead of teamLeads) {
      if (lead.is_team_lead && lead.tenant_id) {
        tenantHasLeads[lead.tenant_id] = true
      }
    }

    // Filter: team leads always get briefing. Non-leads only if their tenant has no leads.
    const briefingRecipients = teamLeads.filter(lead => {
      if (lead.is_team_lead) return true
      // Include all active workers for tenants without team structure
      return lead.tenant_id && !tenantHasLeads[lead.tenant_id]
    })

    // 3. For each recipient, build and send the briefing
    for (const lead of briefingRecipients) {
      try {
        // Resolve tenant for this cleaner (used for SMS + query scoping)
        const leadTenantId = lead.tenant_id
        const tenant = leadTenantId ? await getTenantById(leadTenantId) : null

        // Today's jobs for this team/worker (scoped by tenant)
        let todaysJobsQuery = client
          .from('jobs')
          .select('id, scheduled_at, address, status, service_type')
          .eq('date', today)
          .order('scheduled_at')
        if (leadTenantId) todaysJobsQuery = todaysJobsQuery.eq('tenant_id', leadTenantId)
        // Scope by team if team lead; otherwise show all tenant jobs
        if (lead.team_id && lead.is_team_lead) {
          todaysJobsQuery = todaysJobsQuery.eq('team_id', lead.team_id)
        }
        const { data: todaysJobs } = await todaysJobsQuery

        // Jobs needing crew assignment (scoped by tenant)
        let unassignedQuery = client
          .from('jobs')
          .select('*', { count: 'exact', head: true })
          .gte('date', today)
          .is('team_id', null)
          .in('status', ['scheduled', 'confirmed'])
        if (leadTenantId) unassignedQuery = unassignedQuery.eq('tenant_id', leadTenantId)
        const { count: unassignedCount } = await unassignedQuery

        // Yesterday's upsell total for this team
        let upsellQuery = client
          .from('upsells')
          .select('value')
          .eq('team_id', lead.team_id)
          .gte('created_at', `${yesterday}T00:00:00`)
          .lt('created_at', `${today}T00:00:00`)
        if (leadTenantId) upsellQuery = upsellQuery.eq('tenant_id', leadTenantId)
        const { data: upsells } = await upsellQuery

        const upsellTotal = (upsells || []).reduce((sum: number, u: { value: number }) => sum + (u.value || 0), 0)

        const dateLabel = new Date().toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
        })

        let msg = `Good morning, ${lead.name}! ${dateLabel}\n`

        // Today's jobs
        const jobCount = todaysJobs?.length || 0
        msg += `Today's Jobs: ${jobCount}\n`
        if (todaysJobs && todaysJobs.length > 0) {
          const appDomain = (process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live').replace(/\/+$/, '')
          for (const job of todaysJobs) {
            const time = job.scheduled_at || 'TBD'
            const address = job.address || 'No address'
            const portalLink = lead.portal_token ? ` ${appDomain}/crew/${lead.portal_token}/job/${job.id}` : ''
            msg += `- ${time} - ${address}${portalLink}\n`
          }
        } else {
          msg += `No jobs scheduled today.\n`
        }

        // Upsell summary
        if (upsellTotal > 0) {
          msg += `Yesterday's Upsells: $${upsellTotal.toFixed(2)}\n`
        }

        // Unassigned jobs alert
        if (unassignedCount && unassignedCount > 0) {
          msg += `Needs Crew Assignment: ${unassignedCount} job(s). Please assign crew via the dashboard.\n`
        }

        if (!tenant) {
          console.error(`[crew-briefing] Cannot send briefing to ${lead.name} — tenant not resolved (tenant_id: ${leadTenantId})`)
          results.briefingErrors++
          continue
        }
        await sendSMS(tenant, lead.phone, msg)
        results.briefingsSent++
        console.log(`[crew-briefing] Sent briefing to ${lead.name} (${lead.phone})`)
      } catch (err) {
        results.briefingErrors++
        console.error(`[crew-briefing] Failed to send briefing to ${lead.name}:`, err)
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (error) {
    console.error('[crew-briefing] Cron error:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
