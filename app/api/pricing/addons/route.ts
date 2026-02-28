import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { getPricingAddons } from '@/lib/pricing-db'

/**
 * GET /api/pricing/addons
 * Returns the active add-ons for the authenticated tenant.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant' }, { status: 400 })
  }

  try {
    const addons = await getPricingAddons(tenant.id)
    return NextResponse.json({
      success: true,
      data: addons.map((a) => ({
        addon_key: a.addon_key,
        label: a.label,
        flat_price: a.flat_price,
        minutes: a.minutes,
      })),
    })
  } catch (error) {
    console.error('[pricing/addons] error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch addons' }, { status: 500 })
  }
}
