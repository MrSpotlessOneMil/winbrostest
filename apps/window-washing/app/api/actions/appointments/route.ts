import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Appointments — WinBros Round 2 task 4.
 *
 * GET   /api/actions/appointments?start=YYYY-MM-DD&end=YYYY-MM-DD
 *       Returns jobs in date range + list of salesmen to render as grid rows.
 * POST  /api/actions/appointments
 *       Creates an unassigned job with scheduled_at/end_time. Admin only.
 * PATCH /api/actions/appointments?id=N
 *       Assigns crew_salesman_id (drag-drop drop) and/or updates date/time.
 *       When crew_salesman_id is set, upserts crew_days for that salesman as
 *       team_lead (WinBros convention: salesman runs his own crew). Admin only.
 */

type PostBody = {
  customer_id?: unknown
  phone_number?: unknown
  address?: unknown
  service_type?: unknown
  date?: unknown
  scheduled_at?: unknown
  end_time?: unknown
  price?: unknown
  notes?: unknown
}

type PatchBody = {
  crew_salesman_id?: unknown
  date?: unknown
  scheduled_at?: unknown
  end_time?: unknown
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function ensureOwner(authResult: { user: { id: number } }): NextResponse | null {
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/owner access required' }, { status: 403 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const url = new URL(request.url)
  const start = url.searchParams.get('start')
  const end = url.searchParams.get('end')

  if (!isDateString(start) || !isDateString(end)) {
    return NextResponse.json(
      { error: 'start and end query params required (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  const { data: appointments, error: jobsErr } = await client
    .from('jobs')
    .select(
      'id, customer_id, phone_number, address, service_type, date, scheduled_at, end_time, price, status, crew_salesman_id, notes'
    )
    .eq('tenant_id', tenantId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })
    .order('scheduled_at', { ascending: true })

  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 })

  const { data: salesmen, error: salesmenErr } = await client
    .from('cleaners')
    .select('id, name, employee_type, is_team_lead')
    .eq('tenant_id', tenantId)
    .eq('employee_type', 'salesman')
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (salesmenErr) return NextResponse.json({ error: salesmenErr.message }, { status: 500 })

  return NextResponse.json({
    appointments: appointments ?? [],
    salesmen: salesmen ?? [],
    range: { start, end },
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const ownerGate = ensureOwner(authResult)
  if (ownerGate) return ownerGate

  let body: PostBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!isDateString(body.date)) {
    return NextResponse.json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 })
  }
  if (typeof body.scheduled_at !== 'string' || !body.scheduled_at.trim()) {
    return NextResponse.json(
      { error: 'scheduled_at (HH:MM) is required' },
      { status: 400 }
    )
  }
  if (typeof body.end_time !== 'string' || !body.end_time.trim()) {
    return NextResponse.json(
      { error: 'end_time (ISO timestamp) is required' },
      { status: 400 }
    )
  }

  const insertRow: Record<string, unknown> = {
    tenant_id: authResult.tenant.id,
    date: body.date,
    scheduled_at: body.scheduled_at.trim(),
    end_time: body.end_time,
    status: 'pending',
    booked: false,
  }
  if (typeof body.customer_id === 'number') insertRow.customer_id = body.customer_id
  if (typeof body.phone_number === 'string' && body.phone_number.trim())
    insertRow.phone_number = body.phone_number.trim()
  if (typeof body.address === 'string') insertRow.address = body.address
  if (typeof body.service_type === 'string') insertRow.service_type = body.service_type
  if (typeof body.price === 'number' && body.price >= 0) insertRow.price = body.price
  if (typeof body.notes === 'string') insertRow.notes = body.notes

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('jobs')
    .insert(insertRow)
    .select(
      'id, customer_id, phone_number, address, service_type, date, scheduled_at, end_time, price, status, crew_salesman_id, notes'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ appointment: data })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const ownerGate = ensureOwner(authResult)
  if (ownerGate) return ownerGate

  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (body.crew_salesman_id === null) updates.crew_salesman_id = null
  if (typeof body.crew_salesman_id === 'number') updates.crew_salesman_id = body.crew_salesman_id
  if (isDateString(body.date)) updates.date = body.date
  if (typeof body.scheduled_at === 'string' && body.scheduled_at.trim())
    updates.scheduled_at = body.scheduled_at.trim()
  if (typeof body.end_time === 'string' && body.end_time.trim()) updates.end_time = body.end_time

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  updates.updated_at = new Date().toISOString()

  const { data: job, error: jobErr } = await client
    .from('jobs')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)
    .select(
      'id, customer_id, phone_number, address, service_type, date, scheduled_at, end_time, price, status, crew_salesman_id, notes'
    )
    .single()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // When a salesman is assigned, ensure a crew_days row exists with them as
  // team_lead for that date. WinBros salesmen typically run their own crews;
  // Max can reassign a different team_lead in /crews later if needed.
  if (typeof updates.crew_salesman_id === 'number' && job.date) {
    const { data: existing } = await client
      .from('crew_days')
      .select('id')
      .eq('tenant_id', authResult.tenant.id)
      .eq('date', job.date)
      .eq('team_lead_id', updates.crew_salesman_id)
      .maybeSingle()

    if (!existing) {
      await client.from('crew_days').insert({
        tenant_id: authResult.tenant.id,
        date: job.date,
        team_lead_id: updates.crew_salesman_id,
      })
    }
  }

  return NextResponse.json({ appointment: job })
}
