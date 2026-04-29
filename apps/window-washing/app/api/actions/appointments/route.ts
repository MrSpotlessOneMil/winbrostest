import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { upsertPendingAppointmentCredit } from '@/lib/appointment-commission'
import { renderTemplate, resolveAutomatedMessage } from '@/lib/automated-messages'

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

  // PRD #2 — Sales Appointments must surface salesmen only. Resolve the
  // tenant's salesmen first so we can constrain appointments to jobs
  // assigned to a salesman (or unassigned).
  const { data: salesmen, error: salesmenErr } = await client
    .from('cleaners')
    .select('id, name, employee_type, is_team_lead')
    .eq('tenant_id', tenantId)
    .eq('employee_type', 'salesman')
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (salesmenErr) return NextResponse.json({ error: salesmenErr.message }, { status: 500 })

  const salesmanIds = (salesmen ?? []).map((s) => s.id)

  let appointmentsQuery = client
    .from('jobs')
    .select(
      'id, customer_id, phone_number, address, service_type, date, scheduled_at, end_time, price, status, crew_salesman_id, notes'
    )
    .eq('tenant_id', tenantId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })
    .order('scheduled_at', { ascending: true })

  // Constrain crew_salesman_id to NULL or IN (salesmen). This filters out
  // any historical row where a technician was accidentally assigned.
  if (salesmanIds.length > 0) {
    appointmentsQuery = appointmentsQuery.or(
      `crew_salesman_id.is.null,crew_salesman_id.in.(${salesmanIds.join(',')})`,
    )
  } else {
    // No salesmen seeded for this tenant — only show unassigned slots
    appointmentsQuery = appointmentsQuery.is('crew_salesman_id', null)
  }

  const { data: appointments, error: jobsErr } = await appointmentsQuery
  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 })

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

  // Phase F: log a pending 12.5% credit if the appointment was created
  // already-assigned to a salesman with a price. Helper is idempotent and
  // skips silently when either piece is missing — admins typically drag
  // the appointment onto a salesman after creation, which is handled in
  // PATCH below.
  if (
    data &&
    typeof data.crew_salesman_id === 'number' &&
    typeof data.price === 'number' &&
    data.price > 0
  ) {
    await upsertPendingAppointmentCredit(client, {
      tenantId: authResult.tenant.id,
      appointmentJobId: data.id,
      salesmanId: data.crew_salesman_id,
      appointmentPrice: data.price,
    })
  }

  // Phase G: send the editable `appointment_confirm` SMS once we have a
  // customer phone. Skipped silently if no template + no phone, or if the
  // admin paused the template via is_active=false.
  if (data?.id) {
    void sendAppointmentConfirm(client, authResult.tenant, data.id).catch((err) => {
      console.error('[appointments] appointment_confirm send failed:', err)
    })
  }

  return NextResponse.json({ appointment: data })
}

async function sendAppointmentConfirm(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: { id: string; business_name_short?: string | null; name?: string | null },
  appointmentId: number,
): Promise<void> {
  const { data: appt } = await client
    .from('jobs')
    .select(
      'id, date, scheduled_at, phone_number, customer_id, customers:customer_id(first_name, phone_number)'
    )
    .eq('id', appointmentId)
    .maybeSingle()

  const customer = (appt as any)?.customers
  const phone = customer?.phone_number || appt?.phone_number
  if (!phone) return

  const fallback = `Hi {{customer_name}}! Your appointment with {{business_name}} is set for {{date}} at {{time}}. We'll be there!`
  const resolved = await resolveAutomatedMessage(client, {
    tenantId: tenant.id,
    trigger: 'appointment_confirm',
    fallbackBody: fallback,
  })
  if (!resolved.isActive) return

  const businessName = tenant.business_name_short || tenant.name || 'WinBros'
  const message = renderTemplate(resolved.body, {
    customer_name: customer?.first_name || 'there',
    business_name: businessName,
    date: appt?.date || '',
    time: appt?.scheduled_at || '',
  })

  const { sendSMS } = await import('@/lib/openphone')
  await sendSMS(tenant as any, phone, message)
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

  // Phase F: log/refresh the pending appointment credit when a salesman is
  // assigned (or re-assigned). Idempotent + price-aware: if the appointment
  // has no price yet, nothing happens; price added later still gets a
  // pending credit on the next PATCH.
  if (
    typeof job.crew_salesman_id === 'number' &&
    typeof job.price === 'number' &&
    job.price > 0
  ) {
    await upsertPendingAppointmentCredit(client, {
      tenantId: authResult.tenant.id,
      appointmentJobId: job.id,
      salesmanId: job.crew_salesman_id,
      appointmentPrice: job.price,
    })
  }

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
