/**
 * Complete Job Action Endpoint
 *
 * POST /api/actions/complete-job
 * Body: { jobId: string }
 *
 * This endpoint:
 * 1. Marks the job as completed
 * 2. Creates and sends the remaining 50% payment link
 */

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import {
  getJobById,
  getCustomerByPhone,
  updateJob,
  appendToTextingTranscript,
} from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { findOrCreateStripeCustomer, resolveStripeChargeCents } from '@/lib/stripe-client'
import { logSystemEvent } from '@/lib/system-events'
import { getPaymentTotalsFromNotes } from '@/lib/pricing-config'
import { getClientConfig } from '@/lib/client-config'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { jobId } = body

    if (!jobId) {
      return NextResponse.json(
        { error: 'Job ID is required' },
        { status: 400 }
      )
    }

    // Get job details
    const job = await getJobById(jobId)
    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }

    // Get customer details
    const customer = await getCustomerByPhone(job.phone_number)
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    if (!customer.email) {
      return NextResponse.json(
        { error: 'Customer email required for final payment' },
        { status: 400 }
      )
    }

    // Calculate remaining 50% (with 3% processing fee)
    const totalPrice = job.price || 0
    const paymentTotals = getPaymentTotalsFromNotes(job.notes)
    const depositPaid = paymentTotals.depositPaid || 0
    const addOnPaid = paymentTotals.addOnPaid || 0
    const totalDue = Math.round(totalPrice * 1.03 * 100) / 100
    const remainingAmount = Math.round((totalDue - depositPaid - addOnPaid) * 100) / 100

    if (remainingAmount <= 0) {
      // Job was fully prepaid
      await updateJob(jobId, { status: 'completed' })

      await logSystemEvent({
        source: 'actions',
        event_type: 'JOB_COMPLETED',
        message: `Job ${jobId} completed (fully prepaid).`,
        job_id: jobId,
        customer_id: job.customer_id,
        phone_number: job.phone_number,
        metadata: {
          total_price: totalPrice,
          total_due: totalDue,
          deposit_paid: depositPaid,
          add_on_paid: addOnPaid,
        },
      })

      return NextResponse.json({
        success: true,
        message: 'Job completed - was fully prepaid',
        jobId,
      })
    }

    const defaultRemainingCents = Math.round(remainingAmount * 100)
    const { amountCents: chargeAmountCents, testChargeCents } = resolveStripeChargeCents(
      defaultRemainingCents,
      'FINAL'
    )
    const chargeAmount = chargeAmountCents / 100

    // Create Stripe payment link for remaining amount
    const stripe = getStripeClient()

    // Find or create Stripe customer
    const stripeCustomer = await findOrCreateStripeCustomer(customer)

    // First create a price for this specific payment
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: chargeAmountCents, // Convert to cents
      product_data: {
        name: `${job.service_type || 'Cleaning'} - Final Payment`,
      },
    })

    // Create a payment link using the price
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
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${domain}/thank-you`,
        },
      },
    })

    // Update job status
    await updateJob(jobId, { status: 'completed' })

    // Send SMS with payment link
    const dateStr = job.date
      ? new Date(job.date).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })
      : 'today'

    const smsMessage = `Thanks for choosing ${config.businessName}! We hope your home is sparkling clean. Your remaining balance is due. Pay securely here: ${paymentLink.url}`

    const sendResult = await sendSMS(customer.phone_number, smsMessage)

    if (sendResult.success) {
      const timestamp = new Date().toISOString()
      await appendToTextingTranscript(
        customer.phone_number,
        `[${timestamp}] [Job Completed - Final Payment Requested] ${config.businessNameShort}: ${smsMessage}`
      )
    }

    await logSystemEvent({
      source: 'actions',
      event_type: 'FINAL_PAYMENT_LINK_SENT',
      message: `Final payment link sent for job ${jobId}.`,
      job_id: jobId,
      customer_id: job.customer_id,
      phone_number: customer.phone_number,
        metadata: {
          remaining_amount: remainingAmount,
          charge_amount: chargeAmount,
          payment_link: paymentLink.url,
          total_due: totalDue,
          deposit_paid: depositPaid,
          add_on_paid: addOnPaid,
          test_charge_cents: testChargeCents ?? undefined,
        },
      })

    await logSystemEvent({
      source: 'actions',
      event_type: 'JOB_COMPLETED',
      message: `Job ${jobId} marked completed.`,
      job_id: jobId,
      customer_id: job.customer_id,
      phone_number: job.phone_number,
        metadata: {
          total_price: totalPrice,
          remaining_amount: remainingAmount,
          charge_amount: chargeAmount,
          total_due: totalDue,
          deposit_paid: depositPaid,
          add_on_paid: addOnPaid,
          test_charge_cents: testChargeCents ?? undefined,
        },
      })

    return NextResponse.json({
      success: true,
      jobId,
      paymentUrl: paymentLink.url,
      remainingAmount,
      chargeAmount,
      smsSent: sendResult.success,
    })
  } catch (error) {
    console.error('Complete job error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'complete-job',
    method: 'POST',
    body: {
      jobId: 'string (required)',
    },
    description: 'Marks job as completed and sends final payment link to customer',
  })
}
