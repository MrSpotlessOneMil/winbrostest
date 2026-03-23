import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { validateStripeWebhook, createCardOnFileLink } from '@/lib/stripe-client'
import { getSupabaseServiceClient, updateJob, getJobById, updateGHLLead } from '@/lib/supabase'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { logSystemEvent } from '@/lib/system-events'
import { convertHCPLeadToJob } from '@/lib/housecall-pro-api'
import { getTenantById, getAllActiveTenants, tenantUsesFeature, type Tenant } from '@/lib/tenant'
import { sendSMS, SMS_TEMPLATES } from '@/lib/openphone'
import { maskPhone } from '@/lib/phone-utils'
import { distributeTip } from '@/lib/tips'
import { geocodeAddress } from '@/lib/google-maps'
import { calculateDistance } from '@/lib/cleaner-assignment'
import { optimizeRoutesIncremental } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'
import { syncNewJobToHCP } from '@/lib/hcp-job-sync'
import { buildWinBrosJobNotes } from '@/lib/winbros-sms-prompt'
import { paymentFailed as paymentFailedTemplate } from '@/lib/sms-templates'
import { cancelTask } from '@/lib/scheduler'
import { cancelPendingTasks } from '@/lib/lifecycle-engine'
import { maybeMarkBooked } from '@/lib/maybe-mark-booked'

/** Safely add months without JS Date overflow (Jan 31 + 1 month = Feb 28, not Mar 3) */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setMonth(result.getMonth() + months)
  if (result.getDate() !== day) {
    result.setDate(0)
  }
  return result
}

/**
 * Process a pre-validated Stripe event. Exported so tenant-specific routes
 * (e.g. /api/webhooks/stripe/winbros) can validate with their own secret
 * and then delegate processing here.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`)

  // --- IDEMPOTENCY: prevent duplicate processing on Stripe retries ---
  const serviceClient = getSupabaseServiceClient()
  const { data: alreadyProcessed } = await serviceClient
    .from('stripe_processed_events')
    .select('id')
    .eq('event_id', event.id)
    .maybeSingle()

  if (alreadyProcessed) {
    console.log(`[Stripe Webhook] Event ${event.id} already processed — skipping`)
    return
  }

  // Claim this event atomically (UNIQUE constraint on event_id is the true guard)
  const { error: claimError } = await serviceClient
    .from('stripe_processed_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      metadata: { livemode: event.livemode },
    })

  if (claimError) {
    console.log(`[Stripe Webhook] Event ${event.id} claimed by another instance — skipping`)
    return
  }

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

    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent)
      break

    default:
      console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the raw body for signature validation
    const payload = await request.text()
    const signature = request.headers.get('stripe-signature')

    // Collect per-tenant webhook secrets for multi-tenant validation
    const tenants = await getAllActiveTenants()
    const tenantSecrets = tenants
      .map(t => t.stripe_webhook_secret)
      .filter((s): s is string => !!s)

    // Validate the webhook signature (tries env var, then each tenant secret)
    const event = validateStripeWebhook(payload, signature, tenantSecrets)

    if (!event) {
      console.error('[Stripe Webhook] Invalid webhook signature')
      return NextResponse.json(
        { error: 'Invalid webhook signature' },
        { status: 400 }
      )
    }

    await processStripeEvent(event)

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
    if (metadata.purpose === 'quote_card_on_file') {
      await handleQuoteCardOnFile(session)
    } else {
      await handleCardOnFileSaved(session)
    }
    return
  }

  // Handle TIP payments (may not have job verification requirement)
  if (payment_type === 'TIP') {
    await handleTipPayment(session)
    return
  }

  // Handle QUOTE_DEPOSIT — quote approval with payment
  if (payment_type === 'QUOTE_DEPOSIT') {
    await handleQuoteDepositPayment(session)
    return
  }

  if (!job_id) {
    console.error('[Stripe Webhook] Missing job_id in session metadata')
    return
  }

  // Get the job to verify it exists — use service client (webhook has no tenant JWT)
  const serviceClient = getSupabaseServiceClient()
  const job = await getJobById(job_id, serviceClient)
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
 * - Updates lead status to 'qualified'
 * - Converts HCP lead to job (two-way sync)
 * - Triggers cleaner assignment
 */
