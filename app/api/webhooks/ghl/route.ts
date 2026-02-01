import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { getSupabaseClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getApiKey } from "@/lib/user-api-keys"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getDefaultTenant } from "@/lib/tenant"

// Minimal GoHighLevel webhook handler:
// stores incoming leads into `public.leads`.
export async function POST(request: NextRequest) {
  // Get raw body for signature verification
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ success: false, error: "Failed to read request body" }, { status: 400 })
  }

  // Verify webhook signature
  const signature = request.headers.get("X-GHL-Signature")
  const secret = getApiKey("ghlWebhookSecret") || process.env.GHL_WEBHOOK_SECRET

  if (secret) {
    if (!signature) {
      console.error("[OSIRIS] GHL Webhook: Missing signature header")
      return NextResponse.json(
        { success: false, error: "Missing signature" },
        { status: 401 }
      )
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")

    // Use timingSafeEqual to prevent timing attacks
    const signatureLower = signature.toLowerCase()
    const expectedLower = expectedSignature.toLowerCase()

    if (
      signatureLower.length !== expectedLower.length ||
      !timingSafeEqual(Buffer.from(signatureLower), Buffer.from(expectedLower))
    ) {
      console.error("[OSIRIS] GHL Webhook: Invalid signature")
      return NextResponse.json(
        { success: false, error: "Invalid signature" },
        { status: 401 }
      )
    }
  } else {
    console.warn("[OSIRIS] GHL Webhook: No webhook secret configured, skipping signature validation")
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const data = payload?.data || payload
  const contact = data?.contact || data?.contactData || data

  const phoneRaw =
    contact?.phone ||
    contact?.phoneNumber ||
    contact?.phone_number ||
    data?.phone ||
    data?.phoneNumber ||
    data?.phone_number ||
    ""

  const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)
  if (!phone) return NextResponse.json({ success: true, ignored: true })

  const firstName = contact?.firstName || contact?.first_name || ""
  const lastName = contact?.lastName || contact?.last_name || ""
  const email = contact?.email || ""

  const sourceId =
    contact?.id ||
    data?.contactId ||
    data?.source_id ||
    `ghl-${Date.now()}`

  const locationId =
    data?.locationId ||
    data?.location_id ||
    payload?.locationId ||
    payload?.location_id ||
    null

  const client = getSupabaseClient()

  // Upsert customer for linking later
  const { data: customer } = await client
    .from("customers")
    .upsert({ phone_number: phone, first_name: firstName || null, last_name: lastName || null, email: email || null }, { onConflict: "phone_number" })
    .select("id")
    .single()

  const { data: lead, error: leadError } = await client.from("leads").insert({
    source_id: String(sourceId),
    ghl_location_id: locationId ? String(locationId) : null,
    phone_number: phone,
    customer_id: customer?.id ?? null,
    first_name: firstName || null,
    last_name: lastName || null,
    email: email || null,
    source: "meta",
    status: "new",
    form_data: payload,
    followup_stage: 0,
    followup_started_at: new Date().toISOString(),
  }).select("id").single()

  if (leadError) {
    console.error("[OSIRIS] GHL Webhook: Error inserting lead:", leadError)
    return NextResponse.json({ success: false, error: "Failed to create lead" }, { status: 500 })
  }

  // Log system event
  await logSystemEvent({
    source: "ghl",
    event_type: "GHL_LEAD_RECEIVED",
    message: `New lead from GHL: ${firstName || 'Unknown'} ${lastName || ''}`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      source_id: sourceId,
      location_id: locationId,
    },
  })

  // Schedule the lead follow-up sequence
  const tenant = await getDefaultTenant()
  if (lead?.id) {
    try {
      const leadName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer'
      await scheduleLeadFollowUp(tenant?.id || '', String(lead.id), phone, leadName)
      console.log(`[OSIRIS] GHL Webhook: Scheduled follow-up sequence for lead ${lead.id}`)
    } catch (scheduleError) {
      console.error("[OSIRIS] GHL Webhook: Error scheduling follow-up:", scheduleError)
      // Don't fail the webhook, the lead is already created
    }
  }

  return NextResponse.json({ success: true, leadId: lead?.id })
}

