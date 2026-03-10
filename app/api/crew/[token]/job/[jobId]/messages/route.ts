/**
 * Cleaner-to-Client Messaging API
 *
 * GET  /api/crew/[token]/job/[jobId]/messages — Message thread for this job
 * POST /api/crew/[token]/job/[jobId]/messages — Send message to customer
 *
 * Messages are proxied through the business OpenPhone number.
 * Cleaner never sees the customer's phone number (except WinBros).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'
import { sendCleanerPortalMessage } from '@/lib/cleaner-sms'

type RouteParams = { params: Promise<{ token: string; jobId: string }> }

async function resolveContext(token: string, jobId: string) {
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) return null

  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .in('status', ['accepted', 'confirmed'])
    .limit(1)
    .maybeSingle()

  if (!assignment) return null

  const { data: job } = await client
    .from('jobs')
    .select('id, customer_id, phone_number, customers(id, phone_number, first_name)')
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) return null

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) return null

  return { cleaner, assignment, job, tenant, client }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { cleaner, job, tenant, client } = ctx
  const customer = (job as any).customers
  const customerId = customer?.id || job.customer_id

  if (!customerId) {
    return NextResponse.json({ messages: [] })
  }

  // Fetch messages relevant to this cleaner's job:
  // 1. Messages sent by this cleaner (via metadata.cleaner_id)
  // 2. Customer inbound messages during active assignment
  // 3. System messages for this job (OMW/HERE/DONE confirmations)
  const { data: messages } = await client
    .from('messages')
    .select('id, content, direction, role, created_at, source, metadata, timestamp')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customerId)
    .order('timestamp', { ascending: true })
    .limit(100)

  // Filter to only show relevant messages
  const filtered = (messages || []).filter((msg: any) => {
    // Messages sent by this cleaner from portal
    if (msg.metadata?.cleaner_id === cleaner.id && msg.metadata?.source === 'cleaner_portal') {
      return true
    }
    // Customer inbound messages (they might be replying to cleaner)
    if (msg.direction === 'inbound' && msg.role === 'client') {
      return true
    }
    // System status notifications (OMW/HERE/DONE sent to customer)
    if (msg.source === 'cleaner_portal' && msg.metadata?.job_id === parseInt(jobId)) {
      return true
    }
    return false
  })

  return NextResponse.json({
    messages: filtered.map((msg: any) => ({
      id: msg.id,
      content: msg.content,
      direction: msg.direction,
      role: msg.role,
      timestamp: msg.timestamp || msg.created_at,
      source: msg.source,
      is_mine: msg.metadata?.cleaner_id === cleaner.id,
    })),
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { content } = body
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'Message content required' }, { status: 400 })
  }

  if (content.length > 1000) {
    return NextResponse.json({ error: 'Message too long (max 1000 chars)' }, { status: 400 })
  }

  const { cleaner, job, tenant, client } = ctx
  const customer = (job as any).customers
  const customerPhone = customer?.phone_number || job.phone_number

  if (!customerPhone) {
    return NextResponse.json({ error: 'No customer phone number' }, { status: 400 })
  }

  // Rate limit: max 10 messages per job per day
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await client
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('source', 'cleaner_portal')
    .gte('timestamp', dayAgo)
    .filter('metadata->>cleaner_id', 'eq', String(cleaner.id))
    .filter('metadata->>job_id', 'eq', jobId)

  if (count && count >= 10) {
    return NextResponse.json({ error: 'Message limit reached (10/day per job)' }, { status: 429 })
  }

  const result = await sendCleanerPortalMessage(
    tenant,
    cleaner,
    customerPhone,
    content.trim(),
    parseInt(jobId),
    customer?.id || job.customer_id
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Failed to send' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
