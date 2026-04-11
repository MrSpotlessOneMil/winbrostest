/**
 * GET /api/actions/attention-needed
 *
 * Aggregates items that need human attention RIGHT NOW:
 * - Unanswered customer messages (inbound, no reply in 30+ min)
 * - Failed payments
 * - Declined cleaner assignments with no replacement
 * - Upcoming jobs with no cleaner assigned
 * - Stale quotes (sent >24h, no response)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

interface AttentionItem {
  id: string
  type: 'message' | 'payment' | 'cleaner' | 'unassigned' | 'quote'
  priority: 'high' | 'medium' | 'low'
  title: string
  action: string
  customer_name: string | null
  phone: string | null
  link: string | null
  time: string
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()
  const now = new Date()
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const today = now.toISOString().slice(0, 10)
  const threeDaysOut = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const items: AttentionItem[] = []

  // 1. Unanswered customer messages (inbound, no outbound reply in 30+ min)
  try {
    const { data: unanswered } = await supabase.rpc('get_unanswered_messages', {
      p_tenant_id: tenant.id,
      p_since: thirtyMinAgo,
    }).limit(10)

    // Fallback: manual query if RPC doesn't exist
    if (!unanswered) {
      const { data: recentInbound } = await supabase
        .from('messages')
        .select('id, phone_number, content, timestamp, customer_id, customers(first_name, last_name)')
        .eq('tenant_id', tenant.id)
        .eq('direction', 'inbound')
        .eq('role', 'client')
        .lt('timestamp', thirtyMinAgo)
        .gte('timestamp', twentyFourHoursAgo)
        .order('timestamp', { ascending: false })
        .limit(20)

      if (recentInbound) {
        // Check which ones have no outbound reply after them
        for (const msg of recentInbound) {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', tenant.id)
            .eq('phone_number', msg.phone_number)
            .eq('direction', 'outbound')
            .gt('timestamp', msg.timestamp)

          if (!count || count === 0) {
            const customer = (msg as any).customers
            const name = customer ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() : null
            items.push({
              id: `msg-${msg.id}`,
              type: 'message',
              priority: 'high',
              title: `${name || msg.phone_number} — no reply`,
              action: 'Respond to message',
              customer_name: name,
              phone: msg.phone_number,
              link: `/inbox?phone=${encodeURIComponent(msg.phone_number)}`,
              time: msg.timestamp,
            })
          }
        }
      }
    }
  } catch {}

  // 2. Failed payments
  try {
    const { data: failedPayments } = await supabase
      .from('jobs')
      .select('id, phone_number, price, date, customer_id, customers(first_name)')
      .eq('tenant_id', tenant.id)
      .eq('payment_status', 'payment_failed')
      .not('status', 'eq', 'cancelled')
      .order('date', { ascending: true })
      .limit(10)

    for (const job of failedPayments || []) {
      const customer = (job as any).customers
      items.push({
        id: `pay-${job.id}`,
        type: 'payment',
        priority: 'high',
        title: `Payment failed — Job #${job.id} ($${Number(job.price || 0).toFixed(0)})`,
        action: 'Retry payment',
        customer_name: customer?.first_name || null,
        phone: job.phone_number,
        link: `/jobs?job=${job.id}`,
        time: job.date || now.toISOString(),
      })
    }
  } catch {}

  // 3. Upcoming jobs with no cleaner assigned (next 3 days)
  try {
    const { data: unassigned } = await supabase
      .from('jobs')
      .select('id, phone_number, date, scheduled_at, address, service_type, customer_id, customers(first_name)')
      .eq('tenant_id', tenant.id)
      .in('status', ['scheduled', 'pending'])
      .is('cleaner_id', null)
      .gte('date', today)
      .lte('date', threeDaysOut)
      .order('date', { ascending: true })
      .limit(10)

    for (const job of unassigned || []) {
      const customer = (job as any).customers
      const jobDate = job.date ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'
      const jobTime = job.scheduled_at ? new Date(job.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
      const service = job.service_type ? job.service_type.replace(/_/g, ' ') : 'Job'
      const timeStr = [jobDate, jobTime].filter(Boolean).join(' at ')
      items.push({
        id: `unassigned-${job.id}`,
        type: 'unassigned',
        priority: job.date === today ? 'high' : 'medium',
        title: `${customer?.first_name || 'Customer'} — ${service} — ${timeStr} — No cleaner assigned`,
        action: 'Assign cleaner',
        customer_name: customer?.first_name || null,
        phone: job.phone_number,
        link: `/jobs?job=${job.id}`,
        time: job.date || now.toISOString(),
      })
    }
  } catch {}

  // 4. Declined assignments with no replacement
  try {
    const { data: declined } = await supabase
      .from('cleaner_assignments')
      .select('id, job_id, cleaner_id, created_at, jobs!inner(id, date, phone_number, status, customers(first_name))')
      .eq('tenant_id', tenant.id)
      .eq('status', 'declined')
      .in('jobs.status', ['scheduled', 'pending'])
      .gte('jobs.date', today)
      .order('created_at', { ascending: false })
      .limit(10)

    // Filter to only show jobs that STILL have no accepted/confirmed assignment
    for (const d of declined || []) {
      const { count } = await supabase
        .from('cleaner_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', d.job_id)
        .in('status', ['accepted', 'confirmed'])

      if (!count || count === 0) {
        const job = (d as any).jobs
        const customer = job?.customers
        const jobDate = job?.date ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
        items.push({
          id: `declined-${d.id}`,
          type: 'cleaner',
          priority: 'high',
          title: `${customer?.first_name || 'Customer'} — ${jobDate ? jobDate + ' — ' : ''}Cleaner declined, needs reassignment`,
          action: 'Reassign cleaner',
          customer_name: customer?.first_name || null,
          phone: job?.phone_number || null,
          link: `/jobs?job=${d.job_id}`,
          time: d.created_at,
        })
      }
    }
  } catch {}

  // 5. Stale quotes (sent >24h ago, no job created)
  try {
    const { data: staleQuotes } = await supabase
      .from('quotes')
      .select('id, customer_name, customer_phone, total, created_at, status')
      .eq('tenant_id', tenant.id)
      .eq('status', 'sent')
      .lt('created_at', twentyFourHoursAgo)
      .order('created_at', { ascending: false })
      .limit(10)

    for (const q of staleQuotes || []) {
      items.push({
        id: `quote-${q.id}`,
        type: 'quote',
        priority: 'medium',
        title: `Quote stale — ${q.customer_name} ($${Number(q.total || 0).toFixed(0)})`,
        action: 'Follow up on quote',
        customer_name: q.customer_name,
        phone: q.customer_phone,
        link: `/quotes`,
        time: q.created_at,
      })
    }
  } catch {}

  // Sort: high priority first, then by time (most recent first)
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  items.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (pDiff !== 0) return pDiff
    return new Date(b.time).getTime() - new Date(a.time).getTime()
  })

  return NextResponse.json({ items: items.slice(0, 15) })
}
