import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { getPricingRow } from '@/lib/pricing-db'

/**
 * GET /api/pricing/estimate?bedrooms=3&bathrooms=2&sqft=1500&service_type=standard
 * Returns the price for the given property details based on the tenant's pricing tiers.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant' }, { status: 400 })
  }

  const params = request.nextUrl.searchParams
  const bedrooms = Number(params.get('bedrooms'))
  const bathrooms = Number(params.get('bathrooms'))
  const sqft = params.get('sqft') ? Number(params.get('sqft')) : undefined
  const rawService = (params.get('service_type') || 'standard').toLowerCase()

  // Map display service types to pricing tier keys
  let serviceType: 'standard' | 'deep' | 'move' = 'standard'
  if (rawService.includes('deep')) serviceType = 'deep'
  else if (rawService.includes('move')) serviceType = 'move'

  if (!bedrooms || !bathrooms) {
    return NextResponse.json({ success: false, error: 'bedrooms and bathrooms required' }, { status: 400 })
  }

  try {
    const row = await getPricingRow(serviceType, bedrooms, bathrooms, sqft, tenant.id)
    if (!row) {
      return NextResponse.json({ success: true, data: { price: null, message: 'No pricing tier found' } })
    }

    return NextResponse.json({
      success: true,
      data: {
        price: row.price,
        labor_hours: row.labor_hours,
        cleaners: row.cleaners,
        hours_per_cleaner: row.hours_per_cleaner,
      },
    })
  } catch (error) {
    console.error('[pricing/estimate] error:', error)
    return NextResponse.json({ success: false, error: 'Failed to estimate price' }, { status: 500 })
  }
}
