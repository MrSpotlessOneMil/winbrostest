import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getDefaultTenant } from '@/lib/tenant'
import { optimizeRoutesForDate } from '@/lib/route-optimizer'

export async function POST(request: NextRequest) {
  // Allow both dashboard auth and cron auth
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) {
    if (!verifyCronAuth(request)) {
      return authResult
    }
  }

  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { date, options } = body

    if (!date) {
      return NextResponse.json({ success: false, error: 'date is required (YYYY-MM-DD)' }, { status: 400 })
    }

    console.log(`[Logistics] Optimizing routes for ${date}`)

    const result = await optimizeRoutesForDate(date, tenant.id, options)

    return NextResponse.json({
      success: true,
      data: result,
      message: `Optimized ${result.stats.assignedJobs} of ${result.stats.totalJobs} jobs across ${result.stats.activeTeams} teams`,
    })
  } catch (error) {
    console.error('[Logistics] Optimization error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Optimization failed' },
      { status: 500 }
    )
  }
}
