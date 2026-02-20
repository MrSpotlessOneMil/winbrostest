/**
 * Send Invoice Action Endpoint
 *
 * POST /api/actions/send-invoice
 * Body: { jobId: string, email?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getJobById,
  getCustomerByPhone,
  updateJob,
  upsertCustomer,
  appendToTextingTranscript,
} from '@/lib/supabase'
import type { Job } from '@/lib/supabase'
import { calculateJobEstimate } from '@/lib/stripe-client'
import { createInvoice } from '@/lib/invoices'
import { sendSMS, SMS_TEMPLATES } from '@/lib/openphone'
import { mergeEstimateIntoNotes } from '@/lib/pricing-config'
import { alertOwner } from '@/lib/owner-alert'
import { getClientConfig } from '@/lib/client-config'
import { getTenantById, getTenantBusinessName } from '@/lib/tenant'
import { sendDocuSignContract } from '@/lib/docusign'
import { logSystemEvent } from '@/lib/system-events'
import { requireAuth } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const body = await request.json()
    const { jobId, email } = body

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

    // Look up tenant for dynamic business name and proper SMS routing
    const tenant = job.tenant_id ? await getTenantById(job.tenant_id) : null
    const businessNameShort = tenant ? getTenantBusinessName(tenant, true) : 'Team'

    // Get customer
    let customer = await getCustomerByPhone(job.phone_number)
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Use provided email or customer's existing email
    const customerEmail = email || customer.email
    if (!customerEmail) {
      return NextResponse.json(
        { error: 'Email required to send invoice' },
        { status: 400 }
      )
    }

    // Update customer email if provided
    if (email && email !== customer.email) {
      customer = await upsertCustomer(job.phone_number, { email }) || customer
    }

    // Calculate price if not set
    let jobPrice = job.price
    if (!jobPrice || jobPrice <= 0 || !job.hours) {
      const estimate = calculateJobEstimate(job, customer)
      jobPrice = estimate.totalPrice

      // Update job with calculated price and hours
      const nextNotes = mergeEstimateIntoNotes(job.notes, {
        totalHours: estimate.totalHours,
        hoursPerCleaner: estimate.hoursPerCleaner,
        cleaners: estimate.cleaners,
        cleanerPay: estimate.cleanerPay,
      })
      await updateJob(jobId, { price: jobPrice, hours: estimate.totalHours, cleaners: estimate.cleaners, notes: nextNotes })
    }

    const invoiceResult = await createInvoice(
      { ...job, price: jobPrice },
      { ...customer, email: customerEmail }
    )

    if (!invoiceResult.success) {
      await alertOwner('Invoice creation failed. Manual follow-up required.', {
        jobId,
        metadata: { error: invoiceResult.error, email: customerEmail },
      })
      return NextResponse.json(
        { error: invoiceResult.error || 'Failed to create invoice' },
        { status: 500 }
      )
    }

    const jobUpdate: Partial<Job> = {
      invoice_sent: true,
      booked: false,
      status: 'quoted',
    }

    if (invoiceResult.provider === 'stripe' && invoiceResult.invoiceId) {
      jobUpdate.stripe_invoice_id = invoiceResult.invoiceId
    }

    const nextNotes = mergeInvoiceLinkIntoNotes(job.notes, invoiceResult.invoiceUrl)
    if (nextNotes !== job.notes) {
      jobUpdate.notes = nextNotes
    }

    await updateJob(jobId, jobUpdate)

    // Send SMS notification
    const smsMessage = SMS_TEMPLATES.invoiceSent(customerEmail, invoiceResult.invoiceUrl)
    const smsResult = tenant
      ? await sendSMS(tenant, job.phone_number, smsMessage)
      : await sendSMS(job.phone_number, smsMessage)
    if (!smsResult.success) {
      await alertOwner('Failed to send invoice SMS to customer.', {
        jobId,
        metadata: { error: smsResult.error, email: customerEmail },
      })
    }

    // Update transcript
    const timestamp = new Date().toISOString()
    await appendToTextingTranscript(
      job.phone_number,
      `[${timestamp}] [Invoice Sent - $${jobPrice} - ${invoiceResult.provider}] ${businessNameShort}: ${smsMessage}`
    )

    if (invoiceResult.provider === 'wave' && invoiceResult.emailSent === false) {
      await alertOwner('Wave invoice email failed. Manual follow-up required.', {
        jobId,
        metadata: { error: invoiceResult.emailError, invoice_id: invoiceResult.invoiceId },
      })
    }
    if (invoiceResult.provider === 'wave' && !invoiceResult.invoiceUrl) {
      await alertOwner('Wave invoice created without a URL. Manual follow-up required.', {
        jobId,
        metadata: { invoice_id: invoiceResult.invoiceId },
      })
    }

    const config = getClientConfig()
    if (config.features.docusign && !job.docusign_envelope_id) {
      const docuSignResult = await sendDocuSignContract(
        { ...job, price: jobPrice },
        { ...customer, email: customerEmail }
      )

      if (docuSignResult.success && docuSignResult.envelopeId) {
        await updateJob(jobId, {
          docusign_envelope_id: docuSignResult.envelopeId,
          docusign_status: 'sent',
        })

        await logSystemEvent({
          source: 'actions',
          event_type: 'DOCUSIGN_SENT',
          message: 'DocuSign contract sent.',
          job_id: jobId,
          customer_id: customer.id,
          phone_number: job.phone_number,
          metadata: {
            envelope_id: docuSignResult.envelopeId,
          },
        })
      } else if (docuSignResult.error) {
        console.error('DocuSign send failed:', docuSignResult.error)
        await logSystemEvent({
          source: 'actions',
          event_type: 'OWNER_ACTION_REQUIRED',
          message: 'DocuSign send failed.',
          job_id: jobId,
          customer_id: customer.id,
          phone_number: job.phone_number,
          metadata: {
            error: docuSignResult.error,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      invoiceId: invoiceResult.invoiceId,
      invoiceUrl: invoiceResult.invoiceUrl,
      provider: invoiceResult.provider,
      amount: jobPrice,
      email: customerEmail,
    })
  } catch (error) {
    console.error('Send invoice error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'send-invoice',
    method: 'POST',
    body: {
      jobId: 'string (required)',
      email: 'string (optional, uses customer email if not provided)',
    },
  })
}

function mergeInvoiceLinkIntoNotes(
  notes: string | null | undefined,
  invoiceUrl?: string
): string | undefined {
  if (!invoiceUrl) {
    return notes === null ? undefined : notes
  }

  const existing = notes || ''
  const tag = 'INVOICE_URL:'
  if (existing.includes(tag) && existing.includes(invoiceUrl)) {
    return notes === null ? undefined : notes
  }

  const line = `${tag} ${invoiceUrl}`
  return existing ? `${existing}\n${line}` : line
}
