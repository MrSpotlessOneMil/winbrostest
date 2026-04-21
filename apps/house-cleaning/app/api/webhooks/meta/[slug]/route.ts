import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug } from "@/lib/tenant"
import { upsertLeadCustomer } from "@/lib/customer-dedup"

/**
 * Meta Lead Ads Webhook
 *
 * GET  /api/webhooks/meta/{slug} — Verification (Meta sends hub.challenge)
 * POST /api/webhooks/meta/{slug} — Lead notification (Meta sends leadgen event)
 *
 * When a lead fills out a Meta Lead Ad form:
 * 1. Meta POSTs a leadgen event with lead_id
 * 2. We fetch the lead data from Meta Graph API using the tenant's page access token
 * 3. Create customer + lead in Osiris
 * 4. Schedule SMS follow-up sequence
 */

// ── GET: Webhook Verification ──
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const url = new URL(request.url)
  const mode = url.searchParams.get("hub.mode")
  const token = url.searchParams.get("hub.verify_token")
  const challenge = url.searchParams.get("hub.challenge")

  if (mode !== "subscribe") {
    return new NextResponse("Invalid mode", { status: 400 })
  }

  // Verify token matches tenant config or env
  const tenant = await getTenantBySlug(slug)
  const expectedToken = (tenant?.workflow_config as Record<string, unknown>)?.meta_verify_token
    || process.env.META_VERIFY_TOKEN

  if (!expectedToken || token !== expectedToken) {
    console.error(`[Meta Webhook] Verification failed for ${slug} — token mismatch`)
    return new NextResponse("Forbidden", { status: 403 })
  }

  console.log(`[Meta Webhook] Verified for ${slug}`)
  return new NextResponse(challenge, { status: 200 })
}

// ── POST: Leadgen Event ──
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    console.error(`[Meta Webhook] Unknown tenant slug: ${slug}`)
    return NextResponse.json({ received: true })
  }

  const wc = (tenant.workflow_config || {}) as Record<string, unknown>
  // Prefer System User token (new, multi-scope, never-expires) → fall back to page access token → env
  const pageAccessToken =
    (wc.meta_ads_access_token as string) ||
    (wc.meta_page_access_token as string) ||
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN
  if (!pageAccessToken) {
    console.error(`[Meta Webhook] No access token for ${slug}`)
    return NextResponse.json({ received: true })
  }

  // Meta sends: { object: "page", entry: [{ id, time, changes: [{ field: "leadgen", value: { ... } }] }] }
  const entries = (body.entry || []) as Array<Record<string, unknown>>

  let leadsProcessed = 0

  for (const entry of entries) {
    const changes = (entry.changes || []) as Array<Record<string, unknown>>

    for (const change of changes) {
      if (change.field !== "leadgen") continue

      const value = change.value as Record<string, unknown>
      const leadgenId = value?.leadgen_id as string
      if (!leadgenId) continue

      try {
        const leadData = await fetchMetaLead(leadgenId, pageAccessToken)
        if (!leadData) continue

        await processMetaLead(tenant, leadData, leadgenId)
        leadsProcessed++
      } catch (err) {
        console.error(`[Meta Webhook] Error processing lead ${leadgenId}:`, err)
      }
    }
  }

  console.log(`[Meta Webhook] Processed ${leadsProcessed} leads for ${slug}`)
  return NextResponse.json({ received: true, processed: leadsProcessed })
}

// ── Fetch lead data from Meta Graph API ──
async function fetchMetaLead(leadId: string, accessToken: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${leadId}?access_token=${accessToken}`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Meta Webhook] Graph API error: ${res.status} ${err}`)
      return null
    }

    return await res.json()
  } catch (err) {
    clearTimeout(timeout)
    console.error("[Meta Webhook] Graph API fetch failed:", err)
    return null
  }
}

