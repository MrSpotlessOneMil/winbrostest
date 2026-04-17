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
import { sendReplyEmail } from '@/lib/gmail-client'
import { generateEmailResponse, loadCustomerContext } from '@/lib/auto-response'
import type { KnownCustomerInfo } from '@/lib/auto-response'
import { logSystemEvent } from '@/lib/system-events'
import type { IncomingEmail } from '@/lib/gmail-imap'

export const maxDuration = 60

/**
 * Build the reply subject line. NEVER changes the base subject —
 * Gmail threads by subject match, so altering it breaks threading.
 * Just prepends "Re:" if not already present.
 */
function getReplySubject(originalSubject: string): string {
  const trimmed = (originalSubject || '').trim()

  // Already has a Re: prefix — use as-is
  if (trimmed.startsWith('Re:')) return trimmed

  // Prepend Re: to whatever the original subject was (even if empty)
  return trimmed ? `Re: ${trimmed}` : 'Re:'
}

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
    // Only process tenants with Gmail credentials (app password OR service account)
    const hasCreds = (tenant.gmail_user && tenant.gmail_app_password) ||
                     (tenant.gmail_service_account_json && tenant.gmail_impersonated_user) ||
                     (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
    if (!hasCreds) continue

    // Email bot now works for all tenant types (house cleaning + window cleaning)

    try {
      const { emails, error: imapError } = await fetchUnreadEmails(tenant)

      if (imapError) {
        console.error(`[Email Cron] IMAP error for tenant ${tenant.slug}:`, imapError)
        errors.push(`${tenant.slug}: ${imapError}`)
        continue
      }

      if (emails.length === 0) continue

      console.log(`[Email Cron] ${tenant.slug}: ${emails.length} email(s)`)

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

  // ── Dedup: skip if we already stored AND replied to this exact Message-ID ──
  // If inbound was stored but no outbound reply exists, retry the reply.
  let isRetry = false
  if (email.messageId) {
    const { data: existing } = await client
      .from('messages')
      .select('id, created_at')
      .eq('tenant_id', tenant.id)
      .eq('email_message_id', email.messageId)
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Check if we actually replied to this sender after this inbound was stored
      const { data: hasReply } = await client
        .from('messages')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('email_address', senderEmail)
        .eq('direction', 'outbound')
        .eq('message_type', 'email')
        .gt('created_at', existing.created_at)
        .limit(1)
        .maybeSingle()

      if (hasReply) {
        console.log(`[Email Cron] Skipping already-replied email Message-ID: ${email.messageId}`)
        return { replied: false }
      }
      // Inbound stored but no reply — fall through to retry reply generation
      isRetry = true
      console.log(`[Email Cron] Retrying reply for stored-but-unreplied email from ${senderEmail}`)
    }
  }

  // ── Reset watermark: skip emails older than the last reset for this sender ──
  // When the admin resets a test customer, old emails in Gmail shouldn't be re-ingested
  const { data: resetEvent } = await client
    .from('system_events')
    .select('created_at')
    .eq('event_type', 'SYSTEM_RESET')
    .contains('metadata', { reset_email: senderEmail })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (resetEvent && email.date < new Date(resetEvent.created_at)) {
    console.log(`[Email Cron] Skipping pre-reset email from ${senderEmail} (email: ${email.date.toISOString()}, reset: ${resetEvent.created_at})`)
    return { replied: false }
  }

  // ── Find or create customer by email ──
  // Check by email first, then by phone_number placeholder (unique constraint key)
  let { data: customer } = await client
    .from('customers')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('email', senderEmail)
    .maybeSingle()

  if (!customer) {
    // Also check by phone_number placeholder — handles cases where email column
    // was corrupted but the unique constraint record still exists
    const { data: byPhone } = await client
      .from('customers')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('phone_number', `email:${senderEmail}`)
      .maybeSingle()

    if (byPhone) {
      // Fix the email column and use this customer
      await client.from('customers').update({ email: senderEmail }).eq('id', byPhone.id)
      byPhone.email = senderEmail
      customer = byPhone
      console.log(`[Email Cron] Found existing customer #${byPhone.id} by phone placeholder, fixed email`)
    }
  }

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
        phone_number: `email:${senderEmail}`,  // placeholder until phone collected during booking
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

  // ── Store the inbound email as a message (skip on retry — already stored) ──
  if (!isRetry) {
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
  }

  // ── Skip auto-response for dead leads ──
  if (['lost', 'unresponsive'].includes(lead.status)) {
    console.log(`[Email Cron] Lead ${lead.id} status is '${lead.status}', skipping auto-response`)
    return { replied: false }
  }

  // ── Post-booking / assigned / quoted lead: respond with customer context ──
  // (Same pattern as SMS bot — answer questions, handle corrections, don't re-book)
  // 'qualified' = quote link sent, customer may ask questions before paying
  const isPostBooking = ['booked', 'assigned', 'qualified'].includes(lead.status)

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

    // Send reply — keep original subject with Re: prefix for threading
    const subject = getReplySubject(email.subject)
    const replyRefs = [...email.references]
    if (email.messageId && !replyRefs.includes(email.messageId)) replyRefs.push(email.messageId)

    const sendResult = await sendReplyEmail({
      to: senderEmail,
      subject,
      body: cleanedResponse,
      fromName: businessName,
      inReplyTo: email.messageId,
      references: replyRefs,
      threadId: email.gmailThreadId,
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

  // ── Send reply email — keep original subject with Re: prefix for threading ──
  const subject = getReplySubject(email.subject)
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
    threadId: email.gmailThreadId,
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
  const isWinBros = tenantUsesFeature(tenant, 'use_hcp_mirror')

  // For email leads, the customer's email is always senderEmail.
  const finalEmail = senderEmail

  // ── Extract booking data (different extractor per tenant type) ──
  let firstName: string | null = null
  let lastName: string | null = null
  let address: string | null = null
  let serviceType: string | null = null
  let preferredDate: string | null = null
  let preferredTime: string | null = null
  let servicePrice: number | null = null
  let jobNotes = 'Booked via email'
  let bookingData: any = {}

  if (isWinBros) {
    const { extractBookingData } = await import('@/lib/winbros-sms-prompt')
    const wb = await extractBookingData(conversationHistory)
    bookingData = wb
    firstName = wb.firstName
    lastName = wb.lastName
    address = wb.address
    serviceType = wb.serviceType?.replace(/_/g, ' ') || 'Window cleaning'
    preferredDate = wb.preferredDate
    preferredTime = wb.preferredTime || null

    // WinBros: use pricebook for pricing (never trust AI-extracted price)
    try {
      const { lookupPrice } = await import('@/lib/pricebook')
      const { getWindowTiersFromDB, getFlatServicesFromDB } = await import('@/lib/pricebook-db')
      const [emWTiers, emFSvcs] = await Promise.all([getWindowTiersFromDB(tenant.id), getFlatServicesFromDB(tenant.id)])
      const priceLookup = lookupPrice({
        serviceType: wb.serviceType || null,
        squareFootage: wb.squareFootage || null,
        scope: wb.scope || null,
        pressureWashingSurfaces: wb.pressureWashingSurfaces || null,
        propertyType: wb.propertyType || null,
      }, { windowTiers: emWTiers, flatServices: emFSvcs })
      if (priceLookup) {
        servicePrice = priceLookup.price
        console.log(`[Email Cron] Pricebook: ${priceLookup.serviceName} = $${servicePrice}`)
      }
    } catch (pbErr) {
      console.error('[Email Cron] Pricebook lookup error:', pbErr)
    }

    const noteParts = [
      wb.scope ? `Scope: ${wb.scope}` : null,
      wb.squareFootage ? `${wb.squareFootage} sqft` : null,
      wb.buildingType ? `Building: ${wb.buildingType}` : null,
      wb.referralSource ? `Referral: ${wb.referralSource}` : null,
      'Booked via email',
    ].filter(Boolean)
    jobNotes = noteParts.join(' | ')

    console.log(`[Email Cron] WinBros extracted: service=${wb.serviceType}, sqft=${wb.squareFootage}, scope=${wb.scope}, date=${wb.preferredDate}`)
  } else {
    const { extractHouseCleaningBookingData } = await import('@/lib/house-cleaning-sms-prompt')
    const hc = await extractHouseCleaningBookingData(conversationHistory)
    bookingData = hc
    firstName = hc.firstName
    lastName = hc.lastName
    address = hc.address
    serviceType = hc.serviceType?.replace(/_/g, ' ') || 'Standard cleaning'
    preferredDate = hc.preferredDate
    preferredTime = hc.preferredTime || null

    // House cleaning: use pricing_tiers DB
    if (hc.bedrooms && hc.bathrooms && tenant?.id) {
      try {
        const { getPricingRow } = await import('@/lib/pricing-db')
        const svcRaw = (hc.serviceType || 'standard_cleaning').toLowerCase().replace(/[_ ]cleaning/, '')
        const pricingTier = (svcRaw === 'deep' || svcRaw === 'move') ? svcRaw : 'standard'
        const pricingRow = await getPricingRow(
          pricingTier as 'standard' | 'deep' | 'move',
          hc.bedrooms,
          hc.bathrooms,
          hc.squareFootage || null,
          tenant.id
        )
        if (pricingRow?.price) {
          servicePrice = pricingRow.price
          console.log(`[Email Cron] Price: $${servicePrice} (${pricingTier} ${hc.bedrooms}bd/${hc.bathrooms}ba)`)
        }
      } catch (pricingErr) {
        console.error('[Email Cron] Pricing lookup failed:', pricingErr)
      }
    }

    const { mergeOverridesIntoNotes } = await import('@/lib/pricing-config')
    const noteParts = [
      hc.hasPets ? 'Has pets' : null,
      hc.frequency ? `Frequency: ${hc.frequency}` : null,
      'Booked via email',
    ].filter(Boolean)
    jobNotes = noteParts.join(' | ')

    if (hc.bedrooms || hc.bathrooms || hc.squareFootage) {
      jobNotes = mergeOverridesIntoNotes(jobNotes || null, {
        bedrooms: hc.bedrooms || undefined,
        bathrooms: hc.bathrooms || undefined,
        squareFootage: hc.squareFootage || undefined,
      })
    }

    console.log(`[Email Cron] Extracted booking: service=${hc.serviceType}, beds=${hc.bedrooms}, baths=${hc.bathrooms}, date=${hc.preferredDate}`)
  }

  // ── Extract phone number from conversation ──
  let phoneNumber = customer.phone_number || null
  if (!phoneNumber || phoneNumber.startsWith('email:')) {
    const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
    for (const msg of [...conversationHistory].reverse()) {
      if (msg.role === 'client') {
        const phoneMatch = msg.content.match(phoneRegex)
        if (phoneMatch) {
          const digits = phoneMatch[0].replace(/\D/g, '')
          phoneNumber = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : phoneMatch[0]
          console.log(`[Email Cron] Phone extracted from conversation: ${phoneNumber}`)
          break
        }
      }
    }
  }

  // ── Update customer with extracted data ──
  await client.from('customers').update({
    email: finalEmail,
    first_name: firstName || customer.first_name,
    last_name: lastName || customer.last_name,
    address: address || customer.address,
    phone_number: phoneNumber || customer.phone_number || null,
  }).eq('id', customer.id)

  // Sync to HouseCall Pro if enabled
  if (tenant) {
    const { syncCustomerToHCP } = await import('@/lib/hcp-job-sync')
    await syncCustomerToHCP({
      tenantId: tenant.id,
      customerId: customer.id,
      phone: phoneNumber || customer.phone_number || '',
      firstName: firstName || customer.first_name,
      lastName: lastName || customer.last_name,
      email: finalEmail,
      address: address || customer.address,
    })
  }

  // ── Fallback date ──
  let jobDate = preferredDate || null
  if (!jobDate) {
    const now = new Date()
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1)
    }
    jobDate = candidate.toISOString().split('T')[0]
  }

  // ── Create job ──
  const { data: newJob, error: jobError } = await client.from('jobs').insert({
    tenant_id: tenant.id,
    customer_id: customer.id,
    phone_number: phoneNumber || customer.phone_number || null,
    service_type: serviceType || 'Standard cleaning',
    address: address || customer.address || null,
    price: servicePrice || null,
    date: jobDate,
    scheduled_at: preferredTime || '09:00',
    status: 'quoted',
    booked: false,
    notes: jobNotes || null,
    job_type: isWinBros ? 'estimate' : 'cleaning',
  }).select('id').single()

  if (jobError || !newJob?.id) {
    console.error(`[Email Cron] Job creation failed for ${senderEmail}:`, jobError)
    return
  }

  if (isWinBros) {
    console.log(`[Email Cron] WinBros estimate job created: #${newJob.id}`)
    // Sync job to HouseCall Pro
    const { syncNewJobToHCP } = await import('@/lib/hcp-job-sync')
    await syncNewJobToHCP({
      tenant,
      jobId: newJob.id,
      phone: customer.phone_number,
      firstName: firstName || customer.first_name,
      lastName: lastName || customer.last_name,
      email: finalEmail,
      address: address || customer.address,
      serviceType: serviceType || null,
      scheduledDate: jobDate,
      scheduledTime: preferredTime || '09:00',
      price: servicePrice,
      notes: 'Estimate Visit | Booked via email',
      source: 'email',
      isEstimate: true,
    })
  } else {
    // House cleaning: tag customer as quoted (badge in dashboard)
    await client.from('customers').update({ lifecycle_stage_override: 'quoted_not_booked' }).eq('id', customer.id).is('lifecycle_stage_override', null)
    console.log(`[Email Cron] House cleaning — skipping job, quote-only for ${senderEmail}`)
  }

  // ── Update lead to qualified (booked requires payment + cleaner assigned) ──
  await client.from('leads').update({
    status: 'qualified',
    converted_to_job_id: newJob.id,
    form_data: {
      ...(typeof lead.form_data === 'object' && lead.form_data ? lead.form_data : {}),
      booking_data: bookingData,
    },
  }).eq('id', lead.id)

  // ── Build threading headers so confirmation lands in same email thread ──
  const replyRefs = [...originalEmail.references]
  if (originalEmail.messageId && !replyRefs.includes(originalEmail.messageId)) {
    replyRefs.push(originalEmail.messageId)
  }
  const confirmSubject = getReplySubject(originalEmail.subject)

  // ── Payment flow: WinBros estimates get simple confirmation, house cleaning gets Wave invoice + deposit ──
  let paymentUrl = ''

  if (isWinBros) {
    // WinBros: estimates are FREE in-home visits — no payment link needed.
    // Send a simple confirmation reply in the same thread.
    const sdrName = tenant.sdr_persona || 'Mary'
    const jobDate_ = jobDate ? new Date(jobDate + 'T12:00:00') : null
    const dateDisplay = jobDate_
      ? jobDate_.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'a date we\'ll confirm shortly'
    // Convert 24h time (e.g. "08:00") to 12h display (e.g. "8:00 AM")
    let timeDisplay = '9:00 AM'
    if (preferredTime) {
      const [h, m] = preferredTime.split(':').map(Number)
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      timeDisplay = `${h12}:${(m || 0).toString().padStart(2, '0')} ${ampm}`
    }
    const addrDisplay = address || customer.address || 'your home'

    const confirmBody = [
      `Hi ${firstName || customer.first_name || 'there'},`,
      '',
      `You're all set! We'll have one of our team members come out to ${addrDisplay} on ${dateDisplay} at ${timeDisplay} for a free estimate. The visit usually takes about 15-20 minutes, and they'll walk through everything with you and give you exact pricing right on the spot — no obligation at all.`,
      '',
      `We'll send a reminder before the appointment. If anything changes or you have any questions in the meantime, just reply to this email.`,
      '',
      `Looking forward to meeting you!`,
      '',
      sdrName,
    ].join('\n')

    const sendResult = await sendReplyEmail({
      to: senderEmail,
      subject: confirmSubject,
      body: confirmBody,
      fromName: businessName,
      inReplyTo: originalEmail.messageId,
      references: replyRefs,
      threadId: originalEmail.gmailThreadId,
      tenant,
    })

    if (sendResult.success) {
      await client.from('messages').insert({
        tenant_id: tenant.id,
        direction: 'outbound',
        message_type: 'email',
        content: confirmBody,
        role: 'assistant',
        ai_generated: false,
        status: 'sent',
        source: 'estimate_booked',
        customer_id: customer.id,
        lead_id: lead.id,
        email_address: senderEmail,
        email_thread_id: threadId,
        email_message_id: sendResult.messageId || null,
        metadata: {
          subject: confirmSubject,
          job_id: newJob?.id,
        },
        timestamp: new Date().toISOString(),
      })
      console.log(`[Email Cron] WinBros estimate confirmation sent to ${senderEmail}`)
    } else {
      console.error(`[Email Cron] Failed to send estimate confirmation to ${senderEmail}: ${sendResult.error}`)
    }
  } else {
    // House cleaning: Create a quote and send the customer a link (same as SMS flow)
    const svcType = (serviceType || '').toLowerCase()
    const quoteCategory = svcType.includes('move') ? 'move_in_out' : 'standard'

    const { data: newQuote, error: quoteError } = await client
      .from('quotes')
      .insert({
        tenant_id: tenant.id,
        customer_id: customer.id,
        customer_name: [firstName, lastName].filter(Boolean).join(' ') || customer.first_name || null,
        customer_phone: phoneNumber || customer.phone_number || null,
        customer_email: finalEmail,
        customer_address: address || customer.address || null,
        bedrooms: bookingData.bedrooms || null,
        bathrooms: bookingData.bathrooms || null,
        square_footage: bookingData.squareFootage || null,
        service_category: quoteCategory,
        service_date: jobDate || null,
        service_time: preferredTime || null,
        notes: [
          bookingData.frequency ? `Frequency: ${bookingData.frequency}` : null,
          bookingData.hasPets ? 'Has pets' : null,
          jobDate ? `Preferred date: ${jobDate}` : null,
          preferredTime ? `Preferred time: ${preferredTime}` : null,
        ].filter(Boolean).join(' | ') || null,
      })
      .select('id, token')
      .single()

    if (quoteError || !newQuote) {
      console.error(`[Email Cron] Quote creation failed for ${senderEmail}:`, quoteError)
    } else {
      const { getClientConfig } = await import('@/lib/client-config')
      const appDomain = getClientConfig().domain.replace(/\/+$/, '')
      const quoteUrl = `${appDomain}/quote/${newQuote.token}`
      paymentUrl = quoteUrl

      console.log(`[Email Cron] Quote created: #${newQuote.id}, URL: ${quoteUrl}`)

      // Send quote link email in the same thread
      const sdrName = tenant.sdr_persona || 'Mary'
      const customerName = firstName || customer.first_name || 'there'
      const quoteBody = `Hi ${customerName}!\n\nYour estimated cleaning price for a ${bookingData.bedrooms || '?'} bed / ${bookingData.bathrooms || '?'} bath home is ready. Review your quote and book here: ${quoteUrl}\n\nIf you have any questions, just reply to this email!\n\n${sdrName}`

      const sendResult = await sendReplyEmail({
        to: senderEmail,
        subject: confirmSubject,
        body: quoteBody,
        fromName: businessName,
        inReplyTo: originalEmail.messageId,
        references: replyRefs,
        threadId: originalEmail.gmailThreadId,
        tenant,
      })

      if (sendResult.success) {
        await client.from('messages').insert({
          tenant_id: tenant.id,
          direction: 'outbound',
          message_type: 'email',
          content: quoteBody,
          role: 'assistant',
          ai_generated: false,
          status: 'sent',
          source: 'estimate_booked',
          customer_id: customer.id,
          lead_id: lead.id,
          email_address: senderEmail,
          email_thread_id: threadId,
          email_message_id: sendResult.messageId || null,
          metadata: {
            quote_id: newQuote.id,
            quote_token: newQuote.token,
            quote_url: quoteUrl,
            job_id: newJob?.id,
          },
          timestamp: new Date().toISOString(),
        })
        console.log(`[Email Cron] Quote link sent to ${senderEmail} — quote ${newQuote.id}`)
      } else {
        console.error(`[Email Cron] Failed to send quote email to ${senderEmail}: ${sendResult.error}`)
      }

      // Schedule follow-up wiring (same as SMS flow)
      try {
        const { scheduleTask, scheduleRetargetingSequence } = await import('@/lib/scheduler')
        await scheduleTask({
          tenantId: tenant.id,
          taskType: 'quote_followup_urgent',
          taskKey: `quote-${newQuote.id}-urgent`,
          scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000),
          payload: {
            quoteId: newQuote.id,
            customerId: customer.id,
            customerPhone: phoneNumber || customer.phone_number || '',
            customerName: customerName,
            tenantId: tenant.id,
          },
        })
        await scheduleRetargetingSequence(
          tenant.id,
          customer.id,
          phoneNumber || customer.phone_number || '',
          customerName,
          'quoted_not_booked',
        )
        await client.from('quotes').update({ followup_enrolled_at: new Date().toISOString() }).eq('id', newQuote.id)
        console.log(`[Email Cron] Quote follow-up wired: 2hr nudge + retargeting for quote ${newQuote.id}`)
      } catch (followupErr) {
        console.error('[Email Cron] Quote follow-up wiring failed:', followupErr)
      }
    }
  }

  await logSystemEvent({
    tenant_id: tenant.id,
    source: 'email_cron',
    event_type: 'EMAIL_BOOKING_COMPLETED',
    message: `Email booking completed for ${senderEmail}${newJob ? ` — job ${newJob.id}` : ' — quote only'}`,
    metadata: {
      lead_id: lead.id,
      job_id: newJob?.id,
      booking_data: bookingData,
      email: finalEmail,
      deposit_url: paymentUrl || null,
      service_price: servicePrice,
    },
  })
}
