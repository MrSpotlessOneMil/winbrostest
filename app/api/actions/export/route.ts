/**
 * CSV Export Action Endpoint
 *
 * POST /api/actions/export
 * Body: { type: 'customers' | 'jobs', dateRange?: { start: string, end: string } }
 *
 * Returns CSV file as attachment download.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  let str = String(value)
  // Prevent CSV formula injection (Excel/Sheets execute =, +, -, @ as formulas)
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes("'")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',')
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { type?: string; dateRange?: { start?: string; end?: string } }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const exportType = body.type
  if (exportType !== 'customers' && exportType !== 'jobs') {
    return NextResponse.json({ error: 'type must be "customers" or "jobs"' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const today = new Date().toISOString().split('T')[0]

  if (exportType === 'customers') {
    // Fetch customers with their most recent completed job date
    const { data: customers, error } = await client
      .from('customers')
      .select('id, first_name, last_name, phone_number, email, address, notes, lifecycle_stage, created_at')
      .eq('tenant_id', tenant.id)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get last service date per customer
    const customerIds = (customers || []).map(c => c.id)
    const lastServiceMap = new Map<number, string>()

    if (customerIds.length > 0) {
      const { data: jobs } = await client
        .from('jobs')
        .select('customer_id, completed_at')
        .eq('tenant_id', tenant.id)
        .eq('status', 'completed')
        .in('customer_id', customerIds)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })

      for (const job of jobs || []) {
        if (job.customer_id && !lastServiceMap.has(job.customer_id)) {
          lastServiceMap.set(job.customer_id, job.completed_at!.split('T')[0])
        }
      }
    }

    const headers = ['First Name', 'Last Name', 'Phone', 'Email', 'Address', 'Last Service Date', 'Lifecycle Stage', 'Notes', 'Created']
    const rows = (customers || []).map(c => toCsvRow([
      c.first_name,
      c.last_name,
      c.phone_number,
      c.email,
      c.address,
      lastServiceMap.get(c.id) || '',
      c.lifecycle_stage,
      c.notes,
      c.created_at?.split('T')[0],
    ]))

    const csv = [toCsvRow(headers), ...rows].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${tenant.slug}-customers-${today}.csv"`,
      },
    })
  }

  // Jobs export
  let jobsQuery = client
    .from('jobs')
    .select('id, date, phone_number, address, service_type, status, price, completed_at, notes, customer_id, customers(first_name, last_name, phone_number)')
    .eq('tenant_id', tenant.id)
    .order('date', { ascending: false })

  if (body.dateRange?.start) {
    jobsQuery = jobsQuery.gte('date', body.dateRange.start)
  }
  if (body.dateRange?.end) {
    jobsQuery = jobsQuery.lte('date', body.dateRange.end)
  }

  const { data: jobs, error: jobsError } = await jobsQuery

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 })
  }

  const jobHeaders = ['Date', 'Customer Name', 'Phone', 'Address', 'Service Type', 'Status', 'Price', 'Completed At', 'Notes']
  const jobRows = (jobs || []).map((j: any) => {
    const customer = j.customers as { first_name?: string; last_name?: string; phone_number?: string } | null
    const name = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') : ''
    const phone = customer?.phone_number || j.phone_number
    return toCsvRow([
      j.date?.split('T')[0],
      name,
      phone,
      j.address,
      j.service_type,
      j.status,
      j.price != null ? `$${(j.price / 100).toFixed(2)}` : '',
      j.completed_at?.split('T')[0],
      j.notes,
    ])
  })

  const jobsCsv = [toCsvRow(jobHeaders), ...jobRows].join('\n')
  return new Response(jobsCsv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${tenant.slug}-jobs-${today}.csv"`,
    },
  })
}
