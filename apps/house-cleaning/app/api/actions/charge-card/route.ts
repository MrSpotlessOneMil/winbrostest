/**
 * Charge Card on File Action Endpoint
 *
 * POST /api/actions/charge-card
 * Body: { customer_id: string, amount: number, description?: string, job_id?: string }
 *
 * Charges a customer's saved card on file (off-session) for a given amount.
 * Sends SMS receipt and logs system event.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { chargeCardOnFile } from '@/lib/stripe-client'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getTenantById, getTenantBusinessName, formatTenantCurrency } from '@/lib/tenant'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    const body = await request.json()
    const { customer_id, amount, description, job_id } = body as {
      customer_id: string
      amount: number
      description?: string
      job_id?: string
    }

    if (!customer_id) {
      return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
    }
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than $0' }, { status: 400 })
    }

    const serviceClient = getSupabaseServiceClient()

    // Fetch customer + cross-tenant validation
    const { data: customer, error: custErr } = await serviceClient
      .from('customers')
      .select('id, tenant_id, phone_number, first_name, last_name, stripe_customer_id, card_on_file_at')
      .eq('id', customer_id)
      .single()

    if (custErr || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (customer.tenant_id !== authTenant.id) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (!customer.stripe_customer_id) {
      return NextResponse.json({ error: 'Customer has no card on file' }, { status: 400 })
    }
    if (!customer.card_on_file_at) {
      return NextResponse.json({ error: 'Customer has no card on file' }, { status: 400 })
    }

    const stripeKey = authTenant.stripe_secret_key
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured for this tenant' }, { status: 400 })
    }

    // Validate job belongs to tenant if provided
    if (job_id) {
      const { data: job } = await serviceClient
        .from('jobs')
        .select('id, tenant_id')
        .eq('id', job_id)
        .single()

      if (!job || job.tenant_id !== authTenant.id) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
    }

    const amountCents = Math.round(amount * 100)
    const chargeDescription = description || 'Manual charge'
    const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer'

    const result = await chargeCardOnFile(stripeKey, customer.stripe_customer_id, amountCents, {
      tenant_id: authTenant.id,
      customer_id,
      description: chargeDescription,
      ...(job_id ? { job_id } : {}),
    }, authTenant.currency || 'usd')

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Charge failed' }, { status: 400 })
    }

    // Send SMS receipt
    const tenant = await getTenantById(authTenant.id)
    if (tenant && customer.phone_number) {
      const businessName = getTenantBusinessName(tenant)
      const smsMsg = `Your card on file has been charged ${formatTenantCurrency(tenant, amount)} for: ${chargeDescription}. Thank you! - ${businessName}`
      await sendSMS(tenant, customer.phone_number, smsMsg)
    }

    await logSystemEvent({
      source: 'actions',
      event_type: 'CARD_CHARGED',
      message: `Card on file charged $${amount.toFixed(2)} for ${customerName} (${chargeDescription}).`,
      customer_id,
      phone_number: customer.phone_number,
      metadata: {
        amount,
        amount_cents: amountCents,
        description: chargeDescription,
        payment_intent_id: result.paymentIntentId,
        ...(job_id ? { job_id } : {}),
      },
    })

    return NextResponse.json({
      success: true,
      payment_intent_id: result.paymentIntentId,
      amount,
    })
  } catch (error) {
    console.error('[charge-card] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