// ── Process a single Meta lead ──
async function processMetaLead(
  tenant: { id: string; slug: string; name: string; business_name_short?: string },
  leadData: Record<string, unknown>,
  leadgenId: string
) {
  const client = getSupabaseServiceClient()

  // Parse Meta form fields
  const fieldData = (leadData.field_data || []) as Array<{ name: string; values: string[] }>
  const fields: Record<string, string> = {}
  for (const f of fieldData) {
    fields[f.name?.toLowerCase()] = f.values?.[0] || ""
  }

  const fullName = fields.full_name || fields.name || ""
  const firstName = fields.first_name || fullName.split(" ")[0] || ""
  const lastName = fields.last_name || fullName.split(" ").slice(1).join(" ") || ""
  const email = fields.email || ""
  const phoneRaw = fields.phone_number || fields.phone || ""
  const phone = normalizePhoneNumber(phoneRaw) || phoneRaw
  const serviceType = fields.service_type || fields.what_service_are_you_interested_in || ""
  const address = fields.street_address || fields.address || fields.zip_code || fields.city || ""

  if (!phone) {
    console.warn(`[Meta Webhook] Lead ${leadgenId} has no phone number — skipping`)
    return
  }

  // Dedup: check if we already processed this leadgen_id
  const { data: existing } = await client
    .from("leads")
    .select("id")
    .eq("source_id", `meta-${leadgenId}`)
    .eq("tenant_id", tenant.id)
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`[Meta Webhook] Lead ${leadgenId} already processed — skipping`)
    return
  }

  // Dedup-aware upsert: match existing customer by email first, then phone.
  // Prevents duplicate customer records when the same person submits with a
  // different phone number (AJ incident 2026-04-17).
  const dedupResult = await upsertLeadCustomer(client, {
    tenant_id: tenant.id,
    phone_number: phone,
    first_name: firstName || null,
    last_name: lastName || null,
    email: email || null,
    address: address || null,
    lead_source: "meta",
  })
  const customer = dedupResult ? { id: dedupResult.customer_id } : null

  if (dedupResult?.was_merged && dedupResult.match) {
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "meta",
      event_type: "CUSTOMER_MERGED_ON_LEAD",
      message: `Meta lead merged into existing customer #${dedupResult.match.existing_id} by ${dedupResult.match.reason}`,
      phone_number: phone,
      metadata: {
        reason: dedupResult.match.reason,
        existing_phone: dedupResult.match.existing_phone,
        existing_email: dedupResult.match.existing_email,
        incoming_phone: phone,
        incoming_email: email || null,
        leadgen_id: leadgenId,
      },
    })
  }
  if (dedupResult?.duplicate_first_name_count && dedupResult.duplicate_first_name_count > 0) {
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "meta",
      event_type: "DUPLICATE_FIRST_NAME_WARNING",
      message: `New Meta customer #${dedupResult.customer_id} shares first name "${firstName}" with ${dedupResult.duplicate_first_name_count} existing customer(s)`,
      phone_number: phone,
      metadata: {
        first_name: firstName,
        duplicate_count: dedupResult.duplicate_first_name_count,
        leadgen_id: leadgenId,
      },
    })
  }

  // Create lead
  const { data: lead, error: leadError } = await client
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      source_id: `meta-${leadgenId}`,
      phone_number: phone,
      customer_id: customer?.id ?? null,
      first_name: firstName || null,
      last_name: lastName || null,
      email: email || null,
      source: "meta",
      status: "new",
      form_data: {
        ...fields,
        meta_leadgen_id: leadgenId,
        meta_form_id: leadData.form_id,
        meta_ad_id: leadData.ad_id,
        service_type: serviceType,
        address,
        submitted_at: leadData.created_time || new Date().toISOString(),
      },
      followup_stage: 0,
      followup_started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (leadError) {
    console.error(`[Meta Webhook] Error creating lead for ${tenant.slug}:`, leadError)
    return
  }

  await logSystemEvent({
    tenant_id: tenant.id,
    source: "meta",
    event_type: "META_LEAD_RECEIVED",
    message: `New Meta Lead Ad: ${firstName || "Unknown"} ${lastName || ""}`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      leadgen_id: leadgenId,
      service_type: serviceType,
      tenant_slug: tenant.slug,
    },
  })

  // Schedule follow-up (same sequence as website leads — stage 1 fires immediately via SMS)
  if (lead?.id) {
    try {
      const leadName = `${firstName || ""} ${lastName || ""}`.trim() || "Customer"
      await scheduleLeadFollowUp(tenant.id, String(lead.id), phone, leadName)
      console.log(`[Meta Webhook] Scheduled follow-up for Meta lead ${lead.id} (${tenant.slug})`)
    } catch (err) {
      console.error("[Meta Webhook] Error scheduling follow-up:", err)
    }
  }
}
