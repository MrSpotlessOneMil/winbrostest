import { NextRequest, NextResponse } from "next/server"
import { extractMessageFromOpenPhonePayload, normalizePhoneNumber, validateOpenPhoneWebhook, sendSMS } from "@/lib/openphone"
import { getSupabaseClient } from "@/lib/supabase"
import { analyzeBookingIntent, isObviouslyNotBooking } from "@/lib/ai-intent"
import { generateAutoResponse, type KnownCustomerInfo } from "@/lib/auto-response"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant, getTenantByPhoneNumber, getTenantByOpenPhoneId, isSmsAutoResponseEnabled } from "@/lib/tenant"
import { parseFormData } from "@/lib/utils"

export async function POST(request: NextRequest) {
  const signature =
    request.headers.get("x-openphone-signature") ||
    request.headers.get("X-OpenPhone-Signature")
  const timestamp = request.headers.get("x-openphone-timestamp")

  const rawBody = await request.text()
  // Pass null for tenant - uses global webhook secret from env
  const ok = await validateOpenPhoneWebhook(null, rawBody, signature, timestamp)
  if (!ok) {
    return NextResponse.json({ success: false, error: "Invalid OpenPhone signature" }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const extracted = extractMessageFromOpenPhonePayload(payload)
  if (!extracted) {
    return NextResponse.json({ success: true, ignored: true, reason: "could not extract message" })
  }

  // Determine direction from extracted data OR from webhook event type
  // OpenPhone event types: "message.received" (inbound), "message.sent" (outbound)
  const isInbound =
    extracted.direction === "inbound" ||
    extracted.direction === "incoming" ||
    extracted.eventType === "message.received"

  const isOutbound =
    extracted.direction === "outbound" ||
    extracted.direction === "outgoing" ||
    extracted.eventType === "message.sent"

  // Handle outbound messages - log them so they appear in the UI
  // This catches messages sent directly from the OpenPhone app
  if (isOutbound) {
    const toE164 = normalizePhoneNumber(extracted.to) || extracted.to
    const toPhone = normalizePhoneNumber(toE164)

    if (toPhone) {
      const client = getSupabaseClient()

      // Route to correct tenant
      let tenant = await getTenantByPhoneNumber(extracted.from)
      if (!tenant) {
        tenant = await getTenantByOpenPhoneId(extracted.from)
      }
      if (!tenant) {
        tenant = await getDefaultTenant()
      }

      // Find customer
      const { data: customer } = await client
        .from("customers")
        .select("id")
        .eq("phone_number", toE164)
        .eq("tenant_id", tenant?.id)
        .maybeSingle()

      // Save the outbound message
      const { error: msgErr } = await client.from("messages").insert({
        tenant_id: tenant?.id,
        customer_id: customer?.id || null,
        phone_number: toE164,
        role: "assistant",
        content: extracted.content,
        direction: "outbound",
        message_type: "sms",
        ai_generated: false,
        timestamp: extracted.createdAt || new Date().toISOString(),
        source: "openphone_app",
        metadata: payload,
      })

      if (msgErr) {
        console.error("[OpenPhone] Failed to save outbound message:", msgErr)
      } else {
        console.log(`[OpenPhone] Saved outbound message from OpenPhone app to ${toPhone}`)
      }
    }

    return NextResponse.json({ success: true, logged: true, direction: "outbound" })
  }

  const fromE164 = normalizePhoneNumber(extracted.from) || extracted.from
  const phone = normalizePhoneNumber(fromE164)
  if (!phone) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const client = getSupabaseClient()

  // Log extracted data for debugging
  console.log(`[OpenPhone] Extracted message data:`, JSON.stringify({
    from: extracted.from,
    to: extracted.to,
    direction: extracted.direction,
    eventType: extracted.eventType,
    contentPreview: extracted.content?.slice(0, 50),
  }))

  // Route to the correct tenant based on which phone number received the message
  // This ensures Spotless Scrubbers texts go to Spotless, WinBros to WinBros, etc.
  let tenant = null
  let routingMethod = "default"

  // Try 1: Look up by the "to" phone number
  if (extracted.to) {
    // First try as a phone number
    tenant = await getTenantByPhoneNumber(extracted.to)
    if (tenant) {
      routingMethod = "phone_number"
      console.log(`[OpenPhone] Routed to tenant '${tenant.slug}' by phone number: ${extracted.to}`)
    } else {
      // If that failed, try as an OpenPhone phone ID
      tenant = await getTenantByOpenPhoneId(extracted.to)
      if (tenant) {
        routingMethod = "openphone_id"
        console.log(`[OpenPhone] Routed to tenant '${tenant.slug}' by OpenPhone ID: ${extracted.to}`)
      }
    }
  }

  // Fall back to default tenant if we couldn't route
  if (!tenant) {
    tenant = await getDefaultTenant()
    console.log(`[OpenPhone] Using default tenant '${tenant?.slug}' (to: ${extracted.to || 'not provided'})`)
  }

  // Log routing decision as system event for debugging
  await logSystemEvent({
    tenant_id: tenant?.id,
    source: "openphone",
    event_type: "SMS_ROUTING",
    message: `SMS from ${phone} routed to ${tenant?.slug || 'unknown'} via ${routingMethod}`,
    phone_number: phone,
    metadata: {
      from: extracted.from,
      to: extracted.to,
      routing_method: routingMethod,
      tenant_slug: tenant?.slug,
      tenant_phone: tenant?.openphone_phone_number,
      tenant_phone_id: tenant?.openphone_phone_id,
    },
  })

  // CRITICAL: Filter out messages from our own phone number to prevent auto-response loops
  // When we send an SMS, OpenPhone may send a webhook for our outbound message
  const ourPhoneNumber = normalizePhoneNumber(tenant?.openphone_phone_number || "")
  if (ourPhoneNumber && phone === ourPhoneNumber) {
    console.log(`[OpenPhone] Ignoring message from our own phone number: ${phone}`)
    return NextResponse.json({ success: true, ignored: true, reason: "Message from our own phone number" })
  }

  // Check if SMS auto-response is enabled for this tenant (kill switch)
  const smsEnabled = tenant ? isSmsAutoResponseEnabled(tenant) : false
  if (!smsEnabled) {
    console.log(`[OpenPhone] SMS auto-response disabled for tenant '${tenant?.slug}' - storing message but not responding`)
  }

  // Upsert customer by phone_number (composite unique: tenant_id, phone_number)
  const { data: customer, error: custErr } = await client
    .from("customers")
    .upsert({ phone_number: phone, tenant_id: tenant?.id }, { onConflict: "tenant_id,phone_number" })
    .select("*")
    .single()

  if (custErr) {
    return NextResponse.json({ success: false, error: `Failed to upsert customer: ${custErr.message}` }, { status: 500 })
  }

  // Dedup: skip if an identical inbound message was already stored in the last 30 seconds
  // (OpenPhone can fire multiple webhook events for the same message)
  const dedupCutoff = new Date(Date.now() - 30000).toISOString()
  const { data: existingDup } = await client
    .from("messages")
    .select("id")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("role", "client")
    .eq("content", extracted.content || "")
    .gte("timestamp", dedupCutoff)
    .limit(1)
    .maybeSingle()

  if (existingDup) {
    console.log(`[OpenPhone] Duplicate inbound message detected for ${phone}, skipping`)
    return NextResponse.json({ success: true, action: "duplicate_webhook_skipped" })
  }

  // Store the inbound message for dashboard display
  const receivedAt = new Date().toISOString()
  const { data: insertedMsg, error: msgErr } = await client.from("messages").insert({
    tenant_id: tenant?.id,
    customer_id: customer.id,
    phone_number: phone,
    role: "client",
    content: extracted.content,
    direction: extracted.direction || "inbound",
    message_type: "sms",
    ai_generated: false,
    timestamp: receivedAt,
    source: "openphone",
    metadata: payload,
  }).select("id").single()

  if (msgErr) {
    return NextResponse.json({ success: false, error: `Failed to insert message: ${msgErr.message}` }, { status: 500 })
  }

  const currentMsgId = insertedMsg?.id

  // ============================================
  // AI Intent Analysis for Lead Creation
  // ============================================
  const messageContent = extracted.content || ""

  // Quick check - skip obvious non-booking messages (don't waste the debounce delay)
  if (isObviouslyNotBooking(messageContent)) {
    console.log(`[OpenPhone] Message is obviously not booking intent: "${messageContent}"`)
    return NextResponse.json({ success: true, intentAnalysis: "skipped" })
  }

  // ============================================
  // DEBOUNCE: Wait for additional messages to arrive
  // This prevents sending multiple responses when a customer
  // sends several texts in quick succession (e.g. "Yup" then email)
  // ============================================
  const RESPONSE_DELAY_MS = Number(process.env.SMS_RESPONSE_DELAY_MS || '8000')
  if (RESPONSE_DELAY_MS > 0) {
    console.log(`[OpenPhone] Waiting ${RESPONSE_DELAY_MS}ms for additional messages from ${phone}...`)
    await new Promise(resolve => setTimeout(resolve, RESPONSE_DELAY_MS))
  }

  // After delay, check if this is still the newest inbound message
  // If a newer message arrived during the delay, let that webhook handle the response
  // Use id as tiebreaker for deterministic ordering when timestamps match
  const { data: newestInbound } = await client
    .from("messages")
    .select("id")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("role", "client")
    .order("timestamp", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .single()

  if (newestInbound && newestInbound.id !== currentMsgId) {
    console.log(`[OpenPhone] Newer message arrived during debounce window, deferring to newer webhook`)
    return NextResponse.json({ success: true, action: "debounced_newer_message" })
  }

  // Double-guard: check if another webhook already sent an AI response recently
  const recentOutboundCutoff = new Date(Date.now() - 15000).toISOString()
  const { data: recentOutbound } = await client
    .from("messages")
    .select("id")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("role", "assistant")
    .eq("ai_generated", true)
    .gte("timestamp", recentOutboundCutoff)
    .limit(1)

  if (recentOutbound && recentOutbound.length > 0) {
    console.log(`[OpenPhone] AI response already sent in last 15s, skipping duplicate`)
    return NextResponse.json({ success: true, action: "debounced_recent_outbound" })
  }

  // ============================================
  // COMBINE: Batch all recent inbound messages into one context
  // e.g. "Yup" + "jaspergrenager@gmail.com" → "Yup jaspergrenager@gmail.com"
  // ============================================
  const combineWindow = new Date(Date.now() - 2 * 60 * 1000).toISOString()
  const { data: recentInbound } = await client
    .from("messages")
    .select("content")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("role", "client")
    .gte("timestamp", combineWindow)
    .order("timestamp", { ascending: true })

  const combinedMessage = recentInbound && recentInbound.length > 1
    ? recentInbound.map(m => m.content).join(' ')
    : messageContent

  if (recentInbound && recentInbound.length > 1) {
    console.log(`[OpenPhone] Combined ${recentInbound.length} messages: "${combinedMessage.slice(0, 100)}"`)
  }

  // Get recent conversation history for context (more messages for better AI context)
  const { data: recentMessages } = await client
    .from("messages")
    .select("role, content")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .order("timestamp", { ascending: false })
    .limit(10)

  const conversationHistory = recentMessages?.reverse().map(m => ({
    role: m.role as 'client' | 'assistant',
    content: m.content
  })) || []

  // ============================================
  // FLOW ROUTING: Check for existing leads to determine response flow
  // - "booked" leads → phone-call flow (email capture → payment link)
  // - "new"/"contacted"/"qualified" leads → continue follow-up conversation
  // - No lead → new inquiry flow (intent analysis → lead creation)
  // ============================================

  // Check for a BOOKED lead first (customer called in, booked, now texting back)
  const { data: bookedLeads } = await client
    .from("leads")
    .select("id, status, form_data, converted_to_job_id")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("status", "booked")
    .order("created_at", { ascending: false })
    .limit(1)

  let bookedLead = bookedLeads?.[0] ?? null

  // Fallback: if no "booked" lead found, check if there's a recent VAPI booking
  // confirmation message - this handles the case where the lead status update
  // didn't complete before the customer texted back
  if (!bookedLead) {
    const { data: vapiConfirmation } = await client
      .from("messages")
      .select("id")
      .eq("phone_number", phone)
      .eq("tenant_id", tenant?.id)
      .eq("source", "vapi_booking_confirmation")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (vapiConfirmation) {
      console.log(`[OpenPhone] Found VAPI booking confirmation for ${phone}, looking for phone-source lead`)
      // Find the most recent lead for this phone (any status)
      const { data: phoneLead } = await client
        .from("leads")
        .select("id, status, form_data, converted_to_job_id")
        .eq("phone_number", phone)
        .eq("tenant_id", tenant?.id)
        .eq("source", "phone")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (phoneLead) {
        console.log(`[OpenPhone] Using phone-source lead ${phoneLead.id} (status: ${phoneLead.status}) as booked lead fallback`)
        // Update lead to "booked" since the VAPI confirmation was sent
        if (phoneLead.status !== "booked") {
          await client
            .from("leads")
            .update({ status: "booked" })
            .eq("id", phoneLead.id)
        }
        bookedLead = phoneLead
      }
    }
  }

  if (bookedLead && smsEnabled) {
    console.log(`[OpenPhone] Phone-call flow: Lead ${bookedLead.id} is booked, handling post-booking response`)

    // Update last contact time
    await client
      .from("leads")
      .update({ last_contact_at: new Date().toISOString() })
      .eq("id", bookedLead.id)

    // Check if customer provided an email address
    const emailMatch = combinedMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
    const providedEmail = emailMatch ? emailMatch[0].toLowerCase() : null

    if (providedEmail) {
      console.log(`[OpenPhone] Email captured from booked customer: ${providedEmail}`)

      // Save email to customer record
      await client
        .from("customers")
        .update({ email: providedEmail })
        .eq("id", customer.id)

      await logSystemEvent({
        tenant_id: tenant?.id,
        source: "openphone",
        event_type: "EMAIL_CAPTURED",
        message: `Email captured from booked customer: ${providedEmail}`,
        phone_number: phone,
        metadata: { email: providedEmail, lead_id: bookedLead.id },
      })

      // Find the job for this booking
      let job = null
      if (bookedLead.converted_to_job_id) {
        const { data: jobData } = await client
          .from("jobs")
          .select("*")
          .eq("id", bookedLead.converted_to_job_id)
          .single()
        job = jobData
      }

      // If no job linked, find most recent job for this customer
      if (!job) {
        const { data: recentJob } = await client
          .from("jobs")
          .select("*")
          .eq("phone_number", phone)
          .eq("tenant_id", tenant?.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        job = recentJob
      }

      // Send card-on-file link (job is optional - we can still save card without it)
      const jobId = job?.id || bookedLead.converted_to_job_id || null
      try {
        const { createCardOnFileLink } = await import("@/lib/stripe-client")
        const cardResult = await createCardOnFileLink(
          { ...customer, email: providedEmail } as any,
          jobId || `lead-${bookedLead.id}`,
        )

        if (cardResult.success && cardResult.url) {
          // Determine service price: use job price if set, otherwise look up from pricebook
          let servicePrice = job?.price || job?.estimated_value || null
          if (!servicePrice && tenant?.slug === "winbros") {
            try {
              const { lookupPrice } = await import("@/lib/pricebook")
              const { parseFormData } = await import("@/lib/utils")
              const formData = parseFormData((bookedLead as any)?.form_data)
              const priceLookup = lookupPrice({
                serviceType: (formData.serviceType as string) || job?.service_type || null,
                squareFootage: (formData.squareFootage as number) || job?.square_footage || null,
                notes: (formData.notes as string) || job?.notes || null,
              })
              if (priceLookup) {
                servicePrice = priceLookup.price
                console.log(`[OpenPhone] Pricebook lookup: ${priceLookup.serviceName} ${priceLookup.tier ? `(${priceLookup.tier})` : ""} = $${priceLookup.price}`)
              }
            } catch (pbErr) {
              console.error("[OpenPhone] Pricebook lookup error:", pbErr)
            }
          }
          const priceStr = servicePrice ? `Your service total is $${Number(servicePrice).toFixed(2)}. ` : ""
          const cardMessage = `Thanks! ${priceStr}Go ahead and put your card on file so that we can get you set up: ${cardResult.url}`
          const cardSms = await sendSMS(tenant!, phone, cardMessage)
          if (cardSms.success) {
            await client.from("messages").insert({
              tenant_id: tenant?.id,
              customer_id: customer.id,
              phone_number: phone,
              role: "assistant",
              content: cardMessage,
              direction: "outbound",
              message_type: "sms",
              ai_generated: false,
              timestamp: new Date().toISOString(),
              source: "card_on_file",
              metadata: { lead_id: bookedLead.id, job_id: jobId, card_on_file_url: cardResult.url },
            })
            console.log(`[OpenPhone] Card-on-file link sent to ${phone}: ${cardResult.url}`)
          }

          await logSystemEvent({
            tenant_id: tenant?.id,
            source: "openphone",
            event_type: "PAYMENT_LINKS_SENT",
            message: `Card-on-file link sent to ${phone}`,
            phone_number: phone,
            metadata: { lead_id: bookedLead.id, job_id: jobId, cardOnFileUrl: cardResult.url },
          })

          // Try to send confirmation email
          if (job) {
            try {
              const { sendConfirmationEmail } = await import("@/lib/gmail-client")
              await sendConfirmationEmail({
                customer: { ...customer, email: providedEmail },
                job,
                stripeDepositUrl: cardResult.url,
              })
              console.log(`[OpenPhone] Confirmation email sent to ${providedEmail}`)
            } catch (emailErr) {
              console.error("[OpenPhone] Failed to send confirmation email:", emailErr)
            }
          }

          return NextResponse.json({ success: true, flow: "phone_call_card_on_file", leadId: bookedLead.id })
        } else {
          console.error("[OpenPhone] Card-on-file link creation failed:", cardResult.error)
        }
      } catch (cardErr) {
        console.error("[OpenPhone] Failed to create card-on-file link:", cardErr)
      }

      // Fallback: card-on-file creation failed
      {
        const fallbackMsg = `Thanks for your email! We're getting everything set up and will send over the details shortly.`
        const fallbackResult = await sendSMS(tenant!, phone, fallbackMsg)
        if (fallbackResult.success) {
          await client.from("messages").insert({
            tenant_id: tenant?.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: fallbackMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "openphone",
          })
        }
      }

      return NextResponse.json({ success: true, flow: "phone_call_email_capture", leadId: bookedLead.id })

    } else {
      // No email in this message — check if customer is past the booking stage
      // (already has email on file or job already created). If so, use AI for
      // a natural contextual response instead of the canned email request.
      const customerAlreadyHasEmail = !!customer.email
      const jobAlreadyCreated = !!bookedLead.converted_to_job_id

      if (customerAlreadyHasEmail || jobAlreadyCreated) {
        // Customer is past booking — respond naturally with AI
        console.log(`[OpenPhone] Booked lead ${bookedLead.id} already has email/job, using AI response`)

        const leadFormData = parseFormData(bookedLead.form_data)
        const knownInfo: KnownCustomerInfo = {
          firstName: customer.first_name || leadFormData.first_name || null,
          lastName: customer.last_name || leadFormData.last_name || null,
          address: customer.address || leadFormData.address || null,
          email: customer.email || leadFormData.email || null,
          phone: phone,
          source: "phone",
        }

        const quickIntent = await analyzeBookingIntent(combinedMessage, conversationHistory)
        const autoResponse = await generateAutoResponse(
          combinedMessage,
          quickIntent,
          tenant,
          conversationHistory,
          knownInfo
        )

        if (autoResponse.shouldSend && autoResponse.response) {
          const sendResult = await sendSMS(tenant!, phone, autoResponse.response)
          if (sendResult.success) {
            await client.from("messages").insert({
              tenant_id: tenant?.id,
              customer_id: customer.id,
              phone_number: phone,
              role: "assistant",
              content: autoResponse.response,
              direction: "outbound",
              message_type: "sms",
              ai_generated: true,
              timestamp: new Date().toISOString(),
              source: "openphone",
              metadata: {
                auto_response: true,
                booked_lead_id: bookedLead.id,
                reason: autoResponse.reason,
              },
            })
          }
        }

        // Extract corrections from conversation and update DB
        // (e.g. customer says "It's grenager" to fix their last name)
        try {
          const { extractBookingData } = await import("@/lib/winbros-sms-prompt")
          const correctedData = await extractBookingData(conversationHistory)
          if (correctedData.firstName || correctedData.lastName || correctedData.address) {
            const updates: Record<string, string | null> = {}
            if (correctedData.firstName) updates.first_name = correctedData.firstName
            if (correctedData.lastName) updates.last_name = correctedData.lastName
            if (correctedData.address) updates.address = correctedData.address
            await client.from("customers").update(updates).eq("id", customer.id)

            // Also update the job if one exists
            if (bookedLead.converted_to_job_id && correctedData.address) {
              await client.from("jobs").update({ address: correctedData.address }).eq("id", bookedLead.converted_to_job_id)
            }
            console.log(`[OpenPhone] Updated customer/job with corrections:`, updates)
          }
        } catch (extractErr) {
          console.error("[OpenPhone] Error extracting corrections:", extractErr)
        }

        return NextResponse.json({ success: true, flow: "phone_call_post_booking_ai", leadId: bookedLead.id })
      }

      // Customer hasn't provided email yet — ask for it to complete booking
      const confirmMsg = `Thanks for confirming! To send you the confirmed pricing and secure your booking, could you send me your best email address?`
      const confirmResult = await sendSMS(tenant!, phone, confirmMsg)
      if (confirmResult.success) {
        await client.from("messages").insert({
          tenant_id: tenant?.id,
          customer_id: customer.id,
          phone_number: phone,
          role: "assistant",
          content: confirmMsg,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: "openphone",
          metadata: { lead_id: bookedLead.id },
        })
      }

      // Extract corrections from conversation and update DB
      try {
        const { extractBookingData } = await import("@/lib/winbros-sms-prompt")
        const correctedData = await extractBookingData(conversationHistory)
        if (correctedData.firstName || correctedData.lastName || correctedData.address) {
          const updates: Record<string, string | null> = {}
          if (correctedData.firstName) updates.first_name = correctedData.firstName
          if (correctedData.lastName) updates.last_name = correctedData.lastName
          if (correctedData.address) updates.address = correctedData.address
          await client.from("customers").update(updates).eq("id", customer.id)

          if (bookedLead.converted_to_job_id && correctedData.address) {
            await client.from("jobs").update({ address: correctedData.address }).eq("id", bookedLead.converted_to_job_id)
          }
          console.log(`[OpenPhone] Updated customer/job with corrections:`, updates)
        }
      } catch (extractErr) {
        console.error("[OpenPhone] Error extracting corrections:", extractErr)
      }

      return NextResponse.json({ success: true, flow: "phone_call_confirm", leadId: bookedLead.id })
    }
  }

  // Get the MOST RECENT active (non-booked) lead for this phone number
  const { data: allLeadsForPhone } = await client
    .from("leads")
    .select("id, status, form_data, source")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .in("status", ["new", "contacted", "qualified", "responded", "escalated"])
    .order("created_at", { ascending: false })

  // Get the most recent lead (first one due to descending order)
  const existingLead = allLeadsForPhone?.[0] ?? null

  // Check if the MOST RECENT lead has auto-response paused
  if (existingLead) {
    const formData = parseFormData(existingLead.form_data)
    if (formData.followup_paused === true) {
      console.log(`[OpenPhone] Auto-response paused for phone ${phone} (most recent lead ${existingLead.id}), skipping auto-response`)
      return NextResponse.json({ success: true, autoResponsePaused: true, leadId: existingLead.id })
    }
  }

  if (existingLead) {
    // Lead responded — update status and cancel remaining follow-up tasks
    await client
      .from("leads")
      .update({ status: "responded", last_contact_at: new Date().toISOString() })
      .eq("id", existingLead.id)

    // Cancel all pending follow-up stages so the sequence stops
    try {
      const { cancelTask } = await import("@/lib/scheduler")
      for (let stage = 1; stage <= 5; stage++) {
        await cancelTask(`lead-${existingLead.id}-stage-${stage}`)
      }
      console.log(`[OpenPhone] Cancelled remaining follow-up tasks for lead ${existingLead.id}`)
    } catch (cancelErr) {
      console.error("[OpenPhone] Error cancelling follow-up tasks:", cancelErr)
    }

    console.log(`[OpenPhone] Active lead ${existingLead.id} marked as responded for ${phone}`)

    // Only send auto-response if SMS is enabled for this tenant
    if (smsEnabled) {
      try {
        const quickIntent = await analyzeBookingIntent(combinedMessage, conversationHistory)

        // Build known customer info so the AI can confirm instead of re-asking
        const leadFormData = parseFormData(existingLead.form_data)
        const knownInfo: KnownCustomerInfo = {
          firstName: customer.first_name || leadFormData.first_name || null,
          lastName: customer.last_name || leadFormData.last_name || null,
          address: customer.address || leadFormData.address || null,
          email: customer.email || leadFormData.email || null,
          phone: phone,
          source: existingLead.source || null,
        }

        const autoResponse = await generateAutoResponse(
          combinedMessage,
          quickIntent,
          tenant,
          conversationHistory,
          knownInfo
        )

        if (autoResponse.shouldSend && autoResponse.response) {
          console.log(`[OpenPhone] Sending auto-response to existing lead: "${autoResponse.response.slice(0, 50)}..."`)

          const sendResult = await sendSMS(tenant!, phone, autoResponse.response)

          if (sendResult.success) {
            await client.from("messages").insert({
              tenant_id: tenant?.id,
              customer_id: customer.id,
              phone_number: phone,
              role: "assistant",
              content: autoResponse.response,
              direction: "outbound",
              message_type: "sms",
              ai_generated: true,
              timestamp: new Date().toISOString(),
              source: "openphone",
              metadata: {
                auto_response: true,
                existing_lead_id: existingLead.id,
                reason: autoResponse.reason,
                combined_message: combinedMessage,
                openphone_message_id: sendResult.messageId,
              },
            })
          }

          // Handle escalation — notify the owner if the AI flagged this customer
          if (autoResponse.escalation?.shouldEscalate && tenant?.owner_phone) {
            try {
              // Check if we already sent an escalation for this phone recently (prevent duplicates)
              const recentEscCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
              const { data: recentEsc } = await client
                .from("system_events")
                .select("id")
                .eq("event_type", "LEAD_ESCALATED")
                .eq("phone_number", phone)
                .gte("created_at", recentEscCutoff)
                .limit(1)

              if (!recentEsc || recentEsc.length === 0) {
                const { buildOwnerEscalationMessage } = await import("@/lib/winbros-sms-prompt")
                // Try to get a real name from conversation history
                const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ")
                  || extractNameFromConversation(conversationHistory)
                  || "Unknown"
                // Include full conversation transcript (history + latest bot response)
                const fullTranscript = [
                  ...conversationHistory,
                  { role: 'assistant', content: autoResponse.response || '' },
                ]
                const ownerMsg = buildOwnerEscalationMessage(
                  phone,
                  customerName,
                  autoResponse.escalation.reasons,
                  fullTranscript
                )
                await sendSMS(tenant, tenant.owner_phone, ownerMsg)

                await logSystemEvent({
                  tenant_id: tenant?.id,
                  source: "openphone",
                  event_type: "LEAD_ESCALATED",
                  message: `Lead escalated to owner: ${autoResponse.escalation.reasons.join(", ")}`,
                  phone_number: phone,
                  metadata: { lead_id: existingLead.id, reasons: autoResponse.escalation.reasons },
                })

                console.log(`[OpenPhone] Escalation notification sent to owner for ${phone}: ${autoResponse.escalation.reasons.join(", ")}`)
              } else {
                console.log(`[OpenPhone] Escalation already sent recently for ${phone}, skipping duplicate`)
              }

              // Pause auto-response for this lead — owner is taking over
              await client
                .from("leads")
                .update({
                  status: "escalated",
                  form_data: {
                    ...parseFormData(existingLead.form_data),
                    followup_paused: true,
                    escalation_reasons: autoResponse.escalation.reasons,
                  },
                })
                .eq("id", existingLead.id)
            } catch (escErr) {
              console.error("[OpenPhone] Failed to send escalation notification:", escErr)
            }
          }

          // ==============================================
          // WINBROS BOOKING COMPLETION: create job + send card-on-file link
          // ==============================================
          const emailInMessage = combinedMessage.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)
          const detectedEmail = emailInMessage ? emailInMessage[0].toLowerCase() : null

          // Fallback chain when booking is complete but email isn't in the current message
          // (e.g. customer confirmed email with "Yup"):
          // 1. Check customer record in DB
          // 2. Check lead form_data (from HCP)
          // 3. Scan conversation history for an email address
          let fallbackEmail: string | null = null
          if (!detectedEmail && autoResponse.bookingComplete) {
            fallbackEmail = (customer.email || parseFormData(existingLead.form_data).email || null)?.toLowerCase() || null

            // Last resort: scan conversation history for an email
            if (!fallbackEmail && conversationHistory.length > 0) {
              const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i
              for (const msg of [...conversationHistory].reverse()) {
                const historyMatch = msg.content.match(emailRegex)
                if (historyMatch) {
                  fallbackEmail = historyMatch[0].toLowerCase()
                  console.log(`[OpenPhone] Found email in conversation history: ${fallbackEmail} (from ${msg.role} message)`)
                  break
                }
              }
            }
          }
          const bookingEmail = detectedEmail || fallbackEmail

          if (bookingEmail && autoResponse.bookingComplete) {
            console.log(`[OpenPhone] SMS booking completion: email=${bookingEmail} (source: ${detectedEmail ? 'message' : 'fallback'}) for lead ${existingLead.id}`)

            try {
              // Save email to customer
              await client
                .from("customers")
                .update({ email: bookingEmail })
                .eq("id", customer.id)

              // Extract all booking data from conversation
              const { extractBookingData } = await import("@/lib/winbros-sms-prompt")
              const bookingData = await extractBookingData(conversationHistory)
              console.log(`[OpenPhone] Extracted booking data:`, JSON.stringify(bookingData))

              // Use extracted email if AI found one, otherwise use the one from booking
              const finalEmail = bookingData.email || bookingEmail

              // Update customer name if extracted
              if (bookingData.firstName || bookingData.lastName) {
                await client
                  .from("customers")
                  .update({
                    first_name: bookingData.firstName || customer.first_name,
                    last_name: bookingData.lastName || customer.last_name,
                    email: finalEmail,
                    address: bookingData.address || customer.address,
                  })
                  .eq("id", customer.id)
              }

              // Determine price using extracted data or pricebook lookup
              let servicePrice = bookingData.price
              if (!servicePrice && tenant?.slug === 'winbros') {
                try {
                  const { lookupPrice } = await import("@/lib/pricebook")
                  const priceLookup = lookupPrice({
                    serviceType: bookingData.serviceType || null,
                    squareFootage: bookingData.squareFootage || null,
                    notes: bookingData.scope || null,
                  })
                  if (priceLookup) {
                    servicePrice = priceLookup.price
                    console.log(`[OpenPhone] Pricebook lookup: ${priceLookup.serviceName} = $${priceLookup.price}`)
                  }
                } catch (pbErr) {
                  console.error("[OpenPhone] Pricebook lookup error:", pbErr)
                }
              }

              // Create job
              const { data: newJob, error: jobError } = await client.from("jobs").insert({
                tenant_id: tenant?.id,
                customer_id: customer.id,
                phone_number: phone,
                service_type: bookingData.serviceType?.replace(/_/g, ' ') || 'window cleaning',
                address: bookingData.address || customer.address || null,
                price: servicePrice || null,
                date: bookingData.preferredDate || null,
                scheduled_at: bookingData.preferredTime || null,
                status: 'scheduled',
                booked: true,
                notes: [
                  bookingData.squareFootage ? `SqFt: ${bookingData.squareFootage}` : null,
                  bookingData.scope ? `Scope: ${bookingData.scope}` : null,
                  bookingData.planType ? `Plan: ${bookingData.planType}` : null,
                  bookingData.referralSource ? `Referral: ${bookingData.referralSource}` : null,
                ].filter(Boolean).join(' | ') || null,
              }).select("id").single()

              if (jobError) {
                console.error(`[OpenPhone] Job creation failed:`, jobError)
              }
              console.log(`[OpenPhone] Job created from SMS booking: ${newJob?.id} — service: ${bookingData.serviceType}, date: ${bookingData.preferredDate}, price: $${servicePrice || 'TBD'}, address: ${bookingData.address || 'none'}`)

              // Update lead to booked
              await client
                .from("leads")
                .update({
                  status: "booked",
                  converted_to_job_id: newJob?.id || null,
                  form_data: {
                    ...parseFormData(existingLead.form_data),
                    booking_data: bookingData,
                  },
                })
                .eq("id", existingLead.id)

              // Send card-on-file link
              try {
                const { createCardOnFileLink } = await import("@/lib/stripe-client")
                const cardResult = await createCardOnFileLink(
                  { ...customer, email: finalEmail } as any,
                  newJob?.id || `lead-${existingLead.id}`,
                )

                if (cardResult.success && cardResult.url) {
                  const priceStr = servicePrice ? `Your total is $${Number(servicePrice).toFixed(2)}. ` : ""
                  const cardMessage = `${priceStr}Put your card on file so we can get you all set up: ${cardResult.url}`
                  const cardSms = await sendSMS(tenant!, phone, cardMessage)

                  if (cardSms.success) {
                    await client.from("messages").insert({
                      tenant_id: tenant?.id,
                      customer_id: customer.id,
                      phone_number: phone,
                      role: "assistant",
                      content: cardMessage,
                      direction: "outbound",
                      message_type: "sms",
                      ai_generated: false,
                      timestamp: new Date().toISOString(),
                      source: "card_on_file",
                      metadata: {
                        lead_id: existingLead.id,
                        job_id: newJob?.id,
                        card_on_file_url: cardResult.url,
                        booking_source: "sms_flow",
                      },
                    })
                    console.log(`[OpenPhone] Card-on-file link sent to ${phone} (SMS booking flow)`)
                  }

                  // Send confirmation email to customer
                  try {
                    const { sendConfirmationEmail } = await import("@/lib/gmail-client")
                    const emailResult = await sendConfirmationEmail({
                      customer: {
                        ...customer,
                        email: finalEmail,
                        first_name: bookingData.firstName || customer.first_name,
                        last_name: bookingData.lastName || customer.last_name,
                      } as any,
                      job: {
                        id: newJob?.id,
                        service_type: bookingData.serviceType?.replace(/_/g, ' ') || 'window cleaning',
                        address: bookingData.address || customer.address || null,
                        date: bookingData.preferredDate || null,
                        scheduled_at: null,
                        price: servicePrice || null,
                      } as any,
                      stripeDepositUrl: cardResult.url,
                    })
                    if (emailResult.success) {
                      console.log(`[OpenPhone] Confirmation email sent to ${finalEmail} (SMS booking flow)`)
                    } else {
                      console.error(`[OpenPhone] Confirmation email failed: ${emailResult.error}`)
                    }
                  } catch (emailErr) {
                    console.error("[OpenPhone] Failed to send confirmation email:", emailErr)
                  }

                  await logSystemEvent({
                    tenant_id: tenant?.id,
                    source: "openphone",
                    event_type: "SMS_BOOKING_COMPLETED",
                    message: `SMS booking completed for ${phone} — job ${newJob?.id}, card-on-file link sent, email sent to ${finalEmail}`,
                    phone_number: phone,
                    metadata: {
                      lead_id: existingLead.id,
                      job_id: newJob?.id,
                      booking_data: bookingData,
                      card_on_file_url: cardResult.url,
                      email_sent_to: finalEmail,
                    },
                  })
                } else {
                  console.error("[OpenPhone] Card-on-file link creation failed:", cardResult.error)
                }
              } catch (cardErr) {
                console.error("[OpenPhone] Failed to create card-on-file link:", cardErr)
              }

              return NextResponse.json({
                success: true,
                flow: "sms_booking_complete",
                existingLeadId: existingLead.id,
                jobId: newJob?.id,
              })
            } catch (bookingErr) {
              console.error("[OpenPhone] SMS booking completion error:", bookingErr)
            }
          }
        }
      } catch (err) {
        console.error("[OpenPhone] Auto-response error for existing lead:", err)
      }
    }

    return NextResponse.json({ success: true, existingLeadId: existingLead.id, autoResponseSent: smsEnabled })
  }

  // ============================================
  // NEW INQUIRY FLOW: No existing lead found
  // Run AI intent analysis and create lead if booking intent detected
  // ============================================
  console.log(`[OpenPhone] No existing lead for ${phone}, analyzing as new inquiry`)
  const intentResult = await analyzeBookingIntent(combinedMessage, conversationHistory)

  console.log(`[OpenPhone] Intent analysis result:`, intentResult)

  await logSystemEvent({
    tenant_id: tenant?.id,
    source: "openphone",
    event_type: "SMS_INTENT_ANALYZED",
    message: `SMS intent: ${intentResult.hasBookingIntent ? 'BOOKING INTENT DETECTED' : 'No booking intent'} (${intentResult.confidence})`,
    phone_number: phone,
    metadata: {
      message: combinedMessage,
      intent_result: intentResult,
    },
  })

  // Auto-Response for new inquiries
  if (smsEnabled) {
    try {
      console.log(`[OpenPhone] Generating auto-response for new inquiry: "${combinedMessage}"`)

      // Build known customer info so the AI can confirm instead of re-asking
      const knownInfoNew: KnownCustomerInfo = {
        firstName: customer.first_name || intentResult.extractedInfo.name?.split(' ')[0] || null,
        lastName: customer.last_name || intentResult.extractedInfo.name?.split(' ').slice(1).join(' ') || null,
        address: customer.address || intentResult.extractedInfo.address || null,
        email: customer.email || null,
        phone: phone,
      }

      const autoResponse = await generateAutoResponse(
        combinedMessage,
        intentResult,
        tenant,
        conversationHistory,
        knownInfoNew
      )

      if (autoResponse.shouldSend && autoResponse.response) {
        console.log(`[OpenPhone] Sending auto-response: "${autoResponse.response.slice(0, 50)}..."`)

        const sendResult = await sendSMS(tenant!, phone, autoResponse.response)

        if (sendResult.success) {
          await client.from("messages").insert({
            tenant_id: tenant?.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: autoResponse.response,
            direction: "outbound",
            message_type: "sms",
            ai_generated: true,
            timestamp: new Date().toISOString(),
            source: "openphone",
            metadata: {
              auto_response: true,
              reason: autoResponse.reason,
              intent_analysis: intentResult,
              combined_message: combinedMessage,
              openphone_message_id: sendResult.messageId,
            },
          })

          await logSystemEvent({
            tenant_id: tenant?.id,
            source: "openphone",
            event_type: "AUTO_RESPONSE_SENT",
            message: `Auto-response sent to ${phone}: "${autoResponse.response.slice(0, 50)}..."`,
            phone_number: phone,
            metadata: {
              response: autoResponse.response,
              reason: autoResponse.reason,
              message_id: sendResult.messageId,
            },
          })

          // Handle escalation — notify the owner if the AI flagged this customer
          if (autoResponse.escalation?.shouldEscalate && tenant?.owner_phone) {
            try {
              // Check if we already sent an escalation for this phone recently (prevent duplicates)
              const recentEscCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString()
              const { data: recentEsc } = await client
                .from("system_events")
                .select("id")
                .eq("event_type", "LEAD_ESCALATED")
                .eq("phone_number", phone)
                .gte("created_at", recentEscCutoff)
                .limit(1)

              if (!recentEsc || recentEsc.length === 0) {
                const { buildOwnerEscalationMessage } = await import("@/lib/winbros-sms-prompt")
                const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ")
                  || extractNameFromConversation(conversationHistory)
                  || "Unknown"
                // Include full conversation transcript (history + latest bot response)
                const fullTranscript = [
                  ...conversationHistory,
                  { role: 'assistant', content: autoResponse.response || '' },
                ]
                const ownerMsg = buildOwnerEscalationMessage(
                  phone,
                  customerName,
                  autoResponse.escalation.reasons,
                  fullTranscript
                )
                await sendSMS(tenant, tenant.owner_phone, ownerMsg)

                await logSystemEvent({
                  tenant_id: tenant?.id,
                  source: "openphone",
                  event_type: "LEAD_ESCALATED",
                  message: `Lead escalated to owner: ${autoResponse.escalation.reasons.join(", ")}`,
                  phone_number: phone,
                  metadata: { reasons: autoResponse.escalation.reasons },
                })

                console.log(`[OpenPhone] Escalation notification sent to owner for new inquiry ${phone}: ${autoResponse.escalation.reasons.join(", ")}`)
              } else {
                console.log(`[OpenPhone] Escalation already sent recently for new inquiry ${phone}, skipping duplicate`)
              }
            } catch (escErr) {
              console.error("[OpenPhone] Failed to send escalation notification:", escErr)
            }
          }
        } else {
          console.error(`[OpenPhone] Failed to send auto-response:`, sendResult.error)
        }
      } else {
        console.log(`[OpenPhone] Auto-response skipped: ${autoResponse.reason}`)
      }
    } catch (autoResponseErr) {
      console.error("[OpenPhone] Auto-response error:", autoResponseErr)
    }
  }

  // If booking intent detected, create lead and trigger follow-up
  if (intentResult.hasBookingIntent && (intentResult.confidence === 'high' || intentResult.confidence === 'medium')) {
    console.log(`[OpenPhone] Booking intent detected, creating lead...`)

    const firstName = customer.first_name || intentResult.extractedInfo.name?.split(' ')[0] || null
    const lastName = customer.last_name || intentResult.extractedInfo.name?.split(' ').slice(1).join(' ') || null
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null

    const { data: lead, error: leadErr } = await client.from("leads").insert({
      tenant_id: tenant?.id,
      source_id: `sms-${Date.now()}`,
      phone_number: phone,
      customer_id: customer.id,
      first_name: firstName,
      last_name: lastName,
      source: "sms",
      status: "new",
      form_data: {
        original_message: combinedMessage,
        intent_analysis: intentResult,
        extracted_info: intentResult.extractedInfo,
      },
      followup_stage: 0,
      followup_started_at: new Date().toISOString(),
    }).select("id").single()

    if (leadErr) {
      console.error("[OpenPhone] Failed to create lead:", leadErr.message)
    } else if (lead?.id) {
      console.log(`[OpenPhone] Lead created: ${lead.id}`)

      // Create lead in HousecallPro for two-way sync
      const hcpResult = await createLeadInHCP({
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        phone,
        address: intentResult.extractedInfo.address || customer.address || undefined,
        notes: `SMS Inquiry: "${combinedMessage}"`,
        source: "sms",
      })

      if (hcpResult.success) {
        console.log(`[OpenPhone] Lead synced to HCP: ${hcpResult.leadId}`)
        // Update lead with HCP ID
        await client
          .from("leads")
          .update({ source_id: hcpResult.leadId || `sms-${Date.now()}` })
          .eq("id", lead.id)
      } else {
        console.warn("[OpenPhone] Failed to sync lead to HCP:", hcpResult.error)
      }

      // Log lead creation
      await logSystemEvent({
        tenant_id: tenant?.id,
        source: "openphone",
        event_type: "LEAD_CREATED_FROM_SMS",
        message: `Lead created from SMS: ${fullName || phone}`,
        phone_number: phone,
        metadata: {
          lead_id: lead.id,
          hcp_lead_id: hcpResult.leadId,
          message: combinedMessage,
          intent: intentResult,
        },
      })

      // Auto-response already served as the initial greeting (stage 1),
      // so mark the lead as contacted to prevent the scheduled stage 1 from sending a duplicate.
      if (smsEnabled) {
        await client
          .from("leads")
          .update({ followup_stage: 1, last_contact_at: new Date().toISOString() })
          .eq("id", lead.id)
      }

      // Schedule the 5-stage follow-up sequence
      try {
        await scheduleLeadFollowUp(
          tenant?.id || '',
          String(lead.id),
          phone,
          fullName || "there"
        )
        console.log(`[OpenPhone] Follow-up sequence scheduled for lead ${lead.id}`)
      } catch (scheduleErr) {
        console.error("[OpenPhone] Failed to schedule follow-up:", scheduleErr)
      }

      return NextResponse.json({
        success: true,
        leadCreated: true,
        leadId: lead.id,
        intentAnalysis: intentResult,
      })
    }
  }

  return NextResponse.json({
    success: true,
    intentAnalysis: intentResult,
    leadCreated: false,
  })
}

/**
 * Try to extract a customer name from the conversation history.
 * Looks for the customer's response after a "full name" question from the assistant.
 */
function extractNameFromConversation(
  conversationHistory: Array<{ role: string; content: string }>
): string | null {
  for (let i = 0; i < conversationHistory.length - 1; i++) {
    if (
      conversationHistory[i].role === 'assistant' &&
      /full name/i.test(conversationHistory[i].content)
    ) {
      const nextClient = conversationHistory.slice(i + 1).find(m => m.role === 'client')
      if (nextClient) {
        const name = nextClient.content.trim()
        // Sanity check: should look like a name (not an email, URL, or long message)
        if (name.length > 0 && name.length < 60 && !name.includes('@') && !name.includes('http')) {
          return name
        }
      }
    }
  }
  return null
}
