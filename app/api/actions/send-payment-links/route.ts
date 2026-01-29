/**
 * Send Payment Links Action Endpoint
 *
 * POST /api/actions/send-payment-links
 * Body: { jobId: string }
 *
 * This endpoint sends the deposit payment link.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getJobById,
  getCustomerByPhone,
  updateJob,
  appendToTextingTranscript,
} from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import {
  createDepositPaymentLink,
  calculateJobEstimate,
} from '@/lib/stripe-client'
import { logSystemEvent } from '@/lib/system-events'
import { mergeEstimateIntoNotes } from '@/lib/pricing-config'
import { alertOwner } from '@/lib/owner-alert'
import { getClientConfig } from '@/lib/client-config'

const PAYMENT_LINK_DELAY_MS = Number(process.env.SMS_PAYMENT_LINK_DELAY_MS || '60000')

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
        { error: 'Customer email required for payment links' },
        { status: 400 }
      )
    }

    // Calculate price if not set
    let price = job.price
    if (!price || price <= 0 || !job.hours) {
      const estimate = calculateJobEstimate(job, customer)
      price = estimate.totalPrice
      const nextNotes = mergeEstimateIntoNotes(job.notes, {
        totalHours: estimate.totalHours,
        hoursPerCleaner: estimate.hoursPerCleaner,
        cleaners: estimate.cleaners,
        cleanerPay: estimate.cleanerPay,
      })
      await updateJob(jobId, { price, hours: estimate.totalHours, cleaners: estimate.cleaners, notes: nextNotes })
    }

    // Update job with price
    const jobWithPrice = { ...job, price }

    // Create deposit payment link
    const depositResult = await createDepositPaymentLink(customer, jobWithPrice)
    if (!depositResult.success) {
      await alertOwner('Deposit link failed. Manual follow-up required.', {
        jobId,
        metadata: { error: depositResult.error },
      })
      return NextResponse.json(
        { error: `Failed to create deposit link: ${depositResult.error}` },
        { status: 500 }
      )
    }

    const timestamp = new Date().toISOString()
    const config = getClientConfig()
    if (PAYMENT_LINK_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, PAYMENT_LINK_DELAY_MS))
    }

    const depositMessage = `Please pay the 50% deposit to confirm your appointment: ${depositResult.url}`
    const depositSms = await sendSMS(customer.phone_number, depositMessage)
    if (!depositSms.success) {
      await alertOwner('Failed to send deposit SMS to customer.', {
        jobId,
        metadata: { error: depositSms.error },
      })
    }
    await appendToTextingTranscript(
      customer.phone_number,
      `[${timestamp}] ${config.businessNameShort}: ${depositMessage}`
    )

    // Update job status
    await updateJob(jobId, {
      booked: false,
      status: 'quoted',
    })

    await logSystemEvent({
      source: 'actions',
      event_type: 'PAYMENT_LINKS_SENT',
      message: 'Deposit link sent (manual action).',
      job_id: jobId,
      customer_id: job.customer_id,
      phone_number: customer.phone_number,
      metadata: {
        deposit_url: depositResult.url,
        deposit_amount: depositResult.amount,
        price,
      },
    })

    return NextResponse.json({
      success: true,
      jobId,
      price,
      depositAmount: depositResult.amount,
      depositUrl: depositResult.url,
    })
  } catch (error) {
    console.error('Send payment links error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'send-payment-links',
    method: 'POST',
    body: {
      jobId: 'string (required)',
    },
    description: 'Sends the deposit payment link to customer via SMS',
  })
}
