/**
 * Generate Payment Link Action Endpoint
 *
 * POST /api/actions/generate-payment-link
 * Body: { customerId: string, type: 'card_on_file' | 'payment' | 'deposit' | 'invoice', amount?: number, description?: string, jobId?: string, sendSms?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import {
  getSupabaseServiceClient,
  getJobById,
} from '@/lib/supabase'
import {
  createCardOnFileLink,
  createCustomPaymentLink,
  createDepositPaymentLink,
  createAndSendInvoice,
} from '@/lib/stripe-client'
import { sendSMS } from '@/lib/openphone'
import { getTenantById } from '@/lib/tenant'
import type { Customer, Job } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    const body = await request.json()
    const { customerId, type, amount, description, jobId, sendSms: shouldSendSms } = body

    if (!customerId) {
      return NextResponse.json({ error: 'Customer ID is required' }, { status: 400 })
    }

    if (!type || !['card_on_file', 'payment', 'deposit', 'invoice'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type. Must be card_on_file, payment, deposit, or invoice.' }, { status: 400 })
    }

    // Look up customer and verify tenant ownership
    const supabase = getSupabaseServiceClient()
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single()

    if (custErr || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Cross-tenant validation
    if (customer.tenant_id !== authTenant.id) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (!authTenant.stripe_secret_key) {
      return NextResponse.json({ error: 'Stripe not configured for this tenant' }, { status: 400 })
    }
    const stripeKey = authTenant.stripe_secret_key
    const tenant = await getTenantById(authTenant.id)

    // Resolve job if needed
    let job: Job | null = null
    if (jobId) {
      job = await getJobById(jobId)
      if (!job || job.tenant_id !== authTenant.id) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
    }

    let result: { success: boolean; url?: string; amount?: number; invoiceId?: string; invoiceUrl?: string; error?: string }

    switch (type) {
      case 'card_on_file': {
        if (!customer.email) {
          return NextResponse.json({ error: 'Customer email required for card on file' }, { status: 400 })
        }
        result = await createCardOnFileLink(customer as Customer, jobId || customer.id, authTenant.id, stripeKey)
        break
      }

      case 'payment': {
        if (!amount || amount <= 0) {
          return NextResponse.json({ error: 'Amount is required and must be greater than $0' }, { status: 400 })
        }
        if (!customer.email) {
          return NextResponse.json({ error: 'Customer email required for payment link' }, { status: 400 })
        }
        result = await createCustomPaymentLink(
          customer as Customer,
          amount,
          description || 'Payment',
          authTenant.id,
          stripeKey,
          jobId
        )
        break
      }

      case 'deposit': {
        if (!job) {
          return NextResponse.json({ error: 'Job ID required for deposit link' }, { status: 400 })
        }
        if (!customer.email) {
          return NextResponse.json({ error: 'Customer email required for deposit link' }, { status: 400 })
        }
        result = await createDepositPaymentLink(customer as Customer, job, undefined, authTenant.id, stripeKey)
        break
      }

      case 'invoice': {
        if (!job) {
          return NextResponse.json({ error: 'Job ID required for invoice' }, { status: 400 })
        }
        if (!customer.email) {
          return NextResponse.json({ error: 'Customer email required for invoice' }, { status: 400 })
        }
        result = await createAndSendInvoice(job, customer as Customer, stripeKey, undefined, authTenant.currency || 'usd')
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to generate link' }, { status: 500 })
    }

    // Optionally send the URL via SMS
    if (shouldSendSms && result.url && tenant) {
      const smsMessage = `Here's your payment link: ${result.url}`
      await sendSMS(tenant, customer.phone_number, smsMessage)
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      amount: result.amount,
      invoiceId: result.invoiceId,
      invoiceUrl: result.invoiceUrl,
    })
  } catch (err: unknown) {
    console.error('[generate-payment-link] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
