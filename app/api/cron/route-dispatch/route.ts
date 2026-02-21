/**
 * Route Dispatch Cron Job
 *
 * Runs hourly. For each tenant with route optimization enabled:
 *
 * At 5 PM local time (EVENING_SCHEDULE_HOUR): final optimization for
 * TOMORROW's jobs and send full route schedules (with addresses) to
 * team leads via Telegram. This is the primary schedule notification.
 *
 * New bookings are assigned in real-time by the Stripe webhook via
 * optimizeRoutesIncremental — no morning safety-net dispatch needed.
 *
 * Schedule: Every hour at :00 (0 * * * *)
 * Endpoint: GET /api/cron/route-dispatch
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getAllActiveTenants } from '@/lib/tenant'
import { optimizeRoutesForDate } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'

const EVENING_SCHEDULE_HOUR = 17 // 5 PM local time — send next-day schedule to teams

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const now = new Date()
  const tenants = await getAllActiveTenants()
  const results: Array<{
    tenant: string
    type: 'morning_dispatch' | 'evening_schedule'
    dispatched: boolean
    reason: string
    stats?: Record<string, number>
  }> = []

  for (const tenant of tenants) {
    // Skip tenants without route optimization
    const useRouteOpt =
      tenant.workflow_config?.use_route_optimization === true ||
      tenant.slug === 'winbros'
    if (!useRouteOpt) continue

    const tz = tenant.timezone || 'America/Chicago'
    const localHour = getLocalHour(now, tz)

    // ── 5 PM: Evening schedule for TOMORROW ──
    if (localHour === EVENING_SCHEDULE_HOUR) {
      const tomorrowLocal = getLocalDate(new Date(now.getTime() + 24 * 60 * 60 * 1000), tz)

      console.log(
        `[route-dispatch] Running evening schedule for "${tenant.name}" (${tz}), tomorrow: ${tomorrowLocal}`
      )

      try {
        const optimization = await optimizeRoutesForDate(tomorrowLocal, tenant.id)

        if (optimization.stats.assignedJobs === 0) {
          results.push({
            tenant: tenant.slug,
            type: 'evening_schedule',
            dispatched: false,
            reason: optimization.warnings.join('; ') || 'No jobs for tomorrow',
          })
          continue
        }

        // Dispatch: persist assignments + send full routes to team leads via Telegram
        // Do NOT send customer ETA SMS the night before — that happens morning-of
        const dispatchResult = await dispatchRoutes(optimization, tenant.id, {
          sendTelegramToTeams: true,    // Send full route WITH addresses
          sendSmsToCustomers: false,    // Don't text customers the night before
        })

        results.push({
          tenant: tenant.slug,
          type: 'evening_schedule',
          dispatched: true,
          reason: `Tomorrow's schedule: ${dispatchResult.jobsUpdated} jobs across ${optimization.stats.activeTeams} teams`,
          stats: {
            jobs: dispatchResult.jobsUpdated,
            assignments: dispatchResult.assignmentsCreated,
            telegrams: dispatchResult.telegramsSent,
            errors: dispatchResult.errors.length,
          },
        })

        console.log(
          `[route-dispatch] ${tenant.slug} evening: ${dispatchResult.jobsUpdated} jobs optimized, ${dispatchResult.telegramsSent} schedule Telegrams sent for tomorrow`
        )
      } catch (error) {
        console.error(`[route-dispatch] Evening schedule error for ${tenant.slug}:`, error)
        results.push({
          tenant: tenant.slug,
          type: 'evening_schedule',
          dispatched: false,
          reason: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }

  const dispatched = results.filter(r => r.dispatched).length
  console.log(
    `[route-dispatch] Done: ${dispatched} dispatched, ${results.length - dispatched} skipped/failed`
  )

  return NextResponse.json({ success: true, results })
}

export async function POST(request: NextRequest) {
  return GET(request)
}

/**
 * Get the current hour (0-23) in a given IANA timezone.
 */
function getLocalHour(date: Date, timezone: string): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(date)
  return parseInt(hourStr, 10)
}

/**
 * Get the date (YYYY-MM-DD) in a given IANA timezone.
 */
function getLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
