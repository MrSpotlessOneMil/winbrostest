import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'

/**
 * Unified daily cron endpoint that consolidates daily cron jobs
 * into a single execution (Vercel Hobby plan limitation)
 *
 * This endpoint calls:
 * - lifecycle-reengagement: Unified re-engagement for past customers (replaces monthly-followup)
 * - logistics/rain-day: Check tomorrow's weather for rain day (WinBros)
 * - crew-briefing: Morning briefing to team leads
 *
 * Note: send-reminders has its own hourly cron in vercel.json — NOT called here.
 *
 * Note: Route optimization + dispatch is handled by /api/cron/route-dispatch
 * which runs hourly and fires at 3 AM in each tenant's local timezone.
 *
 * Note: Frequent crons (ghl-followups, check-timeouts)
 * are handled by process-scheduled-tasks which runs every minute.
 */

const SUB_CRON_TIMEOUT_MS = 55_000 // 55 seconds — leave headroom for Vercel's 60s limit

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  try {
    const results = {
      auto_complete: { success: false, error: null as string | null, count: 0 },
      monthly_followup: { success: false, error: null as string | null },
      logistics_rain_day: { success: false, error: null as string | null },
      crew_briefing: { success: false, error: null as string | null },
      timestamp: new Date().toISOString(),
    }

    // 0. Auto-complete past-dated scheduled/in_progress jobs (for tenants without HCP)
    try {
      console.log('[unified-daily] Auto-completing past-dated jobs...')
      const client = getSupabaseServiceClient()
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayISO = yesterday.toISOString().split('T')[0]

      const { data: staleJobs, error: staleErr } = await client
        .from('jobs')
        .select('id, date, tenant_id')
        .in('status', ['scheduled', 'in_progress'])
        .lt('date', yesterdayISO)
        .not('date', 'is', null)

      if (staleErr) throw staleErr

      if (staleJobs && staleJobs.length > 0) {
        const now = new Date().toISOString()
        const { error: updateErr } = await client
          .from('jobs')
          .update({ status: 'completed', completed_at: now, updated_at: now })
          .in('id', staleJobs.map(j => j.id))

        if (updateErr) throw updateErr
        results.auto_complete.count = staleJobs.length
        console.log(`[unified-daily] Auto-completed ${staleJobs.length} past-dated jobs`)
      }
      results.auto_complete.success = true
    } catch (error) {
      results.auto_complete.error = String(error)
      console.error('[unified-daily] auto-complete error:', error)
    }

    const domain = process.env.NEXT_PUBLIC_DOMAIN || process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const cronSecret = process.env.CRON_SECRET || ''

    // 1. Execute lifecycle reengagement (replaces monthly-followup)
    try {
      console.log('[unified-daily] Executing lifecycle-reengagement...')
      const monthlyResponse = await fetchWithTimeout(`${domain}/api/cron/lifecycle-reengagement`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      }, SUB_CRON_TIMEOUT_MS)

      if (monthlyResponse.ok) {
        results.monthly_followup.success = true
        console.log('[unified-daily] lifecycle-reengagement completed successfully')
      } else {
        results.monthly_followup.error = `Status ${monthlyResponse.status}`
        console.error('[unified-daily] lifecycle-reengagement failed:', monthlyResponse.status)
      }
    } catch (error) {
      results.monthly_followup.error = String(error)
      console.error('[unified-daily] lifecycle-reengagement error:', error)
    }

    // 2. Check tomorrow's weather for rain day
    try {
      console.log('[unified-daily] Checking rain day forecast...')
      const rainDayResponse = await fetchWithTimeout(`${domain}/api/logistics/rain-day`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ days_ahead: 1 }),
      }, SUB_CRON_TIMEOUT_MS)

      if (rainDayResponse.ok) {
        results.logistics_rain_day.success = true
        const rainData = await rainDayResponse.json()
        if (rainData.data?.isRainDay) {
          console.log('[unified-daily] Rain day detected! Jobs rescheduled.')
        } else {
          console.log('[unified-daily] No rain day — all clear')
        }
      } else {
        results.logistics_rain_day.error = `Status ${rainDayResponse.status}`
        console.error('[unified-daily] rain day check failed:', rainDayResponse.status)
      }
    } catch (error) {
      results.logistics_rain_day.error = String(error)
      console.error('[unified-daily] rain day check error:', error)
    }

    // 3. Send crew briefings to team leads + run daily alert checks
    try {
      console.log('[unified-daily] Sending crew briefings...')
      const briefingResponse = await fetchWithTimeout(`${domain}/api/cron/crew-briefing`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      }, SUB_CRON_TIMEOUT_MS)

      if (briefingResponse.ok) {
        results.crew_briefing.success = true
        console.log('[unified-daily] crew briefings sent')
      } else {
        results.crew_briefing.error = `Status ${briefingResponse.status}`
        console.error('[unified-daily] crew briefings failed:', briefingResponse.status)
      }
    } catch (error) {
      results.crew_briefing.error = String(error)
      console.error('[unified-daily] crew briefings error:', error)
    }

    // Check if any sub-cron failed
    const allSucceeded = results.auto_complete.success &&
      results.monthly_followup.success &&
      results.logistics_rain_day.success &&
      results.crew_briefing.success

    return NextResponse.json(
      { success: allSucceeded, results },
      { status: allSucceeded ? 200 : 207 }
    )
  } catch (error) {
    console.error('[unified-daily] Unified daily cron error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
