/**
 * Customer Visits API
 * GET /api/actions/customer-visits?customer_id=123 — list visits for a customer
 *
 * Joins visits -> jobs to find all visits belonging to this customer's jobs,
 * and joins visit_line_items for service names.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const customerId = request.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Get all job IDs for this customer
  const { data: customerJobs } = await client
    .from('jobs')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', Number(customerId))

  if (!customerJobs || customerJobs.length === 0) {
    return NextResponse.json({ data: [] })
  }

  const jobIds = customerJobs.map(j => j.id)

  // Get visits for those jobs
  const { data: visits, error } = await client
    .from('visits')
    .select('id, visit_date, status, payment_amount')
    .eq('tenant_id', tenant.id)
    .in('job_id', jobIds)
    .order('visit_date', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!visits || visits.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // Get line items for these visits to populate service names
  const visitIds = visits.map(v => v.id)
  const { data: lineItems } = await client
    .from('visit_line_items')
    .select('visit_id, service_name')
    .in('visit_id', visitIds)

  const lineItemMap: Record<number, string[]> = {}
  if (lineItems) {
    for (const li of lineItems) {
      if (!lineItemMap[li.visit_id]) lineItemMap[li.visit_id] = []
      lineItemMap[li.visit_id].push(li.service_name)
    }
  }

  const result = visits.map(v => ({
    id: v.id,
    visit_date: v.visit_date,
    status: v.status,
    services: lineItemMap[v.id] || [],
    total: Number(v.payment_amount || 0),
  }))

  return NextResponse.json({ data: result })
}
