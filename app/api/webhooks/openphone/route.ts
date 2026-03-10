import { NextRequest, NextResponse } from "next/server"
import { extractMessageFromOpenPhonePayload, normalizePhoneNumber, validateOpenPhoneWebhook, sendSMS, SMS_TEMPLATES } from "@/lib/openphone"
import { normalizePhone, maskPhone, maskEmail } from "@/lib/phone-utils"
import { getSupabaseClient } from "@/lib/supabase"
import { analyzeBookingIntent, isObviouslyNotBooking } from "@/lib/ai-intent"
import { generateAutoResponse, loadCustomerContext, type KnownCustomerInfo } from "@/lib/auto-response"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp, scheduleTask, cancelTask, scheduleRetargetingSequence } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantByPhoneNumber, getTenantByOpenPhoneId, isSmsAutoResponseEnabled, tenantUsesFeature } from "@/lib/tenant"
import { parseFormData } from "@/lib/utils"
import { syncNewJobToHCP, syncCustomerToHCP } from "@/lib/hcp-job-sync"
import { analyzeSimpleSentiment, recordMessageSent, cancelPendingTasks } from "@/lib/lifecycle-engine"

/**
 * Send a multi-part AI response as separate SMS messages.
 * The AI uses ||| to separate messages that should be sent as individual texts.
 * Returns the full concatenated content for DB storage.
 */
async function sendMultiPartSMS(
  tenant: any,
  phone: string,
  fullResponse: string,
  client: any,
  customerId: number,
  metadata: Record<string, any>
): Promise<{ success: boolean; fullContent: string; messageIds: string[] }> {
  const parts = fullResponse.split('|||').map(p => p.trim()).filter(Boolean)
  const messageIds: string[] = []
  let allSuccess = true

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const result = await sendSMS(tenant, phone, part)
    if (result.success) {
      messageIds.push(result.messageId || '')
    } else {
      allSuccess = false
    }

    // Store each part as a separate message in DB for dashboard display
    await client.from("messages").insert({
      tenant_id: tenant.id,
      customer_id: customerId,
      phone_number: phone,
      role: "assistant",
      content: part,
      direction: "outbound",
      message_type: "sms",
      ai_generated: true,
      timestamp: new Date(Date.now() + i).toISOString(), // offset by 1ms for ordering
      source: "openphone",
      metadata: { ...metadata, part: i + 1, total_parts: parts.length },
    })

    // Small delay between texts so they arrive in order
    if (i < parts.length - 1) {
      await new Promise(r => setTimeout(r, 800))
    }
  }

  return { success: allSuccess, fullContent: parts.join('\n'), messageIds }
}

/** Format raw ISO dates/timestamps to human-readable for SMS and LLM context */
function formatDateHuman(raw: string, tz = 'America/Chicago'): string {
  try {
    const dateOnly = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (dateOnly) {
      const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    }
    const d = new Date(raw)
    if (!isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
      }).format(d)
    }
    return raw
  } catch { return raw }
}

