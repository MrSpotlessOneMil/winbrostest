import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET - Pipeline summary: 7 journey stages aggregated across leads, quotes, jobs, customers
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  // Refresh lifecycle stages first
  await supabase.rpc('refresh_customer_lifecycles', { p_tenant_id: tenant.id })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Run all queries in parallel
  const [
    newLeadsRes,
    engagedRes,
    quotesRes,
    paidRes,
    bookedRes,
    completedRes,
    winBackRes,
    avgPriceRes,
  ] = await Promise.all([
    // 1. New Lead: leads with status = 'new'
    supabase.from('leads')
      .select('id, first_name, last_name, phone_number, source, status, followup_stage, created_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(200),

    // 2. Engaged: leads actively being worked
    supabase.from('leads')
      .select('id, first_name, last_name, phone_number, source, status, followup_stage, last_contact_at, created_at')
      .eq('tenant_id', tenant.id)
      .in('status', ['contacted', 'qualified', 'nurturing', 'escalated'])
      .order('created_at', { ascending: false })
      .limit(200),

    // 3. Quoted: pending/sent quotes
    supabase.from('quotes')
      .select('id, customer_name, customer_phone, customer_id, total, status, token, created_at')
      .eq('tenant_id', tenant.id)
      .in('status', ['pending', 'sent'])
      .order('created_at', { ascending: false })
      .limit(200),

    // 4. Paid: deposit paid but not yet scheduled
    supabase.from('jobs')
      .select('id, phone_number, price, status, payment_status, date, created_at, customer_id')
      .eq('tenant_id', tenant.id)
      .eq('payment_status', 'deposit_paid')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(200),

    // 5. Booked: scheduled / confirmed / in progress
    supabase.from('jobs')
      .select('id, phone_number, price, status, date, cleaner_id, created_at, customer_id')
      .eq('tenant_id', tenant.id)
      .in('status', ['scheduled', 'confirmed', 'in_progress'])
      .order('date', { ascending: true })
      .limit(200),

    // 6. Completed: last 30 days
    supabase.from('jobs')
      .select('id, phone_number, price, status, completed_at, satisfaction_response, review_sent_at, created_at, customer_id')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .gte('completed_at', thirtyDaysAgo)
      .order('completed_at', { ascending: false })
      .limit(200),

    // 7. Win Back: active retargeting or eligible lifecycle stages
    supabase.from('customers')
      .select('id, first_name, last_name, phone_number, lifecycle_stage, retargeting_sequence, retargeting_step, retargeting_enrolled_at, retargeting_completed_at, retargeting_stopped_reason, updated_at')
      .eq('tenant_id', tenant.id)
      .or('retargeting_sequence.not.is.null,lifecycle_stage.in.(one_time,lapsed,lost,unresponsive,quoted_not_booked)')
      .order('updated_at', { ascending: false })
      .limit(200),

    // Avg completed job price for win back value estimates
    supabase.from('jobs')
      .select('price')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .not('price', 'is', null)
      .limit(100),
  ])

  // Customer name lookup for jobs
  const allJobRows = [
    ...(paidRes.data || []),
    ...(bookedRes.data || []),
    ...(completedRes.data || []),
  ]
  const jobCustomerIds = [...new Set(
    allJobRows.map(j => j.customer_id).filter(Boolean)
  )]

  const customerNameMap: Record<number, { first_name: string; last_name: string }> = {}
  if (jobCustomerIds.length > 0) {
    const { data: cNames } = await supabase
      .from('customers')
      .select('id, first_name, last_name')
      .in('id', jobCustomerIds)
    if (cNames) {
      for (const c of cNames) {
        customerNameMap[c.id] = { first_name: c.first_name || '', last_name: c.last_name || '' }
      }
    }
  }

  // Filter quotes: exclude those whose customer already has an active job
  const activeJobCustomerIds = new Set(
    allJobRows.map(j => j.customer_id).filter(Boolean)
  )
  const filteredQuotes = (quotesRes.data || []).filter(q =>
    !q.customer_id || !activeJobCustomerIds.has(q.customer_id)
  )

  // Average job price for win back value estimates
  const prices = (avgPriceRes.data || []).map(j => Number(j.price) || 0).filter(p => p > 0)
  const avgJobPrice = prices.length > 0
    ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    : 0

  // Helpers
  const buildName = (first?: string | null, last?: string | null) =>
    `${first || ''} ${last || ''}`.trim() || 'Unknown'

  const jobName = (j: { customer_id?: number | null; phone_number?: string | null }) => {
    if (j.customer_id && customerNameMap[j.customer_id]) {
      const c = customerNameMap[j.customer_id]
      return buildName(c.first_name, c.last_name)
    }
    return j.phone_number || 'Unknown'
  }

  // Build stages
  const newLeads = newLeadsRes.data || []
  const engaged = engagedRes.data || []
  const paid = paidRes.data || []
  const booked = bookedRes.data || []
  const completed = completedRes.data || []
  const winBack = winBackRes.data || []

  const stages = {
    new_lead: {
      count: newLeads.length,
      value: 0,
      items: newLeads.map(l => ({
        id: `lead-${l.id}`,
        name: buildName(l.first_name, l.last_name),
        phone: l.phone_number || '',
        value: 0,
        status: 'new',
        substatus: l.followup_stage ? `Follow-up ${l.followup_stage}/5` : 'Waiting',
        time: l.created_at,
        source_table: 'lead',
        source: l.source || null,
        followup_stage: l.followup_stage || null,
      })),
    },
    engaged: {
      count: engaged.length,
      value: 0,
      items: engaged.map(l => ({
        id: `lead-${l.id}`,
        name: buildName(l.first_name, l.last_name),
        phone: l.phone_number || '',
        value: 0,
        status: l.status,
        substatus: l.followup_stage
          ? `Follow-up ${l.followup_stage}/5 sent`
          : l.status.charAt(0).toUpperCase() + l.status.slice(1),
        time: l.last_contact_at || l.created_at,
        source_table: 'lead',
        source: l.source || null,
        followup_stage: l.followup_stage || null,
      })),
    },
    quoted: {
      count: filteredQuotes.length,
      value: filteredQuotes.reduce((sum, q) => sum + (Number(q.total) || 0), 0),
      items: filteredQuotes.map(q => ({
        id: `quote-${q.id}`,
        name: q.customer_name || 'Unknown',
        phone: q.customer_phone || '',
        value: Number(q.total) || 0,
        status: q.status,
        substatus: q.status === 'sent' ? 'Quote sent' : 'Quote pending',
        time: q.created_at,
        source_table: 'quote',
        quote_token: q.token || null,
        customer_id: q.customer_id || null,
      })),
    },
    paid: {
      count: paid.length,
      value: paid.reduce((sum, j) => sum + (Number(j.price) || 0), 0),
      items: paid.map(j => ({
        id: `job-${j.id}`,
        name: jobName(j),
        phone: j.phone_number || '',
        value: Number(j.price) || 0,
        status: 'deposit_paid',
        substatus: 'Waiting for scheduling',
        time: j.created_at,
        source_table: 'job',
        customer_id: j.customer_id || null,
      })),
    },
    booked: {
      count: booked.length,
      value: booked.reduce((sum, j) => sum + (Number(j.price) || 0), 0),
      items: booked.map(j => ({
        id: `job-${j.id}`,
        name: jobName(j),
        phone: j.phone_number || '',
        value: Number(j.price) || 0,
        status: j.status,
        substatus: j.status.charAt(0).toUpperCase() + j.status.slice(1).replace('_', ' '),
        time: j.date || j.created_at,
        source_table: 'job',
        cleaner_id: j.cleaner_id || null,
        job_date: j.date || null,
        customer_id: j.customer_id || null,
      })),
    },
    completed: {
      count: completed.length,
      value: completed.reduce((sum, j) => sum + (Number(j.price) || 0), 0),
      items: completed.map(j => ({
        id: `job-${j.id}`,
        name: jobName(j),
        phone: j.phone_number || '',
        value: Number(j.price) || 0,
        status: 'completed',
        substatus: j.satisfaction_response
          ? `Satisfaction: ${j.satisfaction_response}`
          : j.review_sent_at ? 'Review requested' : 'Post-job pending',
        time: j.completed_at || j.created_at,
        source_table: 'job',
        satisfaction_response: j.satisfaction_response || null,
        review_sent_at: j.review_sent_at || null,
        customer_id: j.customer_id || null,
      })),
    },
    win_back: {
      count: winBack.length,
      value: winBack.length * avgJobPrice,
      items: winBack.map(c => ({
        id: `customer-${c.id}`,
        name: buildName(c.first_name, c.last_name),
        phone: c.phone_number || '',
        value: avgJobPrice,
        status: c.retargeting_sequence ? 'in_sequence' : 'eligible',
        substatus: c.retargeting_sequence
          ? `${c.retargeting_sequence} step ${c.retargeting_step || 1}`
          : c.lifecycle_stage || 'eligible',
        time: c.retargeting_enrolled_at || c.updated_at,
        source_table: 'customer',
        retargeting_sequence: c.retargeting_sequence || null,
        retargeting_step: c.retargeting_step || null,
        lifecycle_stage: c.lifecycle_stage || null,
        customer_id: c.id,
      })),
    },
  }

  return NextResponse.json({ stages })
}
