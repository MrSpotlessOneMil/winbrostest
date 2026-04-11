/**
 * Attach Card on File Action Endpoint
 *
 * GET /api/actions/attach-card — returns tenant's Stripe publishable key
 * POST /api/actions/attach-card — attaches a PaymentMethod to a customer
 * Body: { customer_id: string, payment_method_id: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getStripeClientForTenant } from '@/lib/stripe-client'
import { logSystemEvent } from '@/lib/system-events'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const publishableKey = authTenant.stripe_publishable_key
  if (!publishableKey) {
    return NextResponse.json({ error: 'Stripe publishable key not configured' }, { status: 400 })
  }

  return NextResponse.json({ success: true, publishable_key: publishableKey })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    const body = await request.json()
    const { customer_id, payment_method_id } = body as {
      customer_id: string
      payment_method_id: string
    }

    if (!customer_id) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
    }
    if (!payment_method_id) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 })
    }

    const serviceClient = getSupabaseServiceClient()

    // Fetch customer + cross-tenant validation
    const { data: customer, error: custErr } = await serviceClient
      .from('customers')
      .select('id, tenant_id, phone_number, first_name, last_name, email, stripe_customer_id')
      .eq('id', customer_id)
      .single()

    if (custErr || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (customer.tenant_id !== authTenant.id) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const stripeKey = authTenant.stripe_secret_key
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured for this tenant' }, { status: 400 })
    }

    const stripe = getStripeClientForTenant(stripeKey)
    let stripeCustomerId = customer.stripe_customer_id

    // Create Stripe customer if needed
    if (!stripeCustomerId) {
      const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || undefined
      const stripeCustomer = await stripe.customers.create({
        name: customerName,
        email: customer.email || undefined,
        phone: customer.phone_number || undefined,
        metadata: { osiris_customer_id: String(customer_id) },
      })
      stripeCustomerId = stripeCustomer.id
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(payment_method_id, {
      customer: stripeCustomerId,
    })

    // Set as default payment method
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: payment_method_id },
    })

    // Update customer record
    const now = new Date().toISOString()
    await serviceClient
      .from('customers')
      .update({
        stripe_customer_id: stripeCustomerId,
        card_on_file_at: now,
      })
      .eq('id', customer_id)
      .eq('tenant_id', authTenant.id)

    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer'

    await logSystemEvent({
      source: 'actions',
      event_type: 'CARD_ON_FILE_SAVED',
      message: `Card on file saved manually for ${customerName}.`,
      customer_id: String(customer_id),
      phone_number: customer.phone_number,
      metadata: {
        stripe_customer_id: stripeCustomerId,
        payment_method_id,
        method: 'manual_entry',
      },
    })

    return NextResponse.json({
      success: true,
      stripe_customer_id: stripeCustomerId,
    })
  } catch (error) {
    console.error('[attach-card] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