async function handleDepositPayment(
  jobId: string,
  leadId: string | undefined,
  session: Stripe.Checkout.Session
) {
  console.log(`[Stripe Webhook] Processing DEPOSIT payment for job: ${jobId}`)

  // Use service client — webhook has no tenant JWT, anon key is blocked by RLS
  const serviceClient = getSupabaseServiceClient()

  // Update job status — deposit paid, but not "booked" until cleaner is also assigned
  const updatedJob = await updateJob(jobId, {
    payment_status: 'deposit_paid',
    confirmed_at: new Date().toISOString(),
    status: 'scheduled' as any,
  }, {}, serviceClient)

  if (!updatedJob) {
    console.error(`[Stripe Webhook] Failed to update job ${jobId}`)
    return
  }

  // Get tenant for this job to send SMS notifications
  const jobTenantId = (updatedJob as any).tenant_id
  if (!jobTenantId) {
    console.error(`[Stripe Webhook] CRITICAL: Job ${jobId} has no tenant_id — cannot determine tenant. Skipping SMS/notifications.`)
  }
  const tenant = jobTenantId ? await getTenantById(jobTenantId) : null

  // Send payment confirmation SMS to customer
  if (updatedJob.phone_number && tenant) {
    const { data: depositCust } = await serviceClient
      .from('customers')
      .select('id')
      .eq('phone_number', updatedJob.phone_number)
      .eq('tenant_id', tenant.id)
      .maybeSingle()
    const depositCustId = depositCust?.id || updatedJob.customer_id || null

    const serviceType = updatedJob.service_type || 'cleaning'
    const dateStr = updatedJob.date || 'your scheduled date'
    const confirmMsg = SMS_TEMPLATES.paymentConfirmation(serviceType, dateStr)
    const confirmSms = await sendSMS(tenant, updatedJob.phone_number, confirmMsg)

    if (confirmSms.success) {
      await serviceClient.from('messages').insert({
        tenant_id: tenant.id,
        customer_id: depositCustId,
        phone_number: updatedJob.phone_number,
        role: 'assistant',
        content: confirmMsg,
        direction: 'outbound',
        message_type: 'sms',
        ai_generated: false,
        timestamp: new Date().toISOString(),
        source: 'stripe_deposit_paid',
      })
      console.log(`[Stripe Webhook] Deposit confirmation SMS sent to ${maskPhone(updatedJob.phone_number)}`)
    }

    // Send card-on-file link so customer can save card for final payment
    try {
      const custEmail = await getCustomerEmail(updatedJob.phone_number, tenant.id)
      if (custEmail) {
        if (!tenant.stripe_secret_key) {
          console.error(`[Stripe Webhook] CRITICAL: Tenant ${tenant.slug} has no stripe_secret_key — cannot create card-on-file link. Skipping.`)
          throw new Error('Tenant has no Stripe key')
        }
        const cardResult = await createCardOnFileLink(
          { email: custEmail, phone_number: updatedJob.phone_number } as any,
          jobId,
          jobTenantId,
          tenant.stripe_secret_key,
        )

        if (cardResult.success && cardResult.url) {
          // Short delay between messages
          await new Promise(resolve => setTimeout(resolve, 2000))

          const cardMsg = `Additionally, go ahead and put your card on file so that we can get you set up: ${cardResult.url}`
          const cardSms = await sendSMS(tenant, updatedJob.phone_number, cardMsg)
          if (cardSms.success) {
            await serviceClient.from('messages').insert({
              tenant_id: tenant.id,
              customer_id: depositCustId,
              phone_number: updatedJob.phone_number,
              role: 'assistant',
              content: cardMsg,
              direction: 'outbound',
              message_type: 'sms',
              ai_generated: false,
              timestamp: new Date().toISOString(),
              source: 'stripe_card_on_file',
              metadata: { job_id: jobId, card_on_file_url: cardResult.url },
            })
            console.log(`[Stripe Webhook] Card-on-file link sent after deposit: ${cardResult.url}`)
          }
        }
      }
    } catch (cardErr) {
      console.error('[Stripe Webhook] Failed to send card-on-file after deposit:', cardErr)
    }
  }

  // Update lead status if lead_id is provided
  let hcpLeadId: string | undefined
  if (leadId) {
    // Get lead to find HCP source_id
    const { data: lead } = await serviceClient
      .from('leads')
      .select('source_id')
      .eq('id', leadId)
      .single()

    hcpLeadId = lead?.source_id

    const updatedLead = await updateGHLLead(leadId, {
      status: 'qualified',
      converted_to_job_id: jobId,
    })

    if (!updatedLead) {
      console.warn(`[Stripe Webhook] Failed to update lead ${leadId}`)
    }
  }

  // Convert HCP lead to job (two-way sync)
  let hcpJobId: string | undefined
  if (hcpLeadId && !hcpLeadId.startsWith('vapi-') && !hcpLeadId.startsWith('sms-')) {
    const hcpTenant = tenant
    if (hcpTenant) {
      console.log(`[Stripe Webhook] Converting HCP lead ${hcpLeadId} to job...`)
      const hcpResult = await convertHCPLeadToJob(hcpTenant, hcpLeadId, {
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
        }, {}, serviceClient)
      } else {
        console.warn(`[Stripe Webhook] Failed to convert HCP lead: ${hcpResult.error}`)
      }
    }
  }

  // Trigger cleaner assignment
  const assignmentResult = await triggerCleanerAssignment(jobId)

  // Check if both payment + cleaner now satisfied → mark booked
  if (assignmentResult.success) {
    await maybeMarkBooked(jobId)
  }

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
 * Handle QUOTE_DEPOSIT payment — customer approved a quote and paid the deposit.
 * Creates a job, marks quote approved, creates membership if applicable, sends SMS.
 */
/**
 * Handle quote card-on-file setup completion (checkout.session.completed with mode: 'setup', purpose: 'quote_card_on_file')
 * - Saves card on customer (stripe_customer_id + card_on_file_at)
 * - Sets default payment method on Stripe customer for future chargeCardOnFile() calls
 * - Marks quote approved
 * - Creates job with payment_status: 'pending'
 * - Creates membership if plan was selected
 * - Sends confirmation SMS
 * - Triggers cleaner assignment
 */
