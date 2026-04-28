/**
 * POST /api/actions/send-review-link
 *   Body: { jobId: number }
 *
 *   Sends the Google review request SMS to the customer for a given job.
 *   Reuses `buildReviewMessage` from lib/close-job.ts so the wording stays
 *   in sync with the auto-on-close message.
 *
 *   Manual button on the JobDetailDrawer — useful when a tech wants to
 *   send the review link separately (e.g. after a follow-up visit) or when
 *   the auto-on-close path was skipped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { buildReviewMessage } from '@/lib/close-job'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { jobId: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  const reviewLink = (tenant as unknown as { workflow_config?: Record<string, unknown> }).workflow_config?.google_review_link as string | undefined
  if (!reviewLink) {
    return NextResponse.json(
      { error: 'No google_review_link configured for this tenant. Set it in admin > tenant settings.' },
      { status: 412 }
    )
  }

  const client = getSupabaseServiceClient()

  const { data: job } = await client
    .from('jobs')
    .select(`
      id, tenant_id, phone_number,
      customers:customer_id ( first_name, last_name, phone_number )
    `)
    .eq('id', body.jobId)
    .single()

  if (!job || job.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const customer = (job as unknown as {
    customers?: { first_name?: string | null; last_name?: string | null; phone_number?: string | null } | null
  }).customers ?? null
  const phone = customer?.phone_number || job.phone_number
  if (!phone) {
    return NextResponse.json({ error: 'No phone number on file for this job' }, { status: 422 })
  }

  const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'there'
  const message = buildReviewMessage(customerName, reviewLink)

  await sendSMS(tenant, phone, message)

  await client
    .from('jobs')
    .update({ review_requested_at: new Date().toISOString() })
    .eq('id', body.jobId)

  return NextResponse.json({ success: true, sent_to: phone })
}
