import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { sendSMS } from "@/lib/openphone"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug, getTenantServiceDescription } from "@/lib/tenant"

// CORS headers for embed-friendly response (any domain can POST)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

/**
 * Website Lead Form Webhook
 *
 * POST /api/webhooks/website/{slug}
 * Accepts flexible JSON payload from website forms / quote calculators.
 *
 * - Resolves tenant from URL slug
 * - Validates name + phone (required)
 * - Upserts customer, creates lead with source details + UTM
 * - Sends an immediate SMS acknowledging the submission
 * - Schedules follow-up sequence (stages 2-5, skips instant stage 1)
 * - Returns embed-friendly response with CORS headers
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // Resolve tenant
  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    return NextResponse.json(
      { success: false, error: "Unknown business" },
      { status: 404, headers: corsHeaders }
    )
  }

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders }
    )
  }

  // ── Extract & validate required fields ──────────────────────────

  const nameRaw =
    (body.name as string) ||
    [body.first_name || body.firstName, body.last_name || body.lastName]
      .filter(Boolean)
      .join(" ") ||
    ""

  if (!nameRaw.trim()) {
    return NextResponse.json(
      { success: false, error: "Name is required" },
      { status: 400, headers: corsHeaders }
    )
  }

  const phoneRaw =
    (body.phone as string) ||
    (body.phone_number as string) ||
    (body.phoneNumber as string) ||
    ""
  const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)

  if (!phone) {
    return NextResponse.json(
      { success: false, error: "Phone number is required" },
      { status: 400, headers: corsHeaders }
    )
  }

  // ── Extract optional fields ─────────────────────────────────────

  const firstName =
    (body.first_name as string) ||
    (body.firstName as string) ||
    nameRaw.split(" ")[0] ||
    ""
  const lastName =
    (body.last_name as string) ||
    (body.lastName as string) ||
    nameRaw.split(" ").slice(1).join(" ") ||
    ""
  const email = (body.email as string) || ""
  const address = (body.address as string) || ""
  const serviceType = (body.service_type as string) || (body.serviceType as string) || ""
  const message = (body.message as string) || (body.notes as string) || ""
  const source = (body.source as string) || "website"
  const bedrooms = typeof body.bedrooms === "number" ? body.bedrooms : null
  const bathrooms = typeof body.bathrooms === "number" ? body.bathrooms : null
  const frequency = (body.frequency as string) || null
  const estimatedPrice = typeof body.estimated_price === "number" ? body.estimated_price : null

  const client = getSupabaseServiceClient()

  // ── Upsert customer (composite unique: tenant_id, phone_number) ─

  const { data: customer } = await client
    .from("customers")
    .upsert(
      {
        phone_number: phone,
        tenant_id: tenant.id,
        first_name: firstName || null,
        last_name: lastName || null,
        email: email || null,
        address: address || null,
        lead_source: source,
      },
      { onConflict: "tenant_id,phone_number" }
    )
    .select("id")
    .single()

  // ── Create lead ─────────────────────────────────────────────────

  const { data: lead, error: leadError } = await client
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      source_id: `website-${Date.now()}`,
      phone_number: phone,
      customer_id: customer?.id ?? null,
      first_name: firstName || null,
      last_name: lastName || null,
      email: email || null,
      source,
      status: "new",
      form_data: {
        ...body,
        service_type: serviceType,
        message,
        address,
        bedrooms,
        bathrooms,
        frequency,
        estimated_price: estimatedPrice,
        utm_source: body.utm_source || null,
        utm_medium: body.utm_medium || null,
        utm_campaign: body.utm_campaign || null,
        utm_content: body.utm_content || null,
        utm_term: body.utm_term || null,
        submitted_at: new Date().toISOString(),
      },
      followup_stage: 1, // Mark stage 1 as done since we send SMS inline
      followup_started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (leadError) {
    console.error(`[Website Webhook] Error creating lead for ${tenant.slug}:`, leadError)
    return NextResponse.json(
      { success: false, error: "Failed to create lead" },
      { status: 500, headers: corsHeaders }
    )
  }

  // ── Send immediate SMS ──────────────────────────────────────────

  const businessName = tenant.business_name_short || tenant.name || "Our team"
  const serviceDesc = getTenantServiceDescription(tenant)
  const friendlyService = serviceType
    ? serviceType.replace(/[-_]/g, " ")
    : serviceDesc

  // Build a context-aware first message
  let smsMessage: string
  if (bedrooms && bathrooms) {
    smsMessage = `Hey ${firstName}! This is Mary from ${businessName}. Thanks for requesting a quote — ${bedrooms} bed, ${bathrooms} bath${address ? ` at ${address}` : ""}. We'll have your pricing options ready shortly! Any questions in the meantime, just text back here.`
  } else if (estimatedPrice) {
    smsMessage = `Hey ${firstName}! This is Mary from ${businessName}. Thanks for checking out our pricing for ${friendlyService}! We'd love to get you on the schedule. When works best for you?`
  } else {
    smsMessage = `Hey ${firstName}! This is Mary from ${businessName}. Thanks for reaching out about ${friendlyService}! We'd love to help. Can you share your address and number of bedrooms/bathrooms so we can get you a quick quote?`
  }

  // Pre-insert message record so outbound webhook dedup finds it
  const { data: msgRecord } = await client.from("messages").insert({
    tenant_id: tenant.id,
    customer_id: customer?.id ?? null,
    phone_number: phone,
    role: "assistant",
    content: smsMessage,
    direction: "outbound",
    message_type: "sms",
    ai_generated: false,
    timestamp: new Date().toISOString(),
    source: "website_lead_auto",
  }).select("id").single()

  const smsResult = await sendSMS(tenant, phone, smsMessage, {
    skipDedup: true,
    skipThrottle: true,
  })

  if (!smsResult.success) {
    // Clean up pre-inserted record since send failed
    if (msgRecord?.id) {
      await client.from("messages").delete().eq("id", msgRecord.id)
    }
    console.error(`[Website Webhook] SMS send failed for ${phone}:`, smsResult.error)
  }

  // ── Log system event ────────────────────────────────────────────

  await logSystemEvent({
    tenant_id: tenant.id,
    source: "website",
    event_type: "WEBSITE_LEAD_RECEIVED",
    message: `New website lead: ${firstName || "Unknown"} ${lastName || ""}`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      service_type: serviceType,
      source,
      bedrooms,
      bathrooms,
      frequency,
      estimated_price: estimatedPrice,
      sms_sent: smsResult.success,
      tenant_slug: tenant.slug,
    },
  })

  // ── Schedule follow-up sequence (stages 2-5, skip instant stage 1) ──

  if (lead?.id) {
    try {
      const leadName = `${firstName || ""} ${lastName || ""}`.trim() || "Customer"
      // Stage 1 (delay 0) will be skipped by message dedup since we already sent an SMS above
      await scheduleLeadFollowUp(tenant.id, String(lead.id), phone, leadName)
      console.log(
        `[Website Webhook] Scheduled follow-up stages 2-5 for lead ${lead.id} (${tenant.slug})`
      )
    } catch (scheduleError) {
      console.error("[Website Webhook] Error scheduling follow-up:", scheduleError)
      // Don't fail the webhook — lead is already created and SMS sent
    }
  }

  return NextResponse.json(
    { success: true, id: lead?.id },
    { headers: corsHeaders }
  )
}
