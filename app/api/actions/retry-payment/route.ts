/**
 * Retry Payment Action Endpoint
 *
 * POST /api/actions/retry-payment
 * Body: { jobId: string }
 *
 * This endpoint:
 * 1. Looks up the job and calculates remaining balance
 * 2. Creates a new Stripe payment link
 * 3. Sends the link to the customer via SMS
 * 4. Tracks retry count in job notes
 *
 * Used for: manual admin retry + auto-retry cron
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import {
  getJobById,
  getCustomerByPhone,
  updateJob,
  getSupabaseServiceClient,
} from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { findOrCreateStripeCustomer, resolveStripeChargeCents } from '@/lib/stripe-client'
import { logSystemEvent } from '@/lib/system-events'
import { getPaymentTotalsFromNotes } from '@/lib/pricing-config'
import { getClientConfig } from '@/lib/client-config'
import { requireAuth } from '@/lib/auth'
import { getDefaultTenant, getTenantById } from '@/lib/tenant'
import { paymentRetry as paymentRetryTemplate } from '@/lib/sms-templates'

function getStripeClient(): Stripe {
  const rawKey = process.env.STRIPE_SECRET_KEY
  const secretKey = rawKey ? rawKey.replace(/[\r\n]/g, '').trim() : ''

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY not configured')
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-02-24.acacia',
  })
}

/**
 * Core retry logic — callable from both the API route (with auth) and the cron (without auth)
 */
export async function executeRetryPayment(jobId: string): Promise<{
  success: boolean
  jobId?: string
  paymentUrl?: string
  remainingAmount?: number
  chargeAmount?: number
  retryCount?: number
  smsSent?: boolean
  error?: string
}> {
  // Use service client to bypass RLS (called by admin action + cron)
  const serviceClient = getSupabaseServiceClient()

  // Get job details
  const job = await getJobById(jobId, serviceClient)
  if (!job) {
    return { success: false, error: 'Job not found' }
  }

  // Get customer details
  const customer = await getCustomerByPhone(job.phone_number, serviceClient)
  if (!customer) {
    return { success: false, error: 'Customer not found' }
  }

  if (!customer.email) {
    return { success: false, error: 'Customer email required for payment retry' }
  }

  // Calculate remaining amount (same logic as complete-job)
  const totalPrice = job.price || 0
  const paymentTotals = getPaymentTotalsFromNotes(job.notes)
  const depositPaid = paymentTotals.depositPaid || 0
  const addOnPaid = paymentTotals.addOnPaid || 0
  const totalDue = Math.round(totalPrice * 1.03 * 100) / 100
  const remainingAmount = Math.round((totalDue - depositPaid - addOnPaid) * 100) / 100

  if (remainingAmount <= 0) {
    return { success: false, error: 'No remaining balance — job is fully paid' }
  }

  // Create new Stripe payment link
  const defaultRemainingCents = Math.round(remainingAmount * 100)
  const { amountCents: chargeAmountCents, testChargeCents } = resolveStripeChargeCents(
    defaultRemainingCents,
    'FINAL'
  )
  const chargeAmount = chargeAmountCents / 100

  const stripe = getStripeClient()
  // Ensure customer exists in Stripe so payment is associated correctly
  await findOrCreateStripeCustomer(customer)

  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: chargeAmountCents,
    product_data: {
      name: `${job.service_type || 'Cleaning'} - Payment Retry`,
    },
  })

  const config = getClientConfig()
  const domain = config.domain.endsWith('/') ? config.domain.slice(0, -1) : config.domain
  const paymentMetadata: Record<string, string> = {
    job_id: jobId,
    phone_number: job.phone_number,
    payment_type: 'FINAL',
  }
  if (testChargeCents) {
    paymentMetadata.test_charge_cents = String(testChargeCents)
  }

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [
      {
        price: price.id,
        quantity: 1,
      },
    ],
    metadata: paymentMetadata,
    payment_intent_data: {
      metadata: paymentMetadata,
    },
    after_completion: {
      type: 'redirect',
      redirect: {
        url: `${domain}/thank-you`,
      },
    },
  })

  // Update retry count in notes
  const currentNotes = job.notes || ''
  const retryMatch = currentNotes.match(/PAYMENT_RETRY_COUNT:\s*(\d+)/)
  const currentRetryCount = retryMatch ? parseInt(retryMatch[1], 10) : 0
  const newRetryCount = currentRetryCount + 1

  let updatedNotes = currentNotes.replace(/PAYMENT_RETRY_COUNT:\s*\d+\n?/g, '')
  updatedNotes = `${updatedNotes}\nPAYMENT_RETRY_COUNT: ${newRetryCount}`.trim()

  await updateJob(jobId, {
    notes: updatedNotes,
  }, {}, serviceClient)

  // Send SMS with new payment link
  const jobTenantId = (job as any).tenant_id
  const tenant = jobTenantId ? await getTenantById(jobTenantId) : await getDefaultTenant()

  const smsMessage = paymentRetryTemplate(
    config.businessName,
    chargeAmount,
    paymentLink.url
  )

  let smsSent = false
  if (tenant) {
    const sendResult = await sendSMS(tenant, job.phone_number, smsMessage)
    smsSent = sendResult.success
  } else {
    const sendResult = await sendSMS(job.phone_number, smsMessage)
    smsSent = sendResult.success
  }

  await logSystemEvent({
    source: 'actions',
    event_type: 'PAYMENT_RETRY_SENT',
    message: `Payment retry #${newRetryCount} sent for job ${jobId}`,
    job_id: jobId,
    customer_id: job.customer_id,
    phone_number: job.phone_number,
    metadata: {
      remaining_amount: remainingAmount,
      charge_amount: chargeAmount,
      payment_link: paymentLink.url,
      retry_count: newRetryCount,
      sms_sent: smsSent,
      test_charge_cents: testChargeCents ?? undefined,
    },
  })

  return {
    success: true,
    jobId,
    paymentUrl: paymentLink.url,
    remainingAmount,
    chargeAmount,
    retryCount: newRetryCount,
    smsSent,
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    const result = await executeRetryPayment(jobId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Retry payment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'retry-payment',
    method: 'POST',
    body: {
      jobId: 'string (required)',
    },
    description: 'Creates a new payment link for a failed payment and sends it to the customer via SMS',
  })
}