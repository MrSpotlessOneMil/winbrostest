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
  const now = new Date()
  const today = now.toISOString().split('T')[0]

  // Get 7 days from now
  const weekFromNow = new Date(now)
  weekFromNow.setDate(weekFromNow.getDate() + 7)
  const weekStr = weekFromNow.toISOString().split('T')[0]

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

  const todaysJobs: any[] = []
  const upcomingJobs: any[] = []
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
      assignment_status: asn.status,
      assignment_id: asn.id,
      customer_first_name: job.customers?.first_name || null,
      cleaner_omw_at: job.cleaner_omw_at,
      cleaner_arrived_at: job.cleaner_arrived_at,
      payment_method: job.payment_method,
    }

    if (asn.status === 'pending') {
      pendingJobs.push(jobData)
    } else if (job.date === today) {
      todaysJobs.push(jobData)
    } else if (job.date > today && job.date <= weekStr) {
      upcomingJobs.push(jobData)
    }
  }

  // Past jobs (completed, last 30 days)
  const thirtyDaysAgo = new Date(now)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const pastStr = thirtyDaysAgo.toISOString().split('T')[0]

  const { data: pastAssignments } = await client
    .from('cleaner_assignments')
    .select(`
      id, status,
      jobs!inner(
        id, date, scheduled_at, address, service_type, status,
        customer_id, customers(first_name)
      )
    `)
    .eq('cleaner_id', cleaner.id)
    .eq('tenant_id', tenantId)
    .in('status', ['confirmed', 'accepted'])
    .eq('jobs.status', 'completed')
    .gte('jobs.date', pastStr)
    .order('created_at', { ascending: false })
    .limit(20)

  const pastJobs = (pastAssignments || []).map((asn: any) => ({
    id: asn.jobs.id,
    date: asn.jobs.date,
    scheduled_at: asn.jobs.scheduled_at,
    address: asn.jobs.address,
    service_type: asn.jobs.service_type,
    status: asn.jobs.status,
    customer_first_name: asn.jobs.customers?.first_name || null,
  }))

  // Sort today's jobs by time
  todaysJobs.sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

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
    },
    tenant: {
      name: tenant.business_name_short || tenant.business_name || tenant.name,
      slug: tenant.slug,
    },
    todaysJobs,
    upcomingJobs,
    pendingJobs,
    pastJobs,
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
