import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { sendSMS } from '@/lib/openphone'
import { optimizeRoutesForDate } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { date, dry_run } = body

    if (!date) {
      return NextResponse.json({ success: false, error: 'date is required (YYYY-MM-DD)' }, { status: 400 })
    }

    console.log(`[Logistics] ${dry_run ? 'DRY RUN - ' : ''}Dispatching routes for ${date}`)

    // Optimize first
    const optimization = await optimizeRoutesForDate(date, tenant.id)

    if (optimization.stats.assignedJobs === 0) {
      // Alert owner if optimization couldn't assign any jobs (skipped teams, no jobs, etc.)
      if (optimization.warnings.length > 0 && tenant.owner_phone) {
        const warningLines = optimization.warnings.map(w => `  - ${w}`).join('\n')
        const msg = `LOGISTICS DISPATCH - ${date}\n\nNo jobs were dispatched.\n\nWARNINGS:\n${warningLines}`
        await sendSMS(tenant, tenant.owner_phone, msg).catch(err =>
          console.error('[Logistics] Failed to alert owner:', err)
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          optimization: optimization.stats,
          dispatch: { jobsUpdated: 0, assignmentsCreated: 0, telegramsSent: 0, smsSent: 0 },
          warnings: optimization.warnings,
        },
        message: 'No jobs to dispatch',
      })
    }

    // Dispatch
    const dispatchResult = await dispatchRoutes(optimization, tenant.id, {
      dryRun: dry_run ?? false,
    })

    return NextResponse.json({
      success: dispatchResult.success,
      data: {
        optimization: optimization.stats,
        routes: optimization.routes.map(r => ({
          team: r.teamName,
          stops: r.stops.length,
          totalDriveMinutes: r.totalDriveTimeMinutes,
          revenue: r.totalRevenueEstimate,
        })),
        dispatch: {
          jobsUpdated: dispatchResult.jobsUpdated,
          assignmentsCreated: dispatchResult.assignmentsCreated,
          telegramsSent: dispatchResult.telegramsSent,
          smsSent: dispatchResult.smsSent,
        },
        warnings: optimization.warnings,
        unassigned: optimization.unassignedJobs,
        errors: dispatchResult.errors.length > 0 ? dispatchResult.errors : undefined,
      },
      message: dry_run
        ? `DRY RUN: Would dispatch ${optimization.stats.assignedJobs} jobs to ${optimization.stats.activeTeams} teams`
        : `Dispatched ${dispatchResult.jobsUpdated} jobs, sent ${dispatchResult.telegramsSent} Telegram routes + ${dispatchResult.smsSent} customer SMS`,
    })
  } catch (error) {
    console.error('[Logistics] Dispatch error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Dispatch failed' },
      { status: 500 }
    )
  }
}
