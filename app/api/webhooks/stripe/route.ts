import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { validateStripeWebhook, createCardOnFileLink } from '@/lib/stripe-client'
import { getSupabaseClient, updateJob, getJobById, updateGHLLead } from '@/lib/supabase'
import { triggerCleanerAssignment } from '@/lib/cleaner-assignment'
import { logSystemEvent } from '@/lib/system-events'
import { convertHCPLeadToJob } from '@/lib/housecall-pro-api'
import { getDefaultTenant, getTenantById } from '@/lib/tenant'
import { sendSMS, SMS_TEMPLATES } from '@/lib/openphone'
import { sendTelegramMessage } from '@/lib/telegram'
import { distributeTip } from '@/lib/tips'
import { geocodeAddress } from '@/lib/google-maps'
import { calculateDistance } from '@/lib/cleaner-assignment'
import { optimizeRoutesIncremental } from '@/lib/route-optimizer'
import { dispatchRoutes } from '@/lib/dispatch'
import { syncNewJobToHCP } from '@/lib/hcp-job-sync'
import { buildWinBrosJobNotes } from '@/lib/winbros-sms-prompt'

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

  // Update job status — mark as booked + scheduled now that deposit is paid
  const updatedJob = await updateJob(jobId, {
    payment_status: 'deposit_paid',
    confirmed_at: new Date().toISOString(),
    booked: true,
    status: 'scheduled' as any,
  })

  if (!updatedJob) {
    console.error(`[Stripe Webhook] Failed to update job ${jobId}`)
    return
  }

  // Get tenant for this job to send SMS notifications
  const jobTenantId = (updatedJob as any).tenant_id
  const tenant = jobTenantId ? await getTenantById(jobTenantId) : await getDefaultTenant()

  // Send payment confirmation SMS to customer
  if (updatedJob.phone_number && tenant) {
    const depositClient = getSupabaseClient()
    const { data: depositCust } = await depositClient
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
      await depositClient.from('messages').insert({
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
      console.log(`[Stripe Webhook] Deposit confirmation SMS sent to ${updatedJob.phone_number}`)
    }

    // Send card-on-file link so customer can save card for final payment
    try {
      const custEmail = await getCustomerEmail(updatedJob.phone_number, tenant.id)
      if (custEmail) {
        const cardResult = await createCardOnFileLink(
          { email: custEmail, phone_number: updatedJob.phone_number } as any,
          jobId,
        )

        if (cardResult.success && cardResult.url) {
          // Short delay between messages
          await new Promise(resolve => setTimeout(resolve, 2000))

          const cardMsg = `Additionally, go ahead and put your card on file so that we can get you set up: ${cardResult.url}`
          const cardSms = await sendSMS(tenant, updatedJob.phone_number, cardMsg)
          if (cardSms.success) {
            await depositClient.from('messages').insert({
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
    const hcpTenant = tenant || await getDefaultTenant()
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

  // Get job and phone number
  let phoneNumber: string | undefined
  let teamId: number | null = null
  if (job_id) {
    const job = await getJobById(job_id)
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
 * - For route-optimization tenants (WinBros): notifies owner via Telegram, job queued for batch routing
 * - For other tenants: triggers individual cleaner assignment cascade
 */
async function handleCardOnFileSaved(session: Stripe.Checkout.Session) {
  const metadata = session.metadata || {}
  const { job_id, phone_number } = metadata

  console.log(`[Stripe Webhook] Card on file saved - job_id: ${job_id}, phone: ${phone_number}, session: ${session.id}`)

  const tenant = await getDefaultTenant()
  if (!tenant) {
    console.error('[Stripe Webhook] No tenant configured, cannot process card-on-file')
    return
  }

  const client = getSupabaseClient()

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
    } else {
      console.error(`[Stripe Webhook] Failed to send card-on-file SMS to ${phone_number}: ${smsResult.error}`)
    }
  }

  // Get job details for logging and assignment
  let job: Awaited<ReturnType<typeof getJobById>> | null = null
  let actualJobId = job_id
  if (job_id && !job_id.startsWith('lead-')) {
    job = await getJobById(job_id)
    if (!job) {
      console.error(`[Stripe Webhook] Job not found for card-on-file: ${job_id}`)
    } else {
      console.log(`[Stripe Webhook] Job found: ${job_id} — service: ${job.service_type}, date: ${job.date}, address: ${job.address}, price: ${job.price}`)
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
        booked: true,
        notes: buildWinBrosJobNotes(bookingData) || null,
      }).select('id').single()

      if (retryJob) {
        actualJobId = retryJob.id
        job = await getJobById(retryJob.id)
        console.log(`[Stripe Webhook] Job created from lead retry: ${retryJob.id}`)

        // Update lead with the real job ID
        await client
          .from('leads')
          .update({ converted_to_job_id: retryJob.id, status: 'booked' })
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

  // WinBros (route optimization): auto-assign job to team, no accept/decline
  // Other tenants: trigger individual cleaner assignment cascade (accept/decline)
  // If deposit was already paid, cleaner assignment was already triggered in handleDepositPayment — skip here
  const useRouteOptimization = tenant.workflow_config?.use_route_optimization === true || tenant.slug === 'winbros'
  let assignmentOutcome = 'no_job'

  if (job && job.payment_status === 'deposit_paid') {
    assignmentOutcome = 'already_assigned_via_deposit'
    console.log(`[Stripe Webhook] Job ${actualJobId} already has deposit_paid status — skipping redundant assignment`)
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

            // Send immediate Telegram to assigned cleaner — WITHOUT address
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

            if (assignedLeadTelegramId) {
              // Notification WITHOUT address — address comes in the full schedule at 5pm CT
              const notifMsg = [
                `<b>New Job Assigned - ${businessName}</b>`,
                ``,
                `Date: ${dateStr}${timeStr ? ` at ${timeStr}` : ''}`,
                `Service: ${serviceStr}`,
                ``,
                `You'll receive your full route with addresses at 5 PM tonight.`,
              ].join('\n')

              try {
                await sendTelegramMessage(tenant, assignedLeadTelegramId, notifMsg, 'HTML')
                console.log(`[Stripe Webhook] Cleaner notification (no address) sent for job ${actualJobId}`)
              } catch (err) {
                console.error(`[Stripe Webhook] Failed to send cleaner notification:`, err)
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
            await updateJob(actualJobId!, { team_id: team.id, cleaner_confirmed: true, status: 'assigned' } as Record<string, unknown>)
            assignmentOutcome = 'fallback_closest_team'
          }
        }
      }

      // Always notify owner about new booking
      if (tenant.owner_telegram_chat_id) {
        const customerName = phone_number || 'Unknown'
        const priceStr = job.price ? `$${Number(job.price).toFixed(2)}` : 'TBD'
        const dateStr = job.date || 'TBD'
        const serviceStr = job.service_type || 'window cleaning'

        const ownerMsg = [
          `<b>New Booking — Card on File</b>`,
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
              : `⚠️ Job could not be auto-assigned — ${assignmentOutcome}.`,
        ].join('\n')

        try {
          await sendTelegramMessage(tenant, tenant.owner_telegram_chat_id, ownerMsg, 'HTML')
        } catch (err) {
          console.error(`[Stripe Webhook] Failed to send owner Telegram for job ${actualJobId}:`, err)
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
  } else if (job_id?.startsWith('lead-') && tenant.owner_telegram_chat_id) {
    // Even if job retry failed, still notify owner that a customer saved their card
    assignmentOutcome = 'lead_only_notified'
    const ownerMsg = [
      `<b>New Booking — Card on File</b>`,
      ``,
      `Customer: ${phone_number || 'Unknown'}`,
      `⚠️ Job creation failed — check the lead in the dashboard.`,
      `Lead ID: ${job_id.replace('lead-', '')}`,
    ].join('\n')

    try {
      await sendTelegramMessage(tenant, tenant.owner_telegram_chat_id, ownerMsg, 'HTML')
      console.log(`[Stripe Webhook] Owner notified about card-on-file with failed job (${job_id})`)
    } catch (err) {
      console.error(`[Stripe Webhook] Failed to send lead-fallback owner Telegram:`, err)
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

  console.log(`[Stripe Webhook] Setup intent succeeded - job_id: ${job_id}, phone: ${phone_number}, purpose: ${purpose} — skipping (checkout.session.completed handles processing)`)
}

/**
 * Helper to look up customer email by phone number and tenant
 */
async function getCustomerEmail(phoneNumber: string, tenantId: string): Promise<string | null> {
  const client = getSupabaseClient()
  const { data } = await client
    .from('customers')
    .select('email')
    .eq('phone_number', phoneNumber)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data?.email || null
}