async function handleQuoteCardOnFile(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { quote_id, quote_token, selected_tier, phone_number, tenant_id, membership_plan } = metadata

  if (!quote_id) {
    console.error('[Stripe Webhook] quote_card_on_file missing quote_id')
    return
  }

  console.log(`[Stripe Webhook] Quote card-on-file saved — quote_id: ${quote_id}, tier: ${selected_tier}`)

  const serviceClient = getSupabaseServiceClient()

  // Fetch the quote
  const { data: quote } = await serviceClient
    .from('quotes')
    .select('*')
    .eq('id', quote_id)
    .single()

  if (!quote) {
    console.error(`[Stripe Webhook] Quote not found: ${quote_id}`)
    return
  }

  // Guard: only process pending quotes
  if (quote.status !== 'pending') {
    console.log(`[Stripe Webhook] Quote ${quote_id} already ${quote.status}, skipping`)
    return
  }

  // Mark quote as approved atomically
  const { error: approveError } = await serviceClient
    .from('quotes')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', quote_id)
    .in('status', ['pending'])

  if (approveError) {
    console.error(`[Stripe Webhook] Failed to approve quote ${quote_id}:`, approveError.message)
  }

  // Resolve tenant
  let tenant: Tenant | null = null
  if (tenant_id) {
    tenant = await getTenantById(tenant_id)
  }

  // Save card on customer: set card_on_file_at + stripe_customer_id + default payment method
  const stripeCustomerId = typeof session.customer === 'string'
    ? session.customer
    : (session.customer as any)?.id || null

  if (stripeCustomerId && tenant?.stripe_secret_key) {
    try {
      const stripe = (await import('@/lib/stripe-client')).getStripeClientForTenant(tenant.stripe_secret_key)

      // Retrieve the setup intent to get the payment method
      const setupIntentId = typeof session.setup_intent === 'string'
        ? session.setup_intent
        : (session.setup_intent as any)?.id
      if (setupIntentId) {
        const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
        const paymentMethodId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : (setupIntent.payment_method as any)?.id

        if (paymentMethodId) {
          // Set as default payment method on Stripe customer (critical for future chargeCardOnFile)
          await stripe.customers.update(stripeCustomerId, {
            invoice_settings: { default_payment_method: paymentMethodId },
          })
          console.log(`[Stripe Webhook] Set default payment method ${paymentMethodId} on Stripe customer ${stripeCustomerId}`)
        }
      }
    } catch (err) {
      console.error('[Stripe Webhook] Failed to set default payment method:', err)
    }
  }

  // Update customer record with card-on-file info
  const customerPhone = quote.customer_phone || phone_number
  if (customerPhone) {
    const { data: customer } = await serviceClient
      .from('customers')
      .select('id')
      .eq('phone_number', customerPhone)
      .eq('tenant_id', quote.tenant_id)
      .maybeSingle()

    if (customer?.id) {
      await serviceClient.from('customers').update({
        card_on_file_at: new Date().toISOString(),
        stripe_customer_id: stripeCustomerId,
      }).eq('id', customer.id)
      console.log(`[Stripe Webhook] Marked customer ${customer.id} as card-on-file`)
    }
  }

  // Determine service name from tier
  const tierNames: Record<string, string> = {
    good: 'Exterior Clean',
    better: 'Complete Clean',
    best: 'Full Detail',
    standard: 'Standard Clean',
    deep: 'Deep Clean',
    extra_deep: 'Extra Deep Clean',
    move: 'Move-In/Move-Out Clean',
    custom: 'Custom Quote',
  }
  const serviceName = tierNames[selected_tier || ''] || selected_tier || 'Cleaning'

  // Create membership first (if plan selected) so we can link it atomically to the job
  let membershipId: string | null = null
  if (membership_plan && quote.customer_id) {
    try {
      const { data: plan } = await serviceClient
        .from('service_plans')
        .select('id, interval_months')
        .eq('slug', membership_plan)
        .eq('tenant_id', quote.tenant_id)
        .eq('active', true)
        .single()

      if (plan) {
        // Guard: check for existing active membership to prevent duplicates on webhook replay
        const { data: existing } = await serviceClient
          .from('customer_memberships')
          .select('id')
          .eq('tenant_id', quote.tenant_id)
          .eq('customer_id', quote.customer_id)
          .eq('plan_id', plan.id)
          .eq('status', 'active')
          .maybeSingle()

        if (existing) {
          membershipId = existing.id
          console.log(`[Stripe Webhook] Reusing existing active membership ${existing.id} for customer ${quote.customer_id}`)
        } else {
          const nextVisit = addMonths(new Date(), plan.interval_months)

          // Find salesman who sold this (from the estimate job assignment)
          let soldById: number | null = null
          if (quote.customer_id) {
            const { data: estJob } = await serviceClient
              .from('jobs')
              .select('cleaner_assignments(cleaner_id)')
              .eq('tenant_id', quote.tenant_id)
              .eq('customer_id', quote.customer_id)
              .eq('job_type', 'estimate')
              .eq('status', 'completed')
              .order('completed_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            const assignments = (estJob as any)?.cleaner_assignments
            if (assignments?.length > 0) soldById = assignments[0].cleaner_id
          }

          const { data: membership } = await serviceClient.from('customer_memberships').insert({
            tenant_id: quote.tenant_id,
            customer_id: quote.customer_id,
            plan_id: plan.id,
            status: 'active',
            started_at: new Date().toISOString(),
            next_visit_at: nextVisit.toISOString(),
            visits_completed: 0,
            ...(soldById ? { sold_by_id: soldById } : {}),
          }).select('id').single()

          membershipId = membership?.id || null
        }
      } else {
        console.error(`[Stripe Webhook] Plan "${membership_plan}" not found or inactive for tenant ${quote.tenant_id}`)
      }
    } catch (err) {
      console.error('[Stripe Webhook] Membership creation error:', err)
    }
  }

  // Create job from the approved quote (with membership_id if applicable)
  const hasServiceDate = quote.service_date && typeof quote.service_date === 'string'
  const jobInsert: Record<string, unknown> = {
    tenant_id: quote.tenant_id,
    customer_id: quote.customer_id || null,
    phone_number: customerPhone || null,
    address: quote.customer_address || null,
    service_type: serviceName,
    price: Number(quote.total) || 0,
    status: hasServiceDate ? 'scheduled' : 'pending',
    booked: false,
    paid: false,
    payment_status: 'pending',
    confirmed_at: new Date().toISOString(),
    stripe_checkout_session_id: session.id,
    notes: `Quote #${(quote_token || '').slice(0, 8).toUpperCase()} approved — card on file — ${serviceName} package`,
    quote_id: quote.id,
    ...(hasServiceDate ? { date: quote.service_date } : {}),
    ...(membershipId ? { membership_id: membershipId } : {}),
  }

  const { data: newJob, error: jobError } = await serviceClient
    .from('jobs')
    .insert(jobInsert)
    .select('id')
    .single()

  if (jobError) {
    console.error(`[Stripe Webhook] Failed to create job from quote ${quote_id}:`, jobError.message)
  }

  // Generate professional invoice email (non-blocking)
  if (newJob?.id && tenant) {
    try {
      const { generateQuoteInvoice } = await import('@/lib/quote-invoice')
      generateQuoteInvoice(newJob.id, quote, tenant).catch(err => {
        console.error(`[Stripe Webhook] Quote invoice generation failed for job ${newJob.id}:`, err)
      })
    } catch (err) {
      console.error('[Stripe Webhook] Failed to import quote-invoice module:', err)
    }
  }

  // Send confirmation SMS (with date if selected)
  const smsPhone = customerPhone
  if (smsPhone && tenant) {
    try {
      const customerName = quote.customer_name?.split(' ')[0] || 'there'
      const businessName = tenant.business_name || tenant.name
      let message: string
      if (hasServiceDate) {
        const dateStr = new Date(quote.service_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        message = `Hey ${customerName}! Your card is on file and your ${serviceName.toLowerCase()} with ${businessName} is booked for ${dateStr}. We'll send you a reminder before your appointment. Thank you!`
      } else {
        message = `Hey ${customerName}! Your card is on file and your ${serviceName.toLowerCase()} with ${businessName} is confirmed. We'll be in touch to schedule your service. Thank you!`
      }
      await sendSMS(tenant, smsPhone, message)
    } catch (err) {
      console.error('[Stripe Webhook] Failed to send quote confirmation SMS:', err)
    }
  }

  // Log system event
  await logSystemEvent({
    tenant_id: quote.tenant_id,
    source: 'stripe',
    event_type: 'QUOTE_CARD_ON_FILE',
    message: `Quote #${(quote_token || '').slice(0, 8).toUpperCase()} approved — card on file — ${serviceName}`,
    phone_number: smsPhone || undefined,
    job_id: newJob?.id ? String(newJob.id) : undefined,
    metadata: {
      quote_id,
      selected_tier,
      total: quote.total,
      membership_plan: membership_plan || null,
      membership_id: membershipId,
      stripe_session_id: session.id,
    },
  })

  // Cancel quote follow-up tasks + ALL retargeting sequences (customer converted)
  try {
    await cancelTask(`quote-${quote_id}-urgent`)
    if (quote.customer_id) {
      await cancelPendingTasks(quote.tenant_id, `retarget-${quote.customer_id}-`)
      // Clear retargeting state so they're not re-enrolled
      await serviceClient.from('customers').update({
        retargeting_completed_at: new Date().toISOString(),
        retargeting_stopped_reason: 'converted',
      }).eq('id', quote.customer_id)
    }
    console.log(`[Stripe Webhook] Cancelled quote follow-up tasks for quote ${quote_id}`)
  } catch (err) {
    console.error('[Stripe Webhook] Failed to cancel quote follow-up tasks:', err)
  }

  // Trigger technician assignment if job was created with a service date
  if (newJob?.id && hasServiceDate && tenant) {
    try {
      const useRouteOpt = tenant.workflow_config?.use_route_optimization === true
      let techAssigned = false

      if (useRouteOpt) {
        const { optimization, assignedTeamId, assignedLeadId } =
          await optimizeRoutesIncremental(newJob.id, quote.service_date, quote.tenant_id, 'technician')

        if (assignedTeamId && assignedLeadId) {
          await dispatchRoutes(optimization, quote.tenant_id, {
            sendTelegramToTeams: false,
            sendSmsToCustomers: false,
            sendOwnerSummary: false,
          })

          const { data: tech } = await serviceClient
            .from('cleaners')
            .select('phone, name, portal_token')
            .eq('id', assignedLeadId)
            .maybeSingle()
          if (tech?.phone) {
            const { getClientConfig } = await import('@/lib/client-config')
            const appDomain = getClientConfig().domain.replace(/\/+$/, '')
            const portalLink = tech.portal_token ? `\nDetails: ${appDomain}/crew/${tech.portal_token}/job/${newJob.id}` : ''
            const custName = quote.customer_name?.split(' ')[0] || 'Customer'
            const dateStr = new Date(quote.service_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
            const techMsg = `New Job Assigned!\n\nCustomer: ${custName}\nAddress: ${quote.customer_address || 'See portal'}\nDate: ${dateStr}\nService: ${serviceName}${portalLink}\n\nReply ACCEPT or DECLINE.`
            await sendSMS(tenant, tech.phone, techMsg)
            techAssigned = true
            console.log(`[Stripe Webhook] Technician ${tech.name} notified for quote-approved job ${newJob.id}`)
          }
        }
      }

      if (!techAssigned) {
        await triggerCleanerAssignment(String(newJob.id))
      }
    } catch (err) {
      console.error('[Stripe Webhook] Technician assignment from quote failed:', err)
      try { await triggerCleanerAssignment(String(newJob.id)) } catch { /* swallow */ }
    }
  } else if (newJob?.id) {
    try {
      await triggerCleanerAssignment(String(newJob.id))
    } catch (err) {
      console.error('[Stripe Webhook] Cleaner assignment from quote failed:', err)
    }
  }

  // Notify salesman if this quote originated from an estimate
  if (tenant && quote.customer_id) {
    try {
      const { data: estimateAssignment } = await serviceClient
        .from('jobs')
        .select(`
          id,
          cleaner_assignments!inner(cleaner_id, cleaners!inner(name, phone))
        `)
        .eq('tenant_id', quote.tenant_id)
        .eq('customer_id', quote.customer_id)
        .eq('job_type', 'estimate')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (estimateAssignment) {
        const assignments = (estimateAssignment as any).cleaner_assignments
        if (assignments?.length > 0) {
          const salesman = assignments[0].cleaners
          if (salesman?.phone) {
            const custName = quote.customer_name?.split(' ')[0] || 'A customer'
            await sendSMS(tenant, salesman.phone, `${custName} just accepted your quote for $${Number(quote.total || 0).toFixed(0)}! Job is booked. Nice work, ${salesman.name?.split(' ')[0] || 'team'}!`)
            console.log(`[Stripe Webhook] Notified salesman ${salesman.name} about quote conversion`)
          }
        }
      }
    } catch (err) {
      console.error('[Stripe Webhook] Failed to notify salesman:', err)
    }
  }
}

async function handleQuoteDepositPayment(session: Stripe.Checkout.Session) {
  console.warn('[LEGACY] handleQuoteDepositPayment — processing in-flight deposit session. New quotes use setup mode (card-on-file).')
  const metadata = session.metadata || {}
  const { quote_id, quote_token, selected_tier, phone_number, tenant_id, membership_plan } = metadata

  if (!quote_id) {
    console.error('[Stripe Webhook] QUOTE_DEPOSIT missing quote_id')
    return
  }

  console.log(`[Stripe Webhook] Quote deposit paid — quote_id: ${quote_id}, tier: ${selected_tier}`)

  const serviceClient = getSupabaseServiceClient()

  // Fetch the quote
  const { data: quote } = await serviceClient
    .from('quotes')
    .select('*')
    .eq('id', quote_id)
    .single()

  if (!quote) {
    console.error(`[Stripe Webhook] Quote not found: ${quote_id}`)
    return
  }

  // Mark quote as approved atomically
  const { error: approveError } = await serviceClient
    .from('quotes')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
    })
    .eq('id', quote_id)
    .in('status', ['pending']) // Only if still pending (idempotent)

  if (approveError) {
    console.error(`[Stripe Webhook] Failed to approve quote ${quote_id}:`, approveError.message)
  }

  // Resolve tenant
  let tenant: Tenant | null = null
  if (tenant_id) {
    tenant = await getTenantById(tenant_id)
  }

  // Determine service name from tier
  const tierNames: Record<string, string> = {
    good: 'Exterior Clean',
    better: 'Complete Clean',
    best: 'Full Detail',
    standard: 'Standard Clean',
    deep: 'Deep Clean',
    extra_deep: 'Extra Deep Clean',
    move: 'Move-In/Move-Out Clean',
  }
  const serviceName = tierNames[selected_tier || ''] || selected_tier || 'Cleaning'

  // Create membership first (if plan selected) so we can link it atomically to the job
  let depositMembershipId: string | null = null
  if (membership_plan && quote.customer_id) {
    try {
      const { data: plan } = await serviceClient
        .from('service_plans')
        .select('id, interval_months')
        .eq('slug', membership_plan)
        .eq('tenant_id', quote.tenant_id)
        .eq('active', true)
        .single()

      if (plan) {
        // Guard: check for existing active membership to prevent duplicates on webhook replay
        const { data: existing } = await serviceClient
          .from('customer_memberships')
          .select('id')
          .eq('tenant_id', quote.tenant_id)
          .eq('customer_id', quote.customer_id)
          .eq('plan_id', plan.id)
          .eq('status', 'active')
          .maybeSingle()

        if (existing) {
          depositMembershipId = existing.id
          console.log(`[Stripe Webhook] Reusing existing active membership ${existing.id} for customer ${quote.customer_id}`)
        } else {
          const nextVisit = addMonths(new Date(), plan.interval_months)

          const { data: membership } = await serviceClient.from('customer_memberships').insert({
            tenant_id: quote.tenant_id,
            customer_id: quote.customer_id,
            plan_id: plan.id,
            status: 'active',
            started_at: new Date().toISOString(),
            next_visit_at: nextVisit.toISOString(),
            visits_completed: 0,
          }).select('id').single()

          depositMembershipId = membership?.id || null
        }
      } else {
        console.error(`[Stripe Webhook] Plan "${membership_plan}" not found or inactive for tenant ${quote.tenant_id}`)
      }
    } catch (err) {
      console.error('[Stripe Webhook] Membership creation error:', err)
    }
  }

  // Create job from the approved quote (with membership_id if applicable)
  const jobInsert: Record<string, unknown> = {
    tenant_id: quote.tenant_id,
    customer_id: quote.customer_id || null,
    phone_number: quote.customer_phone || phone_number || null,
    address: quote.customer_address || null,
    service_type: serviceName,
    price: Number(quote.total) || 0,
    status: 'pending',
    booked: false,
    paid: false,
    payment_status: 'deposit_paid',
    confirmed_at: new Date().toISOString(),
    stripe_checkout_session_id: session.id,
    notes: `Quote #${(quote_token || '').slice(0, 8).toUpperCase()} approved & deposit paid — ${serviceName} package`,
    quote_id: quote.id,
    ...(depositMembershipId ? { membership_id: depositMembershipId } : {}),
  }

  const { data: newJob, error: jobError } = await serviceClient
    .from('jobs')
    .insert(jobInsert)
    .select('id')
    .single()

  if (jobError) {
    console.error(`[Stripe Webhook] Failed to create job from quote ${quote_id}:`, jobError.message)
  }

  // Send confirmation SMS
  const smsPhone = quote.customer_phone || phone_number
  if (smsPhone && tenant) {
    try {
      const customerName = quote.customer_name?.split(' ')[0] || 'there'
      const businessName = tenant.business_name || tenant.name
      const depositStr = quote.deposit_amount ? `$${Number(quote.deposit_amount).toFixed(2)}` : 'your deposit'
      const message = `Hey ${customerName}! Your ${depositStr} deposit for ${serviceName} with ${businessName} has been received. We'll be in touch to schedule your service. Thank you!`
      await sendSMS(tenant, smsPhone, message)
    } catch (err) {
      console.error('[Stripe Webhook] Failed to send quote confirmation SMS:', err)
    }
  }

  // Log system event
  await logSystemEvent({
    tenant_id: quote.tenant_id,
    source: 'stripe',
    event_type: 'QUOTE_DEPOSIT_PAID',
    message: `Quote #${(quote_token || '').slice(0, 8).toUpperCase()} approved and deposit paid — ${serviceName}`,
    phone_number: smsPhone || undefined,
    job_id: newJob?.id ? String(newJob.id) : undefined,
    metadata: {
      quote_id,
      selected_tier,
      total: quote.total,
      deposit_amount: quote.deposit_amount,
      membership_plan: membership_plan || null,
      stripe_session_id: session.id,
    },
  })

  // Trigger cleaner assignment if job was created
  if (newJob?.id) {
    try {
      await triggerCleanerAssignment(String(newJob.id))
    } catch (err) {
      console.error('[Stripe Webhook] Cleaner assignment from quote failed:', err)
    }
  }
}

/**
 * Handle FINAL payment completion
 * - Updates job payment_status to 'fully_paid'
 * - Sets paid = true
 */
async function handleFinalPayment(jobId: string, session: Stripe.Checkout.Session) {
  console.log(`[Stripe Webhook] Processing FINAL payment for job: ${jobId}`)

  // Use service client — webhook has no tenant JWT, anon key is blocked by RLS
  const serviceClient = getSupabaseServiceClient()

  // Update job status
  const updatedJob = await updateJob(jobId, {
    payment_status: 'fully_paid',
    paid: true,
  }, {}, serviceClient)

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

  // Payment confirmed — check if cleaner is also assigned → mark booked
  await maybeMarkBooked(jobId)

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

  const client = getSupabaseServiceClient()

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

  // Get job and phone number
  let phoneNumber: string | undefined
  let teamId: number | null = null
  if (job_id) {
    const job = await getJobById(job_id, getSupabaseServiceClient())
    phoneNumber = job?.phone_number
    teamId = job?.team_id ?? null
  }

  const tipDollars = tip_amount
    ? parseFloat(tip_amount)
    : session.amount_total
      ? session.amount_total / 100
      : 0

  // Distribute tip equally among assigned cleaners
  if (job_id && tipDollars > 0) {
    await distributeTip(
      Number(job_id),
      tipDollars,
      teamId,
      'stripe',
      `stripe_session=${session.id}`
    ).catch(err => console.error('[Stripe Webhook] Failed to distribute tip:', err))
  }

  // Log the tip payment
  await logSystemEvent({
    source: 'stripe',
    event_type: 'INVOICE_PAID',
    message: `Tip of $${tipDollars.toFixed(2)} received for ${cleanerName}`,
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

  console.log(`[Stripe Webhook] TIP payment processed - $${tipDollars.toFixed(2)} for ${cleanerName}`)
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
    const job = await getJobById(job_id, getSupabaseServiceClient())

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
 * Handle payment_intent.payment_failed event
 * - Updates job payment_status to 'payment_failed'
 * - Logs PAYMENT_FAILED system event
 * - Sends customer SMS with payment link to retry
 * - Alerts owner via Telegram
 * - Tracks retry count in job notes
 */
async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
  const metadata = paymentIntent.metadata || {}
  const { job_id, payment_type, phone_number: metaPhone } = metadata

  const failureMessage = paymentIntent.last_payment_error?.message || 'Card declined'
  const failureCode = paymentIntent.last_payment_error?.code || 'unknown'

  console.log(`[Stripe Webhook] Payment failed - job_id: ${job_id}, type: ${payment_type}, reason: ${failureMessage}`)

  if (!job_id) {
    console.error('[Stripe Webhook] payment_intent.payment_failed has no job_id in metadata')
    return
  }

  // Use service client — webhooks don't have tenant JWT, anon key is blocked by RLS
  const serviceClient = getSupabaseServiceClient()

  const job = await getJobById(job_id, serviceClient)
  if (!job) {
    console.error(`[Stripe Webhook] Job not found for failed payment: ${job_id}`)
    return
  }

  const phoneNumber = metaPhone || job.phone_number

  // Update job payment_status to reflect failure
  const currentNotes = job.notes || ''
  const retryMatch = currentNotes.match(/PAYMENT_RETRY_COUNT:\s*(\d+)/)
  const currentRetryCount = retryMatch ? parseInt(retryMatch[1], 10) : 0

  // Update notes with failure info (append or update)
  let updatedNotes = currentNotes
  // Remove old PAYMENT_FAILED line if present
  updatedNotes = updatedNotes.replace(/PAYMENT_FAILED:[^\n]*\n?/g, '')
  updatedNotes = `${updatedNotes}\nPAYMENT_FAILED: ${new Date().toISOString()} | ${failureCode} | ${failureMessage}`.trim()

  await updateJob(job_id, {
    payment_status: 'payment_failed',
    notes: updatedNotes,
  }, {}, serviceClient)

  // Get tenant for notifications
  const jobTenantId = (job as any).tenant_id
  if (!jobTenantId) {
    console.error(`[Stripe Webhook] CRITICAL: Job ${job_id} has no tenant_id — cannot determine tenant for payment failure. Skipping SMS/notifications.`)
  }
  const tenant = jobTenantId ? await getTenantById(jobTenantId) : null

  // Send customer SMS with retry info
  // Payment links are persistent — the customer can click the same link again
  // If the checkout session URL is in the payment intent, use it
  const paymentUrl = paymentIntent.last_payment_error?.payment_method
    ? `https://checkout.stripe.com/pay/${paymentIntent.id}`
    : null

  if (phoneNumber && tenant) {
    const { data: customer } = await serviceClient
      .from('customers')
      .select('id')
      .eq('phone_number', phoneNumber)
      .eq('tenant_id', tenant.id)
      .maybeSingle()

    // Only send customer SMS on first failure (avoid spamming on repeated declines within same session)
    if (currentRetryCount === 0) {
      const customerMsg = paymentUrl
        ? paymentFailedTemplate(paymentUrl)
        : "Your recent payment didn't go through. Please contact us to arrange payment."
      const smsResult = await sendSMS(tenant, phoneNumber, customerMsg)

      if (smsResult.success) {
        await serviceClient.from('messages').insert({
          tenant_id: tenant.id,
          customer_id: customer?.id || job.customer_id || null,
          phone_number: phoneNumber,
          role: 'assistant',
          content: customerMsg,
          direction: 'outbound',
          message_type: 'sms',
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: 'stripe_payment_failed',
        })
        console.log(`[Stripe Webhook] Payment failure SMS sent to ${maskPhone(phoneNumber)}`)
      }
    }

    // Always notify owner via SMS
    if (tenant.owner_phone) {
      const amount = paymentIntent.amount ? `$${(paymentIntent.amount / 100).toFixed(2)}` : 'unknown'
      const ownerMsg = [
        `PAYMENT FAILED`,
        ``,
        `Customer: ${phoneNumber}`,
        `Amount: ${amount}`,
        `Type: ${payment_type || 'unknown'}`,
        `Reason: ${failureMessage}`,
        `Job ID: ${job_id}`,
        ``,
        currentRetryCount > 0
          ? `This is attempt #${currentRetryCount + 1}. Consider contacting the customer directly.`
          : `Customer has been notified via SMS.`,
      ].join('\n')

      try {
        await sendSMS(tenant, tenant.owner_phone, ownerMsg)
        console.log(`[Stripe Webhook] Owner notified of payment failure for job ${job_id}`)
      } catch (err) {
        console.error(`[Stripe Webhook] Failed to send owner payment failure alert:`, err)
      }
    }
  }

  // Log system event
  await logSystemEvent({
    source: 'stripe',
    event_type: 'PAYMENT_FAILED',
    message: `Payment failed for job ${job_id}: ${failureMessage}`,
    job_id,
    phone_number: phoneNumber,
    metadata: {
      payment_type: payment_type || 'unknown',
      payment_intent_id: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      failure_code: failureCode,
      failure_message: failureMessage,
      retry_count: currentRetryCount,
    },
  })

  console.log(`[Stripe Webhook] Payment failure processed for job ${job_id}`)
}

/**
 * Handle card-on-file setup completion (checkout.session.completed with mode: 'setup')
 * - Sends confirmation SMS to customer
 * - For route-optimization tenants (WinBros): notifies owner via Telegram, job queued for batch routing
 * - For other tenants: triggers individual cleaner assignment cascade
 */
async function handleCardOnFileSaved(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { job_id, phone_number } = metadata

  console.log(`[Stripe Webhook] Card on file saved - job_id: ${job_id}, phone: ${maskPhone(phone_number)}, session: ${session.id}`)

  const client = getSupabaseServiceClient()

  // Look up tenant from job's tenant_id (not default) to route SMS/Telegram correctly
  let tenant: Tenant | null = null
  if (job_id && !job_id.startsWith('lead-')) {
    const { data: jobRow } = await client
      .from('jobs')
      .select('tenant_id')
      .eq('id', job_id)
      .maybeSingle()
    if (jobRow?.tenant_id) {
      tenant = await getTenantById(jobRow.tenant_id)
    }
  }
  if (!tenant) {
    console.error(`[Stripe Webhook] CRITICAL: No tenant_id found for card-on-file job ${job_id} — refusing to fall back to default tenant. Skipping processing.`)
    return
  }
  console.log(`[Stripe Webhook] Using tenant ${tenant.slug} for card-on-file processing`)

  // Send confirmation SMS to customer
  if (phone_number) {
    console.log(`[Stripe Webhook] Sending card-on-file confirmation SMS to ${phone_number}`)
    const confirmMsg = "Thanks, your card is on file. You're fully set up now!"
    const smsResult = await sendSMS(tenant, phone_number, confirmMsg)

    if (smsResult.success) {
      const { data: customer } = await client
        .from('customers')
        .select('id')
        .eq('phone_number', phone_number)
        .eq('tenant_id', tenant.id)
        .maybeSingle()

      // Mark customer as having card on file
      if (customer?.id) {
        await client.from('customers').update({
          card_on_file_at: new Date().toISOString(),
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : (session.customer as any)?.id || null,
        }).eq('id', customer.id)
        console.log(`[Stripe Webhook] Marked customer ${customer.id} as card-on-file`)
      }

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

      console.log(`[Stripe Webhook] Card-on-file confirmation SMS sent to ${maskPhone(phone_number)}`)
    } else {
      console.error(`[Stripe Webhook] Failed to send card-on-file SMS to ${maskPhone(phone_number)}: ${smsResult.error}`)
    }
  }

  // Get job details for logging and assignment
  let job: Awaited<ReturnType<typeof getJobById>> | null = null
  let actualJobId = job_id
  if (job_id && !job_id.startsWith('lead-')) {
    job = await getJobById(job_id, client)
    if (!job) {
      console.error(`[Stripe Webhook] Job not found for card-on-file: ${job_id}`)
    } else {
      console.log(`[Stripe Webhook] Job found: ${job_id} — service: ${job.service_type}, date: ${job.date}, address: ${job.address}, price: ${job.price}`)

      // Card-on-file saved → transition quoted jobs to scheduled (but not booked — needs cleaner too)
      if (job.status === 'quoted') {
        const { error: transitionErr } = await client
          .from('jobs')
          .update({ status: 'scheduled' })
          .eq('id', job_id)
          .eq('status', 'quoted') // atomic: only transition if still quoted
        if (transitionErr) {
          console.error(`[Stripe Webhook] Failed to transition job ${job_id} quoted→scheduled:`, transitionErr.message)
        } else {
          console.log(`[Stripe Webhook] Job ${job_id} transitioned quoted→scheduled after card saved`)
          // Refresh job object so downstream assignment logic sees updated status
          job = await getJobById(job_id, client)
          // Check if cleaner is already assigned → maybe mark booked
          await maybeMarkBooked(job_id, job)
        }
      }
    }
  } else if (job_id && job_id.startsWith('lead-')) {
    // Job creation failed during booking — retry from lead data
    const leadId = job_id.replace('lead-', '')
    console.log(`[Stripe Webhook] job_id is lead fallback (${job_id}), attempting job creation from lead ${leadId}`)

    const { data: lead } = await client
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (lead) {
      const bookingData = lead.form_data?.booking_data || {}

      // Look up associated customer
      let custId = lead.customer_id || null
      let custPhone = phone_number || null
      let custAddress: string | null = null
      if (custId) {
        const { data: cust } = await client
          .from('customers')
          .select('id, phone_number, address')
          .eq('id', custId)
          .single()
        if (cust) {
          custPhone = custPhone || cust.phone_number
          custAddress = cust.address
        }
      }

      // Try to create the job now
      const { data: retryJob } = await client.from('jobs').insert({
        tenant_id: tenant.id,
        customer_id: custId,
        phone_number: custPhone,
        service_type: bookingData.serviceType?.replace(/_/g, ' ') || 'window cleaning',
        address: bookingData.address || custAddress || null,
        price: bookingData.price || null,
        date: bookingData.preferredDate || null,
        scheduled_at: bookingData.preferredTime || null,
        status: 'scheduled',
        booked: false,
        // TENANT ISOLATION: buildWinBrosJobNotes is window-cleaning-specific.
        // Cedar Rapids house cleaning uses mergeOverridesIntoNotes instead.
        // Do NOT use buildWinBrosJobNotes for non-WinBros tenants.
        notes: (tenant && tenantUsesFeature(tenant, 'use_hcp_mirror'))
          ? buildWinBrosJobNotes(bookingData) || null
          : null,
      }).select('id').single()

      if (retryJob) {
        actualJobId = retryJob.id
        job = await getJobById(retryJob.id, client)
        console.log(`[Stripe Webhook] Job created from lead retry: ${retryJob.id}`)

        // Sync to HouseCall Pro
        await syncNewJobToHCP({
          tenant,
          jobId: retryJob.id,
          phone: custPhone || '',
          firstName: lead.first_name,
          lastName: lead.last_name,
          address: bookingData.address || custAddress,
          serviceType: bookingData.serviceType || null,
          scheduledDate: bookingData.preferredDate || null,
          scheduledTime: bookingData.preferredTime || null,
          price: bookingData.price || null,
          notes: `Booked via Stripe payment`,
          source: 'stripe',
        })

        // Update lead with the real job ID
        await client
          .from('leads')
          .update({ converted_to_job_id: retryJob.id, status: 'qualified' })
          .eq('id', leadId)
      } else {
        console.error(`[Stripe Webhook] Job creation retry failed for lead ${leadId}`)
      }
    } else {
      console.error(`[Stripe Webhook] Lead not found: ${leadId}`)
    }
  } else {
    console.log(`[Stripe Webhook] No job_id for card-on-file, skipping assignment`)
  }

  // ──────────────────────────────────────────────────────────────────────
  // TENANT ISOLATION — CLEANER ASSIGNMENT MODES (do NOT merge these paths):
  //
  // WinBros (use_team_routing=true):
  //   Full route optimization → auto-assign to closest team → Telegram owner notify
  //
  // Cedar Rapids (use_broadcast_assignment=true):
  //   Broadcast to ALL cleaners → first to accept wins → customer notified
  //   Assignment triggered here after card-on-file saved (quoted→scheduled transition above).
  //
  // If deposit was already paid, cleaner assignment was already triggered — skip here.
  // ──────────────────────────────────────────────────────────────────────
  const useRouteOptimization = tenantUsesFeature(tenant, 'use_team_routing')
  let assignmentOutcome = 'no_job'

  if (job && job.payment_status === 'deposit_paid') {
    assignmentOutcome = 'already_assigned_via_deposit'
    console.log(`[Stripe Webhook] Job ${actualJobId} already has deposit_paid status — skipping redundant assignment`)
  } else if (job && (job as any).job_type === 'estimate') {
    // WinBros estimate jobs should never trigger route optimization from Stripe
    // (salesman handles estimates, not the payment flow)
    assignmentOutcome = 'skipped_estimate'
    console.log(`[Stripe Webhook] Job ${actualJobId} is an estimate — skipping route optimization`)
  } else if (job) {
    if (useRouteOptimization) {
      // WinBros flow: full route optimization across all teams for this day
      console.log(`[Stripe Webhook] WinBros route optimization — re-optimizing all routes for ${job.date} including job ${actualJobId}`)
      assignmentOutcome = 'auto_assigned'

      try {
        if (!job.date) {
          console.warn(`[Stripe Webhook] Job ${actualJobId} has no date — cannot optimize routes`)
          assignmentOutcome = 'no_date'
        } else {
          // Run full route optimization for the day (includes this new job)
          const { optimization, assignedTeamId, assignedLeadId, assignedLeadTelegramId } =
            await optimizeRoutesIncremental(Number(actualJobId), job.date, tenant.id)

          if (assignedTeamId && assignedLeadId) {
            // Dispatch: persist ALL assignments and update ALL jobs for the day
            const dispatchResult = await dispatchRoutes(optimization, tenant.id, {
              sendTelegramToTeams: false,  // Don't send full route now — that happens at 5pm CT
              sendSmsToCustomers: false,   // Don't send ETA now — that happens at 5pm CT
            })

            console.log(`[Stripe Webhook] Route dispatch: ${dispatchResult.jobsUpdated} jobs updated, ${dispatchResult.assignmentsCreated} assignments`)

            // Send immediate SMS to assigned cleaner — WITHOUT address
            const businessName = tenant.business_name_short || tenant.name
            const dateStr = job.date
              ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
              : 'TBD'

            let timeStr = ''
            if (job.scheduled_at) {
              const raw = String(job.scheduled_at)
              const shortTime = raw.match(/^(\d{1,2}):(\d{2})$/)
              if (shortTime) {
                let h = parseInt(shortTime[1])
                const m = shortTime[2]
                const ampm = h >= 12 ? 'PM' : 'AM'
                if (h > 12) h -= 12
                if (h === 0) h = 12
                timeStr = `${h}:${m} ${ampm}`
              } else {
                const d = new Date(raw)
                if (!isNaN(d.getTime())) {
                  timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
                }
              }
            }

            const serviceStr = (job.service_type || 'Window Cleaning').replace(/\b\w/g, c => c.toUpperCase())

            if (assignedLeadId) {
              // Look up cleaner phone for SMS notification
              const { data: assignedLead } = await client
                .from('cleaners')
                .select('phone')
                .eq('id', assignedLeadId)
                .single()

              if (assignedLead?.phone) {
                // Notification WITHOUT address — address comes in the full schedule at 5pm CT
                const notifMsg = `New Job Assigned - ${businessName}. Date: ${dateStr}${timeStr ? ` at ${timeStr}` : ''}. Service: ${serviceStr}. You'll receive your full route with addresses at 5 PM tonight.`

                try {
                  await sendSMS(tenant, assignedLead.phone, notifMsg)
                  console.log(`[Stripe Webhook] Cleaner SMS notification (no address) sent for job ${actualJobId}`)
                } catch (err) {
                  console.error(`[Stripe Webhook] Failed to send cleaner notification:`, err)
                }
              }
            }
          } else {
            assignmentOutcome = optimization.unassignedJobs.length > 0
              ? `unassigned: ${optimization.unassignedJobs[0].reason}`
              : 'no_teams'
            console.warn(`[Stripe Webhook] Job ${actualJobId} could not be assigned via route optimization`)
          }
        }
      } catch (routeErr) {
        console.error(`[Stripe Webhook] Route optimization failed, falling back to closest-team:`, routeErr)
        assignmentOutcome = 'route_optimization_failed'

        // Fallback: simple closest-team assignment
        const { data: teams } = await client
          .from('teams')
          .select('id, name, active, team_members ( cleaner_id, role, is_active, cleaners ( id, name, telegram_id, home_lat, home_lng ) )')
          .eq('tenant_id', tenant.id)
          .eq('active', true)

        let team = teams?.[0]
        if (teams && teams.length > 1 && job.address) {
          try {
            const jobGeo = await geocodeAddress(job.address)
            if (jobGeo) {
              let bestTeam = teams[0]
              let bestDistance = Infinity
              for (const t of teams) {
                const members = (t.team_members || []) as any[]
                const lead = members.find((m: any) => m.role === 'lead' && m.is_active && m.cleaners?.home_lat != null && m.cleaners?.home_lng != null)
                if (!lead?.cleaners?.home_lat || !lead?.cleaners?.home_lng) continue
                const dist = calculateDistance(lead.cleaners.home_lat, lead.cleaners.home_lng, jobGeo.lat, jobGeo.lng)
                if (dist < bestDistance) { bestDistance = dist; bestTeam = t }
              }
              team = bestTeam
            }
          } catch (_) { /* use first team */ }
        }

        if (team) {
          const members = (team.team_members || []) as any[]
          const lead = members.find((m: any) => m.role === 'lead' && m.is_active)
            || members.find((m: any) => m.is_active)
          if (lead?.cleaner_id) {
            await client.from('cleaner_assignments').insert({
              tenant_id: tenant.id, job_id: actualJobId, cleaner_id: lead.cleaner_id,
              status: 'confirmed', assigned_at: new Date().toISOString(), responded_at: new Date().toISOString(),
            })
            await updateJob(actualJobId!, { team_id: team.id, cleaner_confirmed: true, status: 'scheduled' } as Record<string, unknown>)
            assignmentOutcome = 'fallback_closest_team'
          }
        }
      }

      // Always notify owner about new booking via SMS
      if (tenant.owner_phone) {
        const customerName = phone_number || 'Unknown'
        const priceStr = job.price ? `$${Number(job.price).toFixed(2)}` : 'TBD'
        const dateStr = job.date || 'TBD'
        const serviceStr = job.service_type || 'window cleaning'

        const ownerMsg = [
          `NEW BOOKING - CARD ON FILE`,
          ``,
          `Customer: ${customerName}`,
          `Service: ${serviceStr}`,
          `Date: ${dateStr}`,
          `Price: ${priceStr}`,
          ``,
          assignmentOutcome === 'auto_assigned'
            ? `Job routed via full optimization.`
            : assignmentOutcome === 'fallback_closest_team'
              ? `Job assigned to closest team (optimization failed).`
              : `WARNING: Job could not be auto-assigned - ${assignmentOutcome}.`,
        ].join('\n')

        try {
          await sendSMS(tenant, tenant.owner_phone, ownerMsg)
        } catch (err) {
          console.error(`[Stripe Webhook] Failed to send owner notification for job ${actualJobId}:`, err)
        }
      }
    } else {
      // Standard flow (Spotless Scrubbers etc.): trigger accept/decline cascade
      console.log(`[Stripe Webhook] Triggering cleaner assignment for job ${actualJobId}`)
      const assignmentResult = await triggerCleanerAssignment(actualJobId!)

      if (assignmentResult.success) {
        assignmentOutcome = 'cleaner_assigned'
        console.log(`[Stripe Webhook] Cleaner assignment triggered successfully for job ${actualJobId}`)
      } else {
        assignmentOutcome = `assignment_failed: ${assignmentResult.error}`
        console.error(`[Stripe Webhook] Cleaner assignment failed for job ${actualJobId}: ${assignmentResult.error}`)
      }
    }
  } else if (job_id?.startsWith('lead-') && tenant.owner_phone) {
    // Even if job retry failed, still notify owner that a customer saved their card
    assignmentOutcome = 'lead_only_notified'
    const ownerMsg = [
      `NEW BOOKING - CARD ON FILE`,
      ``,
      `Customer: ${phone_number || 'Unknown'}`,
      `WARNING: Job creation failed - check the lead in the dashboard.`,
      `Lead ID: ${job_id.replace('lead-', '')}`,
    ].join('\n')

    try {
      await sendSMS(tenant, tenant.owner_phone, ownerMsg)
      console.log(`[Stripe Webhook] Owner notified about card-on-file with failed job (${job_id})`)
    } catch (err) {
      console.error(`[Stripe Webhook] Failed to send lead-fallback owner SMS:`, err)
    }
  }

  // Log system event with full details
  await logSystemEvent({
    source: 'stripe',
    event_type: 'CARD_ON_FILE_SAVED',
    message: `Card on file saved${phone_number ? ` for ${phone_number}` : ''}${job ? ` — job ${actualJobId} (${job.service_type}, ${job.date})` : ''}`,
    phone_number: phone_number || undefined,
    job_id: actualJobId || undefined,
    metadata: {
      session_id: session.id,
      session_mode: session.mode,
      assignment_outcome: assignmentOutcome,
      use_route_optimization: useRouteOptimization,
      job_details: job ? {
        service_type: job.service_type,
        date: job.date,
        address: job.address,
        price: job.price,
        status: job.status,
      } : null,
    },
  })

  console.log(`[Stripe Webhook] Card-on-file processing complete — outcome: ${assignmentOutcome}`)
}

/**
 * Handle setup_intent.succeeded event
 * This always fires alongside checkout.session.completed for card-on-file setups.
 * checkout.session.completed handles ALL processing (SMS, assignment, notifications).
 * This handler is a no-op to prevent duplicate messages from the race condition.
 */
async function handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent) {
  const metadata = setupIntent.metadata || {}
  const { job_id, phone_number, purpose } = metadata

  console.log(`[Stripe Webhook] Setup intent succeeded - job_id: ${job_id}, phone: ${maskPhone(phone_number)}, purpose: ${purpose}`)

  // Quote card-on-file is fully handled by handleQuoteCardOnFile via checkout.session.completed
  if (purpose === 'quote_card_on_file') {
    console.log('[Stripe Webhook] Skipping setup_intent.succeeded for quote_card_on_file — handled by checkout.session.completed')
    return
  }

  // Persist card-on-file: extract Stripe customer ID and update local customer
  const stripeCustomerId = typeof setupIntent.customer === 'string'
    ? setupIntent.customer
    : (setupIntent.customer as any)?.id || null

  if (phone_number) {
    const client = getSupabaseServiceClient()

    // Find tenant from job if available, otherwise try by phone
    let tenantId: string | null = null
    if (job_id && !job_id.startsWith('lead-')) {
      const { data: jobRow } = await client
        .from('jobs')
        .select('tenant_id')
        .eq('id', job_id)
        .maybeSingle()
      tenantId = jobRow?.tenant_id || null
    }

    if (tenantId) {
      const { data: customer } = await client
        .from('customers')
        .select('id')
        .eq('phone_number', phone_number)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (customer?.id) {
        await client.from('customers').update({
          card_on_file_at: new Date().toISOString(),
          stripe_customer_id: stripeCustomerId,
        }).eq('id', customer.id)
        console.log(`[Stripe Webhook] Card-on-file persisted for customer ${customer.id} via setup_intent`)
      }
    }
  }
}

/**
 * Helper to look up customer email by phone number and tenant
 */
async function getCustomerEmail(phoneNumber: string, tenantId: string): Promise<string | null> {
  const client = getSupabaseServiceClient()
  const { data } = await client
    .from('customers')
    .select('email')
    .eq('phone_number', phoneNumber)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data?.email || null
}
