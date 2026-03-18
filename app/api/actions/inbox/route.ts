/**
 * Inbox API - Conversation queue for owner/VA
 *
 * GET: Returns active conversations sorted by priority
 * GET ?thread=<customerId>: Returns message thread for a customer
 * POST: Actions (take_over, release, resolve)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuthWithTenant } from '@/lib/auth'
import { logSystemEvent } from '@/lib/system-events'

type Priority = 'hot_lead' | 'needs_attention' | 'human_active' | 'ai_handling' | 'waiting'
type Handler = 'ai' | 'human' | 'none'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const searchParams = request.nextUrl.searchParams
  const threadCustomerId = searchParams.get('thread')

  const client = getSupabaseServiceClient()

  // Thread view: return messages for a specific customer
  if (threadCustomerId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: messages } = await client
      .from('messages')
      .select('id, content, timestamp, direction, role, ai_generated, source')
      .eq('customer_id', Number(threadCustomerId))
      .eq('tenant_id', tenant.id)
      .gte('timestamp', thirtyDaysAgo)
      .order('timestamp', { ascending: true })
      .limit(50)

    return NextResponse.json({ messages: messages || [] })
  }

  // Inbox view: return active conversations
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Get distinct customer IDs with recent inbound activity
  const { data: inboundRows } = await client
    .from('messages')
    .select('customer_id')
    .eq('tenant_id', tenant.id)
    .eq('direction', 'inbound')
    .eq('role', 'client')
    .gte('timestamp', sevenDaysAgo)
    .not('customer_id', 'is', null)

  if (!inboundRows || inboundRows.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  const customerIds = [...new Set(
    inboundRows.map((r: { customer_id: number }) => r.customer_id).filter(Boolean)
  )]

  // Get customer data
  const { data: customers } = await client
    .from('customers')
    .select('id, first_name, last_name, phone_number, auto_response_paused, manual_takeover_at, awaiting_reply_since, retargeting_replied_at, retargeting_sequence, retargeting_stopped_reason, lifecycle_stage, sms_opt_out')
    .in('id', customerIds)
    .eq('tenant_id', tenant.id)

  if (!customers || customers.length === 0) {
    return NextResponse.json({ conversations: [] })
  }

  // Get ML scores for these customers
  const { data: scores } = await client
    .from('customer_scores')
    .select('customer_id, lead_score, segment, best_contact_hour, churn_risk, response_likelihood')
    .in('customer_id', customerIds)
    .eq('tenant_id', tenant.id)

  const scoreMap = new Map(
    (scores || []).map((s: any) => [s.customer_id, s])
  )

  // Get recent messages for all these customers (batch)
  const { data: messages } = await client
    .from('messages')
    .select('customer_id, content, timestamp, direction, role, ai_generated, source')
    .in('customer_id', customerIds)
    .eq('tenant_id', tenant.id)
    .gte('timestamp', sevenDaysAgo)
    .order('timestamp', { ascending: false })
    .limit(2000)

  // Group messages by customer
  const messagesByCustomer = new Map<number, typeof messages>()
  for (const msg of messages || []) {
    if (!msg.customer_id) continue
    const cid = msg.customer_id as number
    if (!messagesByCustomer.has(cid)) {
      messagesByCustomer.set(cid, [])
    }
    messagesByCustomer.get(cid)!.push(msg)
  }

  // Build conversation objects
  const conversations = customers.map((c: any) => {
    const msgs = messagesByCustomer.get(c.id) || []
    const lastInbound = msgs.find((m: any) => m.direction === 'inbound' && m.role === 'client')
    const lastOutbound = msgs.find((m: any) => m.direction === 'outbound')

    // Unresponded: last message from customer, no outbound reply after it
    const unresponded = !!(lastInbound && (!lastOutbound || new Date(lastInbound.timestamp) > new Date(lastOutbound.timestamp)))

    const minutesSinceLastInbound = lastInbound
      ? Math.floor((Date.now() - new Date(lastInbound.timestamp).getTime()) / 60000)
      : 9999

    // Determine handler
    let handler: Handler = 'none'
    if (c.manual_takeover_at || c.auto_response_paused) handler = 'human'
    else if (lastOutbound?.ai_generated) handler = 'ai'

    // Determine priority
    let priority: Priority = 'waiting'

    const isHotLead = c.retargeting_replied_at
      && !['converted', 'opted_out'].includes(c.retargeting_stopped_reason || '')

    if (isHotLead && unresponded) {
      priority = 'hot_lead'
    } else if (handler === 'human') {
      priority = 'human_active'
    } else if (unresponded && minutesSinceLastInbound > 15) {
      priority = 'needs_attention'
    } else if (unresponded) {
      // Recently unresponded (< 15 min) -- AI is probably about to handle it
      priority = 'needs_attention'
    } else if (handler === 'ai') {
      priority = 'ai_handling'
    }

    // Context label
    let context = 'Customer'
    if (c.retargeting_replied_at) context = 'Retargeting reply'
    else if (c.lifecycle_stage === 'new' || !c.lifecycle_stage) context = 'New contact'

    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'

    return {
      id: c.id,
      name,
      phone: c.phone_number || '',
      priority,
      handler,
      lastInbound: lastInbound
        ? { content: lastInbound.content || '', timestamp: lastInbound.timestamp }
        : null,
      lastOutbound: lastOutbound
        ? {
            content: lastOutbound.content || '',
            timestamp: lastOutbound.timestamp,
            aiGenerated: !!lastOutbound.ai_generated,
            source: lastOutbound.source || '',
          }
        : null,
      context,
      unresponded,
      minutesSinceLastInbound,
      messagesCount: msgs.length,
      optedOut: !!c.sms_opt_out,
      // ML scores from Osiris Brain
      leadScore: scoreMap.get(c.id)?.lead_score ?? null,
      segment: scoreMap.get(c.id)?.segment ?? null,
      bestContactHour: scoreMap.get(c.id)?.best_contact_hour ?? null,
      churnRisk: scoreMap.get(c.id)?.churn_risk ?? null,
      responseLikelihood: scoreMap.get(c.id)?.response_likelihood ?? null,
    }
  })

  // Sort by priority first, then by lead_score within same priority
  const priorityOrder: Record<Priority, number> = {
    hot_lead: 0,
    needs_attention: 1,
    human_active: 2,
    ai_handling: 3,
    waiting: 4,
  }

  conversations.sort((a: any, b: any) => {
    const pa = priorityOrder[a.priority as Priority] ?? 99
    const pb = priorityOrder[b.priority as Priority] ?? 99
    if (pa !== pb) return pa - pb
    // Within same priority, higher lead score first
    const sa = a.leadScore ?? 0
    const sb = b.leadScore ?? 0
    if (sa !== sb) return sb - sa
    return a.minutesSinceLastInbound - b.minutesSinceLastInbound
  })

  return NextResponse.json({ conversations })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant, user } = authResult

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, customerId } = body
  if (!action || !customerId) {
    return NextResponse.json({ error: 'Missing action or customerId' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Verify customer belongs to tenant
  const { data: customer } = await client
    .from('customers')
    .select('id, tenant_id, phone_number')
    .eq('id', customerId)
    .eq('tenant_id', tenant.id)
    .single()

  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  switch (action) {
    case 'take_over': {
      await client
        .from('customers')
        .update({
          auto_response_paused: true,
          manual_takeover_at: new Date().toISOString(),
        })
        .eq('id', customerId)

      // Cancel retargeting tasks
      await client
        .from('scheduled_tasks')
        .update({ status: 'cancelled' })
        .like('task_key', `retarget-${customerId}-%`)
        .eq('status', 'pending')
        .eq('tenant_id', tenant.id)

      // Pause lead follow-ups
      const { data: activeLead } = await client
        .from('leads')
        .select('id, form_data')
        .eq('phone_number', customer.phone_number)
        .eq('tenant_id', tenant.id)
        .in('status', ['new', 'contacted', 'qualified'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeLead) {
        const fd = typeof activeLead.form_data === 'object' && activeLead.form_data ? activeLead.form_data : {}
        await client.from('leads').update({ form_data: { ...fd, followup_paused: true } }).eq('id', activeLead.id)
      }

      await logSystemEvent({
        source: 'dashboard',
        event_type: 'MANUAL_TAKEOVER',
        message: `${user.display_name || user.username} took over conversation with customer ${customerId}`,
        tenant_id: tenant.id,
        phone_number: customer.phone_number,
        metadata: { customerId, userId: user.id, source: 'inbox' },
      })

      return NextResponse.json({ success: true, action: 'take_over' })
    }

    case 'release': {
      await client
        .from('customers')
        .update({
          auto_response_paused: false,
          manual_takeover_at: null,
        })
        .eq('id', customerId)

      // Unpause lead follow-ups
      const { data: pausedLead } = await client
        .from('leads')
        .select('id, form_data')
        .eq('phone_number', customer.phone_number)
        .eq('tenant_id', tenant.id)
        .in('status', ['new', 'contacted', 'qualified'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (pausedLead) {
        const fd = typeof pausedLead.form_data === 'object' && pausedLead.form_data ? pausedLead.form_data : {}
        await client.from('leads').update({ form_data: { ...fd, followup_paused: false } }).eq('id', pausedLead.id)
      }

      await logSystemEvent({
        source: 'dashboard',
        event_type: 'MANUAL_RELEASE',
        message: `${user.display_name || user.username} released customer ${customerId} back to AI`,
        tenant_id: tenant.id,
        phone_number: customer.phone_number,
        metadata: { customerId, userId: user.id, source: 'inbox' },
      })

      return NextResponse.json({ success: true, action: 'release' })
    }

    case 'resolve': {
      await client
        .from('customers')
        .update({
          awaiting_reply_since: null,
          auto_response_paused: false,
          manual_takeover_at: null,
        })
        .eq('id', customerId)

      return NextResponse.json({ success: true, action: 'resolve' })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
