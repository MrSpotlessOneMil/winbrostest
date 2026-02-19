/**
 * Crew Briefing Cron
 *
 * Sends a morning briefing to all active team leads via Telegram.
 * Includes: today's job count, yesterday's upsell total, and any
 * jobs still needing crew assignment.
 *
 * Also runs daily alert checks (underfilled days, stacked reschedules).
 *
 * Called by unified-daily cron at 8am PST.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { sendTelegramMessage } from '@/lib/telegram'
import { runDailyAlertChecks } from '@/lib/winbros-alerts'

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

    // 2. Fetch all active team leads with a Telegram ID
    const { data: teamLeads, error: leadErr } = await client
      .from('cleaners')
      .select('id, name, telegram_id, team_id')
      .eq('is_team_lead', true)
      .eq('active', true)
      .not('telegram_id', 'is', null)

    if (leadErr || !teamLeads?.length) {
      console.log('[crew-briefing] No active team leads with Telegram IDs found')
      return NextResponse.json({ success: true, results })
    }

    // 3. For each team lead, build and send the briefing
    for (const lead of teamLeads) {
      try {
        // Today's jobs for this team
        const { data: todaysJobs } = await client
          .from('jobs')
          .select('id, scheduled_at, address, status')
          .eq('date', today)
          .eq('team_id', lead.team_id)
          .order('scheduled_at')

        // Jobs needing crew assignment (no team assigned, upcoming)
        const { count: unassignedCount } = await client
          .from('jobs')
          .select('*', { count: 'exact', head: true })
          .gte('date', today)
          .is('team_id', null)
          .in('status', ['scheduled', 'confirmed'])

        // Yesterday's upsell total for this team
        const { data: upsells } = await client
          .from('upsells')
          .select('value')
          .eq('team_id', lead.team_id)
          .gte('created_at', `${yesterday}T00:00:00`)
          .lt('created_at', `${today}T00:00:00`)

        const upsellTotal = (upsells || []).reduce((sum: number, u: { value: number }) => sum + (u.value || 0), 0)

        const dateLabel = new Date().toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric',
        })

        let msg = `<b>📋 Good morning, ${lead.name}!</b>\n`
        msg += `<b>${dateLabel}</b>\n\n`

        // Today's jobs
        const jobCount = todaysJobs?.length || 0
        msg += `<b>Today's Jobs: ${jobCount}</b>\n`
        if (todaysJobs && todaysJobs.length > 0) {
          for (const job of todaysJobs) {
            const time = job.scheduled_at || 'TBD'
            const address = job.address || 'No address'
            msg += `• ${time} — ${address}\n`
          }
        } else {
          msg += `No jobs scheduled today.\n`
        }

        // Upsell summary
        if (upsellTotal > 0) {
          msg += `\n<b>💰 Yesterday's Upsells:</b> $${upsellTotal.toFixed(2)}\n`
        }

        // Unassigned jobs alert
        if (unassignedCount && unassignedCount > 0) {
          msg += `\n<b>⚠️ Needs Crew Assignment: ${unassignedCount} job(s)</b>\n`
          msg += `Please assign crew via the dashboard.\n`
        }

        await sendTelegramMessage(lead.telegram_id, msg, 'HTML')
        results.briefingsSent++
        console.log(`[crew-briefing] Sent briefing to ${lead.name} (${lead.telegram_id})`)
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
