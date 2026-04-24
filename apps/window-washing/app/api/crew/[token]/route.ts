/**
 * Cleaner Portal API
 *
 * GET  /api/crew/[token] — Returns cleaner profile, today's/upcoming/past jobs
 * PATCH /api/crew/[token] — Update cleaner availability
 *
 * Public (no auth — token = access, like quote page).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'

async function resolveCleanerByToken(token: string) {
  const client = getSupabaseServiceClient()
  const { data: cleaner } = await client
    .from('cleaners')
    .select('*, tenants!inner(id, name, slug, business_name, business_name_short, workflow_config)')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  return cleaner
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const cleaner = await resolveCleanerByToken(token)
  if (!cleaner) {
    return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  }

  const client = getSupabaseServiceClient()
  const tenantId = (cleaner as any).tenants.id
  const url = new URL(request.url)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Date range params for calendar view
  const rangeParam = url.searchParams.get('range') // day | week
  const dateParam = url.searchParams.get('date') || today

  let rangeStart = today
  let rangeEnd = today
  if (rangeParam === 'week') {
    const d = new Date(dateParam + 'T12:00:00')
    const dow = d.getDay()
    const diff = dow === 0 ? -6 : 1 - dow // Monday start
    const monday = new Date(d)
    monday.setDate(monday.getDate() + diff)
    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)
    rangeStart = monday.toISOString().split('T')[0]
    rangeEnd = sunday.toISOString().split('T')[0]
  } else if (rangeParam === 'day') {
    rangeStart = dateParam
    rangeEnd = dateParam
  } else {
    // Default: today + 7 days
    const weekFromNow = new Date(now)
    weekFromNow.setDate(weekFromNow.getDate() + 7)
    rangeEnd = weekFromNow.toISOString().split('T')[0]
  }

  // Fetch cleaner's assignments with job details
  const { data: assignments } = await client
    .from('cleaner_assignments')
    .select(`
      id, status, created_at,
      jobs!inner(
        id, date, scheduled_at, address, service_type, status, notes, job_type,
        bedrooms, bathrooms, sqft, hours, price,
        cleaner_omw_at, cleaner_arrived_at, payment_method,
        customer_id, phone_number,
        customers(first_name, last_name, address)
      )
    `)
    .eq('cleaner_id', cleaner.id)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'accepted', 'confirmed'])
    .order('created_at', { ascending: false })

  const allJobs: any[] = []
  const pendingJobs: any[] = []

  for (const asn of assignments || []) {
    const job = (asn as any).jobs
    if (!job) continue

    const jobData = {
      id: job.id,
      date: job.date,
      scheduled_at: job.scheduled_at,
      address: job.address,
      service_type: job.service_type,
      status: job.status,
      job_type: job.job_type || null,
      hours: job.hours ? Number(job.hours) : null,
      price: job.price ? Number(job.price) : null,
      assignment_status: asn.status,
      assignment_id: asn.id,
      customer_first_name: job.customers?.first_name || null,
      cleaner_omw_at: job.cleaner_omw_at,
      cleaner_arrived_at: job.cleaner_arrived_at,
      payment_method: job.payment_method,
    }

    if (asn.status === 'pending') {
      pendingJobs.push(jobData)
    }

    // Include all jobs in the date range
    if (job.date >= rangeStart && job.date <= rangeEnd) {
      allJobs.push(jobData)
    }
  }

  // ── Also fetch jobs via crew_day_members (crew board assignments) ──
  // If this cleaner is assigned to a TL for a day, show that TL's jobs
  const { data: crewMemberships } = await client
    .from('crew_day_members')
    .select('crew_day_id, role, crew_days!inner(id, date, team_lead_id)')
    .eq('cleaner_id', cleaner.id)

  // If this cleaner IS a team lead, fetch their crew_days directly
  const { data: tlCrewDays } = cleaner.is_team_lead
    ? await client
        .from('crew_days')
        .select('id, date, team_lead_id')
        .eq('team_lead_id', cleaner.id)
        .eq('tenant_id', tenantId)
        .gte('date', rangeStart)
        .lte('date', rangeEnd)
    : { data: [] }

  // Collect TL IDs + dates to fetch jobs for
  const tlJobQueries: { date: string; tlId: number }[] = []
  const seenJobIds = new Set(allJobs.map((j: any) => j.id))

  for (const cm of crewMemberships || []) {
    const cd = (cm as any).crew_days
    if (cd && cd.date >= rangeStart && cd.date <= rangeEnd) {
      tlJobQueries.push({ date: cd.date, tlId: cd.team_lead_id })
    }
  }
  // TL sees their own jobs
  for (const cd of tlCrewDays || []) {
    tlJobQueries.push({ date: cd.date, tlId: cd.team_lead_id })
  }

  // For TLs only: also fetch directly assigned jobs (cleaner_id on jobs table)
  // Techs/salesmen should ONLY see jobs via crew_day_members assignments
  if (cleaner.is_team_lead) {
    const { data: directJobs } = await client
      .from('jobs')
      .select('id, date, scheduled_at, address, service_type, status, notes, job_type, hours, price, cleaner_omw_at, cleaner_arrived_at, payment_method, phone_number, customers(first_name, last_name, address)')
      .eq('cleaner_id', cleaner.id)
      .eq('tenant_id', tenantId)
      .gte('date', rangeStart)
      .lte('date', rangeEnd)
      .neq('status', 'cancelled')

    for (const job of directJobs || []) {
      if (seenJobIds.has(job.id)) continue
      seenJobIds.add(job.id)
      allJobs.push({
        id: job.id, date: job.date, scheduled_at: job.scheduled_at,
        address: job.address, service_type: job.service_type, status: job.status,
        job_type: job.job_type || null, hours: job.hours ? Number(job.hours) : null,
        price: job.price ? Number(job.price) : null, assignment_status: 'confirmed',
        assignment_id: null, customer_first_name: (job as any).customers?.first_name || null,
        cleaner_omw_at: job.cleaner_omw_at, cleaner_arrived_at: job.cleaner_arrived_at,
        payment_method: job.payment_method,
      })
    }
  }

  // Fetch TL jobs for crew members
  for (const { date, tlId } of tlJobQueries) {
    const { data: tlJobs } = await client
      .from('jobs')
      .select('id, date, scheduled_at, address, service_type, status, notes, job_type, hours, price, cleaner_omw_at, cleaner_arrived_at, payment_method, phone_number, customers(first_name, last_name, address)')
      .eq('cleaner_id', tlId)
      .eq('tenant_id', tenantId)
      .eq('date', date)
      .neq('status', 'cancelled')

    for (const job of tlJobs || []) {
      if (seenJobIds.has(job.id)) continue
      seenJobIds.add(job.id)
      allJobs.push({
        id: job.id, date: job.date, scheduled_at: job.scheduled_at,
        address: job.address, service_type: job.service_type, status: job.status,
        job_type: job.job_type || null, hours: job.hours ? Number(job.hours) : null,
        price: job.price ? Number(job.price) : null, assignment_status: 'confirmed',
        assignment_id: null, customer_first_name: (job as any).customers?.first_name || null,
        cleaner_omw_at: job.cleaner_omw_at, cleaner_arrived_at: job.cleaner_arrived_at,
        payment_method: job.payment_method,
      })
    }
  }

  // Sort by date then time
  allJobs.sort((a: any, b: any) => a.date.localeCompare(b.date) || (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

  // Batch-fetch visit statuses for all jobs so the list view can show progress
  const allJobIds = allJobs.map((j: any) => j.id)
  if (allJobIds.length > 0) {
    const { data: visits } = await client
      .from('visits')
      .select('job_id, status')
      .eq('tenant_id', tenantId)
      .in('job_id', allJobIds)
      .order('created_at', { ascending: false })

    // Build a map of job_id -> latest visit status (first occurrence = latest due to desc order)
    const visitStatusMap = new Map<number, string>()
    for (const v of visits || []) {
      if (!visitStatusMap.has(v.job_id)) {
        visitStatusMap.set(v.job_id, v.status)
      }
    }

    // Attach visit_status to each job
    for (const job of allJobs) {
      job.visit_status = visitStatusMap.get(job.id) || null
    }
  }

  // Fetch time-off for current + next month
  const currentMonth = today.slice(0, 7)
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const nextMonth = nextMonthDate.toISOString().split('T')[0].slice(0, 7)

  const { data: timeOffData } = await client
    .from('time_off')
    .select('id, date, reason')
    .eq('tenant_id', tenantId)
    .eq('cleaner_id', cleaner.id)
    .gte('date', `${currentMonth}-01`)
    .lte('date', `${nextMonth}-31`)
    .order('date')

  const tenant = (cleaner as any).tenants
  return NextResponse.json({
    cleaner: {
      id: cleaner.id,
      name: cleaner.name,
      phone: cleaner.phone,
      availability: cleaner.availability,
      employee_type: (cleaner as any).employee_type || 'technician',
      is_team_lead: !!(cleaner as any).is_team_lead,
    },
    tenant: {
      name: tenant.business_name_short || tenant.business_name || tenant.name,
      slug: tenant.slug,
    },
    jobs: allJobs,
    pendingJobs,
    dateRange: { start: rangeStart, end: rangeEnd },
    timeOff: timeOffData || [],
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const cleaner = await resolveCleanerByToken(token)
  if (!cleaner) {
    return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const tenantId = (cleaner as any).tenants.id

  // Time-off toggle
  if (body.toggleTimeOff) {
    const { date } = body.toggleTimeOff
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

    // Check if already off
    const { data: existing } = await client
      .from('time_off')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cleaner_id', cleaner.id)
      .eq('date', date)
      .maybeSingle()

    if (existing) {
      await client.from('time_off').delete().eq('id', existing.id)
      return NextResponse.json({ success: true, action: 'removed', date })
    } else {
      await client.from('time_off').insert({
        tenant_id: tenantId,
        cleaner_id: cleaner.id,
        date,
        reason: 'worker_requested',
      })
      return NextResponse.json({ success: true, action: 'added', date })
    }
  }

  // Legacy availability update
  const { availability } = body
  if (!availability) {
    return NextResponse.json({ error: 'Missing availability or toggleTimeOff' }, { status: 400 })
  }

  const { error } = await client
    .from('cleaners')
    .update({ availability, updated_at: new Date().toISOString() })
    .eq('id', cleaner.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
