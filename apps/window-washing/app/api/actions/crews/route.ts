/**
 * GET /api/actions/crews?date=2026-04-01&week=true
 * Returns crew assignments for a date or week range.
 *
 * POST /api/actions/crews
 * Saves crew assignments for a date.
 * Body: { date, assignments: [{ team_lead_id, members: [{ cleaner_id, role }] }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date')
  const isWeek = url.searchParams.get('week') === 'true'

  if (!dateParam) {
    return NextResponse.json({ error: 'date param required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Calculate date range
  let startDate = dateParam
  let endDate = dateParam
  if (isWeek) {
    const d = new Date(dateParam + 'T12:00:00')
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day // Monday start
    const monday = new Date(d)
    monday.setDate(monday.getDate() + diff)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    startDate = monday.toISOString().split('T')[0]
    endDate = sunday.toISOString().split('T')[0]
  }

  // Fetch crew assignments
  const { data: crewDays, error } = await client
    .from('crew_days')
    .select(`
      id, date, team_lead_id, notes,
      crew_day_members (id, cleaner_id, role)
    `)
    .eq('tenant_id', tenant.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch time-off for the range. Status is included so the admin grid can
  // distinguish approved (red) from pending (amber) and ignore denied rows.
  const { data: timeOff } = await client
    .from('time_off')
    .select('id, cleaner_id, date, reason, status')
    .eq('tenant_id', tenant.id)
    .gte('date', startDate)
    .lte('date', endDate)

  // Fetch all active cleaners for the sidebar
  const { data: cleaners } = await client
    .from('cleaners')
    .select('id, name, phone, is_team_lead, employee_type, active, max_jobs_per_day')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name')

  return NextResponse.json({
    crewDays: crewDays || [],
    timeOff: timeOff || [],
    cleaners: cleaners || [],
    dateRange: { start: startDate, end: endDate },
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { date: string; assignments: { team_lead_id: number; members: { cleaner_id: number; role: string }[] }[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.date || !body.assignments) {
    return NextResponse.json({ error: 'date and assignments required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Delete existing crew_days for this date+tenant (replace strategy)
  await client
    .from('crew_days')
    .delete()
    .eq('tenant_id', tenant.id)
    .eq('date', body.date)

  // Insert new crew assignments
  const results = []
  for (const assignment of body.assignments) {
    const { data: crewDay, error: crewErr } = await client
      .from('crew_days')
      .insert({
        tenant_id: tenant.id,
        date: body.date,
        team_lead_id: assignment.team_lead_id,
      })
      .select('id')
      .single()

    if (crewErr || !crewDay) {
      console.error(`Failed to create crew_day:`, crewErr?.message)
      continue
    }

    // Insert members
    if (assignment.members.length > 0) {
      const members = assignment.members.map(m => ({
        crew_day_id: crewDay.id,
        cleaner_id: m.cleaner_id,
        role: m.role,
      }))

      const { error: memberErr } = await client
        .from('crew_day_members')
        .insert(members)

      if (memberErr) {
        console.error(`Failed to insert crew members:`, memberErr.message)
      }
    }

    results.push({ crew_day_id: crewDay.id, team_lead_id: assignment.team_lead_id, members: assignment.members.length })
  }

  return NextResponse.json({ success: true, saved: results })
}
