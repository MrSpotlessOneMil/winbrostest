/**
 * Charge Card on File API for Crew Portal
 *
 * POST /api/crew/[token]/job/[jobId]/charge — Charge customer's saved card
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'
import { chargeCardOnFile } from '@/lib/stripe-client'
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
      id, status, price, payment_status, paid,
      customer_id, phone_number,
      customers(id, first_name, phone_number, stripe_customer_id, card_on_file_at)
    `)
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Only allow charging completed jobs
  if (job.status !== 'completed') {
    return NextResponse.json({ error: 'Job must be completed before charging' }, { status: 400 })
  }

  // Prevent double-charge
  if (job.paid || job.payment_status === 'paid') {
    return NextResponse.json({ error: 'Job is already paid' }, { status: 400 })
  }

  const customer = (job as any).customers
  if (!customer?.stripe_customer_id || !customer?.card_on_file_at) {
    return NextResponse.json({ error: 'No card on file for this customer' }, { status: 400 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant || !tenant.stripe_secret_key) {
    return NextResponse.json({ error: 'Payment not configured' }, { status: 400 })
  }

  const amountCents = Math.round((Number(job.price) || 0) * 100)
  if (amountCents <= 0) {
    return NextResponse.json({ error: 'No charge amount' }, { status: 400 })
  }

  // Charge the card
  const result = await chargeCardOnFile(
    tenant.stripe_secret_key,
    customer.stripe_customer_id,
    amountCents,
    {
      job_id: String(job.id),
      tenant_id: cleaner.tenant_id,
      charged_by: cleaner.name || 'crew_portal',
    },
    tenant.currency || 'usd'
  )

  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Charge failed' }, { status: 400 })
  }

  // Update job as paid
  await client
    .from('jobs')
    .update({
      paid: true,
      payment_status: 'paid',
      payment_method: 'card',
      updated_at: new Date().toISOString(),
    })
    .eq('id', parseInt(jobId))

  // Send receipt SMS to customer
  const customerPhone = customer.phone_number || job.phone_number
  if (customerPhone && tenant) {
    try {
      const businessName = tenant.business_name_short || tenant.name
      const amount = (amountCents / 100).toFixed(2)
      await sendSMS(tenant, customerPhone, `Your card has been charged $${amount} for your ${businessName} service. Thank you!`)
    } catch (err) {
      console.error('[crew/charge] Failed to send receipt SMS:', err)
    }
  }

  return NextResponse.json({
    success: true,
    amount: amountCents / 100,
    payment_intent_id: result.paymentIntentId,
  })
}
