import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { sendSMS } from "@/lib/openphone"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug, getTenantServiceDescription } from "@/lib/tenant"
import { upsertLeadCustomer } from "@/lib/customer-dedup"

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown parse error'
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "website",
      event_type: "WEBSITE_FORM_PARSE_FAIL",
      message: `Website form payload could not be parsed: ${msg}`,
      metadata: { error: msg },
    })
    return NextResponse.json(
      { success: false, error: "Invalid JSON body", code: "parse_error" },
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
  const sourceDetail = (body.source as string) || "website"
  const source = "website" // DB CHECK constraint — detail preserved in form_data
  const bedrooms = typeof body.bedrooms === "number" ? body.bedrooms : null
  const bathrooms = typeof body.bathrooms === "number" ? body.bathrooms : null
  const frequency = (body.frequency as string) || null
  const estimatedPrice = typeof body.estimated_price === "number" ? body.estimated_price : null

  const client = getSupabaseServiceClient()

  // ── Dedup-aware customer upsert ──────────────────────────────────
  // Looks up existing customer by email first, then phone. Prevents the
  // AJ-style bug where the same person submits with a different phone
  // number and gets a duplicate customer record.

  const dedupResult = await upsertLeadCustomer(client, {
    tenant_id: tenant.id,
    phone_number: phone,
    first_name: firstName || null,
    last_name: lastName || null,
    email: email || null,
    address: address || null,
    lead_source: source,
  })
  const customer = dedupResult ? { id: dedupResult.customer_id } : null

  if (dedupResult?.was_merged && dedupResult.match) {
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "website",
      event_type: "CUSTOMER_MERGED_ON_LEAD",
      message: `Website lead merged into existing customer #${dedupResult.match.existing_id} by ${dedupResult.match.reason}`,
      phone_number: phone,
      metadata: {
        reason: dedupResult.match.reason,
        existing_phone: dedupResult.match.existing_phone,
        existing_email: dedupResult.match.existing_email,
        incoming_phone: phone,
        incoming_email: email || null,
      },
    })
  }
  if (dedupResult?.duplicate_first_name_count && dedupResult.duplicate_first_name_count > 0) {
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "website",
      event_type: "DUPLICATE_FIRST_NAME_WARNING",
      message: `New customer #${dedupResult.customer_id} shares first name "${firstName}" with ${dedupResult.duplicate_first_name_count} existing customer(s)`,
      phone_number: phone,
      metadata: {
        first_name: firstName,
        duplicate_count: dedupResult.duplicate_first_name_count,
      },
    })
  }

  // ── Cancel stale retargeting for this customer ──────────────────
  // If this phone already has an active retargeting sequence from a previous
  // interaction, cancel it — the customer is re-engaging organically.
  if (customer?.id) {
    try {
      const { cancelPendingTasks } = await import("@/lib/lifecycle-engine")
      const cancelled = await cancelPendingTasks(tenant.id, `retarget-${customer.id}-`)
      if (cancelled > 0) {
        console.log(`[Website Webhook] Cancelled ${cancelled} stale retargeting tasks for customer ${customer.id}`)
        await client
          .from("customers")
          .update({
            retargeting_completed_at: new Date().toISOString(),
            retargeting_stopped_reason: "new_website_lead",
            auto_response_paused: false,
          })
          .eq("id", customer.id)
      }
    } catch (cancelErr) {
      console.error("[Website Webhook] Error cancelling retargeting:", cancelErr)
    }
  }

  // ── Create lead ─────────────────────────────────────────────────

  const { data: lead, error: leadError } = await client
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      source_id: `website-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phone_number: phone,
      customer_id: customer?.id ?? null,
      first_name: firstName || null,
      last_name: lastName || null,
      email: email || null,
      source,
      status: "new",
      form_data: {
        ...body,
        source_detail: sourceDetail,
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
    // Structured error logging — the generic "Something went wrong" message
    // on the Texas Nova form came from swallowing these details. Log the
    // full PostgrestError shape (code, message, hint, details) to
    // system_events so Patrick/Dominic can diagnose from the dashboard.
    // Bug T1 — 2026-04-20.
    console.error(`[Website Webhook] Error creating lead for ${tenant.slug}:`, {
      code: leadError.code,
      message: leadError.message,
      details: leadError.details,
      hint: leadError.hint,
    })
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "website",
      event_type: "WEBSITE_FORM_LEAD_INSERT_FAIL",
      message: `Failed to insert lead for ${tenant.slug}: ${leadError.code} ${leadError.message}`,
      phone_number: phone,
      metadata: {
        code: leadError.code,
        message: leadError.message,
        details: leadError.details,
        hint: leadError.hint,
        payload_keys: Object.keys(body),
        name: nameRaw,
        bedrooms,
        bathrooms,
        has_email: !!email,
        has_address: !!address,
        service_type: serviceType,
      },
    })
    // Return a descriptive error code (NOT the raw DB details — those can
    // leak schema). The form UI can map the code to a user-friendly message.
    return NextResponse.json(
      {
        success: false,
        error: "Could not submit your estimate. Please try again or call us.",
        code: "lead_insert_failed",
        ref: `${tenant.slug}-${Date.now().toString(36)}`,
      },
      { status: 500, headers: corsHeaders }
    )
  }

  // ── Send immediate SMS ──────────────────────────────────────────

  const businessName = tenant.business_name_short || tenant.name || "Our team"
  const serviceDesc = getTenantServiceDescription(tenant)
  const friendlyService = serviceType
    ? serviceType.replace(/[-_]/g, " ")
    : serviceDesc

  // Build a context-aware first message that drives the conversation forward.
  // The SMS bot picks up from here — ask for what's still missing so it can
  // reach [BOOKING_COMPLETE] (needs address + bed/bath) and send the 3-tier quote link.
  const sdrName = tenant.sdr_persona || "Mary"
  const isSpecializedService = ['commercial', 'post_construction', 'airbnb', 'airbnb-cleaning'].includes(serviceType)

  // Check for promo campaign (shared config — single source of truth)
  const { getPromoConfig } = await import('@/lib/promo-config')
  const promoConfig = getPromoConfig({ utm_campaign: body.utm_campaign, source_detail: sourceDetail, service_type: serviceType })

  let smsMessage: string
  if (promoConfig) {
    // Promo campaign — use template from config
    const tpl = promoConfig.firstSms.replace('{name}', firstName).replace('{businessName}', businessName)
    if (bedrooms && bathrooms && address) {
      smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Got your $${promoConfig.price} clean request — ${bedrooms} bed, ${bathrooms} bath at ${address}. I'm getting your booking set up right now!`
    } else if (bedrooms && bathrooms) {
      smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Got your $${promoConfig.price} clean request — ${bedrooms} bed, ${bathrooms} bath! What's the address? I'll get your booking confirmed right away!`
    } else {
      smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. ${tpl.split('. ').slice(1).join('. ')}`
    }
  } else if (isSpecializedService) {
    // Specialized services — don't ask for bedrooms/bathrooms, collect project details instead
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Thanks for reaching out about ${friendlyService}! We'd love to learn more about the job — what's the address and roughly how big is the space? We'll get you a custom quote fast.`
  } else if (bedrooms && bathrooms && estimatedPrice && address) {
    // Everything we need — tell them quote is on the way (bot will fire [BOOKING_COMPLETE])
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Thanks for your quote request — ${bedrooms} bed, ${bathrooms} bath at ${address}. I'm sending over your cleaning options right now!`
  } else if (bedrooms && bathrooms && estimatedPrice) {
    // Have sizing + price, just need address to send the quote link
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Got your quote request — ${bedrooms} bed, ${bathrooms} bath, looks like around $${estimatedPrice} for a standard clean. What's the address? I'll send over your options right away!`
  } else if (bedrooms && bathrooms) {
    // Have sizing but no price — ask for address
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Got your request — ${bedrooms} bed, ${bathrooms} bath. What's the address? I'll send over pricing options right away!`
  } else if (estimatedPrice) {
    // Have a price estimate but no sizing details
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Thanks for checking out our pricing for ${friendlyService}! To get you exact options, what's your address and how many bedrooms and bathrooms?`
  } else {
    smsMessage = `Hey ${firstName}! This is ${sdrName} from ${businessName}. Thanks for reaching out about ${friendlyService}! What's your address and how many bedrooms and bathrooms? I'll get you a quote right away!`
  }

  // sendSMS pre-inserts its own messages row (via the `source` option) and
  // cleans it up on failure, so no manual insert is needed here.
  const smsResult = await sendSMS(tenant, phone, smsMessage, {
    skipDedup: true,
    source: 'website_lead_auto',
    customerId: customer?.id ?? null,
  })

  if (!smsResult.success) {
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
      source_detail: sourceDetail,
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
