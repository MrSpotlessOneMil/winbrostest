/**
 * Route Dispatch Cron Job
 *
 * Runs hourly. For each tenant with route optimization enabled,
 * checks if it's 3 AM in their local timezone. If so, runs the
 * full optimize + dispatch flow for today's jobs:
 *   1. Optimize routes (Google Maps distance matrix, 2-opt)
 *   2. Persist team assignments to the database
 *   3. Send optimized routes to team leads via Telegram
 *   4. Send ETA arrival windows to customers via SMS
 *
 * Schedule: Every hour at :00 (0 * * * *)
 * Endpoint: GET /api/cron/route-dispatch
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getAllActiveTenants } from '@/lib/tenant'
import { optimizeRoutesForDate } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'

const DISPATCH_HOUR = 3 // 3 AM local time

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const now = new Date()
  const tenants = await getAllActiveTenants()
  const results: Array<{
    tenant: string
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

    // Check if it's DISPATCH_HOUR in this tenant's timezone
    const tz = tenant.timezone || 'America/Chicago'
    const localHour = getLocalHour(now, tz)

    if (localHour !== DISPATCH_HOUR) continue

    // Get today's date in the tenant's local timezone (YYYY-MM-DD)
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

    console.log(
      `[route-dispatch] Running optimize+dispatch for "${tenant.name}" (${tz}), date: ${todayLocal}`
    )

    try {
      const optimization = await optimizeRoutesForDate(todayLocal, tenant.id)

      if (optimization.stats.assignedJobs === 0) {
        results.push({
          tenant: tenant.slug,
          dispatched: false,
          reason:
            optimization.warnings.join('; ') || 'No jobs for this date',
        })
        continue
      }

      const dispatchResult = await dispatchRoutes(optimization, tenant.id)

      results.push({
        tenant: tenant.slug,
        dispatched: true,
        reason: `${dispatchResult.jobsUpdated} jobs dispatched to ${optimization.stats.activeTeams} teams`,
        stats: {
          jobs: dispatchResult.jobsUpdated,
          assignments: dispatchResult.assignmentsCreated,
          telegrams: dispatchResult.telegramsSent,
          sms: dispatchResult.smsSent,
          errors: dispatchResult.errors.length,
        },
      })

      console.log(
        `[route-dispatch] ${tenant.slug}: ${dispatchResult.jobsUpdated} jobs dispatched, ${dispatchResult.telegramsSent} Telegram routes sent, ${dispatchResult.smsSent} customer SMS sent`
      )
    } catch (error) {
      console.error(`[route-dispatch] Error for ${tenant.slug}:`, error)
      results.push({
        tenant: tenant.slug,
        dispatched: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const dispatched = results.filter(r => r.dispatched).length
  console.log(
    `[route-dispatch] Done: ${dispatched} tenant(s) dispatched, ${results.length - dispatched} skipped/failed`
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
