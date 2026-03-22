import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug } from "@/lib/tenant"

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
 * Accepts: { name, phone, email, address, service_type, message }
 *
 * - Resolves tenant from URL slug
 * - Upserts customer, creates lead with source: 'website'
 * - Triggers AI SMS follow-up (same as GHL flow)
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

  // Extract fields (flexible naming to support various form builders)
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

  const firstName =
    (body.first_name as string) ||
    (body.firstName as string) ||
    (body.name as string)?.split(" ")[0] ||
    ""
  const lastName =
    (body.last_name as string) ||
    (body.lastName as string) ||
    (body.name as string)?.split(" ").slice(1).join(" ") ||
    ""
  const email = (body.email as string) || ""
  const address = (body.address as string) || ""
  const serviceType = (body.service_type as string) || (body.serviceType as string) || ""
  const message = (body.message as string) || (body.notes as string) || ""

  const client = getSupabaseServiceClient()

  // Upsert customer (composite unique: tenant_id, phone_number)
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
        lead_source: 'website',
      },
      { onConflict: "tenant_id,phone_number" }
    )
    .select("id")
    .single()

  // Create lead
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
      source: "website",
      status: "new",
      form_data: {
        ...body,
        service_type: serviceType,
        message,
        address,
        submitted_at: new Date().toISOString(),
      },
      followup_stage: 0,
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

  // Log system event
  await logSystemEvent({
    tenant_id: tenant.id,
    source: "website",
    event_type: "WEBSITE_LEAD_RECEIVED",
    message: `New website lead: ${firstName || "Unknown"} ${lastName || ""}`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      service_type: serviceType,
      tenant_slug: tenant.slug,
    },
  })

  // Schedule lead follow-up sequence
  if (lead?.id) {
    try {
      const leadName = `${firstName || ""} ${lastName || ""}`.trim() || "Customer"
      await scheduleLeadFollowUp(tenant.id, String(lead.id), phone, leadName)
      console.log(
        `[Website Webhook] Scheduled follow-up for lead ${lead.id} (${tenant.slug})`
      )
    } catch (scheduleError) {
      console.error("[Website Webhook] Error scheduling follow-up:", scheduleError)
      // Don't fail the webhook - lead is already created
    }
  }

  return NextResponse.json(
    { success: true, leadId: lead?.id },
    { headers: corsHeaders }
  )
}
