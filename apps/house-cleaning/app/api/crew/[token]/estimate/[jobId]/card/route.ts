/**
 * Card Capture API for Salesman Estimate Portal
 *
 * POST /api/crew/[token]/estimate/[jobId]/card
 *   - action: "setup_intent" -> Creates Stripe SetupIntent, returns client_secret
 *   - action: "send_link"    -> Sends card-on-file link to customer via SMS
 *
 * Public (no auth - token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'
import { getStripeClientForTenant, findOrCreateStripeCustomer } from '@/lib/stripe-client'
import { getClientConfig } from '@/lib/client-config'

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

  // Verify assignment exists
  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .in('status', ['pending', 'accepted', 'confirmed'])
    .maybeSingle()

  if (!assignment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get job + customer
  const { data: job } = await client
    .from('jobs')
    .select(`
      id, phone_number, address, service_type, date, scheduled_at, price,
      customer_id, tenant_id,
      customers(id, first_name, last_name, phone_number, email, address, stripe_customer_id)
    `)
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  if (!tenant.stripe_secret_key) {
    return NextResponse.json({ error: 'Stripe not configured for this tenant' }, { status: 400 })
  }

  const customer = (job as any).customers
  const customerPhone = customer?.phone_number || job.phone_number
  const customerEmail = customer?.email

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action as string

  if (action === 'setup_intent') {
    // Create a Stripe SetupIntent for inline card collection
    if (!customerEmail) {
      return NextResponse.json({ error: 'Customer email required for card capture. Ask for their email first.' }, { status: 400 })
    }

    try {
      const stripe = getStripeClientForTenant(tenant.stripe_secret_key)

      // Find or create Stripe customer
      const stripeCustomer = await findOrCreateStripeCustomer(
        { phone_number: customerPhone, email: customerEmail, first_name: customer?.first_name, last_name: customer?.last_name } as any,
        tenant.stripe_secret_key
      )

      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomer.id,
        payment_method_types: ['card'],
        metadata: {
          job_id: jobId,
          phone_number: customerPhone || '',
          purpose: 'estimate_card_capture',
          tenant_id: tenant.id,
        },
      })

      return NextResponse.json({
        success: true,
        client_secret: setupIntent.client_secret,
        stripe_customer_id: stripeCustomer.id,
        publishable_key: tenant.stripe_publishable_key || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      })
    } catch (err) {
      console.error('[estimate/card] SetupIntent creation failed:', err)
      return NextResponse.json({ error: 'Failed to create card setup' }, { status: 500 })
    }
  } else if (action === 'send_link') {
    // Send card-on-file link via SMS (for when salesman doesn't collect on spot)
    if (!customerPhone) {
      return NextResponse.json({ error: 'No customer phone number' }, { status: 400 })
    }

    // The quote token should be passed from the frontend after quote creation
    const quoteToken = body.quote_token as string
    if (!quoteToken) {
      return NextResponse.json({ error: 'quote_token required' }, { status: 400 })
    }

    const domain = getClientConfig().domain.replace(/\/+$/, '')
    const quoteLink = `${domain}/quote/${quoteToken}`
    const businessName = tenant.business_name_short || tenant.name
    const custName = customer?.first_name || 'there'

    await sendSMS(
      tenant,
      customerPhone,
      `Hey ${custName}! Here's your quote from ${businessName}. Review and save your card to lock in your spot: ${quoteLink}`
    )

    return NextResponse.json({ success: true })
  } else {
    return NextResponse.json({ error: 'action must be "setup_intent" or "send_link"' }, { status: 400 })
  }
}
