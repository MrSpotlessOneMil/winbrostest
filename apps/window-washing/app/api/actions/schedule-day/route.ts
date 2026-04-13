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

  // Get all jobs for this date
  const { data: jobs } = await client
    .from('jobs')
    .select('id, address, price, status, scheduled_at, service_type, phone_number, cleaner_id, customers(first_name, last_name)')
    .eq('tenant_id', tenantId)
    .eq('date', date)

  // Get all team leads for grouping
  const { data: teamLeads } = await client
    .from('cleaners')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_team_lead', true)
    .eq('active', true)
    .is('deleted_at', null)

  const teamLeadMap = new Map((teamLeads || []).map((tl: any) => [tl.id, tl.name]))

  // Group jobs by assigned cleaner (team lead), plus an "Unassigned" bucket
  const grouped: Record<string, any[]> = { unassigned: [] }
  for (const tl of (teamLeads || [])) {
    grouped[String(tl.id)] = []
  }

  for (const job of (jobs || [])) {
    const cid = job.cleaner_id
    if (cid && grouped[String(cid)]) {
      grouped[String(cid)].push(job)
    } else if (cid && teamLeadMap.has(cid)) {
      grouped[String(cid)] = [job]
    } else {
      grouped.unassigned.push(job)
    }
  }

  function mapJob(j: any) {
    return {
      id: j.id,
      customer_name: [j.customers?.first_name, j.customers?.last_name].filter(Boolean).join(' ') || j.phone_number || 'Unknown',
      address: j.address || '',
      time: j.scheduled_at,
      services: [j.service_type].filter(Boolean),
      price: Number(j.price || 0),
      status: j.status,
    }
  }

  const crews = []

  // Team lead groups
  for (const tl of (teamLeads || [])) {
    const crewJobs = grouped[String(tl.id)] || []
    const dailyRevenue = crewJobs.reduce((sum: number, j: any) => sum + Number(j.price || 0), 0)
    const firstJob = crewJobs[0]
    const firstJobTown = firstJob?.address?.split(',').slice(-2, -1)[0]?.trim() || firstJob?.address || 'No jobs'

    crews.push({
      team_lead_id: tl.id,
      team_lead_name: tl.name,
      first_job_town: firstJobTown,
      daily_revenue: dailyRevenue,
      members: [],
      jobs: crewJobs.map(mapJob),
    })
  }

  // Unassigned group (if any)
  if (grouped.unassigned.length > 0) {
    const dailyRevenue = grouped.unassigned.reduce((sum: number, j: any) => sum + Number(j.price || 0), 0)
    crews.push({
      team_lead_id: null,
      team_lead_name: 'Unassigned',
      first_job_town: grouped.unassigned[0]?.address?.split(',').slice(-2, -1)[0]?.trim() || '',
      daily_revenue: dailyRevenue,
      members: [],
      jobs: grouped.unassigned.map(mapJob),
    })
  }

  return NextResponse.json({
    crews,
    salesmanAppointments: [],
  })
}
