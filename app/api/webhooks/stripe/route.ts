import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { validateStripeWebhook } from '@/lib/stripe-client'
import { getSupabaseClient, updateJob, getJobById, updateGHLLead } from '@/lib/supabase'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { logSystemEvent } from '@/lib/system-events'
import { convertHCPLeadToJob } from '@/lib/housecall-pro-api'
import { getDefaultTenant } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature validation
    const payload = await request.text()
    const signature = request.headers.get('stripe-signature')

    // Validate the webhook signature
    const event = validateStripeWebhook(payload, signature)

    if (!event) {
      console.error('[Stripe Webhook] Invalid webhook signature')
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      )
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`)

    // Handle specific event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session)
        break

      case 'setup_intent.succeeded':
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent)
        break

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent)
        break

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Stripe Webhook] Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}

/**
 * Handle checkout.session.completed event
 * Processes both DEPOSIT and FINAL payment types
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { job_id, lead_id, payment_type } = metadata

  console.log(`[Stripe Webhook] Checkout completed - job_id: ${job_id}, payment_type: ${payment_type}`)

  // Handle card-on-file setup sessions (mode: 'setup' or purpose: 'card_on_file')
  if (session.mode === 'setup' || metadata.purpose === 'card_on_file') {
    await handleCardOnFileSaved(session)
    return
  }

  // Handle TIP payments (may not have job verification requirement)
  if (payment_type === 'TIP') {
    await handleTipPayment(session)
    return
  }

  if (!job_id) {
    console.error('[Stripe Webhook] Missing job_id in session metadata')
    return
  }

  // Get the job to verify it exists
  const job = await getJobById(job_id)
  if (!job) {
    console.error(`[Stripe Webhook] Job not found: ${job_id}`)
    return
  }

  if (payment_type === 'DEPOSIT') {
    await handleDepositPayment(job_id, lead_id, session)
  } else if (payment_type === 'FINAL') {
    await handleFinalPayment(job_id, session)
  } else {
    console.log(`[Stripe Webhook] Unknown payment_type: ${payment_type}`)
  }
}

/**
 * Handle DEPOSIT payment completion
 * - Updates job payment status to 'deposit_paid'
 * - Sets confirmed_at timestamp
 * - Updates lead status to 'booked'
 * - Converts HCP lead to job (two-way sync)
 * - Triggers cleaner assignment
 */
async function handleDepositPayment(
  jobId: string,
  leadId: string | undefined,
  session: Stripe.Checkout.Session
) {
  console.log(`[Stripe Webhook] Processing DEPOSIT payment for job: ${jobId}`)

  // Update job status
  const updatedJob = await updateJob(jobId, {
    payment_status: 'deposit_paid',
    confirmed_at: new Date().toISOString(),
  })

  if (!updatedJob) {
    console.error(`[Stripe Webhook] Failed to update job ${jobId}`)
    return
  }

  // Update lead status if lead_id is provided
  let hcpLeadId: string | undefined
  if (leadId) {
    // Get lead to find HCP source_id
    const client = getSupabaseClient()
    const { data: lead } = await client
      .from('leads')
      .select('source_id')
      .eq('id', leadId)
      .single()

    hcpLeadId = lead?.source_id

    const updatedLead = await updateGHLLead(leadId, {
      status: 'booked',
      converted_to_job_id: jobId,
    })

    if (!updatedLead) {
      console.warn(`[Stripe Webhook] Failed to update lead ${leadId}`)
    }
  }

  // Convert HCP lead to job (two-way sync)
  let hcpJobId: string | undefined
  if (hcpLeadId && !hcpLeadId.startsWith('vapi-') && !hcpLeadId.startsWith('sms-')) {
    const tenant = await getDefaultTenant()
    if (tenant) {
      console.log(`[Stripe Webhook] Converting HCP lead ${hcpLeadId} to job...`)
      const hcpResult = await convertHCPLeadToJob(tenant, hcpLeadId, {
        scheduledDate: updatedJob.date || undefined,
        scheduledTime: updatedJob.scheduled_at || undefined,
        address: updatedJob.address || undefined,
        serviceType: updatedJob.service_type || 'Cleaning Service',
        price: updatedJob.price || undefined,
        notes: updatedJob.notes || undefined,
      })

      if (hcpResult.success) {
        hcpJobId = hcpResult.jobId
        console.log(`[Stripe Webhook] HCP lead converted to job: ${hcpJobId}`)

        // Store HCP job ID in our job record
        await updateJob(jobId, {
          hcp_job_id: hcpJobId,
        })
      } else {
        console.warn(`[Stripe Webhook] Failed to convert HCP lead: ${hcpResult.error}`)
      }
    }
  }

  // Trigger cleaner assignment
  const assignmentResult = await triggerCleanerAssignment(jobId)

  if (!assignmentResult.success) {
    console.error(`[Stripe Webhook] Cleaner assignment failed: ${assignmentResult.error}`)
  }

  // Log the system event
  await logSystemEvent({
    source: 'stripe',
    event_type: 'DEPOSIT_PAID',
    message: `Deposit payment received for job ${jobId}`,
    job_id: jobId,
    phone_number: updatedJob.phone_number,
    metadata: {
      payment_type: 'DEPOSIT',
      session_id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      lead_id: leadId,
      hcp_lead_id: hcpLeadId,
      hcp_job_id: hcpJobId,
      cleaner_assignment_triggered: assignmentResult.success,
    },
  })

  console.log(`[Stripe Webhook] DEPOSIT payment processed successfully for job ${jobId}`)
}

/**
 * Handle FINAL payment completion
 * - Updates job payment_status to 'fully_paid'
 * - Sets paid = true
 */
async function handleFinalPayment(jobId: string, session: Stripe.Checkout.Session) {
  console.log(`[Stripe Webhook] Processing FINAL payment for job: ${jobId}`)

  // Update job status
  const updatedJob = await updateJob(jobId, {
    payment_status: 'fully_paid',
    paid: true,
  })

  if (!updatedJob) {
    console.error(`[Stripe Webhook] Failed to update job ${jobId}`)
    return
  }

  // Log the system event
  await logSystemEvent({
    source: 'stripe',
    event_type: 'FINAL_PAID',
    message: `Final payment received for job ${jobId}`,
    job_id: jobId,
    phone_number: updatedJob.phone_number,
    metadata: {
      payment_type: 'FINAL',
      session_id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
    },
  })

  console.log(`[Stripe Webhook] FINAL payment processed successfully for job ${jobId}`)
}

/**
 * Handle TIP payment completion
 * - Records the tip in the database
 * - Associates with cleaner for payout tracking
 */
async function handleTipPayment(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { job_id, cleaner_id, tip_amount } = metadata

  console.log(`[Stripe Webhook] Processing TIP payment - job_id: ${job_id}, cleaner_id: ${cleaner_id}`)

  const client = getSupabaseClient()

  // Get cleaner name for logging
  let cleanerName = 'Unknown'
  if (cleaner_id) {
    const { data: cleaner } = await client
      .from('cleaners')
      .select('name')
      .eq('id', cleaner_id)
      .single()

    if (cleaner?.name) {
      cleanerName = cleaner.name
    }
  }

  // Get job phone number for logging
  let phoneNumber: string | undefined
  if (job_id) {
    const job = await getJobById(job_id)
    phoneNumber = job?.phone_number
  }

  // Log the tip payment
  await logSystemEvent({
    source: 'stripe',
    event_type: 'INVOICE_PAID',
    message: `Tip of $${tip_amount || (session.amount_total ? session.amount_total / 100 : 0)} received for ${cleanerName}`,
    job_id: job_id || undefined,
    cleaner_id: cleaner_id || undefined,
    phone_number: phoneNumber,
    metadata: {
      payment_type: 'TIP',
      session_id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      cleaner_name: cleanerName,
      tip_amount,
    },
  })

  console.log(`[Stripe Webhook] TIP payment processed - $${tip_amount} for ${cleanerName}`)
}

/**
 * Handle payment_intent.succeeded event
 * Additional payment confirmation logging
 */
async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata || {}
  const { job_id, payment_type } = metadata

  console.log(`[Stripe Webhook] Payment intent succeeded - job_id: ${job_id}, payment_type: ${payment_type}`)

  // This event provides additional confirmation
  // Most logic is handled in checkout.session.completed
  // This can be used for additional reconciliation or logging

  if (job_id) {
    const job = await getJobById(job_id)

    if (job) {
      await logSystemEvent({
        source: 'stripe',
        event_type: payment_type === 'DEPOSIT' ? 'DEPOSIT_PAID' : 'FINAL_PAID',
        message: `Payment intent confirmed for job ${job_id}`,
        job_id: job_id,
        phone_number: job.phone_number,
        metadata: {
          payment_intent_id: paymentIntent.id,
          payment_type: payment_type || 'unknown',
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status,
        },
      })
    }
  }
}

/**
 * Handle card-on-file setup completion (checkout.session.completed with mode: 'setup')
 * - Sends confirmation SMS to customer
 * - Triggers cleaner assignment (which sends Telegram to available cleaners)
 */
async function handleCardOnFileSaved(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { job_id, phone_number } = metadata

  console.log(`[Stripe Webhook] Card on file saved - job_id: ${job_id}, phone: ${phone_number}`)

  const tenant = await getDefaultTenant()

  // Send confirmation SMS to customer
  if (phone_number && tenant) {
    const confirmMsg = "Thanks, your card is on file. You're fully set up now!"
    const smsResult = await sendSMS(tenant, phone_number, confirmMsg)

    if (smsResult.success) {
      const client = getSupabaseClient()

      // Find customer for message logging
      const { data: customer } = await client
        .from('customers')
        .select('id')
        .eq('phone_number', phone_number)
        .eq('tenant_id', tenant.id)
        .maybeSingle()

      await client.from('messages').insert({
        tenant_id: tenant.id,
        customer_id: customer?.id || null,
        phone_number: phone_number,
        role: 'assistant',
        content: confirmMsg,
        direction: 'outbound',
        message_type: 'sms',
        ai_generated: false,
        timestamp: new Date().toISOString(),
        source: 'stripe_card_on_file',
      })

      console.log(`[Stripe Webhook] Card-on-file confirmation SMS sent to ${phone_number}`)
    }
  }

  // Trigger cleaner assignment if we have a job
  if (job_id && !job_id.startsWith('lead-')) {
    const job = await getJobById(job_id)
    if (job) {
      console.log(`[Stripe Webhook] Triggering cleaner assignment for job ${job_id}`)
      const assignmentResult = await triggerCleanerAssignment(job_id)

      if (assignmentResult.success) {
        console.log(`[Stripe Webhook] Cleaner assignment triggered successfully for job ${job_id}`)
      } else {
        console.error(`[Stripe Webhook] Cleaner assignment failed: ${assignmentResult.error}`)
      }
    }
  }

  await logSystemEvent({
    source: 'stripe',
    event_type: 'CARD_ON_FILE_SAVED',
    message: `Card on file saved${phone_number ? ` for ${phone_number}` : ''}`,
    phone_number: phone_number || undefined,
    job_id: job_id || undefined,
    metadata: {
      session_id: session.id,
      session_mode: session.mode,
    },
  })
}

/**
 * Handle setup_intent.succeeded event
 * This fires when a card-on-file setup intent completes.
 * The checkout.session.completed handler sends the confirmation SMS,
 * so this only handles cleaner assignment as a fallback (no SMS to avoid duplicates).
 */
async function handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent) {
  const metadata = setupIntent.metadata || {}
  const { job_id, phone_number, purpose } = metadata

  console.log(`[Stripe Webhook] Setup intent succeeded - job_id: ${job_id}, purpose: ${purpose}`)

  if (phone_number) {
    // Check if checkout.session.completed already handled this (it sends the SMS)
    const client = getSupabaseClient()
    const recentCutoff = new Date(Date.now() - 120000).toISOString()
    const { data: alreadyHandled } = await client
      .from('system_events')
      .select('id')
      .eq('event_type', 'CARD_ON_FILE_SAVED')
      .eq('phone_number', phone_number)
      .gte('created_at', recentCutoff)
      .limit(1)

    if (alreadyHandled && alreadyHandled.length > 0) {
      console.log(`[Stripe Webhook] Card-on-file already processed via checkout.session.completed, skipping setup_intent handler`)
      return
    }

    // Fallback: trigger cleaner assignment if checkout.session.completed didn't fire
    if (job_id && !job_id.startsWith('lead-')) {
      const assignmentResult = await triggerCleanerAssignment(job_id)
      if (!assignmentResult.success) {
        console.error(`[Stripe Webhook] Cleaner assignment failed: ${assignmentResult.error}`)
      }
    }

    await logSystemEvent({
      source: 'stripe',
      event_type: 'CARD_ON_FILE_SAVED',
      message: `Setup intent succeeded for ${phone_number} (fallback handler)`,
      phone_number: phone_number,
      job_id: job_id || undefined,
      metadata: {
        setup_intent_id: setupIntent.id,
        purpose,
        handler: 'setup_intent_fallback',
      },
    })
  }
}
