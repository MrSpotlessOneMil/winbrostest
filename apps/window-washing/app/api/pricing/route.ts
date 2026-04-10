import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuthWithTenant } from '@/lib/auth'
import {
  getPricingTiers,
  getPricingAddons,
  savePricingTiers,
  savePricingAddons,
  initializeTenantPricing,
  type PricingRow,
  type PricingAddon,
} from '@/lib/pricing-db'

/**
 * GET /api/pricing
 * Fetch pricing tiers and add-ons for the current tenant
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuthWithTenant(request)
    if (authResult instanceof NextResponse) return authResult
    const { tenant } = authResult

    const [tiers, addons] = await Promise.all([
      getPricingTiers(tenant.id),
      getPricingAddons(tenant.id),
    ])

    return NextResponse.json({
      success: true,
      data: {
        tiers,
        addons,
        tenant_id: tenant.id,
      },
    })
  } catch (error) {
    console.error('[pricing API] GET error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/pricing
 * Update pricing tiers and/or add-ons for the current tenant
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuthWithTenant(request)
    if (authResult instanceof NextResponse) return authResult
    const { tenant } = authResult

    const body = await request.json()
    const { tiers, addons, action } = body

    // Handle special actions
    if (action === 'reset') {
      const result = await initializeTenantPricing(tenant.id)
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        message: 'Pricing reset to defaults',
      })
    }

    // Update tiers if provided
    if (tiers && typeof tiers === 'object') {
      // Flatten tiers object to array — supports any service type dynamically
      const allTiers: PricingRow[] = []

      for (const [serviceType, rows] of Object.entries(tiers)) {
        if (Array.isArray(rows)) {
          for (const row of rows as PricingRow[]) {
            allTiers.push({ ...row, service_type: serviceType })
          }
        }
      }

      if (allTiers.length > 0) {
        const result = await savePricingTiers(tenant.id, allTiers)
        if (!result.success) {
          return NextResponse.json(
            { success: false, error: result.error },
            { status: 500 }
          )
        }
      }
    }

    // Update addons if provided
    if (addons && Array.isArray(addons)) {
      const result = await savePricingAddons(tenant.id, addons)
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Pricing updated successfully',
    })
  } catch (error) {
    console.error('[pricing API] POST error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update pricing' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/pricing
 * Update a single pricing tier
 */
export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuthWithTenant(request)
    if (authResult instanceof NextResponse) return authResult
    const { tenant } = authResult

    const body = await request.json()
    const { id, price, labor_hours, cleaners, hours_per_cleaner } = body

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Tier ID required' },
        { status: 400 }
      )
    }

    // Update the specific tier
    const updateData: Record<string, unknown> = {}
    if (typeof price === 'number') updateData.price = price
    if (typeof labor_hours === 'number') updateData.labor_hours = labor_hours
    if (typeof cleaners === 'number') updateData.cleaners = cleaners
    if (typeof hours_per_cleaner === 'number') updateData.hours_per_cleaner = hours_per_cleaner

    const client = getSupabaseServiceClient()
    const { error } = await client
      .from('pricing_tiers')
      .update(updateData)
      .eq('id', id)
      .eq('tenant_id', tenant.id)

    if (error) {
      console.error('[pricing API] PUT error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update tier' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Tier updated',
    })
  } catch (error) {
    console.error('[pricing API] PUT error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update tier' },
      { status: 500 }
    )
  }
}
