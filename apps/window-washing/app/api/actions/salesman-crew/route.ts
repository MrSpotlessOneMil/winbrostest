/**
 * Salesman Crew API
 * GET /api/actions/salesman-crew?cleaner_id=123
 *
 * Returns the crew/team lead the salesman is assigned to,
 * so the jobs page can show all crew jobs (not just the salesman's own).
 *
 * Returns: { team_lead_id, team_lead_name, crew_member_ids }
 */

// route-check:no-vercel-cron

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const url = new URL(request.url)
  const cleanerIdParam = url.searchParams.get('cleaner_id')

  if (!cleanerIdParam) {
    return NextResponse.json({ error: 'cleaner_id param required' }, { status: 400 })
  }

  const cleanerId = Number(cleanerIdParam)
  if (!Number.isFinite(cleanerId)) {
    return NextResponse.json({ error: 'Invalid cleaner_id' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // First check if this cleaner is a salesman
  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, employee_type, is_team_lead')
    .eq('id', cleanerId)
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .is('deleted_at', null)
    .single()

  if (!cleaner) {
    return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 })
  }

  // Find crew assignments where this salesman is a member
  // Look at most recent crew_day_members entries to find their team lead
  const { data: crewMemberships } = await client
    .from('crew_day_members')
    .select('crew_days!inner(team_lead_id, tenant_id), cleaner_id, role')
    .eq('cleaner_id', cleanerId)
    .order('id', { ascending: false })
    .limit(10)

  // Find the team lead this salesman is most commonly assigned to
  const teamLeadCounts = new Map<number, number>()
  for (const m of crewMemberships || []) {
    const cd = m.crew_days as unknown as { team_lead_id: number; tenant_id: string }
    if (cd?.team_lead_id && cd.tenant_id === tenant.id) {
      teamLeadCounts.set(cd.team_lead_id, (teamLeadCounts.get(cd.team_lead_id) || 0) + 1)
    }
  }

  let teamLeadId: number | null = null
  let maxCount = 0
  for (const [tlId, count] of teamLeadCounts) {
    if (count > maxCount) {
      teamLeadId = tlId
      maxCount = count
    }
  }

  // If no crew assignment found, try to find any team lead for this tenant
  if (!teamLeadId) {
    const { data: teamLeads } = await client
      .from('cleaners')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('is_team_lead', true)
      .eq('active', true)
      .is('deleted_at', null)
      .limit(1)

    if (teamLeads && teamLeads.length > 0) {
      teamLeadId = teamLeads[0].id
    }
  }

  // Get team lead info
  let teamLeadName = 'Unknown'
  if (teamLeadId) {
    const { data: tl } = await client
      .from('cleaners')
      .select('id, name')
      .eq('id', teamLeadId)
      .single()

    if (tl) teamLeadName = tl.name
  }

  // Get all cleaners assigned to this team lead's crew (from recent crew_days)
  const crewMemberIds: number[] = []
  if (teamLeadId) {
    // The team lead is always a member
    crewMemberIds.push(teamLeadId)

    const { data: recentCrewDay } = await client
      .from('crew_days')
      .select('crew_day_members(cleaner_id)')
      .eq('team_lead_id', teamLeadId)
      .eq('tenant_id', tenant.id)
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (recentCrewDay?.crew_day_members) {
      for (const m of recentCrewDay.crew_day_members as { cleaner_id: number }[]) {
        if (!crewMemberIds.includes(m.cleaner_id)) {
          crewMemberIds.push(m.cleaner_id)
        }
      }
    }
  }

  return NextResponse.json({
    cleaner_id: cleanerId,
    employee_type: cleaner.employee_type,
    team_lead_id: teamLeadId,
    team_lead_name: teamLeadName,
    crew_member_ids: crewMemberIds,
  })
}
