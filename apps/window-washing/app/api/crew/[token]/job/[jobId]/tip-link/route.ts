/**
 * Send Tip Link API for Crew Portal
 *
 * POST /api/crew/[token]/job/[jobId]/tip-link — SMS customer a tip link
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

type RouteParams = { params: Promise<{ token: string; jobId: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const client = getSupabaseServiceClient()

  // Resolve cleaner by portal token
  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Verify assignment
  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .in('status', ['accepted', 'confirmed'])
    .maybeSingle()

  if (!assignment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get job with customer info
  const { data: job } = await client
    .from('jobs')
    .select(`
      id, status, phone_number,
      customers(first_name, phone_number)
    `)
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job || job.status !== 'completed') {
    return NextResponse.json({ error: 'Job must be completed' }, { status: 400 })
  }

  const customer = (job as any).customers
  const customerPhone = customer?.phone_number || job.phone_number
  if (!customerPhone) {
    return NextResponse.json({ error: 'No customer phone number' }, { status: 400 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const domain = process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live'
  const tipLink = `${domain}/tip/${job.id}`
  const businessName = tenant.business_name_short || tenant.name
  const customerName = customer?.first_name || 'there'

  await sendSMS(
    tenant,
    customerPhone,
    `Hey ${customerName}! Thank you for choosing ${businessName}. If you'd like to leave a tip for your crew, you can do so here: ${tipLink}`,
    { skipThrottle: true, bypassFilters: true }
  )

  return NextResponse.json({ success: true })
}
