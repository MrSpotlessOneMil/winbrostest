/**
 * Service Plans Analytics API
 * GET /api/actions/service-plans/analytics?year=2026
 *
 * Returns ARR by plan type, monthly booked ARR, status counts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function getAnnualMultiplier(planType: string): number {
  switch (planType) {
    case 'quarterly': return 4
    case 'triannual': case 'triannual_exterior': return 3
    case 'monthly': return 12
    case 'biannual': return 2
    default: return 1
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

  const url = new URL(request.url)
  const year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString())

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  // Fetch all service plans for this tenant
  const { data: plans } = await client
    .from('service_plans')
    .select('id, plan_type, plan_price, status, service_months, customer_id')
    .eq('tenant_id', tenantId)

  const allPlans = plans || []

  // Status counts
  const statusCounts = {
    active: allPlans.filter(p => p.status === 'active').length,
    cancelled: allPlans.filter(p => p.status === 'cancelled').length,
    pending: allPlans.filter(p => ['draft', 'sent'].includes(p.status || '')).length,
  }

  // ARR by plan type
  const planTypeMap: Record<string, { label: string; color: string; total_arr: number; plan_count: number }> = {
    quarterly: { label: 'Quarterly', color: '#3b82f6', total_arr: 0, plan_count: 0 },
    triannual: { label: 'Triannual', color: '#8b5cf6', total_arr: 0, plan_count: 0 },
    triannual_exterior: { label: 'Triannual Exterior', color: '#06b6d4', total_arr: 0, plan_count: 0 },
    monthly: { label: 'Monthly', color: '#22c55e', total_arr: 0, plan_count: 0 },
    biannual: { label: 'Biannual', color: '#f59e0b', total_arr: 0, plan_count: 0 },
  }

  let totalArr = 0

  for (const plan of allPlans.filter(p => p.status === 'active')) {
    const type = plan.plan_type || 'quarterly'
    const price = Number(plan.plan_price || 0)
    const arr = price * getAnnualMultiplier(type)

    if (planTypeMap[type]) {
      planTypeMap[type].total_arr += arr
      planTypeMap[type].plan_count += 1
    }
    totalArr += arr
  }

  const planTypes = Object.entries(planTypeMap).map(([type, data]) => ({
    type,
    ...data,
  }))

  // Cancelled plan revenue for summary
  let cancelledArr = 0
  const cancelledCount = allPlans.filter(p => p.status === 'cancelled').length
  for (const plan of allPlans.filter(p => p.status === 'cancelled')) {
    const type = plan.plan_type || 'quarterly'
    const price = Number(plan.plan_price || 0)
    cancelledArr += price * getAnnualMultiplier(type)
  }

  // Monthly ARR booked — with per-plan-type breakdown
  const monthlyTarget = totalArr / 12
  const monthlyArr = MONTH_NAMES.map((name, i) => {
    const month = i + 1
    let booked = 0
    const byType: Record<string, number> = {}

    for (const plan of allPlans.filter(p => p.status === 'active')) {
      const months: number[] = plan.service_months || []
      if (months.includes(month)) {
        const price = Number(plan.plan_price || 0)
        const type = plan.plan_type || 'quarterly'
        booked += price
        byType[type] = (byType[type] || 0) + price
      }
    }

    return {
      month,
      month_name: name,
      booked,
      target: Math.round(monthlyTarget),
      by_type: byType,
    }
  })

  // Revenue this year: sum of completed visit payments in the current year
  let revenueThisYear = 0
  const { data: yearVisits } = await client
    .from('visits')
    .select('payment_amount')
    .eq('tenant_id', tenantId)
    .gte('visit_date', `${year}-01-01`)
    .lte('visit_date', `${year}-12-31`)
    .in('status', ['payment_collected', 'closed'])

  if (yearVisits) {
    revenueThisYear = yearVisits.reduce((sum, v) => sum + Number(v.payment_amount || 0), 0)
  }

  return NextResponse.json({
    planTypes,
    monthlyArr,
    totalArr,
    totalPlans: allPlans.length,
    revenueThisYear,
    statusCounts,
    cancelledArr,
    cancelledCount,
  })
}
