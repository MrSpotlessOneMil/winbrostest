/**
 * GET /api/actions/my-jobs?date=2026-04-01&range=day|week
 *
 * Returns jobs assigned to the authenticated user's linked cleaner_id.
 * Used by the worker schedule view (My Schedule page).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant, user } = authResult

  const url = new URL(request.url)
  const dateParam = url.searchParams.get('date') || new Date().toISOString().split('T')[0]
  const range = url.searchParams.get('range') || 'day'
  const cleanerIdParam = url.searchParams.get('cleaner_id')

  const client = getSupabaseServiceClient()

  // Resolve cleaner_id: either from param (admin) or from user's linked cleaner
  let cleanerId: number | null = cleanerIdParam ? Number(cleanerIdParam) : null

  if (!cleanerId && user?.id) {
    // Try to find cleaner linked to this user by phone or username
    const { data: userRecord } = await client
      .from('users')
      .select('phone')
      .eq('id', user.id)
      .single()

    if (userRecord?.phone) {
      const { data: cleaner } = await client
        .from('cleaners')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('phone', userRecord.phone)
        .eq('active', true)
        .single()

      if (cleaner) cleanerId = cleaner.id
    }
  }

  // Calculate date range
  let startDate = dateParam
  let endDate = dateParam
  if (range === 'week') {
    const d = new Date(dateParam + 'T12:00:00')
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const monday = new Date(d)
    monday.setDate(monday.getDate() + diff)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    startDate = monday.toISOString().split('T')[0]
    endDate = sunday.toISOString().split('T')[0]
  }

  // Fetch jobs — if no cleaner_id, return all jobs for the tenant (admin view)
  let query = client
    .from('jobs')
    .select(`
      id, date, scheduled_at, service_type, address, status, price,
      hours, phone_number, job_type, notes, cleaner_id, frequency,
      customers (first_name, last_name)
    `)
    .eq('tenant_id', tenant.id)
    .gte('date', startDate)
    .lte('date', endDate)
    .not('status', 'eq', 'cancelled')
    .order('scheduled_at', { ascending: true, nullsFirst: false })

  if (cleanerId) {
    query = query.eq('cleaner_id', cleanerId)
  }

  const { data: jobs, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Also fetch team lead info for each job's cleaner
  const cleanerIds = [...new Set((jobs || []).map(j => j.cleaner_id).filter(Boolean))]
  let cleanerMap: Record<number, { name: string; is_team_lead: boolean }> = {}

  if (cleanerIds.length > 0) {
    const { data: cleaners } = await client
      .from('cleaners')
      .select('id, name, is_team_lead')
      .in('id', cleanerIds)

    for (const c of cleaners || []) {
      cleanerMap[c.id] = { name: c.name, is_team_lead: c.is_team_lead }
    }
  }

  return NextResponse.json({
    jobs: (jobs || []).map(j => ({
      ...j,
      cleaner_name: j.cleaner_id ? cleanerMap[j.cleaner_id]?.name : null,
      is_team_lead: j.cleaner_id ? cleanerMap[j.cleaner_id]?.is_team_lead : false,
    })),
    cleanerId,
    dateRange: { start: startDate, end: endDate },
  })
}
