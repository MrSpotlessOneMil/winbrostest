/**
 * GET /api/crew/[token]/customers
 *
 * Returns the list of customers a crew member should see in their
 * /my-customers chat inbox.
 *
 * Role rules:
 *   - technician / team_lead: customers who have a job assigned to this
 *     cleaner today OR tomorrow (i.e. who they're about to interact with).
 *   - salesman: every customer linked to their salesman_id via leads,
 *     quotes, or jobs where the lifecycle hasn't completed yet (status
 *     not in completed | closed | cancelled).
 *
 * Returns: { customers: [{ id, first_name, last_name, phone_number, address,
 *   relation: 'job_today' | 'job_tomorrow' | 'lead' | 'quote' | 'job_open',
 *   most_recent_at, summary }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

interface CustomerRow {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  address: string | null
}

interface MyCustomerCard {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  address: string | null
  relation: 'job_today' | 'job_tomorrow' | 'lead' | 'quote' | 'job_open'
  most_recent_at: string | null
  summary: string
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tomorrowIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, tenant_id, employee_type, is_team_lead, active')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner || !cleaner.active) {
    return NextResponse.json({ error: 'Invalid portal link' }, { status: 404 })
  }

  const cards = new Map<number, MyCustomerCard>()
  const today = todayIso()
  const tomorrow = tomorrowIso()
  const isSalesman = cleaner.employee_type === 'salesman'

  // ──────────────────────────────────────────────────────────────────
  // Tech / Team Lead path: today + tomorrow's jobs assigned to me.
  // ──────────────────────────────────────────────────────────────────
  if (!isSalesman) {
    const { data: jobs } = await client
      .from('jobs')
      .select(`
        id, date, scheduled_at, service_type, status,
        customer:customer_id ( id, first_name, last_name, phone_number, address )
      `)
      .eq('tenant_id', cleaner.tenant_id)
      .or(`cleaner_id.eq.${cleaner.id},crew_salesman_id.eq.${cleaner.id}`)
      .in('date', [today, tomorrow])

    for (const job of jobs ?? []) {
      const c = (job as unknown as { customer?: CustomerRow | null }).customer
      if (!c?.id) continue
      const relation: MyCustomerCard['relation'] =
        job.date === today ? 'job_today' : 'job_tomorrow'
      // Tech may have multiple jobs for the same customer in the window —
      // keep the today card if it exists, since today wins.
      const existing = cards.get(c.id)
      if (existing && existing.relation === 'job_today') continue
      cards.set(c.id, {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone_number: c.phone_number,
        address: c.address,
        relation,
        most_recent_at: job.scheduled_at ?? job.date ?? null,
        summary: `${job.service_type ?? 'Service'} ${relation === 'job_today' ? 'today' : 'tomorrow'}`,
      })
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Salesman path: every active customer tagged to me via leads / quotes
  // / jobs whose lifecycle hasn't terminated.
  // ──────────────────────────────────────────────────────────────────
  if (isSalesman) {
    const TERMINAL_JOB_STATUSES = ['completed', 'closed', 'cancelled']
    const TERMINAL_QUOTE_STATUSES = ['converted', 'declined', 'expired']

    // Open jobs attributed to this salesman
    const { data: openJobs } = await client
      .from('jobs')
      .select(`
        id, date, scheduled_at, service_type, status, updated_at,
        customer:customer_id ( id, first_name, last_name, phone_number, address )
      `)
      .eq('tenant_id', cleaner.tenant_id)
      .or(`salesman_id.eq.${cleaner.id},credited_salesman_id.eq.${cleaner.id},crew_salesman_id.eq.${cleaner.id}`)
      .not('status', 'in', `(${TERMINAL_JOB_STATUSES.join(',')})`)

    for (const job of openJobs ?? []) {
      const c = (job as unknown as { customer?: CustomerRow | null }).customer
      if (!c?.id) continue
      const relation: MyCustomerCard['relation'] =
        job.date === today ? 'job_today'
        : job.date === tomorrow ? 'job_tomorrow'
        : 'job_open'
      cards.set(c.id, {
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone_number: c.phone_number,
        address: c.address,
        relation,
        most_recent_at: job.scheduled_at ?? job.date ?? job.updated_at ?? null,
        summary: `${job.service_type ?? 'Job'} · ${job.status}`,
      })
    }

    // Open quotes
    const { data: openQuotes } = await client
      .from('quotes')
      .select(`
        id, status, updated_at, customer_name, phone_number, address,
        customer:customer_id ( id, first_name, last_name, phone_number, address )
      `)
      .eq('tenant_id', cleaner.tenant_id)
      .eq('salesman_id', cleaner.id)
      .not('status', 'in', `(${TERMINAL_QUOTE_STATUSES.join(',')})`)

    for (const quote of openQuotes ?? []) {
      const c = (quote as unknown as { customer?: CustomerRow | null }).customer
      const id = c?.id
      if (!id) continue
      // Don't downgrade a job_today/tomorrow card to a quote card.
      if (cards.has(id)) continue
      cards.set(id, {
        id,
        first_name: c.first_name,
        last_name: c.last_name,
        phone_number: c.phone_number ?? quote.phone_number,
        address: c.address ?? quote.address,
        relation: 'quote',
        most_recent_at: quote.updated_at ?? null,
        summary: `Quote · ${quote.status}`,
      })
    }

    // Open leads (assuming leads has assigned_salesman_id; we soft-fail if column missing)
    try {
      const { data: openLeads } = await client
        .from('leads')
        .select('id, status, customer_id, phone_number, name, updated_at')
        .eq('tenant_id', cleaner.tenant_id)
        .eq('assigned_salesman_id', cleaner.id)
        .not('status', 'in', '(completed,lost,duplicate)')

      const leadCustomerIds = (openLeads ?? [])
        .map(l => l.customer_id)
        .filter((x): x is number => typeof x === 'number')

      if (leadCustomerIds.length) {
        const { data: leadCustomers } = await client
          .from('customers')
          .select('id, first_name, last_name, phone_number, address')
          .in('id', leadCustomerIds)
          .eq('tenant_id', cleaner.tenant_id)

        const customerById = new Map(
          (leadCustomers ?? []).map(c => [c.id, c as CustomerRow])
        )

        for (const lead of openLeads ?? []) {
          const id = lead.customer_id
          if (!id || cards.has(id)) continue
          const c = customerById.get(id)
          if (!c) continue
          cards.set(id, {
            id,
            first_name: c.first_name,
            last_name: c.last_name,
            phone_number: c.phone_number ?? lead.phone_number,
            address: c.address,
            relation: 'lead',
            most_recent_at: lead.updated_at ?? null,
            summary: `Lead · ${lead.status}`,
          })
        }
      }
    } catch {
      // assigned_salesman_id may not exist on leads in older tenants —
      // soft-fail rather than 500 the whole inbox.
    }
  }

  const ordered = Array.from(cards.values()).sort((a, b) => {
    // Today > tomorrow > open job > quote > lead, then by recency.
    const rank: Record<MyCustomerCard['relation'], number> = {
      job_today: 0, job_tomorrow: 1, job_open: 2, quote: 3, lead: 4,
    }
    if (rank[a.relation] !== rank[b.relation]) return rank[a.relation] - rank[b.relation]
    if (a.most_recent_at && b.most_recent_at) {
      return b.most_recent_at.localeCompare(a.most_recent_at)
    }
    return 0
  })

  return NextResponse.json({ customers: ordered })
}
