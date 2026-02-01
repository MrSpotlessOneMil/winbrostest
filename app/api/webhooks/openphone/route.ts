import { NextRequest, NextResponse } from "next/server"
import { extractMessageFromOpenPhonePayload, normalizePhoneNumber, validateOpenPhoneWebhook } from "@/lib/openphone"
import { getSupabaseClient } from "@/lib/supabase"
import { analyzeBookingIntent, isObviouslyNotBooking } from "@/lib/ai-intent"
import { createLeadInHCP } from "@/lib/housecall-pro-api"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"

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
    return NextResponse.json({ success: true, ignored: true })
  }

  // Only process inbound messages
  if (extracted.direction !== "inbound") {
    return NextResponse.json({ success: true, ignored: true, reason: "outbound message" })
  }

  const fromE164 = normalizePhoneNumber(extracted.from) || extracted.from
  const phone = normalizePhoneNumber(fromE164)
  if (!phone) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const client = getSupabaseClient()
  const tenant = await getDefaultTenant()

  // Upsert customer by phone_number
  const { data: customer, error: custErr } = await client
    .from("customers")
    .upsert({ phone_number: phone, tenant_id: tenant?.id }, { onConflict: "phone_number" })
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

  // Check if a lead already exists for this phone (that's still active)
  const { data: existingLead } = await client
    .from("leads")
    .select("id, status")
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
    return NextResponse.json({ success: true, existingLeadId: existingLead.id })
  }

  // Get recent conversation history for context
  const { data: recentMessages } = await client
    .from("messages")
    .select("role, content")
    .eq("phone_number", phone)
    .order("timestamp", { ascending: false })
    .limit(5)

  const conversationHistory = recentMessages?.reverse().map(m => ({
    role: m.role as 'client' | 'business',
    content: m.content
  })) || []

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