export async function POST(request: NextRequest) {
  const signature =
    request.headers.get("openphone-signature") ||
    request.headers.get("x-openphone-signature") ||
    request.headers.get("X-OpenPhone-Signature")

  // OpenPhone signature format: "hmac;1;{timestamp};{digest}"
  // Fall back to dedicated timestamp header, or Stripe-style "t=xxx,v1=xxx"
  let timestamp = request.headers.get("openphone-timestamp") || request.headers.get("x-openphone-timestamp")
  if (!timestamp && signature) {
    // OpenPhone style: hmac;{version};{timestamp};{digest}
    const semicolonParts = signature.split(';')
    if (semicolonParts.length >= 4 && semicolonParts[0].toLowerCase() === 'hmac') {
      timestamp = semicolonParts[2]
    } else {
      // Stripe-style fallback: t=1234,v1=abc
      const tMatch = signature.match(/(?:^|,)\s*t=(\d+)/)
      if (tMatch) timestamp = tMatch[1]
    }
  }

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
        console.error(`[OpenPhone] OUTBOUND: Could not find tenant for from=${extracted.from} — message will be logged without tenant context`)
      }

      // Find customer
      const { data: customer } = await client
        .from("customers")
        .select("id")
        .eq("phone_number", toE164)
        .eq("tenant_id", tenant?.id)
        .maybeSingle()

      // Dedup: check if this outbound message was already stored by our system
      // (e.g., VAPI confirmation, auto-response, deposit flow, card-on-file, etc.)
      const outboundDedupCutoff = new Date(Date.now() - 60000).toISOString()
      const { data: existingOutbound } = await client
        .from("messages")
        .select("id")
        .eq("phone_number", toE164)
        .eq("tenant_id", tenant?.id)
        .eq("role", "assistant")
        .eq("content", extracted.content || "")
        .gte("timestamp", outboundDedupCutoff)
        .limit(1)
        .maybeSingle()

      if (existingOutbound) {
        console.log(`[OpenPhone] Outbound message already stored for ${maskPhone(toPhone)}, skipping duplicate`)
      } else {
        // Save the outbound message (only for messages sent directly from OpenPhone app)
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
          console.log(`[OpenPhone] Saved outbound message from OpenPhone app to ${maskPhone(toPhone)}`)
        }
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
  console.log(`[OpenPhone] Extracted message data: direction=${extracted.direction}, eventType=${extracted.eventType}`)

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
      console.log(`[OpenPhone] Routed to tenant '${tenant.slug}' by phone number: ${maskPhone(extracted.to)}`)
    } else {
      // If that failed, try as an OpenPhone phone ID
      tenant = await getTenantByOpenPhoneId(extracted.to)
      if (tenant) {
        routingMethod = "openphone_id"
        console.log(`[OpenPhone] Routed to tenant '${tenant.slug}' by OpenPhone ID`)
      }
    }
  }

  // If we couldn't route, log an error but DON'T fall back to WinBros
  // This prevents cross-tenant bleed (Bug: Spotless texts getting WinBros responses)
  if (!tenant) {
    console.error(`[OpenPhone] CRITICAL: Could not route inbound SMS to any tenant. to=${extracted.to}, from=${extracted.from}. Message will be dropped — no auto-response sent.`)
    await logSystemEvent({
      source: "openphone",
      event_type: "TENANT_ROUTING_FAILED",
      message: `Could not route inbound SMS to any tenant — no auto-response sent`,
      phone_number: phone,
      metadata: {
        from: extracted.from,
        to: extracted.to,
        content_preview: extracted.content?.slice(0, 100),
      },
    })
    return NextResponse.json({ success: false, error: "Could not determine tenant for this phone number" }, { status: 200 })
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
    console.log(`[OpenPhone] Ignoring message from our own phone number: ${maskPhone(phone)}`)
    return NextResponse.json({ success: true, ignored: true, reason: "Message from our own phone number" })
  }

  // Check if SMS auto-response is enabled for this tenant (kill switch)
  const smsEnabled = tenant ? isSmsAutoResponseEnabled(tenant) : false
  if (!smsEnabled) {
    console.log(`[OpenPhone] SMS auto-response disabled for tenant '${tenant?.slug}' - storing message but not responding`)
  }

  // ============================================
  // INTERNAL NUMBER FILTER
  // Block auto-responses to owner, cleaners, and blocklisted numbers.
  // Messages are still stored for dashboard visibility.
  // ============================================
  const senderDigits = normalizePhone(phone)

  // Check 1: Owner phone
  if (tenant?.owner_phone && normalizePhone(tenant.owner_phone) === senderDigits) {
    // Store message for dashboard, skip all AI logic
    await client.from("messages").insert({
      tenant_id: tenant?.id,
      phone_number: phone,
      role: "client",
      content: extracted.content,
      direction: extracted.direction || "inbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "openphone",
      metadata: { ...payload, openphone_message_id: payload?.data?.object?.id || payload?.data?.id || payload?.id || null, filtered: "owner_phone" },
    })
    console.log(`[OpenPhone] Sender ${phone} is owner of '${tenant?.slug}' — message stored, auto-response skipped`)
    return NextResponse.json({ success: true, stored: true, filtered: "owner_phone" })
  }

  // Check 2: SMS blocklist (from workflow_config)
  const smsBlocklist: string[] = (tenant?.workflow_config as any)?.sms_blocklist || []
  if (smsBlocklist.some((b: string) => normalizePhone(b) === senderDigits)) {
    await client.from("messages").insert({
      tenant_id: tenant?.id,
      phone_number: phone,
      role: "client",
      content: extracted.content,
      direction: extracted.direction || "inbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "openphone",
      metadata: { ...payload, openphone_message_id: payload?.data?.object?.id || payload?.data?.id || payload?.id || null, filtered: "blocklisted" },
    })
    console.log(`[OpenPhone] Sender ${phone} is blocklisted for '${tenant?.slug}' — message stored, auto-response skipped`)
    return NextResponse.json({ success: true, stored: true, filtered: "blocklisted" })
  }

  // Check 3: Cleaner phone — route to cleaner SMS handler
  const { data: tenantCleaners } = await client
    .from("cleaners")
    .select("id, phone, name, portal_token")
    .eq("tenant_id", tenant?.id)
    .eq("active", true)
  const matchedCleaner = (tenantCleaners || []).find((c: any) => c.phone && normalizePhone(c.phone) === senderDigits)
  if (matchedCleaner) {
    // Store the inbound message
    await client.from("messages").insert({
      tenant_id: tenant?.id,
      phone_number: phone,
      role: "client",
      content: extracted.content,
      direction: extracted.direction || "inbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "openphone",
      metadata: { ...payload, openphone_message_id: payload?.data?.object?.id || payload?.data?.id || payload?.id || null, filtered: "cleaner_phone", cleaner_id: matchedCleaner.id },
    })

    // Parse cleaner intent — only YES/NO for assignment replies
    // Status updates (OMW/HERE/DONE) are portal-only
    const { parseCleanerSMS, processCleanerAssignmentReply } = await import("@/lib/cleaner-sms")
    const intent = parseCleanerSMS(extracted.content || "")

    if (intent && tenant && (intent === "accept" || intent === "decline")) {
      const result = await processCleanerAssignmentReply(tenant, matchedCleaner.id, intent === "accept")
      console.log(`[OpenPhone] Cleaner ${matchedCleaner.name} assignment reply: ${intent} — ${result.success ? "ok" : result.error}`)
    } else {
      console.log(`[OpenPhone] Cleaner ${matchedCleaner.name} sent message — stored, forwarding to owner`)
      // Forward cleaner messages to owner
      if (tenant?.owner_phone) {
        const { sendSMS: sendOwnerSMS } = await import("@/lib/openphone")
        await sendOwnerSMS(tenant, tenant.owner_phone, `Message from cleaner ${matchedCleaner.name}: ${(extracted.content || "").slice(0, 200)}`)
      }
    }

    return NextResponse.json({ success: true, stored: true, filtered: "cleaner_phone", intent })
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

  // Track retargeting reply: if customer has active sequence and hasn't replied yet, mark first reply
  if (customer?.retargeting_sequence && !customer?.retargeting_completed_at && !customer?.retargeting_replied_at) {
    await client
      .from("customers")
      .update({ retargeting_replied_at: new Date().toISOString() })
      .eq("id", customer.id)
      .is("retargeting_replied_at", null)
    console.log(`[OpenPhone] Marked retargeting reply for customer ${customer.id}`)
  }

  // ============================================
  // LIFECYCLE REPLY HANDLERS
  // Intercept inbound SMS for post-job satisfaction & recurring replies.
  // Also cancel any pending mid-convo nudge (customer replied).
  // ============================================
  if (tenant && customer) {
    // Cancel any pending mid-convo nudge
    if (customer.awaiting_reply_since) {
      await client
        .from("customers")
        .update({ awaiting_reply_since: null })
        .eq("id", customer.id)
      await cancelPendingTasks(tenant.id, `mid-convo-nudge-${customer.id}`)
    }

    const inboundContent = extracted.content || ""

    // POST-JOB SATISFACTION REPLY
    if (customer.post_job_stage === "satisfaction_sent") {
      const sentiment = analyzeSimpleSentiment(inboundContent)
      console.log(`[OpenPhone] Post-job satisfaction reply from customer ${customer.id}: sentiment=${sentiment}`)

      // Find the most recent completed job for this customer
      const { data: recentJob } = await client
        .from("jobs")
        .select("id, satisfaction_sent_at")
        .eq("customer_id", customer.id)
        .eq("tenant_id", tenant.id)
        .eq("status", "completed")
        .not("satisfaction_sent_at", "is", null)
        .order("satisfaction_sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (recentJob) {
        if (sentiment === "positive") {
          // Immediately send review link + recurring offer (no tip — strike while iron is hot)
          const reviewLink = tenant.google_review_link || "https://g.page/review"

          const recurringDiscount = tenant.workflow_config?.monthly_followup_discount || '15%'
          const replyMsg = `That's wonderful to hear! We'd really appreciate a quick review — it means a lot to us: ${reviewLink}\n\nBy the way, a lot of our customers love setting up recurring cleanings — you'd get ${recurringDiscount} off every visit and never have to think about scheduling. Would that be something you'd be interested in?`
          await sendSMS(tenant, phone, replyMsg)

          // Save outbound message
          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: replyMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "post_job_satisfaction_positive",
          })

          await client.from("customers").update({
            post_job_stage: "recurring_offered",
            post_job_stage_updated_at: new Date().toISOString(),
          }).eq("id", customer.id)

          await client.from("jobs").update({
            satisfaction_response: "positive",
            review_sent_at: new Date().toISOString(),
            recurring_offered_at: new Date().toISOString(),
          }).eq("id", recentJob.id)

          // Cancel 24hr timeout (no need for delayed recurring — already offered)
          await cancelTask(`post-job-review-${recentJob.id}`)

          await recordMessageSent(tenant.id, customer.id, phone, "post_job_satisfaction_positive", "post_job")

        } else if (sentiment === "negative") {
          // Apology — NO review link
          const apologyMsg = `We're really sorry to hear that. We want to make it right — someone from our team will reach out to you personally. Thank you for letting us know.`
          await sendSMS(tenant, phone, apologyMsg)

          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: apologyMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "post_job_satisfaction_negative",
          })

          await client.from("customers").update({
            post_job_stage: "negative_reply",
            post_job_stage_updated_at: new Date().toISOString(),
          }).eq("id", customer.id)

          await client.from("jobs").update({
            satisfaction_response: "negative",
          }).eq("id", recentJob.id)

          // Cancel all post-job tasks
          await cancelTask(`post-job-review-${recentJob.id}`)
          await cancelPendingTasks(tenant.id, `post-job-recurring-${recentJob.id}`)

          // Notify owner via SMS
          try {
            if (tenant.owner_phone) {
              const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || phone
              await sendSMS(
                tenant,
                tenant.owner_phone,
                `Negative Post-Job Feedback\n\nCustomer: ${customerName}\nPhone: ${phone}\nJob #${recentJob.id}\n\nFeedback: "${inboundContent.slice(0, 200)}"\n\nPlease follow up personally.`,
              )
            }
          } catch (smsErr) {
            console.error("[OpenPhone] Failed to send owner alert for negative feedback:", smsErr)
          }

          await recordMessageSent(tenant.id, customer.id, phone, "post_job_satisfaction_negative", "post_job")

        } else {
          // Neutral — don't intercept, let normal flow handle it
          // The 24hr timeout will send the review link
        }

        // For positive/negative, store the inbound message and return early
        if (sentiment !== "neutral") {
          // Store inbound message (it hasn't been stored yet at this point)
          const opMessageId = payload?.data?.object?.id || payload?.data?.id || payload?.id || null
          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "client",
            content: extracted.content,
            direction: extracted.direction || "inbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "openphone",
            metadata: { ...payload, openphone_message_id: opMessageId },
          })

          await logSystemEvent({
            tenant_id: tenant.id,
            source: "openphone",
            event_type: sentiment === "positive" ? "POST_JOB_SATISFACTION_POSITIVE" : "POST_JOB_SATISFACTION_NEGATIVE",
            message: `Customer ${customer.id} replied ${sentiment} to satisfaction check`,
            phone_number: phone,
            metadata: { job_id: recentJob.id, sentiment, reply: inboundContent.slice(0, 200) },
          })

          return NextResponse.json({ success: true, action: `satisfaction_reply_${sentiment}` })
        }
      }
    }

    // POST-JOB RECURRING REPLY — detect clear acceptance or decline.
    // Unclear/conversational replies fall through to the AI so it can sell naturally.
    if (customer.post_job_stage === "recurring_offered") {
      const acceptPattern = /\b(yes|yeah|yep|yup|sure|absolutely|definitely|let'?s do it|sign me up|i'?m interested|i'?d love|sounds good|sounds great|count me in|for sure|please|down|i'?m down)\b/i
      const declinePattern = /\b(no|nah|not right now|not interested|maybe later|pass|i'?m good|no thanks|no thank you)\b/i
      const isAccept = acceptPattern.test(inboundContent)
      const isDecline = declinePattern.test(inboundContent)

      if (isDecline) {
        // Don't intercept — let it fall through to AI which can handle gracefully
        // Just update stage so we stop intercepting future messages
        await client.from("customers").update({
          post_job_stage: "recurring_declined",
          post_job_stage_updated_at: new Date().toISOString(),
        }).eq("id", customer.id)
        // Fall through to normal AI flow
      } else if (isAccept) {
        const customerFirstName = customer.first_name || 'there'
        const confirmMsg = `That's great ${customerFirstName}! Our team will get your next cleaning on the books. They'll text you shortly to get it scheduled!`
        await sendSMS(tenant, phone, confirmMsg)

        await client.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: customer.id,
          phone_number: phone,
          role: "assistant",
          content: confirmMsg,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: "recurring_accepted",
        })

        await client.from("customers").update({
          post_job_stage: "recurring_accepted",
          post_job_stage_updated_at: new Date().toISOString(),
        }).eq("id", customer.id)

        // Find the job and mark recurring response
        const { data: jobForRecurring } = await client
          .from("jobs")
          .select("id")
          .eq("customer_id", customer.id)
          .eq("tenant_id", tenant.id)
          .eq("status", "completed")
          .not("recurring_offered_at", "is", null)
          .order("recurring_offered_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (jobForRecurring) {
          await client.from("jobs").update({ recurring_response: "accepted" }).eq("id", jobForRecurring.id)
        }

        await recordMessageSent(tenant.id, customer.id, phone, "recurring_accepted", "post_job")

        // Notify owner via SMS
        try {
          if (tenant.owner_phone) {
            const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ") || phone
            await sendSMS(
              tenant,
              tenant.owner_phone,
              `Recurring Service Accepted\n\nCustomer: ${customerName}\nPhone: ${phone}\n\nPlease set up their recurring schedule.`,
            )
          }
        } catch (smsErr) {
          console.error("[OpenPhone] Failed to send owner alert for recurring acceptance:", smsErr)
        }

        // Store inbound and return
        const opMessageId = payload?.data?.object?.id || payload?.data?.id || payload?.id || null
        await client.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: customer.id,
          phone_number: phone,
          role: "client",
          content: extracted.content,
          direction: extracted.direction || "inbound",
          message_type: "sms",
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: "openphone",
          metadata: { ...payload, openphone_message_id: opMessageId },
        })

        return NextResponse.json({ success: true, action: "recurring_accepted" })
      }
      // If not an accept, fall through to normal processing
    }
  }

  // Per-customer auto-response kill switch
  if (customer?.auto_response_paused === true) {
    console.log(`[OpenPhone] Auto-response paused for customer ${customer.id} (${maskPhone(phone)}) — storing message, skipping AI`)
    await client.from("messages").insert({
      tenant_id: tenant?.id,
      customer_id: customer.id,
      phone_number: phone,
      role: "client",
      content: extracted.content,
      direction: extracted.direction || "inbound",
      message_type: "sms",
      ai_generated: false,
      timestamp: new Date().toISOString(),
      source: "openphone",
      metadata: { ...payload, openphone_message_id: payload?.data?.object?.id || payload?.data?.id || payload?.id || null, filtered: "customer_paused" },
    })
    return NextResponse.json({ success: true, stored: true, filtered: "customer_auto_response_paused" })
  }

  // Extract OpenPhone message ID for dedup (v3: data.object.id, v2: data.id, fallback: root id)
  const opMessageId: string | undefined =
    payload?.data?.object?.id || payload?.data?.id || payload?.id || undefined

  // Dedup: prefer message ID match, fall back to content match with extended window
  const dedupCutoff = new Date(Date.now() - 60_000).toISOString()
  let existingDup = null

  if (opMessageId) {
    // Primary dedup: check for exact OpenPhone message ID in metadata
    const { data: idMatch } = await client
      .from("messages")
      .select("id")
      .eq("tenant_id", tenant?.id)
      .contains("metadata", { openphone_message_id: opMessageId })
      .limit(1)
      .maybeSingle()
    existingDup = idMatch
  }

  if (!existingDup) {
    // Fallback dedup: content + phone + time window (catches cases without message ID)
    const { data: contentMatch } = await client
      .from("messages")
      .select("id")
      .eq("phone_number", phone)
      .eq("tenant_id", tenant?.id)
      .eq("role", "client")
      .eq("content", extracted.content || "")
      .gte("timestamp", dedupCutoff)
      .limit(1)
      .maybeSingle()
    existingDup = contentMatch
  }

  if (existingDup) {
    console.log(`[OpenPhone] Duplicate inbound message detected for ${maskPhone(phone)} (msgId: ${opMessageId || 'none'}), skipping`)
    return NextResponse.json({ success: true, action: "duplicate_webhook_skipped" })
  }

  // Store the inbound message for dashboard display
  // Use external_message_id with unique index to prevent duplicate inserts from racing webhooks
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
    external_message_id: opMessageId || null,
    metadata: { ...payload, openphone_message_id: opMessageId || null },
  }).select("id").single()

  if (msgErr) {
    // Unique constraint violation on external_message_id = duplicate webhook, not an error
    if (msgErr.code === '23505' && opMessageId) {
      console.log(`[OpenPhone] Duplicate insert blocked by unique index for ${maskPhone(phone)} (msgId: ${opMessageId})`)
      return NextResponse.json({ success: true, action: "duplicate_insert_blocked" })
    }
    return NextResponse.json({ success: false, error: `Failed to insert message: ${msgErr.message}` }, { status: 500 })
  }

  const currentMsgId = insertedMsg?.id

  // ============================================
  // AI Intent Analysis for Lead Creation
  // ============================================
  const messageContent = extracted.content || ""

  // ============================================
  // MEMBERSHIP RENEWAL REPLY HANDLER
  // Intercept RENEW/CANCEL from customers with pending renewal questions.
  // Must run before AI intent analysis to prevent false positives.
  // ============================================
  if (tenant && customer) {
    const normalizedReply = messageContent.trim().toUpperCase()
    // Only match explicit RENEW/CANCEL keywords — avoid intercepting YES/NO
    // which could be replies to booking questions
    const isRenewalReply = /^(RENEW|CANCEL)$/i.test(normalizedReply)

    if (isRenewalReply) {
      try {
        // Check if this customer has a pending renewal question
        const { data: pendingMembership } = await client
          .from("customer_memberships")
          .select(`
            id, customer_id, renewal_asked_at, renewal_choice,
            service_plans!inner( name, slug )
          `)
          .eq("tenant_id", tenant.id)
          .eq("customer_id", customer.id)
          .eq("status", "active")
          .not("renewal_asked_at", "is", null)
          .is("renewal_choice", null)
          .limit(1)
          .maybeSingle()

        if (pendingMembership) {
          const plan = pendingMembership.service_plans as any
          const isRenew = normalizedReply === "RENEW"
          const choice = isRenew ? "renew" : "cancel"

          // Record the customer's choice — return updated row to verify it was actually changed
          const { data: updatedRows, error: updateErr } = await client
            .from("customer_memberships")
            .update({
              renewal_choice: choice,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pendingMembership.id)
            .eq("status", "active")
            .is("renewal_choice", null) // Atomic: only set if not already set
            .select("id")

          if (!updateErr && updatedRows && updatedRows.length > 0) {
            const businessName = (tenant as any).business_name_short || (tenant as any).business_name || (tenant as any).name || 'us'

            // Confirm to customer
            const confirmMsg = isRenew
              ? `Great! Your ${plan.name} membership with ${businessName} will renew after your final visit. Thank you!`
              : `Got it. Your ${plan.name} membership with ${businessName} will end after your final visit. Thank you for being a member!`
            await sendSMS(tenant, phone, confirmMsg)

            // Notify tenant owner via SMS
            if (tenant.owner_phone) {
              const customerName = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || phone
              await sendSMS(
                tenant,
                tenant.owner_phone,
                `Membership ${isRenew ? 'Renewal Confirmed' : 'Cancellation'}\n\nCustomer: ${customerName}\nPlan: ${plan.name}\nChoice: ${choice.toUpperCase()}`,
              )
            }

            // Log system event
            await logSystemEvent({
              tenant_id: tenant.id,
              source: "openphone",
              event_type: isRenew ? "MEMBERSHIP_RENEWAL_CONFIRMED" : "MEMBERSHIP_RENEWAL_DECLINED",
              message: `Customer replied "${normalizedReply}" to renewal SMS for membership ${pendingMembership.id}`,
              phone_number: phone,
              metadata: {
                membership_id: pendingMembership.id,
                plan_slug: plan.slug,
                renewal_choice: choice,
                raw_reply: messageContent,
              },
            })

            console.log(`[OpenPhone] Membership renewal reply processed: ${choice} for membership ${pendingMembership.id}`)
            return NextResponse.json({ success: true, action: "membership_renewal_reply", choice })
          }
        }
      } catch (err) {
        console.error("[OpenPhone] Membership renewal reply handler error:", err)
        // Fall through to normal processing if handler fails
      }
    }
  }

  // ============================================
  // RECURRING INTENT DETECTION (cleaning tenants only)
  // Detect "weekly", "bi-weekly", "every Monday" etc. and persist preference
  // ============================================
  if (tenant?.slug === "spotless-scrubbers" || tenant?.slug === "cedar-rapids") {
    try {
      const { detectRecurringIntent } = await import("@/lib/recurring-detection")
      const recurringIntent = detectRecurringIntent(messageContent)
      if (recurringIntent.frequency) {
        const updates: Record<string, unknown> = {
          preferred_frequency: recurringIntent.frequency,
          recurring_notes: `[Auto-detected ${new Date().toISOString().split("T")[0]}]: wants ${recurringIntent.frequency} cleaning${recurringIntent.preferredDay ? ` on ${recurringIntent.preferredDay}` : ""}`,
        }
        if (recurringIntent.preferredDay) {
          updates.preferred_day = recurringIntent.preferredDay
        }
        await client.from("customers").update(updates).eq("id", customer.id)
        console.log(`[OpenPhone] Recurring intent detected for customer ${customer.id}: ${recurringIntent.frequency}${recurringIntent.preferredDay ? ` (${recurringIntent.preferredDay})` : ""}`)
      }
    } catch (err) {
      console.error("[OpenPhone] Recurring detection error:", err)
    }
  }

  // Quick check - skip obvious non-booking messages (don't waste the debounce delay)
  if (isObviouslyNotBooking(messageContent)) {
    console.log(`[OpenPhone] Message is obviously not booking intent (length=${messageContent.length})`)
    return NextResponse.json({ success: true, intentAnalysis: "skipped" })
  }

  // ============================================
  // DEBOUNCE: Wait for additional messages to arrive
  // This prevents sending multiple responses when a customer
  // sends several texts in quick succession (e.g. "Yup" then email)
  // ============================================
  const RESPONSE_DELAY_MS = Number(process.env.SMS_RESPONSE_DELAY_MS || '8000')
  if (RESPONSE_DELAY_MS > 0) {
    console.log(`[OpenPhone] Waiting ${RESPONSE_DELAY_MS}ms for additional messages from ${maskPhone(phone)}...`)
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

  // Double-guard: check if another webhook already sent an AI response AFTER this inbound message
  // This prevents duplicate responses from race conditions, but allows legitimate conversation
  // continuations (customer replies quickly after bot response)
  const { data: recentOutbound } = await client
    .from("messages")
    .select("id")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .eq("role", "assistant")
    .eq("ai_generated", true)
    .gte("timestamp", receivedAt)
    .limit(1)

  if (recentOutbound && recentOutbound.length > 0) {
    console.log(`[OpenPhone] AI response already sent after this inbound message, skipping duplicate`)
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

  // Get recent conversation history for context
  // Needs to be large enough to capture the full booking conversation (name, address, service type
  // are provided early but extractBookingData runs at the end after 15-20+ messages)
  const { data: recentMessages } = await client
    .from("messages")
    .select("role, content")
    .eq("phone_number", phone)
    .eq("tenant_id", tenant?.id)
    .order("timestamp", { ascending: false })
    .limit(30)

  const conversationHistory = recentMessages?.reverse().map(m => ({
    role: m.role as 'client' | 'assistant',
    content: m.content
  })) || []

  // ============================================
  // SEASONAL REPLY DETECTION: Check if customer is replying to a seasonal campaign
  // If so, flag them as a returning customer for warmer AI treatment
  // ============================================
  const seasonalCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: recentSeasonal } = await client
    .from('messages')
    .select('id, metadata')
    .eq('phone_number', phone)
    .eq('tenant_id', tenant?.id)
    .eq('source', 'seasonal_reminder')
    .gte('timestamp', seasonalCutoff)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  const isSeasonalReply = !!recentSeasonal
  if (isSeasonalReply) {
    console.log(`[OpenPhone] Customer ${maskPhone(phone)} is replying to a seasonal reminder campaign`)
  }

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
      console.log(`[OpenPhone] Found VAPI booking confirmation for ${maskPhone(phone)}, looking for phone-source lead`)
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

    // Dedup: if payment links were already sent, skip email capture even if combinedMessage still contains the email
    const { data: emailCaptureDedupCheck } = await client
      .from("messages")
      .select("id")
      .eq("phone_number", phone)
      .eq("tenant_id", tenant?.id)
      .in("source", ["card_on_file", "deposit", "invoice"])
      .limit(1)
      .maybeSingle()

    if (providedEmail && !emailCaptureDedupCheck) {
      console.log(`[OpenPhone] Email captured from booked customer: ${maskEmail(providedEmail)}`)

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

      const jobId = job?.id || bookedLead.converted_to_job_id || null

      // WinBros estimate jobs: NO payment link — send confirmation + assign salesman
      if (job?.job_type === 'estimate' && tenant) {
        // Dedup guard: skip if salesman already assigned to this job
        const { data: existingAssignment } = await client
          .from("cleaner_assignments")
          .select("id")
          .eq("job_id", job.id)
          .not("status", "in", '("cancelled","declined")')
          .limit(1)
          .maybeSingle()

        if (existingAssignment) {
          console.log(`[OpenPhone] Estimate job ${jobId} already has assignment ${existingAssignment.id} — skipping duplicate`)
          return NextResponse.json({ success: true, flow: "phone_call_estimate_already_confirmed", leadId: bookedLead.id })
        }

        console.log(`[OpenPhone] Estimate job ${jobId} — sending confirmation and assigning salesman (no payment link)`)

        // Save email to lead form_data
        await client
          .from("leads")
          .update({
            form_data: {
              ...parseFormData(bookedLead.form_data),
              email: providedEmail,
            },
          })
          .eq("id", bookedLead.id)

        // Send confirmation message to customer
        const customerFirst = customer.first_name || 'there'
        const tz = tenant.timezone || 'America/Chicago'
        const jobDateTime = job.scheduled_at
          ? formatDateHuman(job.scheduled_at, tz)
          : job.date
            ? formatDateHuman(job.date, tz)
            : 'your requested date'
        const jobAddress = job.address || customer.address || 'your address'
        const confirmMsg = `You're all confirmed, ${customerFirst}! Your free estimate is set for ${jobDateTime} at ${jobAddress}. A team member will visit to provide your on-site quote. We'll see you then!`

        const smsResult = await sendSMS(tenant, phone, confirmMsg)

        if (smsResult.success) {
          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: confirmMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "estimate_booked",
          })
        }

        // Route optimize and assign salesman
        try {
          if (job.date) {
            const { optimizeRoutesIncremental } = await import("@/lib/route-optimizer")
            const { dispatchRoutes } = await import("@/lib/dispatch")
            const { optimization, assignedTeamId, assignedLeadId } =
              await optimizeRoutesIncremental(Number(jobId), job.date, tenant.id, 'salesman')

            if (assignedTeamId) {
              await dispatchRoutes(optimization, tenant.id, {
                sendTelegramToTeams: false,
                sendSmsToCustomers: false,
                sendOwnerSummary: false,
              })

              // Notify assigned salesman via SMS
              if (assignedLeadId) {
                const { data: salesman } = await client
                  .from('cleaners')
                  .select('phone, name, portal_token')
                  .eq('id', assignedLeadId)
                  .maybeSingle()
                if (salesman?.phone) {
                  const custName = customer?.first_name || 'Customer'
                  const salesmanMsg = `New Estimate Assigned - ${tenant.name || 'WinBros'}\n\nCustomer: ${custName}\nService: ${job.service_type || 'Window Cleaning'}\nAddress: ${jobAddress}\nDate: ${job.date || 'TBD'} at ${job.scheduled_at || 'TBD'}\n\nPlease visit the customer to provide an on-site quote.`
                  await sendSMS(tenant, salesman.phone, salesmanMsg)
                  console.log(`[OpenPhone] SMS sent to salesman for estimate job ${jobId}`)
                }
              }
            } else {
              console.warn(`[OpenPhone] No salesman available for estimate job ${jobId} on ${job.date}`)
            }
          }
        } catch (estimateErr) {
          console.error("[OpenPhone] Failed to assign salesman for estimate:", estimateErr)
        }

        // Move lead out of "booked" so subsequent messages don't re-trigger this flow
        await client
          .from("leads")
          .update({ status: "assigned" })
          .eq("id", bookedLead.id)

        await logSystemEvent({
          tenant_id: tenant.id,
          source: "openphone",
          event_type: "SMS_ESTIMATE_BOOKED",
          message: `Estimate confirmed for ${phone} — job ${jobId}, salesman assignment triggered`,
          phone_number: phone,
          metadata: { lead_id: bookedLead.id, job_id: jobId, email: providedEmail },
        })

        return NextResponse.json({ success: true, flow: "phone_call_estimate_confirmed", leadId: bookedLead.id })
      }

      // ──────────────────────────────────────────────────────────────────────
      // TENANT ISOLATION — PAYMENT FLOW AFTER EMAIL CAPTURE:
      // WinBros (use_team_routing=true): Skip deposit, card-on-file only
      // Cedar Rapids (use_team_routing=false): Invoice (Stripe or Wave) + Stripe deposit link
      //   → Customer pays deposit → Stripe webhook → cleaner broadcast assignment
      // Do NOT change the deposit flow without testing Cedar Rapids end-to-end.
      // ──────────────────────────────────────────────────────────────────────
      const isWinBros = tenant ? tenantUsesFeature(tenant, 'use_team_routing') : false

      // Non-WinBros: Invoice (Stripe or Wave) + Stripe deposit link flow (house cleaning)
      if (!isWinBros && tenant) {
        let phoneCallServicePrice = job?.price || job?.estimated_value || null
        const depositFlowResult = await sendDepositPaymentFlow({
          tenant,
          phone,
          email: providedEmail,
          customer,
          job,
          jobId,
          leadId: bookedLead.id,
          servicePrice: phoneCallServicePrice,
          client,
        })
        if (depositFlowResult.success) {
          return NextResponse.json({ success: true, flow: "phone_call_deposit_flow", leadId: bookedLead.id })
        }
        // If deposit flow failed, fall through to card-on-file as fallback
      }

      // WinBros (or fallback): Send card-on-file link
      try {
        const { createCardOnFileLink } = await import("@/lib/stripe-client")
        if (!tenant?.stripe_secret_key) {
          console.error(`[OpenPhone] Tenant ${tenant?.slug || 'unknown'} has no stripe_secret_key — cannot create card-on-file link`)
          throw new Error('Tenant has no Stripe key')
        }
        const cardResult = await createCardOnFileLink(
          { ...customer, email: providedEmail } as any,
          jobId || `lead-${bookedLead.id}`,
          tenant.id,
          tenant.stripe_secret_key,
        )

        if (cardResult.success && cardResult.url) {
          // Determine service price
          let servicePrice: number | null = null
          if (tenant && tenantUsesFeature(tenant, 'use_hcp_mirror')) {
            // Window cleaning tenants: ALWAYS use pricebook — never trust job.price or AI-extracted prices
            try {
              const { lookupPrice } = await import("@/lib/pricebook")
              const { parseFormData } = await import("@/lib/utils")
              const formData = parseFormData((bookedLead as any)?.form_data)
              const scope = (formData.scope as string) || null
              const lookupInput = {
                serviceType: (formData.serviceType as string) || job?.service_type || null,
                squareFootage: (formData.squareFootage as number) || job?.square_footage || null,
                scope: scope || null,
                pressureWashingSurfaces: (formData.pressureWashingSurfaces as string[]) || null,
                propertyType: (formData.propertyType as string) || null,
              }
              console.log(`[OpenPhone] Pricebook lookup inputs (phone call): service=${lookupInput.serviceType}, sqft=${lookupInput.squareFootage || 'none'}`)
              const priceLookup = lookupPrice(lookupInput)
              if (priceLookup) {
                servicePrice = priceLookup.price
                console.log(`[OpenPhone] Pricebook result: ${priceLookup.serviceName} ${priceLookup.tier ? `(${priceLookup.tier})` : ""} = $${priceLookup.price}`)
              } else {
                console.warn(`[OpenPhone] Pricebook returned null — no price will be shown`)
              }
            } catch (pbErr) {
              console.error("[OpenPhone] Pricebook lookup error:", pbErr)
            }
          } else {
            // Non-WinBros: use job price
            servicePrice = job?.price || job?.estimated_value || null
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
            console.log(`[OpenPhone] Card-on-file link sent to ${maskPhone(phone)}`)
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
                tenant: tenant as any,
              })
              console.log(`[OpenPhone] Confirmation email sent to ${maskEmail(providedEmail)}`)
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
      // Check if payment/invoice links were already sent for this booking
      const { data: existingPayment } = await client
        .from("messages")
        .select("id")
        .eq("phone_number", phone)
        .eq("tenant_id", tenant?.id)
        .in("source", ["card_on_file", "deposit", "invoice"])
        .limit(1)
        .maybeSingle()

      if (existingPayment) {
        // Payment links already sent — respond naturally (NOT the booking flow prompt)
        console.log(`[OpenPhone] Booked lead ${bookedLead.id} has payment links sent, using post-booking AI`)
        const businessName = tenant?.business_name_short || tenant?.business_name || tenant?.name || 'our team'
        const sdrName = tenant?.sdr_persona || 'Mary'
        const historyCtx = conversationHistory.slice(-6).map(m =>
          `${m.role === 'client' ? 'Customer' : sdrName}: ${m.content}`
        ).join('\n')

        // Load customer + job + lead data so the AI can answer questions about their booking
        const customerName = customer.first_name || 'the customer'
        const ctxTz = tenant?.timezone || 'America/Chicago'
        let jobCtx = ''
        if (bookedLead.converted_to_job_id) {
          const { data: jobData } = await client
            .from("jobs")
            .select("service_type, date, scheduled_at, price, address, notes, status")
            .eq("id", bookedLead.converted_to_job_id)
            .maybeSingle()
          if (jobData) {
            const parts = [
              jobData.service_type ? `Service: ${jobData.service_type.replace(/_/g, ' ')}` : null,
              jobData.date ? `Date: ${formatDateHuman(jobData.date, ctxTz)}` : null,
              jobData.scheduled_at ? `Time: ${formatDateHuman(jobData.scheduled_at, ctxTz)}` : null,
              jobData.price ? `Price: $${jobData.price}` : null,
              jobData.address ? `Address: ${jobData.address}` : null,
              jobData.notes ? `Notes: ${jobData.notes}` : null,
              jobData.status ? `Status: ${jobData.status}` : null,
            ].filter(Boolean)
            jobCtx = `\n\nBooking details:\n${parts.join('\n')}`
          }
        }

        // Load lead form_data — this has sqft, scope, booking_data etc.
        const leadFormData = parseFormData(bookedLead.form_data)
        const bookingData = leadFormData.booking_data as Record<string, any> || {}

        const customerCtx = [
          customer.first_name ? `First name: ${customer.first_name}` : null,
          customer.email ? `Email: ${customer.email}` : null,
          customer.address ? `Address: ${customer.address}` : null,
          leadFormData.square_footage ? `Square footage: ${leadFormData.square_footage}` : null,
          leadFormData.exterior_windows !== undefined ? `Exterior windows: ${leadFormData.exterior_windows ? 'Yes' : 'No'}` : null,
          leadFormData.interior_windows !== undefined ? `Interior windows: ${leadFormData.interior_windows ? 'Yes' : 'No'}` : null,
          leadFormData.french_panes !== undefined ? `French panes: ${leadFormData.french_panes ? 'Yes' : 'No'}` : null,
          leadFormData.storm_windows !== undefined ? `Storm windows: ${leadFormData.storm_windows ? 'Yes' : 'No'}` : null,
          leadFormData.frequency ? `Frequency: ${leadFormData.frequency}` : null,
          leadFormData.bedrooms ? `Bedrooms: ${leadFormData.bedrooms}` : null,
          leadFormData.bathrooms ? `Bathrooms: ${leadFormData.bathrooms}` : null,
          bookingData.serviceType ? `Service type: ${bookingData.serviceType}` : null,
          bookingData.scope ? `Scope: ${bookingData.scope}` : null,
          bookingData.planType ? `Plan: ${bookingData.planType}` : null,
          bookingData.preferredDate ? `Preferred date: ${bookingData.preferredDate}` : null,
          bookingData.preferredTime ? `Preferred time: ${bookingData.preferredTime}` : null,
          bookingData.address ? `Cleaning address: ${bookingData.address}` : null,
          bookingData.referralSource ? `Referral: ${bookingData.referralSource}` : null,
        ].filter(Boolean).join('\n')

        try {
          const Anthropic = (await import('@anthropic-ai/sdk')).default
          const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
          const resp = await anthropicClient.messages.create({
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 200,
            system: `You are ${sdrName} from ${businessName}. The customer (${customerName}) has a confirmed booking and has already received their pricing and payment links. Respond naturally and helpfully to their questions. You have access to their account info below — share it if they ask.\n\nCustomer info:\n${customerCtx || 'No additional details on file.'}${jobCtx}\n\nRules:\n- Keep it to 1-3 sentences (this is SMS)\n- Do NOT re-ask booking questions or ask for their email\n- Answer their questions directly and warmly\n- If you don't have the info they're asking about, say so honestly\n- If they say thanks, say you're welcome and let them know to reach out if they need anything\n- Do NOT use emojis unless the customer uses them first\n- Do NOT use markdown formatting`,
            messages: [{ role: 'user', content: `Conversation:\n${historyCtx}\n\nCustomer: "${combinedMessage}"\n\nRespond as ${sdrName}. SMS text only.` }],
          })
          const txt = resp.content.find(b => b.type === 'text')
          const responseText = txt?.type === 'text' ? txt.text.trim() : ''

          if (responseText) {
            const sendResult = await sendSMS(tenant!, phone, responseText)
            if (sendResult.success) {
              await client.from("messages").insert({
                tenant_id: tenant?.id,
                customer_id: customer.id,
                phone_number: phone,
                role: "assistant",
                content: responseText,
                direction: "outbound",
                message_type: "sms",
                ai_generated: true,
                timestamp: new Date().toISOString(),
                source: "openphone",
                metadata: { auto_response: true, booked_lead_id: bookedLead.id, reason: 'post_booking_ai' },
              })
            }
          }
        } catch (err) {
          console.error("[OpenPhone] Post-booking AI response error:", err)
        }

        return NextResponse.json({ success: true, flow: "phone_call_post_booking_ai", leadId: bookedLead.id })
      }

      // No payment links sent yet — ask for email to complete booking
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

          // Sync corrections to HousecallPro
          if (tenant) {
            await syncCustomerToHCP({
              tenantId: tenant.id,
              customerId: customer.id,
              phone,
              firstName: correctedData.firstName,
              lastName: correctedData.lastName,
              address: correctedData.address,
            })
          }
        }
      } catch (extractErr) {
        console.error("[OpenPhone] Error extracting corrections:", extractErr)
      }

      return NextResponse.json({ success: true, flow: "phone_call_confirm", leadId: bookedLead.id })
    }
  }

  // FALLBACK: If bookedLead check didn't catch this but payment links already exist,
  // use post-booking AI instead of the normal SMS bot flow.
  // This prevents the bot from re-running the booking flow on post-booking messages.
  if (smsEnabled) {
    const { data: existingPaymentFallback } = await client
      .from("messages")
      .select("id")
      .eq("phone_number", phone)
      .eq("tenant_id", tenant?.id)
      .in("source", ["card_on_file", "deposit", "invoice", "estimate_booked", "vapi_booking_confirmation"])
      .limit(1)
      .maybeSingle()

    if (existingPaymentFallback) {
      console.log(`[OpenPhone] Fallback post-booking: booking confirmation already sent for ${maskPhone(phone)}, using post-booking AI`)
      const businessName = tenant?.business_name_short || tenant?.business_name || tenant?.name || 'our team'
      const sdrName = tenant?.sdr_persona || 'Mary'
      const customerName = customer.first_name || 'the customer'
      const fbTz = tenant?.timezone || 'America/Chicago'
      const historyCtx = conversationHistory.slice(-6).map(m =>
        `${m.role === 'client' ? 'Customer' : sdrName}: ${m.content}`
      ).join('\n')

      // Load job data for context
      const { data: recentJob } = await client
        .from("jobs")
        .select("service_type, date, scheduled_at, price, address, notes, status")
        .eq("phone_number", phone)
        .eq("tenant_id", tenant?.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      let jobCtx = ''
      if (recentJob) {
        const parts = [
          recentJob.service_type ? `Service: ${recentJob.service_type.replace(/_/g, ' ')}` : null,
          recentJob.date ? `Date: ${formatDateHuman(recentJob.date, fbTz)}` : null,
          recentJob.scheduled_at ? `Time: ${formatDateHuman(recentJob.scheduled_at, fbTz)}` : null,
          recentJob.price ? `Price: $${recentJob.price}` : null,
          recentJob.address ? `Address: ${recentJob.address}` : null,
          recentJob.notes ? `Notes: ${recentJob.notes}` : null,
          recentJob.status ? `Status: ${recentJob.status}` : null,
        ].filter(Boolean)
        jobCtx = `\n\nBooking details:\n${parts.join('\n')}`
      }

      // Load lead form_data — has sqft, scope, booking_data etc. even when jobs table is empty
      const { data: fallbackLead } = await client
        .from("leads")
        .select("id, form_data")
        .eq("phone_number", phone)
        .eq("tenant_id", tenant?.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      const fbFormData = fallbackLead ? parseFormData(fallbackLead.form_data) : {} as Record<string, any>
      const fbBookingData = fbFormData.booking_data as Record<string, any> || {}

      const customerCtx = [
        customer.first_name ? `Name: ${customerName}` : null,
        customer.email ? `Email: ${customer.email}` : null,
        customer.address ? `Address: ${customer.address}` : null,
        fbFormData.square_footage ? `Square footage: ${fbFormData.square_footage}` : null,
        fbFormData.exterior_windows !== undefined ? `Exterior windows: ${fbFormData.exterior_windows ? 'Yes' : 'No'}` : null,
        fbFormData.interior_windows !== undefined ? `Interior windows: ${fbFormData.interior_windows ? 'Yes' : 'No'}` : null,
        fbFormData.french_panes !== undefined ? `French panes: ${fbFormData.french_panes ? 'Yes' : 'No'}` : null,
        fbFormData.storm_windows !== undefined ? `Storm windows: ${fbFormData.storm_windows ? 'Yes' : 'No'}` : null,
        fbFormData.frequency ? `Frequency: ${fbFormData.frequency}` : null,
        fbFormData.bedrooms ? `Bedrooms: ${fbFormData.bedrooms}` : null,
        fbFormData.bathrooms ? `Bathrooms: ${fbFormData.bathrooms}` : null,
        fbBookingData.serviceType ? `Service type: ${fbBookingData.serviceType}` : null,
        fbBookingData.scope ? `Scope: ${fbBookingData.scope}` : null,
        fbBookingData.planType ? `Plan: ${fbBookingData.planType}` : null,
        fbBookingData.preferredDate ? `Preferred date: ${fbBookingData.preferredDate}` : null,
        fbBookingData.preferredTime ? `Preferred time: ${fbBookingData.preferredTime}` : null,
        fbBookingData.address ? `Cleaning address: ${fbBookingData.address}` : null,
        fbBookingData.referralSource ? `Referral: ${fbBookingData.referralSource}` : null,
      ].filter(Boolean).join('\n')

      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
        const resp = await anthropicClient.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 200,
          system: `You are ${sdrName} from ${businessName}. The customer (${customerName}) has a confirmed booking. Respond naturally and helpfully to their questions. You have access to their account info below — share it if they ask.\n\nCustomer info:\n${customerCtx || 'No additional details on file.'}${jobCtx}\n\nRules:\n- Keep it to 1-3 sentences (this is SMS)\n- Do NOT re-ask booking questions or ask for their email\n- Answer their questions directly and warmly\n- For estimate appointments: pricing is determined on-site by the team member who visits. If the customer asks about price, explain that a team member will provide an on-site quote at their appointment.\n- If you don't have the info they're asking about, say so honestly\n- If they say thanks, say you're welcome and let them know to reach out if they need anything\n- Do NOT use emojis unless the customer uses them first\n- Do NOT use markdown formatting`,
          messages: [{ role: 'user', content: `Conversation:\n${historyCtx}\n\nCustomer: "${combinedMessage}"\n\nRespond as ${sdrName}. SMS text only.` }],
        })
        const txt = resp.content.find(b => b.type === 'text')
        const responseText = txt?.type === 'text' ? txt.text.trim() : ''

        if (responseText) {
          const sendResult = await sendSMS(tenant!, phone, responseText)
          if (sendResult.success) {
            await client.from("messages").insert({
              tenant_id: tenant?.id,
              customer_id: customer.id,
              phone_number: phone,
              role: "assistant",
              content: responseText,
              direction: "outbound",
              message_type: "sms",
              ai_generated: true,
              timestamp: new Date().toISOString(),
              source: "openphone",
              metadata: { auto_response: true, reason: 'fallback_post_booking_ai' },
            })
          }
        }
      } catch (err) {
        console.error("[OpenPhone] Fallback post-booking AI error:", err)
      }

      return NextResponse.json({ success: true, flow: "fallback_post_booking_ai" })
    }
  }

  // ============================================
  // STAGE 1.5: ASSIGNED LEAD — Post-booking corrections & questions
  // Customer already has a booking assigned (salesman dispatched / cleaner confirmed).
  // Handle info corrections (address, name, time), questions about their appointment,
  // and general conversation. Do NOT re-trigger booking flow or create a new lead.
  // ============================================
  if (smsEnabled && tenant?.id) {
    const { data: assignedLeads } = await client
      .from("leads")
      .select("id, status, form_data, converted_to_job_id, source")
      .eq("phone_number", phone)
      .eq("tenant_id", tenant.id)
      .in("status", ["assigned", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(1)

    const assignedLead = assignedLeads?.[0] ?? null

    if (assignedLead) {
      console.log(`[OpenPhone] Assigned lead ${assignedLead.id} found for ${maskPhone(phone)}, handling post-booking message`)

      // Update last contact time
      await client
        .from("leads")
        .update({ last_contact_at: new Date().toISOString() })
        .eq("id", assignedLead.id)
        .eq("tenant_id", tenant.id)

      // Check if auto-response is paused for this lead
      const assignedFormData = parseFormData(assignedLead.form_data)
      if (assignedFormData.followup_paused === true) {
        console.log(`[OpenPhone] Auto-response paused for assigned lead ${assignedLead.id}, skipping`)
        return NextResponse.json({ success: true, autoResponsePaused: true, leadId: assignedLead.id })
      }

      // Load the linked job
      let assignedJob: any = null
      if (assignedLead.converted_to_job_id) {
        const { data: jobData } = await client
          .from("jobs")
          .select("*")
          .eq("id", assignedLead.converted_to_job_id)
          .maybeSingle()
        assignedJob = jobData
      }

      // Fallback: find most recent scheduled/in_progress job for this phone
      if (!assignedJob) {
        const { data: recentJob } = await client
          .from("jobs")
          .select("*")
          .eq("phone_number", phone)
          .eq("tenant_id", tenant.id)
          .in("status", ["scheduled", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        assignedJob = recentJob
      }

      // Load customer context for AI (active bookings, service history)
      let postBookingCtx = null
      try {
        postBookingCtx = await loadCustomerContext(client, tenant.id, phone, customer?.id)
      } catch (err) {
        console.error('[OpenPhone] Failed to load customer context for assigned lead:', err)
      }

      // Build known customer info for the AI
      const knownInfo: KnownCustomerInfo = {
        firstName: customer.first_name || null,
        lastName: customer.last_name || null,
        address: customer.address || assignedJob?.address || null,
        email: customer.email || null,
        phone: phone,
        source: assignedLead.source || null,
      }

      // Generate AI response with full booking context
      const quickIntent = await analyzeBookingIntent(combinedMessage, conversationHistory)
      const autoResponse = await generateAutoResponse(
        combinedMessage,
        quickIntent,
        tenant,
        conversationHistory,
        knownInfo,
        { isReturningCustomer: false, customerContext: postBookingCtx }
      )

      // Send AI response (strip [BOOKING_COMPLETE] — never re-trigger for assigned leads)
      if (autoResponse.shouldSend && autoResponse.response) {
        const cleanedResponse = autoResponse.response
          .replace(/\[BOOKING_COMPLETE\]/gi, '')
          .replace(/\[BOOKING_COMPLETE:[^\]]*\]/gi, '')
          .trim()

        if (cleanedResponse) {
          const sendResult = await sendMultiPartSMS(tenant, phone, cleanedResponse, client, customer.id, {
            auto_response: true,
            assigned_lead_id: assignedLead.id,
            job_id: assignedJob?.id || null,
            reason: "post_booking_assigned",
          })

          if (sendResult.success) {
            // Schedule mid-convo nudge (5 min)
            await client.from("customers").update({ awaiting_reply_since: new Date().toISOString() }).eq("id", customer.id)
            await scheduleTask({
              tenantId: tenant.id,
              taskType: "mid_convo_nudge",
              taskKey: `mid-convo-nudge-${customer.id}`,
              scheduledFor: new Date(Date.now() + 5 * 60 * 1000),
              payload: { customerId: customer.id, customerPhone: phone, tenantId: tenant.id },
            })
          }
        }
      }

      // Extract corrections from conversation (address, name, email, date/time)
      try {
        const isWindowCleaningTenant = tenantUsesFeature(tenant, 'use_hcp_mirror')
        let correctedData: any = {}

        if (isWindowCleaningTenant) {
          const { extractBookingData } = await import("@/lib/winbros-sms-prompt")
          correctedData = await extractBookingData(conversationHistory)
        } else {
          const { extractHouseCleaningBookingData } = await import("@/lib/house-cleaning-sms-prompt")
          correctedData = await extractHouseCleaningBookingData(conversationHistory)
        }

        // Build update payloads only for fields that changed
        const customerUpdates: Record<string, string | null> = {}
        if (correctedData.firstName && correctedData.firstName !== customer.first_name) {
          customerUpdates.first_name = correctedData.firstName
        }
        if (correctedData.lastName && correctedData.lastName !== customer.last_name) {
          customerUpdates.last_name = correctedData.lastName
        }
        if (correctedData.address && correctedData.address !== customer.address) {
          customerUpdates.address = correctedData.address
        }
        if (correctedData.email && correctedData.email !== customer.email) {
          customerUpdates.email = correctedData.email
        }

        // Update customer record
        const hasCustomerChanges = Object.keys(customerUpdates).length > 0
        if (hasCustomerChanges) {
          await client.from("customers").update(customerUpdates).eq("id", customer.id)
          console.log(`[OpenPhone] Updated customer ${customer.id} with corrections:`, Object.keys(customerUpdates))
        }

        // Always sync customer corrections to HCP (regardless of job existence)
        if (hasCustomerChanges) {
          try {
            const syncFirstName = correctedData.firstName || customer.first_name
            const syncLastName = correctedData.lastName || customer.last_name
            console.log(`[OpenPhone] Pushing customer correction to HCP: firstName=${syncFirstName}, lastName=${syncLastName}`)
            await syncCustomerToHCP({
              tenantId: tenant.id,
              customerId: customer.id,
              phone,
              firstName: syncFirstName,
              lastName: syncLastName,
              email: correctedData.email || customer.email,
              address: correctedData.address || customer.address,
            })
          } catch (syncErr) {
            console.error(`[OpenPhone] HCP customer sync failed for corrections:`, syncErr)
          }
        }

        // Update job record (address, date, time)
        if (assignedJob) {
          const jobUpdates: Record<string, string | null> = {}
          if (correctedData.address && correctedData.address !== assignedJob.address) {
            jobUpdates.address = correctedData.address
          }
          if (correctedData.preferredDate && correctedData.preferredDate !== assignedJob.date) {
            jobUpdates.date = correctedData.preferredDate
          }
          if (correctedData.preferredTime && correctedData.preferredTime !== assignedJob.scheduled_at) {
            jobUpdates.scheduled_at = correctedData.preferredTime
          }

          if (Object.keys(jobUpdates).length > 0) {
            await client.from("jobs").update(jobUpdates).eq("id", assignedJob.id)
            console.log(`[OpenPhone] Updated job ${assignedJob.id} with corrections:`, Object.keys(jobUpdates))
          }

          // Always sync job to HCP — catches both corrections AND missing initial sync.
          // If the job already exists in HCP, syncNewJobToHCP updates it; otherwise creates it.
          const needsHcpSync = Object.keys(jobUpdates).length > 0 || !assignedJob.housecall_pro_job_id || hasCustomerChanges
          if (needsHcpSync) {
            try {
              console.log(`[OpenPhone] Syncing job ${assignedJob.id} to HCP (hcp_job_id=${assignedJob.housecall_pro_job_id || 'NONE'}, jobUpdates=${Object.keys(jobUpdates).length}, customerChanges=${hasCustomerChanges})`)
              await syncNewJobToHCP({
                tenant,
                jobId: assignedJob.id,
                phone,
                firstName: correctedData.firstName || customer.first_name,
                lastName: correctedData.lastName || customer.last_name,
                email: correctedData.email || customer.email,
                address: correctedData.address || assignedJob.address,
                serviceType: assignedJob.service_type,
                scheduledDate: correctedData.preferredDate || assignedJob.date,
                scheduledTime: correctedData.preferredTime || assignedJob.scheduled_at,
                price: assignedJob.price,
                notes: assignedJob.notes,
                source: 'sms_correction',
                isEstimate: assignedJob.job_type === 'estimate',
              })
              console.log(`[OpenPhone] Synced job ${assignedJob.id} to HCP`)
            } catch (syncErr) {
              console.error(`[OpenPhone] HCP job sync failed for job ${assignedJob.id}:`, syncErr)
            }
          }
        }
      } catch (extractErr) {
        console.error("[OpenPhone] Error extracting corrections for assigned lead:", extractErr)
      }

      // Handle escalation if AI flagged it (cancel requests, complaints)
      if (autoResponse.escalation?.shouldEscalate && tenant.owner_phone) {
        try {
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
            const fullTranscript = [
              ...conversationHistory,
              { role: 'assistant' as const, content: autoResponse.response || '' },
            ]
            const ownerMsg = buildOwnerEscalationMessage(
              phone,
              customerName,
              autoResponse.escalation.reasons,
              fullTranscript
            )
            const escSendResult = await sendSMS(tenant, tenant.owner_phone, ownerMsg)

            if (escSendResult.success) {
              await logSystemEvent({
                tenant_id: tenant.id,
                source: "openphone",
                event_type: "LEAD_ESCALATED",
                message: `Assigned lead ${assignedLead.id} escalated: ${autoResponse.escalation.reasons.join(", ")}`,
                phone_number: phone,
                metadata: { lead_id: assignedLead.id, job_id: assignedJob?.id, reasons: autoResponse.escalation.reasons },
              })

              await client
                .from("leads")
                .update({
                  status: "escalated",
                  form_data: {
                    ...assignedFormData,
                    followup_paused: true,
                    escalation_reasons: autoResponse.escalation.reasons,
                    previous_status: "assigned",
                  },
                })
                .eq("id", assignedLead.id)
                .eq("tenant_id", tenant.id)
            } else {
              console.error(`[OpenPhone] Escalation SMS failed for lead ${assignedLead.id}, NOT pausing auto-response: ${escSendResult.error}`)
            }
          }
        } catch (escErr) {
          console.error("[OpenPhone] Failed to send escalation for assigned lead:", escErr)
        }
      }

      await logSystemEvent({
        tenant_id: tenant.id,
        source: "openphone",
        event_type: "POST_BOOKING_MESSAGE_HANDLED",
        message: `Post-booking message handled for assigned lead ${assignedLead.id}`,
        phone_number: phone,
        metadata: { lead_id: assignedLead.id, job_id: assignedJob?.id },
      })

      return NextResponse.json({
        success: true,
        flow: "assigned_lead_post_booking",
        leadId: assignedLead.id,
        jobId: assignedJob?.id || null,
      })
    }
  }

  // ============================================
  // LOAD CUSTOMER CONTEXT for AI situation awareness
  // Active jobs, service history, profile — so the AI knows who's texting
  // ============================================
  let customerCtx = null
  if (smsEnabled && tenant?.id) {
    try {
      customerCtx = await loadCustomerContext(client, tenant.id, phone, customer?.id)
    } catch (err) {
      console.error('[OpenPhone] Failed to load customer context, proceeding without:', err)
    }
  }

  // Get the MOST RECENT active (non-booked) lead for this phone number
  const { data: allLeadsForPhone } = await client
    .from("leads")
    .select("id, status, form_data, source, followup_stage")
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
      console.log(`[OpenPhone] Auto-response paused for phone ${maskPhone(phone)} (most recent lead ${existingLead.id}), skipping auto-response`)
      return NextResponse.json({ success: true, autoResponsePaused: true, leadId: existingLead.id })
    }
  }

  if (existingLead) {
    // Lead responded — update last_contact_at. If status was "responded", reset to "contacted" so cron keeps running.
    const statusUpdate: Record<string, unknown> = { last_contact_at: new Date().toISOString() }
    if (existingLead.status === "responded") {
      statusUpdate.status = "contacted"
    }
    await client
      .from("leads")
      .update(statusUpdate)
      .eq("id", existingLead.id)

    // Cancel pending CALL follow-up tasks (customer is engaged via SMS — don't call them).
    // Reschedule pending TEXT follow-up tasks 30 min forward (continues SMS conversation).
    try {
      const RESCHEDULE_DELAY_MS = 30 * 60 * 1000
      const now = Date.now()

      const { data: pendingTasks } = await client
        .from("scheduled_tasks")
        .select("id, scheduled_for, task_key, payload")
        .eq("status", "pending")
        .eq("task_type", "lead_followup")
        .eq("tenant_id", tenant?.id)
        .order("scheduled_for", { ascending: true })

      const leadTasks = (pendingTasks || []).filter(
        (t: { id: string; scheduled_for: string; task_key: string; payload: any }) => t.task_key.startsWith(`lead-${existingLead.id}-`)
      )

      // Separate call vs text tasks
      const callTasks = leadTasks.filter((t: { payload: any; task_key: string }) => {
        const action = t.payload?.action
        return action === 'call' || action === 'double_call' || t.task_key.includes('double-call')
      })
      const textTasks = leadTasks.filter((t: { payload: any; task_key: string }) => {
        const action = t.payload?.action
        return action === 'text' && !t.task_key.includes('double-call')
      })

      // Cancel call tasks — customer is already texting, no need to call
      if (callTasks.length > 0) {
        for (const task of callTasks) {
          await client
            .from("scheduled_tasks")
            .update({ status: "cancelled" })
            .eq("id", task.id)
        }
        console.log(`[OpenPhone] Cancelled ${callTasks.length} call follow-up tasks for lead ${existingLead.id} (customer responded via SMS)`)
      }

      // Reschedule text tasks 30 min forward
      if (textTasks.length > 0) {
        const firstMs = new Date(textTasks[0].scheduled_for).getTime()
        const shift = Math.max(0, now + RESCHEDULE_DELAY_MS - firstMs)
        for (const task of textTasks) {
          const newTime = new Date(new Date(task.scheduled_for).getTime() + shift)
          await client
            .from("scheduled_tasks")
            .update({ scheduled_for: newTime.toISOString() })
            .eq("id", task.id)
        }
        console.log(`[OpenPhone] Rescheduled ${textTasks.length} text follow-up tasks 30 min forward for lead ${existingLead.id}`)
      }

      if (leadTasks.length === 0) {
        console.log(`[OpenPhone] Follow-up sequence complete for lead ${existingLead.id}, no tasks to reschedule`)
      }
    } catch (rescheduleErr) {
      console.error("[OpenPhone] Error managing follow-up tasks:", rescheduleErr)
    }

    console.log(`[OpenPhone] Active lead ${existingLead.id} last_contact_at updated for ${maskPhone(phone)}`)

    // Only send auto-response if SMS is enabled for this tenant
    if (smsEnabled) {
      try {
        const quickIntent = await analyzeBookingIntent(combinedMessage, conversationHistory)

        // Build known customer info so the AI can confirm instead of re-asking
        const leadFormData = parseFormData(existingLead.form_data)
        const intentAnalysis = leadFormData.intent_analysis as Record<string, unknown> | undefined
        const extractedInfo = (leadFormData.extracted_info || intentAnalysis?.extractedInfo || {}) as Record<string, unknown>
        const knownInfo: KnownCustomerInfo = {
          firstName: customer.first_name || leadFormData.first_name || null,
          lastName: customer.last_name || leadFormData.last_name || null,
          address: customer.address || leadFormData.address || extractedInfo.address as string || null,
          email: customer.email || leadFormData.email || null,
          phone: phone,
          source: existingLead.source || null,
        }

        const autoResponse = await generateAutoResponse(
          combinedMessage,
          quickIntent,
          tenant,
          conversationHistory,
          knownInfo,
          { isReturningCustomer: isSeasonalReply, customerContext: customerCtx }
        )

        if (autoResponse.shouldSend && (autoResponse.response || autoResponse.bookingComplete)) {
          // Skip sending the AI message if it's just the [BOOKING_COMPLETE] tag —
          // the system sends its own confirmation message with invoice/deposit links
          const cleanedResponse = autoResponse.response.replace(/\[BOOKING_COMPLETE\]/gi, '').trim()

          if (cleanedResponse) {
            console.log(`[OpenPhone] Sending auto-response to existing lead: "${cleanedResponse.slice(0, 50)}..."`)

            const sendResult = await sendMultiPartSMS(tenant!, phone, cleanedResponse, client, customer.id, {
              auto_response: true,
              existing_lead_id: existingLead.id,
              reason: autoResponse.reason,
              combined_message: combinedMessage,
            })

            if (!sendResult.success) {
              console.error(`[OpenPhone] Failed to send auto-response to existing lead`)
              // Schedule a retry in 60 seconds
              await scheduleTask({
                tenantId: tenant?.id,
                taskType: 'sms_retry',
                taskKey: `sms-retry-${phone}-${Date.now()}`,
                scheduledFor: new Date(Date.now() + 60_000),
                payload: { phone, message: cleanedResponse },
                maxAttempts: 2,
              })
            }
          } else {
            console.log(`[OpenPhone] Skipping AI response (booking complete tag only) — system will send confirmation`)
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
                const escSendResult = await sendSMS(tenant, tenant.owner_phone, ownerMsg)

                if (escSendResult.success) {
                  await logSystemEvent({
                    tenant_id: tenant?.id,
                    source: "openphone",
                    event_type: "LEAD_ESCALATED",
                    message: `Lead escalated to owner: ${autoResponse.escalation.reasons.join(", ")}`,
                    phone_number: phone,
                    metadata: { lead_id: existingLead.id, reasons: autoResponse.escalation.reasons },
                  })

                  console.log(`[OpenPhone] Escalation notification sent to owner for ${maskPhone(phone)}: ${autoResponse.escalation.reasons.join(", ")}`)

                  // Only pause auto-response if escalation SMS was actually delivered
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
                    .eq("tenant_id", tenant.id)
                } else {
                  console.error(`[OpenPhone] Escalation SMS failed for lead ${existingLead.id}, NOT pausing auto-response: ${escSendResult.error}`)
                }
              } else {
                console.log(`[OpenPhone] Escalation already sent recently for ${maskPhone(phone)}, skipping duplicate`)
              }
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
                  console.log(`[OpenPhone] Found email in conversation history: ${maskEmail(fallbackEmail)} (from ${msg.role} message)`)
                  break
                }
              }
            }
          }
          const bookingEmail = detectedEmail || fallbackEmail

          if (bookingEmail && autoResponse.bookingComplete) {
            // DEDUP GUARD: Check if payment links were already sent for this phone
            // This prevents duplicate Stripe links from race conditions or re-triggered bookings
            const { data: alreadySentPayment } = await client
              .from("messages")
              .select("id")
              .eq("phone_number", phone)
              .eq("tenant_id", tenant?.id)
              .in("source", ["card_on_file", "deposit", "invoice", "estimate_booked"])
              .limit(1)
              .maybeSingle()

            if (alreadySentPayment) {
              console.log(`[OpenPhone] Payment link already sent for ${maskPhone(phone)}, skipping duplicate booking completion (lead ${existingLead.id})`)
              return NextResponse.json({
                success: true,
                flow: "sms_booking_already_complete",
                existingLeadId: existingLead.id,
              })
            }

            console.log(`[OpenPhone] SMS booking completion: email=${maskEmail(bookingEmail)} (source: ${detectedEmail ? 'message' : 'fallback'}) for lead ${existingLead.id}`)

            try {
              // Save email to customer
              await client
                .from("customers")
                .update({ email: bookingEmail })
                .eq("id", customer.id)

              // Extract all booking data from conversation
              // Use the right extractor based on tenant type
              // Use window cleaning extractor for HCP-mirror tenants (WinBros-style),
              // house cleaning extractor for everyone else
              const isWindowCleaningTenant = tenant ? tenantUsesFeature(tenant, 'use_hcp_mirror') : false
              let bookingData: any

              if (isWindowCleaningTenant) {
                const { extractBookingData } = await import("@/lib/winbros-sms-prompt")
                bookingData = await extractBookingData(conversationHistory)
              } else {
                const { extractHouseCleaningBookingData } = await import("@/lib/house-cleaning-sms-prompt")
                bookingData = await extractHouseCleaningBookingData(conversationHistory)
              }
              console.log(`[OpenPhone] Extracted booking data (${isWindowCleaningTenant ? 'winbros' : 'house_cleaning'}): service=${bookingData.serviceType}, beds=${bookingData.bedrooms}, baths=${bookingData.bathrooms}, date=${bookingData.preferredDate}`)

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

                // Sync customer updates to HousecallPro
                if (tenant) {
                  await syncCustomerToHCP({
                    tenantId: tenant.id,
                    customerId: customer.id,
                    phone,
                    firstName: bookingData.firstName || customer.first_name,
                    lastName: bookingData.lastName || customer.last_name,
                    email: finalEmail,
                    address: bookingData.address || customer.address,
                  })
                }
              }

              // Determine price — WinBros estimate flow skips pricing (salesman handles it on-site)
              let servicePrice: number | null = null
              if (isWindowCleaningTenant) {
                // WinBros estimate flow: no price — salesman will quote on-site
                servicePrice = null
              } else {
                // Look up price from database pricing tiers
                servicePrice = bookingData.price || null
                if (!servicePrice && bookingData.bedrooms && bookingData.bathrooms && tenant?.id) {
                  try {
                    const { getPricingRow } = await import("@/lib/pricing-db")
                    // Map service type: "standard cleaning" → "standard", "deep cleaning" → "deep", etc.
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
                      console.log(`[OpenPhone] Price from DB pricing tier: $${servicePrice} (${pricingTier} ${bookingData.bedrooms}bed/${bookingData.bathrooms}bath/${bookingData.squareFootage || '?'}sqft)`)
                    }
                  } catch (pricingErr) {
                    console.error('[OpenPhone] Failed to look up pricing tier:', pricingErr)
                  }
                }
              }

              // Build job notes with OVERRIDE tags for pricing engine
              const { mergeOverridesIntoNotes } = await import("@/lib/pricing-config")
              const { buildWinBrosJobNotes } = await import("@/lib/winbros-sms-prompt")
              let jobNotes = ''

              if (isWindowCleaningTenant) {
                // WinBros: service-specific notes (window/pressure/gutter)
                jobNotes = buildWinBrosJobNotes(bookingData)
              } else {
                // House cleaning: bed/bath/sqft + pets + frequency
                jobNotes = [
                  bookingData.hasPets ? 'Has pets' : null,
                  bookingData.frequency ? `Frequency: ${bookingData.frequency}` : null,
                ].filter(Boolean).join(' | ') || ''
              }

              // Add OVERRIDE tags for bed/bath/sqft so calculateJobEstimateAsync can find them
              if (bookingData.bedrooms || bookingData.bathrooms || bookingData.squareFootage) {
                jobNotes = mergeOverridesIntoNotes(jobNotes || null, {
                  bedrooms: bookingData.bedrooms || undefined,
                  bathrooms: bookingData.bathrooms || undefined,
                  squareFootage: bookingData.squareFootage || undefined,
                })
              }

              // Default service type based on tenant and booking data
              const defaultServiceType = isWindowCleaningTenant
                ? (bookingData.serviceType?.replace(/_/g, ' ') || 'window cleaning')
                : 'Standard cleaning'

              // Fallback date: if customer didn't provide a specific date, use next business day
              let jobDate = bookingData.preferredDate || null
              if (!jobDate) {
                const now = new Date()
                // Start from tomorrow
                const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
                // Skip weekends (0=Sun, 6=Sat)
                while (candidate.getDay() === 0 || candidate.getDay() === 6) {
                  candidate.setDate(candidate.getDate() + 1)
                }
                jobDate = candidate.toISOString().split('T')[0]
                console.log(`[OpenPhone] No preferred date provided — using next business day: ${jobDate}`)
              }

              // Create job (WinBros: estimate type for salesman visit; others: cleaning)
              const { data: newJob, error: jobError } = await client.from("jobs").insert({
                tenant_id: tenant?.id,
                customer_id: customer.id,
                phone_number: phone,
                service_type: bookingData.serviceType?.replace(/_/g, ' ') || defaultServiceType,
                address: bookingData.address || customer.address || null,
                price: servicePrice || null,
                date: jobDate,
                scheduled_at: bookingData.preferredTime || '09:00',
                status: 'scheduled',
                booked: true,
                notes: jobNotes || null,
                job_type: isWindowCleaningTenant ? 'estimate' : 'cleaning',
              }).select("id").single()

              if (jobError || !newJob?.id) {
                console.error(`[OpenPhone] Job creation failed for ${maskPhone(phone)}:`, jobError || 'no job returned')
                console.error(`[OpenPhone] Insert payload: tenant=${tenant?.id}, customer=${customer.id}, type=${bookingData.serviceType}, date=${bookingData.preferredDate}, price=${servicePrice}`)
                // Don't proceed with Stripe link — we need a valid job first
                return NextResponse.json({
                  success: false,
                  error: "job_creation_failed",
                  flow: "sms_booking_job_error",
                  existingLeadId: existingLead.id,
                  details: jobError?.message || "Job insert returned no data",
                })
              }
              console.log(`[OpenPhone] Job created from SMS booking: ${newJob.id} — service: ${bookingData.serviceType}, date: ${bookingData.preferredDate}, price: $${servicePrice || 'TBD'}`)

              // Sync to HouseCall Pro
              if (tenant) {
                await syncNewJobToHCP({
                  tenant,
                  jobId: newJob.id,
                  phone,
                  firstName: customer.first_name,
                  lastName: customer.last_name,
                  email: finalEmail || customer.email || null,
                  address: bookingData.address || customer.address || null,
                  serviceType: bookingData.serviceType || null,
                  scheduledDate: jobDate,
                  scheduledTime: bookingData.preferredTime || '09:00',
                  price: servicePrice,
                  notes: isWindowCleaningTenant ? 'Estimate Visit | Booked via SMS' : 'Booked via SMS',
                  source: 'sms',
                  isEstimate: isWindowCleaningTenant,
                })
              }

              // Update lead to booked
              await client
                .from("leads")
                .update({
                  status: "booked",
                  converted_to_job_id: newJob.id,
                  form_data: {
                    ...parseFormData(existingLead.form_data),
                    booking_data: bookingData,
                  },
                })
                .eq("id", existingLead.id)

              // Non-WinBros: Create a quote and send the customer a link to pick their package
              if (!isWindowCleaningTenant && tenant) {
                // Determine service_category from booking data
                const svcType = (bookingData.serviceType || '').toLowerCase()
                const quoteCategory = svcType.includes('move') ? 'move_in_out' : 'standard'

                // Create quote record
                const { data: newQuote, error: quoteError } = await client
                  .from("quotes")
                  .insert({
                    tenant_id: tenant.id,
                    customer_id: customer.id,
                    customer_name: [bookingData.firstName, bookingData.lastName].filter(Boolean).join(' ') || customer.first_name || null,
                    customer_phone: phone,
                    customer_email: finalEmail || null,
                    customer_address: bookingData.address || customer.address || null,
                    bedrooms: bookingData.bedrooms || null,
                    bathrooms: bookingData.bathrooms || null,
                    square_footage: bookingData.squareFootage || null,
                    service_category: quoteCategory,
                    notes: [
                      bookingData.frequency ? `Frequency: ${bookingData.frequency}` : null,
                      bookingData.hasPets ? 'Has pets' : null,
                      jobDate ? `Preferred date: ${jobDate}` : null,
                      bookingData.preferredTime ? `Preferred time: ${bookingData.preferredTime}` : null,
                    ].filter(Boolean).join(' | ') || null,
                  })
                  .select("id, token")
                  .single()

                if (quoteError || !newQuote) {
                  console.error(`[OpenPhone] Quote creation failed for ${maskPhone(phone)}:`, quoteError)
                  // Fall back to a simple confirmation if quote creation fails
                  const fallbackMsg = `Your booking is confirmed! We'll be in touch with pricing details shortly.`
                  await sendSMS(tenant as any, phone, fallbackMsg)
                  return NextResponse.json({
                    success: true,
                    flow: "sms_booking_quote_fallback",
                    existingLeadId: existingLead.id,
                    jobId: newJob?.id,
                  })
                }

                // Get app domain for quote URL (quote page lives on Vercel, not tenant marketing site)
                const { getClientConfig } = await import("@/lib/client-config")
                const appDomain = getClientConfig().domain.replace(/\/+$/, '')
                const quoteUrl = `${appDomain}/quote/${newQuote.token}`

                // Send short SMS with quote link
                const customerFirstName = bookingData.firstName || customer.first_name || ''
                const quoteMsg = customerFirstName
                  ? `Hey ${customerFirstName}! Here are a couple options for your cleaning. Pick the one that works best for you and let me know if you have any questions: ${quoteUrl}`
                  : `Here are a couple options for your cleaning. Pick the one that works best for you and let me know if you have any questions: ${quoteUrl}`

                const quoteSms = await sendSMS(tenant as any, phone, quoteMsg)
                if (quoteSms.success) {
                  await client.from("messages").insert({
                    tenant_id: tenant.id,
                    customer_id: customer.id,
                    phone_number: phone,
                    role: "assistant",
                    content: quoteMsg,
                    direction: "outbound",
                    message_type: "sms",
                    ai_generated: false,
                    timestamp: new Date().toISOString(),
                    source: "estimate_booked",
                    metadata: { lead_id: existingLead.id, job_id: newJob?.id, quote_id: newQuote.id, quote_token: newQuote.token },
                  })
                }
                console.log(`[OpenPhone] Quote SMS sent to ${maskPhone(phone)} — quote ${newQuote.id}, token ${newQuote.token}`)

                // NOTE: Cleaner assignment is NOT triggered here — it happens AFTER the customer
                // pays the deposit via the quote page (Stripe Checkout → stripe webhook).

                // ── QUOTE FOLLOW-UP WIRING ──
                // 1. Schedule 7-minute urgency nudge
                await scheduleTask({
                  tenantId: tenant.id,
                  taskType: "quote_followup_urgent",
                  taskKey: `quote-${newQuote.id}-urgent`,
                  scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
                  payload: {
                    quoteId: newQuote.id,
                    customerId: customer.id,
                    customerPhone: phone,
                    customerName: customerFirstName || "there",
                    tenantId: tenant.id,
                  },
                })

                // 2. Enroll in quoted_not_booked retargeting sequence
                await scheduleRetargetingSequence(
                  tenant.id,
                  customer.id,
                  phone,
                  customerFirstName || customer.first_name || "there",
                  "quoted_not_booked",
                )

                // 3. Mark quote as enrolled in follow-up
                await client
                  .from("quotes")
                  .update({ followup_enrolled_at: new Date().toISOString() })
                  .eq("id", newQuote.id)

                console.log(`[OpenPhone] Quote follow-up wired: 2hr nudge + retargeting for quote ${newQuote.id}`)

                await logSystemEvent({
                  tenant_id: tenant.id,
                  source: "openphone",
                  event_type: "SMS_BOOKING_COMPLETED",
                  message: `SMS booking completed for ${phone} — job ${newJob?.id}, quote ${newQuote.id} sent`,
                  phone_number: phone,
                  metadata: {
                    lead_id: existingLead.id,
                    job_id: newJob?.id,
                    quote_id: newQuote.id,
                    quote_url: quoteUrl,
                    booking_data: bookingData,
                    flow: "quote_link",
                    email_sent_to: finalEmail,
                  },
                })

                return NextResponse.json({
                  success: true,
                  flow: "sms_booking_quote_sent",
                  existingLeadId: existingLead.id,
                  jobId: newJob?.id,
                  quoteId: newQuote.id,
                  quoteUrl,
                })
              }

              // WinBros: Estimate flow — assign salesman via route optimization (NO payment link)
              try {
                const customerName = [bookingData.firstName || customer.first_name, bookingData.lastName || customer.last_name].filter(Boolean).join(' ') || 'Customer'
                const jobAddress = bookingData.address || customer.address || 'Address TBD'
                const estimateDate = jobDate || 'TBD'

                // Route optimize for salesmen and dispatch
                if (tenant && jobDate) {
                  const { optimizeRoutesIncremental } = await import("@/lib/route-optimizer")
                  const { dispatchRoutes } = await import("@/lib/dispatch")
                  const { optimization, assignedTeamId, assignedLeadId } =
                    await optimizeRoutesIncremental(Number(newJob.id), jobDate, tenant.id, 'salesman')

                  if (assignedTeamId) {
                    await dispatchRoutes(optimization, tenant.id, {
                      sendTelegramToTeams: false,
                      sendSmsToCustomers: false,
                      sendOwnerSummary: false,
                    })

                    // Send immediate SMS to assigned salesman WITH address
                    if (assignedLeadId) {
                      const { data: salesman } = await client
                        .from('cleaners')
                        .select('phone, name')
                        .eq('id', assignedLeadId)
                        .maybeSingle()
                      if (salesman?.phone) {
                        const timeStr = bookingData.preferredTime || 'Time TBD'
                        const salesmanMsg = `New Estimate Assigned - WinBros\n\nCustomer: ${customerName}\nService: ${bookingData.serviceType?.replace(/_/g, ' ') || 'Window Cleaning'}\nAddress: ${jobAddress}\nDate: ${estimateDate} at ${timeStr}\n\nPlease visit the customer to provide an on-site quote.`
                        await sendSMS(tenant, salesman.phone, salesmanMsg)
                        console.log(`[OpenPhone] SMS sent to salesman (team ${assignedTeamId}) for estimate job ${newJob.id}`)
                      }
                    }
                  } else {
                    console.warn(`[OpenPhone] No salesman team available for estimate job ${newJob.id} on ${jobDate}`)
                  }
                }

                // Mark the AI's auto-response as the estimate_booked confirmation
                // (the AI already sent a nicely formatted confirmation with address + date + time)
                // This source tag lets the dedup guard prevent duplicate booking completions
                await client.from("messages")
                  .update({ source: "estimate_booked" })
                  .eq("phone_number", phone)
                  .eq("tenant_id", tenant?.id)
                  .eq("role", "assistant")
                  .eq("ai_generated", true)
                  .order("timestamp", { ascending: false })
                  .limit(1)
                console.log(`[OpenPhone] Marked AI response as estimate_booked for ${maskPhone(phone)}`)

                await logSystemEvent({
                  tenant_id: tenant?.id,
                  source: "openphone",
                  event_type: "SMS_ESTIMATE_BOOKED",
                  message: `SMS estimate booked for ${phone} — job ${newJob?.id}, salesman visit scheduled`,
                  phone_number: phone,
                  metadata: {
                    lead_id: existingLead.id,
                    job_id: newJob?.id,
                    booking_data: bookingData,
                    job_type: "estimate",
                    email_sent_to: finalEmail,
                  },
                })
              } catch (estimateErr) {
                console.error("[OpenPhone] Failed to process estimate booking:", estimateErr)
              }

              return NextResponse.json({
                success: true,
                flow: "sms_estimate_booked",
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
  console.log(`[OpenPhone] No existing lead for ${maskPhone(phone)}, analyzing as new inquiry`)
  const intentResult = await analyzeBookingIntent(combinedMessage, conversationHistory)

  console.log(`[OpenPhone] Intent analysis: hasBookingIntent=${intentResult.hasBookingIntent}, confidence=${intentResult.confidence}, serviceType=${intentResult.extractedInfo?.serviceType || 'none'}`)

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
        knownInfoNew,
        { isReturningCustomer: isSeasonalReply, customerContext: customerCtx }
      )

      if (autoResponse.shouldSend && autoResponse.response) {
        // Strip [BOOKING_COMPLETE] tags for new inquiries too
        const cleanedNewResponse = autoResponse.response.replace(/\[BOOKING_COMPLETE\]/gi, '').trim()
        console.log(`[OpenPhone] Sending auto-response: "${cleanedNewResponse.slice(0, 50)}..."`)

        if (cleanedNewResponse) {
          const sendResult = await sendMultiPartSMS(tenant!, phone, cleanedNewResponse, client, customer.id, {
            auto_response: true,
            reason: autoResponse.reason,
            intent_analysis: intentResult,
            combined_message: combinedMessage,
          })

          await logSystemEvent({
            tenant_id: tenant?.id,
            source: "openphone",
            event_type: "AUTO_RESPONSE_SENT",
            message: `Auto-response sent to ${phone}: "${cleanedNewResponse.slice(0, 50)}..."`,
            phone_number: phone,
            metadata: {
              response: cleanedNewResponse,
              reason: autoResponse.reason,
              message_ids: sendResult.messageIds,
            },
          })

          // Schedule mid-convo nudge (5 min) — customer may go silent
          if (tenant && customer) {
            await client.from("customers").update({ awaiting_reply_since: new Date().toISOString() }).eq("id", customer.id)
            await scheduleTask({
              tenantId: tenant.id,
              taskType: "mid_convo_nudge",
              taskKey: `mid-convo-nudge-${customer.id}`,
              scheduledFor: new Date(Date.now() + 5 * 60 * 1000),
              payload: { customerId: customer.id, customerPhone: phone, tenantId: tenant.id },
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

                console.log(`[OpenPhone] Escalation notification sent to owner for new inquiry ${maskPhone(phone)}: ${autoResponse.escalation.reasons.join(", ")}`)
              } else {
                console.log(`[OpenPhone] Escalation already sent recently for new inquiry ${maskPhone(phone)}, skipping duplicate`)
              }
            } catch (escErr) {
              console.error("[OpenPhone] Failed to send escalation notification:", escErr)
            }
          }
        }
      } else {
        console.log(`[OpenPhone] Auto-response skipped: shouldSend=${autoResponse.shouldSend}, hasResponse=${!!autoResponse.response}, reason=${autoResponse.reason}`)
        await logSystemEvent({
          tenant_id: tenant?.id,
          source: "openphone",
          event_type: "AUTO_RESPONSE_SKIPPED",
          message: `Auto-response skipped for ${phone}: shouldSend=${autoResponse.shouldSend}, hasResponse=${!!autoResponse.response}, reason=${autoResponse.reason}`,
          phone_number: phone,
          metadata: { shouldSend: autoResponse.shouldSend, hasResponse: !!autoResponse.response, reason: autoResponse.reason },
        })
      }
    } catch (autoResponseErr) {
      console.error("[OpenPhone] Auto-response error:", autoResponseErr)
      await logSystemEvent({
        tenant_id: tenant?.id,
        source: "openphone",
        event_type: "AUTO_RESPONSE_ERROR",
        message: `Auto-response error for ${phone}: ${autoResponseErr instanceof Error ? autoResponseErr.message : 'unknown'}`,
        phone_number: phone,
        metadata: { error: autoResponseErr instanceof Error ? autoResponseErr.message : String(autoResponseErr) },
      }).catch(() => {})
    }
  }

  // If booking intent detected, create lead and trigger follow-up
  if (intentResult.hasBookingIntent && (intentResult.confidence === 'high' || intentResult.confidence === 'medium')) {
    console.log(`[OpenPhone] Booking intent detected, creating lead...`)

    const firstName = customer.first_name || intentResult.extractedInfo.name?.split(' ')[0] || null
    const lastName = customer.last_name || intentResult.extractedInfo.name?.split(' ').slice(1).join(' ') || null
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null

    const seasonalMeta = isSeasonalReply && recentSeasonal?.metadata
      ? { seasonal_reply: true, campaign_id: (recentSeasonal.metadata as any)?.campaign_id }
      : {}

    const { data: lead, error: leadErr } = await client.from("leads").insert({
      tenant_id: tenant?.id,
      source_id: `sms-${Date.now()}`,
      phone_number: phone,
      customer_id: customer.id,
      first_name: firstName,
      last_name: lastName,
      source: isSeasonalReply ? "seasonal_reminder" : "sms",
      status: "new",
      form_data: {
        original_message: combinedMessage,
        intent_analysis: intentResult,
        extracted_info: intentResult.extractedInfo,
        ...seasonalMeta,
      },
      followup_stage: 0,
      followup_started_at: new Date().toISOString(),
    }).select("id").single()

    if (leadErr) {
      console.error("[OpenPhone] Failed to create lead:", leadErr.message)
    } else if (lead?.id) {
      console.log(`[OpenPhone] Lead created: ${lead.id}`)

      // Update customer record with extracted info immediately (don't wait for booking completion)
      const extractedAddr = intentResult.extractedInfo.address || null
      const extractedEmail = intentResult.extractedInfo.email || null
      const custUpdates: Record<string, string | null> = {}
      if (firstName && !customer.first_name) custUpdates.first_name = firstName
      if (lastName && !customer.last_name) custUpdates.last_name = lastName
      if (extractedAddr && !customer.address) custUpdates.address = extractedAddr
      if (extractedEmail && !customer.email) custUpdates.email = extractedEmail
      if (Object.keys(custUpdates).length > 0) {
        await client.from("customers").update(custUpdates).eq("id", customer.id)
        console.log(`[OpenPhone] Updated customer ${customer.id} with fields: ${Object.keys(custUpdates).join(', ')}`)
      }

      // Create lead in HousecallPro for two-way sync (pass tenant to avoid getDefaultTenant())
      const hcpResult = await createLeadInHCP({
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        phone,
        email: customer.email || undefined,
        address: intentResult.extractedInfo.address || customer.address || undefined,
        notes: `SMS Inquiry: "${combinedMessage}"\nSource: OpenPhone SMS\nOSIRIS Lead ID: ${lead.id}`,
        source: "sms",
      }, tenant)

      if (hcpResult.success) {
        console.log(`[OpenPhone] Lead synced to HCP: ${hcpResult.leadId}`)
        // Update lead with HCP lead ID (housecall_pro_lead_id column)
        const updateData: Record<string, string> = {}
        if (hcpResult.leadId) {
          updateData.housecall_pro_lead_id = hcpResult.leadId
        }
        if (Object.keys(updateData).length > 0) {
          await client
            .from("leads")
            .update(updateData)
            .eq("id", lead.id)
        }
        // Store HCP customer ID on the customer record (not leads table)
        if (hcpResult.customerId && customer?.id) {
          await client
            .from("customers")
            .update({ housecall_pro_customer_id: hcpResult.customerId })
            .eq("id", customer.id)
        }
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

/**
 * Send invoice + Stripe deposit link for house cleaning businesses.
 * (Cedar Rapids, Spotless Scrubbers, etc. — NOT WinBros window cleaning)
 *
 * Invoice provider is tenant-aware: routes to Stripe or Wave based on workflow_config.
 * Flow: Invoice SMS → short delay → Stripe deposit link SMS → confirmation email
 */
async function sendDepositPaymentFlow(params: {
  tenant: { id: string; slug: string; workflow_config?: any; [key: string]: any },
  phone: string,
  email: string,
  customer: { id: string; email?: string; phone_number?: string; first_name?: string; last_name?: string; address?: string; [key: string]: any },
  job: any | null,
  jobId: string | null,
  leadId: string,
  servicePrice: number | null,
  client: ReturnType<typeof getSupabaseClient>,
}): Promise<{ success: boolean; invoiceUrl?: string; depositUrl?: string }> {
  const { tenant, phone, email, customer, job, jobId, leadId, client } = params
  let { servicePrice } = params

  // Calculate price if not available using tenant-specific pricing
  if (!servicePrice && job) {
    try {
      const { calculateJobEstimateAsync } = await import("@/lib/stripe-client")
      const estimate = await calculateJobEstimateAsync(job, undefined, tenant.id)
      servicePrice = estimate.totalPrice
      console.log(`[OpenPhone] Calculated price for deposit flow: $${servicePrice}`)
    } catch (err) {
      console.error("[OpenPhone] Price calculation failed for deposit flow:", err)
    }
  }

  let invoiceUrl: string | undefined
  let depositUrl: string | undefined

  if (!servicePrice || servicePrice <= 0) {
    console.warn(`[OpenPhone] No valid price for deposit flow (phone: ${maskPhone(phone)}), skipping invoice/deposit`)
    return { success: false }
  }

  // ──────────────────────────────────────────────────────────────────────
  // CARD-ON-FILE FLOW: Save card at booking, charge on completion (no deposit)
  // For tenants with use_card_on_file: true (Cedar Rapids, Spotless Scrubbers)
  // ──────────────────────────────────────────────────────────────────────
  const cardOnFileConfig = tenant.workflow_config || {}
  if (cardOnFileConfig.use_card_on_file) {
    try {
      // Fetch tenant's add-on prices dynamically from pricing_addons table
      const { getPricingAddons } = await import("@/lib/pricing-db")
      const addons = await getPricingAddons(tenant.id)
      const addonLines = addons
        .filter(a => a.flat_price && a.flat_price > 0)
        .map(a => `  • ${a.label}: $${a.flat_price}`)

      const serviceLabel = job?.service_type?.replace(/_/g, ' ') || 'Cleaning Service'
      const dateLine = job?.date
        ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'TBD'
      const addressLine = job?.address || customer.address || ''
      const cancellationFee = cardOnFileConfig.cancellation_fee_cents ? (cardOnFileConfig.cancellation_fee_cents / 100) : 50
      const cancellationWindow = cardOnFileConfig.cancellation_window_hours || 24

      // Build terms SMS
      const msgParts = [
        `Booking Confirmed!`,
        `${serviceLabel} | ${dateLine}${addressLine ? ` | ${addressLine}` : ''}`,
        `Estimated Total: $${servicePrice.toFixed(2)}`,
      ]

      if (addonLines.length > 0) {
        msgParts.push('')
        msgParts.push('Potential add-ons (if applicable):')
        msgParts.push(...addonLines)
      }

      msgParts.push('')
      msgParts.push(`$${cancellationFee} cancellation fee applies if cancelled within ${cancellationWindow}hrs of service.`)

      // Create card-on-file link
      const { createCardOnFileLink } = await import("@/lib/stripe-client")
      if (!tenant.stripe_secret_key) {
        console.error(`[OpenPhone] Tenant ${tenant.slug} has no stripe_secret_key — cannot create card-on-file link for terms flow`)
        throw new Error('Tenant has no Stripe key')
      }
      const cardResult = await createCardOnFileLink(
        { ...customer, email } as any,
        jobId || `lead-${leadId}`,
        tenant.id,
        tenant.stripe_secret_key
      )

      if (cardResult.success && cardResult.url) {
        msgParts.push('')
        msgParts.push(`Please save your card to confirm: ${cardResult.url}`)
        msgParts.push(`Your card will be charged the final amount after service is completed.`)

        const termsMsg = msgParts.join('\n')
        const termsSms = await sendSMS(tenant as any, phone, termsMsg)
        if (termsSms.success) {
          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: termsMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "card_on_file",
            metadata: { lead_id: leadId, job_id: jobId, card_on_file_url: cardResult.url },
          })
        }
        console.log(`[OpenPhone] Card-on-file terms SMS sent to ${maskPhone(phone)}`)

        // Mark job as quoted (transitions to scheduled after card saved via Stripe webhook)
        if (jobId) {
          const { updateJob } = await import("@/lib/supabase")
          await updateJob(jobId, { invoice_sent: true, status: 'quoted' as any, booked: false })
        }

        // Send confirmation email
        try {
          const { sendConfirmationEmail } = await import("@/lib/gmail-client")
          await sendConfirmationEmail({
            customer: { ...customer, email } as any,
            job: job || {} as any,
            waveInvoiceUrl: undefined,
            stripeDepositUrl: cardResult.url,
            tenant: tenant as any,
          })
        } catch (emailErr) {
          console.error("[OpenPhone] Card-on-file confirmation email failed:", emailErr)
        }

        await logSystemEvent({
          tenant_id: tenant.id,
          source: "openphone",
          event_type: "CARD_ON_FILE_TERMS_SENT",
          message: `Card-on-file terms + link sent to ${phone}`,
          phone_number: phone,
          metadata: {
            lead_id: leadId,
            job_id: jobId,
            flow: "card_on_file",
            card_on_file_url: cardResult.url,
            price: servicePrice,
          },
        })

        return { success: true, depositUrl: cardResult.url }
      } else {
        console.error(`[OpenPhone] Card-on-file link creation failed: ${cardResult.error}`)
      }
    } catch (cardErr) {
      console.error("[OpenPhone] Card-on-file flow error:", cardErr)
    }
    // Fall through to legacy deposit flow if card-on-file failed
  }

  // 1. Send booking confirmation (Stripe tenants get SMS summary; Wave tenants get invoice link)
  const wc = tenant.workflow_config
  const isStripeOnly = wc?.use_stripe && !wc?.use_wave

  if (isStripeOnly) {
    // Stripe-only tenants: send informational booking confirmation SMS
    // (skip Stripe invoice — avoids confusing "Already Paid" status)
    try {
      const serviceLabel = job?.service_type || 'Cleaning Service'
      const propertyParts: string[] = []
      const bed = customer.bedrooms ?? job?.bedrooms
      const bath = customer.bathrooms ?? job?.bathrooms
      const sqft = customer.square_footage ?? job?.square_footage
      if (bed) propertyParts.push(`${bed} bed`)
      if (bath) propertyParts.push(`${bath} bath`)
      if (sqft) propertyParts.push(`${Number(sqft).toLocaleString()} sqft`)
      const propertyLine = propertyParts.length > 0 ? `\n${propertyParts.join(' / ')}` : ''

      const dateLine = job?.date
        ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : 'TBD'
      const timeLine = job?.scheduled_at || ''
      const dateTimeStr = timeLine ? `${dateLine} at ${timeLine}` : dateLine
      const addressLine = job?.address || customer.address || ''

      const confirmMsg = [
        `Booking Confirmed!`,
        ``,
        serviceLabel,
        propertyLine ? propertyLine.trim() : null,
        dateTimeStr,
        addressLine,
        `Total: $${servicePrice.toFixed(2)}`,
        ``,
        `Full service details sent to your email. Card-on-file link coming next to confirm your appointment!`,
      ].filter(line => line !== null).join('\n')

      const confirmSms = await sendSMS(tenant as any, phone, confirmMsg)
      if (confirmSms.success) {
        await client.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: customer.id,
          phone_number: phone,
          role: "assistant",
          content: confirmMsg,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: "invoice",
          metadata: { lead_id: leadId, job_id: jobId },
        })
      }
      console.log(`[OpenPhone] Booking confirmation SMS sent to ${maskPhone(phone)}`)
    } catch (confirmErr) {
      console.error("[OpenPhone] Booking confirmation SMS error:", confirmErr)
    }
  } else {
    // Wave tenants: create proper invoice with rich description
    try {
      const { createInvoice } = await import("@/lib/invoices")
      const invoiceResult = await createInvoice(
        { ...job, price: servicePrice, id: jobId, phone_number: phone } as any,
        { ...customer, email } as any,
        tenant
      )

      if (invoiceResult.success && invoiceResult.invoiceUrl) {
        invoiceUrl = invoiceResult.invoiceUrl

        const invoiceMsg = SMS_TEMPLATES.invoiceSent(email, invoiceUrl)
        const invoiceSms = await sendSMS(tenant as any, phone, invoiceMsg)
        if (invoiceSms.success) {
          await client.from("messages").insert({
            tenant_id: tenant.id,
            customer_id: customer.id,
            phone_number: phone,
            role: "assistant",
            content: invoiceMsg,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            timestamp: new Date().toISOString(),
            source: "invoice",
            metadata: { lead_id: leadId, job_id: jobId, invoice_url: invoiceUrl },
          })
        }
        console.log(`[OpenPhone] Invoice sent to ${maskPhone(phone)}`)
      } else {
        console.warn(`[OpenPhone] Invoice creation failed (${invoiceResult.provider || 'unknown'}): ${invoiceResult.error}`)
      }
    } catch (invoiceErr) {
      console.error("[OpenPhone] Invoice error:", invoiceErr)
    }
  }

  // Small delay between invoice and deposit messages
  await new Promise(resolve => setTimeout(resolve, 3000))

  // 2. Create Stripe card-on-file link (save card for later charging)
  try {
    const { createCardOnFileLink } = await import("@/lib/stripe-client")
    if (!tenant.stripe_secret_key) {
      console.error(`[OpenPhone] Tenant ${tenant.slug} has no stripe_secret_key — cannot create card-on-file link for deposit flow`)
      throw new Error('Tenant has no Stripe key')
    }
    const cardResult = await createCardOnFileLink(
      { ...customer, email } as any,
      jobId || `lead-${leadId}`,
      tenant.id,
      tenant.stripe_secret_key
    )

    if (cardResult.success && cardResult.url) {
      depositUrl = cardResult.url

      const cardMsg = `Please save your card on file to confirm your appointment: ${cardResult.url}`
      const cardSms = await sendSMS(tenant as any, phone, cardMsg)
      if (cardSms.success) {
        await client.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: customer.id,
          phone_number: phone,
          role: "assistant",
          content: cardMsg,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          timestamp: new Date().toISOString(),
          source: "card_on_file",
          metadata: { lead_id: leadId, job_id: jobId, card_on_file_url: cardResult.url },
        })
      }
      console.log(`[OpenPhone] Card-on-file link sent to ${maskPhone(phone)}`)
    } else {
      console.error(`[OpenPhone] Card-on-file link creation failed: ${cardResult.error}`)
    }
  } catch (cardErr) {
    console.error("[OpenPhone] Card-on-file link error:", cardErr)
  }

  // 3. Mark job as invoiced/quoted (not booked yet — booked after deposit paid)
  if (jobId) {
    const { updateJob } = await import("@/lib/supabase")
    await updateJob(jobId, {
      invoice_sent: true,
      status: 'quoted' as any,
      booked: false,
    })
  }

  // 4. Send confirmation email with both Wave invoice and Stripe deposit links
  try {
    const { sendConfirmationEmail } = await import("@/lib/gmail-client")
    await sendConfirmationEmail({
      customer: { ...customer, email } as any,
      job: job || {} as any,
      waveInvoiceUrl: invoiceUrl,
      stripeDepositUrl: depositUrl || '',
      tenant: tenant as any,
    })
    console.log(`[OpenPhone] Confirmation email sent to ${maskEmail(email)}`)
  } catch (emailErr) {
    console.error("[OpenPhone] Confirmation email failed:", emailErr)
  }

  // 5. Log system event
  await logSystemEvent({
    tenant_id: tenant.id,
    source: "openphone",
    event_type: "PAYMENT_LINKS_SENT",
    message: `Invoice + deposit links sent to ${phone}`,
    phone_number: phone,
    metadata: {
      lead_id: leadId,
      job_id: jobId,
      flow: "deposit_payment",
      invoice_url: invoiceUrl,
      deposit_url: depositUrl,
      price: servicePrice,
    },
  })

  return {
    success: !!(invoiceUrl || depositUrl),
    invoiceUrl,
    depositUrl,
  }
}
