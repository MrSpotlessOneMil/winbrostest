/**
 * Day Schedule API
 * GET /api/actions/schedule-day?date=2026-04-15
 *
 * Returns daily schedule grouped by team lead with town + revenue.
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
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0]

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  // Get crew assignments for this date
  const { data: crewDays } = await client
    .from('crew_days')
    .select(`
      id, date, notes,
      team_lead:cleaners!crew_days_team_lead_id_fkey(id, name),
      crew_day_members(cleaner_id, role, cleaners(name))
    `)
    .eq('tenant_id', tenantId)
    .eq('date', date)

  // Get jobs for this date
  const { data: jobs } = await client
    .from('jobs')
    .select('id, address, price, status, scheduled_at, service_type, phone_number, cleaner_id, customers(first_name, last_name)')
    .eq('tenant_id', tenantId)
    .eq('date', date)

  // Group jobs by team lead (via crew_day assignments)
  const crews = (crewDays || []).map((cd: any) => {
    const teamLead = cd.team_lead
    const members = (cd.crew_day_members || []).map((m: any) => m.cleaners?.name || 'Unknown')
    const memberIds = (cd.crew_day_members || []).map((m: any) => m.cleaner_id)

    // Find jobs assigned to any member of this crew
    const crewJobs = (jobs || []).filter((j: any) => memberIds.includes(j.cleaner_id))

    const dailyRevenue = crewJobs.reduce((sum: number, j: any) => sum + Number(j.price || 0), 0)

    // Get town from first job address
    const firstJob = crewJobs[0]
    const firstJobTown = firstJob?.address?.split(',').slice(-2, -1)[0]?.trim() || firstJob?.address || 'No jobs'

    return {
      team_lead_id: teamLead?.id || cd.id,
      team_lead_name: teamLead?.name || 'Unassigned',
      first_job_town: firstJobTown,
      daily_revenue: dailyRevenue,
      members,
      jobs: crewJobs.map((j: any) => ({
        id: j.id,
        customer_name: [j.customers?.first_name, j.customers?.last_name].filter(Boolean).join(' ') || j.phone_number || 'Unknown',
        address: j.address || '',
        time: j.scheduled_at,
        services: [j.service_type].filter(Boolean),
        price: Number(j.price || 0),
        status: j.status,
      })),
    }
  })

  return NextResponse.json({
    crews,
    salesmanAppointments: [], // TODO: populate from salesman schedule when available
  })
}
