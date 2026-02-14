import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { verifyCronAuth } from '@/lib/cron-auth'
import { getDefaultTenant } from '@/lib/tenant'
import { checkAndHandleRainDay } from '@/lib/rain-day'

export async function POST(request: NextRequest) {
  // Allow both dashboard auth and cron auth
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) {
    if (!verifyCronAuth(request)) {
      return authResult
    }
  }

  const tenant = await getAuthTenant(request) || await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { days_ahead, auto_spread, spread_days, service_area_zip } = body as any

    console.log(`[Logistics] Checking rain day for +${days_ahead || 1} days`)

    const result = await checkAndHandleRainDay(tenant.id, {
      daysAhead: days_ahead,
      autoSpread: auto_spread,
      spreadDays: spread_days,
      serviceAreaZip: service_area_zip,
    })

    if (!result.checked) {
      return NextResponse.json({
        success: false,
        error: result.error || 'Failed to check weather',
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: result.isRainDay
        ? `Rain day detected! ${result.rescheduled?.jobsRescheduled || 0} jobs rescheduled.`
        : 'No rain day detected — all clear.',
    })
  } catch (error) {
    console.error('[Logistics] Rain day check error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Rain day check failed' },
      { status: 500 }
    )
  }
}
