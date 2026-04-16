/**
 * Unscheduled Jobs API
 * GET /api/actions/unscheduled-jobs
 *
 * Returns jobs where cleaner_id IS NULL and status is pending/quoted/scheduled.
 * Used by the scheduling bank sidebar.
 */

// route-check:no-vercel-cron

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = getSupabaseServiceClient()

  const { data: jobs, error } = await client
    .from('jobs')
    .select('id, address, price, status, date, scheduled_at, service_type, phone_number, cleaner_id, credited_salesman_id, customers(first_name, last_name), credited_salesman:credited_salesman_id(id, name)')
    .eq('tenant_id', tenant.id)
    .is('cleaner_id', null)
    .in('status', ['pending', 'quoted', 'scheduled'])
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const mapped = (jobs || []).map((j: any) => {
    const salesman = j.credited_salesman
    return {
      id: j.id,
      customer_name: [j.customers?.first_name, j.customers?.last_name].filter(Boolean).join(' ') || j.phone_number || 'Unknown',
      address: j.address || '',
      date: j.date || null,
      time: j.scheduled_at,
      services: [j.service_type].filter(Boolean),
      price: Number(j.price || 0),
      status: j.status,
      credited_salesman_id: j.credited_salesman_id || null,
      salesman_name: salesman?.name || null,
    }
  })

  return NextResponse.json({ jobs: mapped })
}
