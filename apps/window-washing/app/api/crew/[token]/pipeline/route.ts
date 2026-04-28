/**
 * GET /api/crew/[token]/pipeline
 *
 * Salesman-only pipeline view: every lead, quote, and job they own where
 * the lifecycle hasn't terminated, grouped by stage.
 *
 *   - leads: assigned_salesman_id = me, status NOT IN (completed, lost, duplicate)
 *   - quotes: salesman_id = me, status NOT IN (converted, declined, expired)
 *   - jobs: any of (salesman_id | credited_salesman_id | crew_salesman_id) = me,
 *           status NOT IN (completed, closed, cancelled)
 *
 * Returns: { leads: [...], quotes: [...], jobs: [...] } each with the
 * minimum fields the /my-pipeline UI needs to render a card. Tech / team
 * lead get 403 — they have /my-day and /schedule for their own work.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

interface PipelineLead {
  id: number
  customer_id: number | null
  name: string | null
  phone_number: string | null
  status: string | null
  updated_at: string | null
  source: string | null
}

interface PipelineQuote {
  id: number
  customer_id: number | null
  customer_name: string | null
  phone_number: string | null
  address: string | null
  status: string | null
  total_price: number | null
  updated_at: string | null
  appointment_job_id: number | null
}

interface PipelineJob {
  id: number
  customer_id: number | null
  customer_name: string | null
  phone_number: string | null
  address: string | null
  service_type: string | null
  status: string | null
  date: string | null
  scheduled_at: string | null
  total_price: number | null
}

const TERMINAL_LEAD_STATUSES = ['completed', 'lost', 'duplicate']
const TERMINAL_QUOTE_STATUSES = ['converted', 'declined', 'expired']
const TERMINAL_JOB_STATUSES = ['completed', 'closed', 'cancelled']

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, tenant_id, employee_type, active')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner || !cleaner.active) {
    return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  }

  if (cleaner.employee_type !== 'salesman') {
    return NextResponse.json(
      { error: 'Pipeline view is for salesmen only' },
      { status: 403 }
    )
  }

  // ──────────────────────────────────────────────────────────────────
  // Open jobs
  // ──────────────────────────────────────────────────────────────────
  const { data: jobsRaw } = await client
    .from('jobs')
    .select(`
      id, date, scheduled_at, service_type, status, total_price, customer_id,
      customer:customer_id ( id, first_name, last_name, phone_number, address )
    `)
    .eq('tenant_id', cleaner.tenant_id)
    .or(`salesman_id.eq.${cleaner.id},credited_salesman_id.eq.${cleaner.id},crew_salesman_id.eq.${cleaner.id}`)
    .not('status', 'in', `(${TERMINAL_JOB_STATUSES.join(',')})`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(200)

  const jobs: PipelineJob[] = (jobsRaw ?? []).map((j) => {
    const c = (j as unknown as {
      customer?: { id?: number; first_name?: string | null; last_name?: string | null; phone_number?: string | null; address?: string | null } | null
    }).customer
    const fullName = c
      ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null
      : null
    return {
      id: j.id,
      customer_id: j.customer_id ?? c?.id ?? null,
      customer_name: fullName,
      phone_number: c?.phone_number ?? null,
      address: c?.address ?? null,
      service_type: j.service_type ?? null,
      status: j.status ?? null,
      date: j.date ?? null,
      scheduled_at: j.scheduled_at ?? null,
      total_price: j.total_price ?? null,
    }
  })

  // ──────────────────────────────────────────────────────────────────
  // Open quotes
  // ──────────────────────────────────────────────────────────────────
  const { data: quotesRaw } = await client
    .from('quotes')
    .select(`
      id, status, total_price, updated_at, customer_name, phone_number, address,
      customer_id, appointment_job_id,
      customer:customer_id ( id, first_name, last_name, phone_number, address )
    `)
    .eq('tenant_id', cleaner.tenant_id)
    .eq('salesman_id', cleaner.id)
    .not('status', 'in', `(${TERMINAL_QUOTE_STATUSES.join(',')})`)
    .order('updated_at', { ascending: false })
    .limit(200)

  const quotes: PipelineQuote[] = (quotesRaw ?? []).map((q) => {
    const c = (q as unknown as {
      customer?: { id?: number; first_name?: string | null; last_name?: string | null; phone_number?: string | null; address?: string | null } | null
    }).customer
    const fullNameFromCustomer = c
      ? [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null
      : null
    return {
      id: q.id,
      customer_id: q.customer_id ?? c?.id ?? null,
      customer_name: fullNameFromCustomer ?? q.customer_name ?? null,
      phone_number: c?.phone_number ?? q.phone_number ?? null,
      address: c?.address ?? q.address ?? null,
      status: q.status ?? null,
      total_price: q.total_price ?? null,
      updated_at: q.updated_at ?? null,
      appointment_job_id: q.appointment_job_id ?? null,
    }
  })

  // ──────────────────────────────────────────────────────────────────
  // Open leads — soft-fail if assigned_salesman_id column doesn't exist
  // ──────────────────────────────────────────────────────────────────
  let leads: PipelineLead[] = []
  try {
    const { data: leadsRaw } = await client
      .from('leads')
      .select('id, customer_id, name, phone_number, status, updated_at, source, assigned_salesman_id')
      .eq('tenant_id', cleaner.tenant_id)
      .eq('assigned_salesman_id', cleaner.id)
      .not('status', 'in', `(${TERMINAL_LEAD_STATUSES.join(',')})`)
      .order('updated_at', { ascending: false })
      .limit(200)

    leads = (leadsRaw ?? []).map((l) => ({
      id: l.id,
      customer_id: l.customer_id ?? null,
      name: l.name ?? null,
      phone_number: l.phone_number ?? null,
      status: l.status ?? null,
      updated_at: l.updated_at ?? null,
      source: l.source ?? null,
    }))
  } catch {
    // Older tenants don't have assigned_salesman_id — return empty leads
    // rather than 500 the whole page.
    leads = []
  }

  return NextResponse.json({ leads, quotes, jobs })
}
