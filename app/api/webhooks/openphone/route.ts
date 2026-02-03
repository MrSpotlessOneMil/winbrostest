import { NextRequest, NextResponse } from "next/server"
import { extractMessageFromOpenPhonePayload, normalizePhoneNumber, validateOpenPhoneWebhook, sendSMS } from "@/lib/openphone"
import { getSupabaseClient } from "@/lib/supabase"
import { analyzeBookingIntent, isObviouslyNotBooking } from "@/lib/ai-intent"
import { generateAutoResponse } from "@/lib/auto-response"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant, getTenantByPhoneNumber, getTenantByOpenPhoneId, isSmsAutoResponseEnabled } from "@/lib/tenant"

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

  // Store the inbound message for dashboard display
  const { error: msgErr } = await client.from("messages").insert({
    tenant_id: tenant?.id,
    customer_id: customer.id,
    phone_number: phone,
    role: "client",
    content: extracted.content,
    direction: extracted.direction || "inbound",
    message_type: "sms",
    ai_generated: false,
    timestamp: extracted.createdAt,
    source: "openphone",
    metadata: payload,
  })

  if (msgErr) {
    return NextResponse.json({ success: false, error: `Failed to insert message: ${msgErr.message}` }, { status: 500 })
  }

  // ============================================
  // AI Intent Analysis for Lead Creation
  // ============================================
  const messageContent = extracted.content || ""

  // Quick check - skip obvious non-booking messages
  if (isObviouslyNotBooking(messageContent)) {
    console.log(`[OpenPhone] Message is obviously not booking intent: "${messageContent}"`)
    return NextResponse.json({ success: true, intentAnalysis: "skipped" })
  }

  // Get recent conversation history for context (needed for auto-response)
  const { data: recentMessages } = await client
    .from("messages")
    .select("role, content")
    .eq("phone_number", phone)
    .order("timestamp", { ascending: false })
    .limit(5)

  const conversationHistory = recentMessages?.reverse().map(m => ({
    role: m.role as 'client' | 'assistant',
    content: m.content
  })) || []

  // Check if a lead already exists for this phone (that's still active)
  const { data: existingLead } = await client
    .from("leads")
    .select("id, status, form_data")
    .eq("phone_number", phone)
    .in("status", ["new", "contacted", "qualified"])
    .maybeSingle()

  if (existingLead) {
    // Lead already exists, update last contact time
    await client
      .from("leads")
      .update({ last_contact_at: new Date().toISOString() })
      .eq("id", existingLead.id)

    console.log(`[OpenPhone] Lead already exists for ${phone}, updated last_contact_at`)

    // Check if auto-response is paused for this lead
    const leadFormData = existingLead.form_data as Record<string, unknown> | null
    const followupPaused = leadFormData?.followup_paused === true
    if (followupPaused) {
      console.log(`[OpenPhone] Auto-response paused for lead ${existingLead.id}, skipping`)
      return NextResponse.json({ success: true, existingLeadId: existingLead.id, autoResponsePaused: true })
    }

    // Only send auto-response if SMS is enabled for this tenant
    if (smsEnabled) {
      try {
        // Run quick intent analysis for context
        const quickIntent = await analyzeBookingIntent(messageContent, conversationHistory)

        const autoResponse = await generateAutoResponse(
          messageContent,
          quickIntent,
          tenant,
          conversationHistory
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
                openphone_message_id: sendResult.messageId,
              },
            })
          }
        }
      } catch (err) {
        console.error("[OpenPhone] Auto-response error for existing lead:", err)
      }
    }

    return NextResponse.json({ success: true, existingLeadId: existingLead.id, autoResponseSent: smsEnabled })
  }

  // Run AI intent analysis
  console.log(`[OpenPhone] Analyzing booking intent for: "${messageContent}"`)
  const intentResult = await analyzeBookingIntent(messageContent, conversationHistory)

  console.log(`[OpenPhone] Intent analysis result:`, intentResult)

  // Log the intent analysis
  await logSystemEvent({
    source: "openphone",
    event_type: "SMS_INTENT_ANALYZED",
    message: `SMS intent: ${intentResult.hasBookingIntent ? 'BOOKING INTENT DETECTED' : 'No booking intent'} (${intentResult.confidence})`,
    phone_number: phone,
    metadata: {
      message: messageContent,
      intent_result: intentResult,
    },
  })

  // ============================================
  // Auto-Response: Send immediate AI-powered reply
  // Only if SMS auto-response is enabled for this tenant
  // ============================================
  if (smsEnabled) {
    try {
      console.log(`[OpenPhone] Generating auto-response for: "${messageContent}"`)

      const autoResponse = await generateAutoResponse(
        messageContent,
        intentResult,
        tenant,
        conversationHistory
      )

      if (autoResponse.shouldSend && autoResponse.response) {
        console.log(`[OpenPhone] Sending auto-response: "${autoResponse.response.slice(0, 50)}..."`)

        const sendResult = await sendSMS(tenant!, phone, autoResponse.response)

        if (sendResult.success) {
          // Store the outgoing auto-response message
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
              openphone_message_id: sendResult.messageId,
            },
          })

          console.log(`[OpenPhone] Auto-response sent successfully: ${sendResult.messageId}`)

          await logSystemEvent({
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
        } else {
          console.error(`[OpenPhone] Failed to send auto-response:`, sendResult.error)
        }
      } else {
        console.log(`[OpenPhone] Auto-response skipped: ${autoResponse.reason}`)
      }
    } catch (autoResponseErr) {
      console.error("[OpenPhone] Auto-response error:", autoResponseErr)
      // Don't fail the webhook, just log the error
    }
  } else {
    console.log(`[OpenPhone] Auto-response skipped - SMS disabled for tenant '${tenant?.slug}'`)
  }

  // If booking intent detected, create lead and trigger follow-up
  if (intentResult.hasBookingIntent && (intentResult.confidence === 'high' || intentResult.confidence === 'medium')) {
    console.log(`[OpenPhone] Booking intent detected, creating lead...`)

    // Extract name from customer record or intent analysis
    const firstName = customer.first_name || intentResult.extractedInfo.name?.split(' ')[0] || null
    const lastName = customer.last_name || intentResult.extractedInfo.name?.split(' ').slice(1).join(' ') || null
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null

    // Create lead in our database
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
        original_message: messageContent,
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
        notes: `SMS Inquiry: "${messageContent}"`,
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
        source: "openphone",
        event_type: "LEAD_CREATED_FROM_SMS",
        message: `Lead created from SMS: ${fullName || phone}`,
        phone_number: phone,
        metadata: {
          lead_id: lead.id,
          hcp_lead_id: hcpResult.leadId,
          message: messageContent,
          intent: intentResult,
        },
      })

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
