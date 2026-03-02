/**
 * Email Lead Processing Cron
 *
 * Polls Gmail inbox (IMAP) for unread emails, processes them through
 * the house cleaning booking AI, and sends threaded replies.
 *
 * Same flow as the SMS bot but adapted for email:
 * - Asks 2-3 questions per email (async channel)
 * - Email address already known (customer emailed us)
 * - Booking completes when date/time is confirmed
 * - Payment links sent via email instead of SMS
 *
 * Only runs for tenants with Gmail credentials configured.
 *
 * Schedule: Every 2 minutes
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { tenantUsesFeature } from '@/lib/tenant'
import { fetchUnreadEmails, markEmailsAsRead } from '@/lib/gmail-imap'
import { sendReplyEmail, sendConfirmationEmail } from '@/lib/gmail-client'
import { generateEmailResponse, loadCustomerContext } from '@/lib/auto-response'
import type { KnownCustomerInfo } from '@/lib/auto-response'
import { logSystemEvent } from '@/lib/system-events'
import type { IncomingEmail } from '@/lib/gmail-imap'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()

  let totalProcessed = 0
  let totalReplied = 0
  const errors: string[] = []

  for (const tenant of tenants) {
    // Only process tenants with Gmail credentials
    const hasCreds = (tenant.gmail_user && tenant.gmail_app_password) ||
                     (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    if (!hasCreds) continue

    // Only process house cleaning tenants (not WinBros window cleaning)
    if (tenantUsesFeature(tenant, 'use_hcp_mirror')) continue

    try {
      const { emails, error: imapError } = await fetchUnreadEmails(tenant)

      if (imapError) {
        console.error(`[Email Cron] IMAP error for tenant ${tenant.slug}:`, imapError)
        errors.push(`${tenant.slug}: ${imapError}`)
        continue
      }

      if (emails.length === 0) continue

      console.log(`[Email Cron] ${tenant.slug}: ${emails.length} unread email(s)`)

      const processedUids: number[] = []

      for (const email of emails) {
        try {
          const result = await processIncomingEmail(client, tenant, email)
          totalProcessed++
          if (result.replied) totalReplied++
          processedUids.push(email.uid)
        } catch (emailErr) {
          console.error(`[Email Cron] Error processing email from ${email.from}:`, emailErr)
          errors.push(`${tenant.slug}/${email.from}: ${emailErr instanceof Error ? emailErr.message : 'unknown'}`)
          // Still mark as read to avoid re-processing broken emails forever
          processedUids.push(email.uid)
        }
      }

      // Mark all processed emails as read in one IMAP session
      if (processedUids.length > 0) {
        await markEmailsAsRead(processedUids, tenant)
      }
    } catch (tenantErr) {
      console.error(`[Email Cron] Tenant ${tenant.slug} error:`, tenantErr)
      errors.push(`${tenant.slug}: ${tenantErr instanceof Error ? tenantErr.message : 'unknown'}`)
    }
  }

  return NextResponse.json({
    success: true,
    processed: totalProcessed,
    replied: totalReplied,
    errors: errors.length > 0 ? errors : undefined,
  })
}

// =====================================================================
// PROCESS A SINGLE INCOMING EMAIL
// =====================================================================

async function processIncomingEmail(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: any,
  email: IncomingEmail
): Promise<{ replied: boolean }> {
  const senderEmail = email.from.toLowerCase()
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name

  // ── Dedup: skip if we already stored this exact Message-ID ──
  if (email.messageId) {
    const { data: existing } = await client
      .from('messages')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('email_message_id', email.messageId)
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.log(`[Email Cron] Skipping already-processed email Message-ID: ${email.messageId}`)
      return { replied: false }
    }
  }

  // ── Find or create customer by email ──
  let { data: customer } = await client
    .from('customers')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('email', senderEmail)
    .maybeSingle()

  if (!customer) {
    // Try to extract name from the email "From" field
    const fromParts = email.fromName.split(/\s+/)
    const firstName = fromParts[0] || null
    const lastName = fromParts.slice(1).join(' ') || null

    const { data: newCustomer } = await client
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        email: senderEmail,
        first_name: firstName,
        last_name: lastName,
      })
      .select('*')
      .single()

    customer = newCustomer
    if (!customer) {
      console.error(`[Email Cron] Failed to create customer for ${senderEmail}`)
      return { replied: false }
    }
    console.log(`[Email Cron] Created new customer #${customer.id} for ${senderEmail}`)
  }

  // ── Find or create lead ──
  // Look for an active email lead (not lost/unresponsive)
  let { data: lead } = await client
    .from('leads')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customer.id)
    .eq('source', 'email')
    .not('status', 'in', '("lost","unresponsive")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // If the existing lead is booked and its job is completed, reset the lead
  // for re-booking. Same customer, same lead, new job.
  if (lead && lead.status === 'booked' && lead.converted_to_job_id) {
    const { data: linkedJob } = await client
      .from('jobs')
      .select('status')
      .eq('id', lead.converted_to_job_id)
      .maybeSingle()

    if (linkedJob?.status === 'completed') {
      console.log(`[Email Cron] Previous booking (job ${lead.converted_to_job_id}) is completed — resetting lead for re-booking`)
      await client.from('leads').update({
        status: 'contacted',
        converted_to_job_id: null,
        followup_stage: 0,
        followup_started_at: new Date().toISOString(),
      }).eq('id', lead.id)
      lead.status = 'contacted'
      lead.converted_to_job_id = null
    }
  }

  if (!lead) {
    const { data: newLead } = await client
      .from('leads')
      .insert({
        tenant_id: tenant.id,
        source_id: `email-${Date.now()}`,
        phone_number: customer.phone_number || `email-${senderEmail}`,
        customer_id: customer.id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: senderEmail,
        source: 'email',
        status: 'new',
        form_data: { original_subject: email.subject },
        followup_stage: 0,
        followup_started_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    lead = newLead
    if (!lead) {
      console.error(`[Email Cron] Failed to create lead for ${senderEmail}`)
      return { replied: false }
    }
    console.log(`[Email Cron] Created new email lead #${lead.id} for ${senderEmail}`)
  }

  // Update last contact
  await client
    .from('leads')
    .update({ last_contact_at: new Date().toISOString() })
    .eq('id', lead.id)

  // ── Determine thread ID ──
  // Use the email's References chain or Message-ID to find existing thread
  let threadId = email.inReplyTo || email.messageId || `thread-${senderEmail}-${Date.now()}`

  // Check if we have existing messages in this thread
  if (email.references.length > 0) {
    const { data: existingThread } = await client
      .from('messages')
      .select('email_thread_id')
      .eq('tenant_id', tenant.id)
      .in('email_message_id', email.references)
      .limit(1)
      .maybeSingle()

    if (existingThread?.email_thread_id) {
      threadId = existingThread.email_thread_id
    }
  }

  // ── Store the inbound email as a message ──
  await client.from('messages').insert({
    tenant_id: tenant.id,
    direction: 'inbound',
    message_type: 'email',
    content: email.textBody || email.subject,
    role: 'client',
    ai_generated: false,
    status: 'received',
    source: 'gmail',
    customer_id: customer.id,
    lead_id: lead.id,
    email_address: senderEmail,
    email_thread_id: threadId,
    email_message_id: email.messageId,
    metadata: {
      subject: email.subject,
      from_name: email.fromName,
      date: email.date.toISOString(),
    },
    timestamp: email.date.toISOString(),
  })

  // ── Skip auto-response for dead leads ──
  if (['lost', 'unresponsive'].includes(lead.status)) {
    console.log(`[Email Cron] Lead ${lead.id} status is '${lead.status}', skipping auto-response`)
    return { replied: false }
  }

  // ── Post-booking / assigned lead: respond with customer context ──
  // (Same pattern as SMS bot — answer questions, handle corrections, don't re-book)
  const isPostBooking = ['booked', 'assigned'].includes(lead.status)

  // ── Load conversation history for this email thread ──
  const { data: historyRows } = await client
    .from('messages')
    .select('role, content')
    .eq('tenant_id', tenant.id)
    .eq('email_address', senderEmail)
    .eq('message_type', 'email')
    .order('timestamp', { ascending: true })
    .limit(30)

  const conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }> = (historyRows || []).map((m: any) => ({
    role: m.role as 'client' | 'assistant',
    content: m.content || '',
  }))

  // ── Build known customer info ──
  const knownInfo: KnownCustomerInfo = {
    firstName: customer.first_name,
    lastName: customer.last_name,
    address: customer.address,
    email: senderEmail,
    phone: customer.phone_number || null,
  }

  // ── Load customer context (active jobs, history) for AI awareness ──
  let customerContext = null
  try {
    customerContext = await loadCustomerContext(
      client,
      tenant.id,
      customer.phone_number || '',
      customer.id
    )
  } catch (err) {
    console.error('[Email Cron] Failed to load customer context:', err)
  }

  // ── Post-booking lead: respond with context, no booking flow ──
  if (isPostBooking) {
    console.log(`[Email Cron] Post-booking response for ${senderEmail} (lead ${lead.id}, status: ${lead.status})`)

    const autoResponse = await generateEmailResponse(
      email.textBody || email.subject,
      tenant,
      conversationHistory,
      knownInfo,
      customerContext,
    )

    if (!autoResponse.shouldSend || !autoResponse.response) {
      return { replied: false }
    }

    // Strip [BOOKING_COMPLETE] tags — post-booking customers shouldn't re-trigger booking
    const cleanedResponse = autoResponse.response.replace(/\[BOOKING_COMPLETE\]/g, '').trim()
    if (!cleanedResponse) return { replied: false }

    // Handle escalation for post-booking customers (reschedule, cancel, complaints)
    if (autoResponse.escalation?.shouldEscalate) {
      if (tenant.owner_email) {
        const { sendCustomEmail } = await import('@/lib/gmail-client')
        await sendCustomEmail({
          to: tenant.owner_email,
          subject: `[Escalation] Post-booking email from ${email.fromName || senderEmail}`,
          body: `A booked customer has been escalated.\n\nCustomer: ${email.fromName || senderEmail}\nEmail: ${senderEmail}\nLead status: ${lead.status}\nReason: ${autoResponse.escalation.reasons.join(', ')}\n\nConversation:\n${conversationHistory.map(m => `${m.role === 'client' ? 'Customer' : 'Bot'}: ${m.content}`).join('\n')}`,
          fromName: businessName,
          tenant,
        })
      }
      await client.from('leads').update({ followup_paused: true }).eq('id', lead.id)
    }

    // Send reply
    const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
    const replyRefs = [...email.references]
    if (email.messageId && !replyRefs.includes(email.messageId)) replyRefs.push(email.messageId)

    const sendResult = await sendReplyEmail({
      to: senderEmail,
      subject,
      body: cleanedResponse,
      fromName: businessName,
      inReplyTo: email.messageId,
      references: replyRefs,
      tenant,
    })

    if (sendResult.success) {
      await client.from('messages').insert({
        tenant_id: tenant.id,
        direction: 'outbound',
        message_type: 'email',
        content: cleanedResponse,
        role: 'assistant',
        ai_generated: true,
        status: 'sent',
        source: 'gmail',
        customer_id: customer.id,
        lead_id: lead.id,
        email_address: senderEmail,
        email_thread_id: threadId,
        email_message_id: sendResult.messageId || null,
        metadata: { subject, reason: 'post_booking_response' },
        timestamp: new Date().toISOString(),
      })
      console.log(`[Email Cron] Post-booking reply sent to ${senderEmail}`)
    }

    return { replied: sendResult.success }
  }

  // ── DEDUP GUARD: Check if payment links already sent for this email ──
  const { data: alreadySentPayment } = await client
    .from('messages')
    .select('id')
    .eq('email_address', senderEmail)
    .eq('tenant_id', tenant.id)
    .in('source', ['card_on_file', 'deposit', 'invoice', 'estimate_booked'])
    .limit(1)
    .maybeSingle()

  if (alreadySentPayment) {
    console.log(`[Email Cron] Payment already sent for ${senderEmail}, skipping`)
    return { replied: false }
  }

  // ── Generate AI response (active booking flow) ──
  const autoResponse = await generateEmailResponse(
    email.textBody || email.subject,
    tenant,
    conversationHistory,
    knownInfo,
    customerContext,
  )

  if (!autoResponse.shouldSend || !autoResponse.response) {
    console.log(`[Email Cron] AI declined to respond: ${autoResponse.reason}`)
    return { replied: false }
  }

  // ── Handle escalation ──
  if (autoResponse.escalation?.shouldEscalate) {
    console.log(`[Email Cron] Escalation detected for ${senderEmail}: ${autoResponse.escalation.reasons.join(', ')}`)

    // Notify owner
    if (tenant.owner_email) {
      const { sendCustomEmail } = await import('@/lib/gmail-client')
      await sendCustomEmail({
        to: tenant.owner_email,
        subject: `[Escalation] Email lead from ${email.fromName || senderEmail}`,
        body: `An email lead has been escalated.\n\nCustomer: ${email.fromName || senderEmail}\nEmail: ${senderEmail}\nReason: ${autoResponse.escalation.reasons.join(', ')}\n\nConversation:\n${conversationHistory.map(m => `${m.role === 'client' ? 'Customer' : 'Bot'}: ${m.content}`).join('\n')}`,
        fromName: businessName,
        tenant,
      })
    }

    // Update lead status
    await client.from('leads').update({
      status: 'escalated',
      followup_paused: true,
    }).eq('id', lead.id)
  }

  // ── Handle booking completion ──
  if (autoResponse.bookingComplete) {
    console.log(`[Email Cron] Booking complete for ${senderEmail}, processing...`)

    try {
      await handleEmailBookingCompletion(client, tenant, customer, lead, senderEmail, conversationHistory, threadId, email)
    } catch (bookingErr) {
      console.error(`[Email Cron] Booking completion error for ${senderEmail}:`, bookingErr)
    }

    return { replied: true }
  }

  // ── Send reply email ──
  const subject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
  const replyRefs = [...email.references]
  if (email.messageId && !replyRefs.includes(email.messageId)) {
    replyRefs.push(email.messageId)
  }

  const sendResult = await sendReplyEmail({
    to: senderEmail,
    subject,
    body: autoResponse.response,
    fromName: businessName,
    inReplyTo: email.messageId,
    references: replyRefs,
    tenant,
  })

  if (!sendResult.success) {
    console.error(`[Email Cron] Failed to send reply to ${senderEmail}: ${sendResult.error}`)
    return { replied: false }
  }

  // ── Store the outbound reply as a message ──
  await client.from('messages').insert({
    tenant_id: tenant.id,
    direction: 'outbound',
    message_type: 'email',
    content: autoResponse.response,
    role: 'assistant',
    ai_generated: true,
    status: 'sent',
    source: 'gmail',
    customer_id: customer.id,
    lead_id: lead.id,
    email_address: senderEmail,
    email_thread_id: threadId,
    email_message_id: sendResult.messageId || null,
    metadata: {
      subject,
      reason: autoResponse.reason,
    },
    timestamp: new Date().toISOString(),
  })

  // Update lead status to contacted
  if (lead.status === 'new') {
    await client.from('leads').update({ status: 'contacted' }).eq('id', lead.id)
  }

  console.log(`[Email Cron] Replied to ${senderEmail} (lead ${lead.id})`)
  return { replied: true }
}

// =====================================================================
// BOOKING COMPLETION — Same flow as SMS but via email
// =====================================================================

async function handleEmailBookingCompletion(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: any,
  customer: any,
  lead: any,
  senderEmail: string,
  conversationHistory: Array<{ role: 'client' | 'assistant'; content: string }>,
  threadId: string,
  originalEmail: IncomingEmail,
) {
  const businessName = tenant.business_name_short || tenant.business_name || tenant.name

  // Extract booking data from conversation
  const { extractHouseCleaningBookingData } = await import('@/lib/house-cleaning-sms-prompt')
  const bookingData = await extractHouseCleaningBookingData(conversationHistory)

  console.log(`[Email Cron] Extracted booking: service=${bookingData.serviceType}, beds=${bookingData.bedrooms}, baths=${bookingData.bathrooms}, date=${bookingData.preferredDate}`)

  const finalEmail = bookingData.email || senderEmail

  // Extract phone number from conversation (customer may have provided it via email)
  let phoneNumber = customer.phone_number || null
  if (!phoneNumber) {
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
    for (const msg of [...conversationHistory].reverse()) {
      if (msg.role === 'client') {
        const phoneMatch = msg.content.match(phoneRegex)
        if (phoneMatch) {
          // Normalize to digits only
          const digits = phoneMatch[0].replace(/\D/g, '')
          phoneNumber = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phoneMatch[0]
          console.log(`[Email Cron] Phone extracted from conversation: ${phoneNumber}`)
          break
        }
      }
    }
  }

  // Update customer with extracted data
  await client.from('customers').update({
    email: finalEmail,
    first_name: bookingData.firstName || customer.first_name,
    last_name: bookingData.lastName || customer.last_name,
    address: bookingData.address || customer.address,
    phone_number: phoneNumber || customer.phone_number || null,
  }).eq('id', customer.id)

  // Sync to HouseCall Pro if enabled
  if (tenant) {
    const { syncCustomerToHCP } = await import('@/lib/hcp-job-sync')
    await syncCustomerToHCP({
      tenantId: tenant.id,
      customerId: customer.id,
      phone: phoneNumber || customer.phone_number || '',
      firstName: bookingData.firstName || customer.first_name,
      lastName: bookingData.lastName || customer.last_name,
      email: finalEmail,
      address: bookingData.address || customer.address,
    })
  }

  // ── Calculate price ──
  let servicePrice: number | null = null
  if (bookingData.bedrooms && bookingData.bathrooms && tenant?.id) {
    try {
      const { getPricingRow } = await import('@/lib/pricing-db')
      const svcRaw = (bookingData.serviceType || 'standard_cleaning').toLowerCase().replace(/[_ ]cleaning/, '')
      const pricingTier = (svcRaw === 'deep' || svcRaw === 'move') ? svcRaw : 'standard'
      const pricingRow = await getPricingRow(
        pricingTier as 'standard' | 'deep' | 'move',
        bookingData.bedrooms,
        bookingData.bathrooms,
        bookingData.squareFootage || null,
        tenant.id
      )
      if (pricingRow?.price) {
        servicePrice = pricingRow.price
        console.log(`[Email Cron] Price: $${servicePrice} (${pricingTier} ${bookingData.bedrooms}bd/${bookingData.bathrooms}ba)`)
      }
    } catch (pricingErr) {
      console.error('[Email Cron] Pricing lookup failed:', pricingErr)
    }
  }

  // ── Build job notes ──
  const { mergeOverridesIntoNotes } = await import('@/lib/pricing-config')
  let jobNotes = [
    bookingData.hasPets ? 'Has pets' : null,
    bookingData.frequency ? `Frequency: ${bookingData.frequency}` : null,
    'Booked via email',
  ].filter(Boolean).join(' | ')

  if (bookingData.bedrooms || bookingData.bathrooms || bookingData.squareFootage) {
    jobNotes = mergeOverridesIntoNotes(jobNotes || null, {
      bedrooms: bookingData.bedrooms || undefined,
      bathrooms: bookingData.bathrooms || undefined,
      squareFootage: bookingData.squareFootage || undefined,
    })
  }

  // ── Fallback date ──
  let jobDate = bookingData.preferredDate || null
  if (!jobDate) {
    const now = new Date()
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1)
    }
    jobDate = candidate.toISOString().split('T')[0]
  }

  const defaultServiceType = 'Standard cleaning'

  // ── Create job ──
  const { data: newJob, error: jobError } = await client.from('jobs').insert({
    tenant_id: tenant.id,
    customer_id: customer.id,
    phone_number: phoneNumber || customer.phone_number || null,
    service_type: bookingData.serviceType?.replace(/_/g, ' ') || defaultServiceType,
    address: bookingData.address || customer.address || null,
    price: servicePrice || null,
    date: jobDate,
    scheduled_at: bookingData.preferredTime || '09:00',
    status: 'scheduled',
    booked: true,
    notes: jobNotes || null,
    job_type: 'cleaning',
  }).select('id').single()

  if (jobError || !newJob?.id) {
    console.error(`[Email Cron] Job creation failed for ${senderEmail}:`, jobError)
    return
  }
  console.log(`[Email Cron] Job created: #${newJob.id}`)

  // Sync job to HouseCall Pro
  const { syncNewJobToHCP } = await import('@/lib/hcp-job-sync')
  await syncNewJobToHCP({
    tenant,
    jobId: newJob.id,
    phone: customer.phone_number,
    firstName: bookingData.firstName || customer.first_name,
    lastName: bookingData.lastName || customer.last_name,
    email: finalEmail,
    address: bookingData.address || customer.address,
    serviceType: bookingData.serviceType || null,
    scheduledDate: jobDate,
    scheduledTime: bookingData.preferredTime || '09:00',
    price: servicePrice,
    notes: 'Booked via email',
    source: 'email',
    isEstimate: false,
  })

  // ── Update lead to booked ──
  await client.from('leads').update({
    status: 'booked',
    converted_to_job_id: newJob.id,
    form_data: {
      ...(typeof lead.form_data === 'object' && lead.form_data ? lead.form_data : {}),
      booking_data: bookingData,
    },
  }).eq('id', lead.id)

  // ── Send deposit payment flow via email ──
  // Calculate price if not yet determined
  if (!servicePrice) {
    try {
      const { calculateJobEstimateAsync } = await import('@/lib/stripe-client')
      const jobForEstimate = {
        id: newJob.id,
        service_type: bookingData.serviceType?.replace(/_/g, ' ') || defaultServiceType,
        notes: jobNotes,
      }
      const estimate = await calculateJobEstimateAsync(jobForEstimate, undefined, tenant.id)
      servicePrice = estimate.totalPrice
      console.log(`[Email Cron] Calculated price: $${servicePrice}`)
    } catch (err) {
      console.error('[Email Cron] Price calculation failed:', err)
    }
  }

  // Create Stripe deposit link
  let depositUrl = ''
  if (servicePrice && tenant.stripe_secret_key) {
    try {
      const { createDepositPaymentLink } = await import('@/lib/stripe-client')
      const depositResult = await createDepositPaymentLink(
        { ...customer, email: finalEmail } as any,
        {
          ...{ id: newJob.id, price: servicePrice, phone_number: customer.phone_number },
          service_type: bookingData.serviceType?.replace(/_/g, ' ') || defaultServiceType,
        } as any,
        { lead_id: String(lead.id) },
        tenant.id,
        tenant.stripe_secret_key
      )

      if (depositResult?.url) {
        depositUrl = depositResult.url
        console.log(`[Email Cron] Stripe deposit link created: ${depositUrl}`)

        // Update job with payment info
        const { updateJob } = await import('@/lib/supabase')
        await updateJob(newJob.id, {
          invoice_sent: true,
          status: 'quoted' as any,
          booked: false,
        })
      }
    } catch (stripeErr) {
      console.error('[Email Cron] Stripe deposit creation failed:', stripeErr)
    }
  }

  // ── Send confirmation email with payment link ──
  if (depositUrl) {
    await sendConfirmationEmail({
      customer: { ...customer, email: finalEmail },
      job: {
        date: jobDate,
        scheduled_at: bookingData.preferredTime || '09:00',
        service_type: bookingData.serviceType?.replace(/_/g, ' ') || defaultServiceType,
        address: bookingData.address || customer.address || null,
      } as any,
      stripeDepositUrl: depositUrl,
      tenant,
    })

    // Store confirmation as a message for conversation history
    await client.from('messages').insert({
      tenant_id: tenant.id,
      direction: 'outbound',
      message_type: 'email',
      content: `Booking confirmed! Sent deposit link and confirmation details to ${finalEmail}`,
      role: 'assistant',
      ai_generated: false,
      status: 'sent',
      source: 'deposit',
      customer_id: customer.id,
      lead_id: lead.id,
      email_address: senderEmail,
      email_thread_id: threadId,
      metadata: {
        deposit_url: depositUrl,
        job_id: newJob.id,
        service_price: servicePrice,
      },
      timestamp: new Date().toISOString(),
    })
  }

  await logSystemEvent({
    tenant_id: tenant.id,
    source: 'email_cron',
    event_type: 'EMAIL_BOOKING_COMPLETED',
    message: `Email booking completed for ${senderEmail} — job ${newJob.id}`,
    metadata: {
      lead_id: lead.id,
      job_id: newJob.id,
      booking_data: bookingData,
      email: finalEmail,
      deposit_url: depositUrl || null,
      service_price: servicePrice,
    },
  })
}
