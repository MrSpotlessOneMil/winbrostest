import { NextRequest, NextResponse } from "next/server"
import { createHmac, timingSafeEqual } from "crypto"
import { getSupabaseClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getApiKey } from "@/lib/user-api-keys"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug } from "@/lib/tenant"

// Map GHL-internal source values to valid leads.source CHECK constraint values
function mapGhlSourceToLeadSource(payload: any): { source: string; ghl_source: string } {
  const data = payload?.data || payload
  const contact = data?.contact || data?.contactData || data
  const rawSource = (contact?.source || data?.source || '').toLowerCase()
  const campaign = (contact?.adCampaign || data?.adCampaign || contact?.ad_campaign || '').toLowerCase()

  if (rawSource.includes('facebook') || rawSource.includes('meta') || rawSource.includes('fb') ||
      campaign.includes('facebook') || campaign.includes('meta') || campaign.includes('fb')) {
    return { source: 'meta', ghl_source: 'meta_ads' }
  }
  if (rawSource.includes('google') || campaign.includes('google') || campaign.includes('adwords')) {
    return { source: 'google', ghl_source: 'google_ads' }
  }
  if (rawSource.includes('referral') || rawSource.includes('refer')) {
    return { source: 'manual', ghl_source: 'referral' }
  }
  if (rawSource.includes('organic') || rawSource.includes('seo')) {
    return { source: 'website', ghl_source: 'organic' }
  }
  return { source: 'ghl', ghl_source: rawSource || 'unknown' }
}

// Minimal GoHighLevel webhook handler:
// stores incoming leads into `public.leads`.
// Tenant is resolved from ?tenant= query param (slug).
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

  // Resolve tenant from ?tenant= query param (slug)
  const tenantSlug = request.nextUrl.searchParams.get("tenant")
  if (!tenantSlug) {
    console.error("[OSIRIS] GHL Webhook: No ?tenant= query param — cannot route. Dropping webhook.")
    await logSystemEvent({
      source: "ghl",
      event_type: "GHL_TENANT_MISSING",
      message: "GHL webhook received without ?tenant= param — dropped to prevent cross-tenant leak",
      phone_number: phone,
      metadata: { locationId, sourceId },
    })
    return NextResponse.json({ success: false, error: "Missing tenant param" }, { status: 400 })
  }

  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) {
    console.error(`[OSIRIS] GHL Webhook: Tenant '${tenantSlug}' not found — dropping webhook.`)
    return NextResponse.json({ success: false, error: "Unknown tenant" }, { status: 404 })
  }

  const client = getSupabaseClient()

  // Detect lead source from GHL payload
  const { source: leadSource, ghl_source: ghlSource } = mapGhlSourceToLeadSource(payload)

  // Upsert customer for linking later (composite unique: tenant_id, phone_number)
  const { data: customer } = await client
    .from("customers")
    .upsert({ phone_number: phone, tenant_id: tenant.id, first_name: firstName || null, last_name: lastName || null, email: email || null, lead_source: leadSource }, { onConflict: "tenant_id,phone_number" })
    .select("id")
    .single()

  const { data: lead, error: leadError } = await client.from("leads").insert({
    tenant_id: tenant.id,
    source_id: String(sourceId),
    ghl_location_id: locationId ? String(locationId) : null,
    phone_number: phone,
    customer_id: customer?.id ?? null,
    first_name: firstName || null,
    last_name: lastName || null,
    email: email || null,
    source: leadSource,
    status: "new",
    form_data: { ...payload, ghl_source: ghlSource },
    followup_stage: 0,
    followup_started_at: new Date().toISOString(),
  }).select("id").single()

  if (leadError) {
    console.error("[OSIRIS] GHL Webhook: Error inserting lead:", leadError)
    return NextResponse.json({ success: false, error: "Failed to create lead" }, { status: 500 })
  }

  // Log system event
  await logSystemEvent({
    tenant_id: tenant.id,
    source: "ghl",
    event_type: "GHL_LEAD_RECEIVED",
    message: `New lead from GHL: ${firstName || 'Unknown'} ${lastName || ''}`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      source_id: sourceId,
      location_id: locationId,
      tenant_slug: tenant.slug,
    },
  })

  // Schedule the lead follow-up sequence
  if (lead?.id) {
    try {
      const leadName = `${firstName || ''} ${lastName || ''}`.trim() || 'Customer'
      await scheduleLeadFollowUp(tenant.id, String(lead.id), phone, leadName)
      console.log(`[OSIRIS] GHL Webhook: Scheduled follow-up sequence for lead ${lead.id} (${tenant.slug})`)
    } catch (scheduleError) {
      console.error("[OSIRIS] GHL Webhook: Error scheduling follow-up:", scheduleError)
      // Don't fail the webhook, the lead is already created
    }
  }

  return NextResponse.json({ success: true, leadId: lead?.id })
}
