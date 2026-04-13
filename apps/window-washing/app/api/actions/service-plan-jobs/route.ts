/**
 * Service Plan Jobs API
 * GET /api/actions/service-plan-jobs?year=2026
 *
 * Returns unscheduled service plan jobs grouped by month.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

  const url = new URL(request.url)
  const year = parseInt(url.searchParams.get('year') || new Date().getFullYear().toString())

  const client = getSupabaseServiceClient()

  const { data: jobs } = await client
    .from('service_plan_jobs')
    .select(`
      id, service_plan_id, customer_id, scheduled_month, target_week, status,
      customers!inner(first_name, last_name, address)
    `)
    .eq('tenant_id', authResult.tenant.id)
    .eq('scheduled_year', year)
    .order('scheduled_month', { ascending: true })

  // Group by month
  const grouped: Record<number, Array<{
    id: number
    customer_name: string
    address: string
    plan_type: string
    target_week: number
    status: string
  }>> = {}

  for (const job of jobs || []) {
    const customer = (job as any).customers
    const entry = {
      id: job.id,
      customer_name: [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Unknown',
      address: customer?.address || '',
      plan_type: '',
      target_week: job.target_week || 1,
      status: job.status,
    }

    if (!grouped[job.scheduled_month]) {
      grouped[job.scheduled_month] = []
    }
    grouped[job.scheduled_month].push(entry)
  }

  return NextResponse.json(grouped)
}
