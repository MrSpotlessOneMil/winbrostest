import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { scheduleLeadFollowUp } from "@/lib/scheduler"
import { logSystemEvent } from "@/lib/system-events"
import { getTenantBySlug } from "@/lib/tenant"

/**
 * SAM Lead Handoff Webhook
 *
 * POST /api/webhooks/sam/{slug}
 * Accepts prospects from SAM (Sales & Acquisition Machine) when they
 * reply to outreach, express interest, or hit a score threshold.
 *
 * Creates customer + lead in Osiris and triggers the SMS followup sequence.
 *
 * Auth: shared secret via X-SAM-Secret header
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // Verify shared secret
  const secret = request.headers.get("x-sam-secret")
  if (!secret || secret !== process.env.SAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Resolve tenant
  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    return NextResponse.json({ error: "Unknown tenant" }, { status: 404 })
  }

  // Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Extract fields from SAM prospect data
  const phoneRaw = (body.phone as string) || ""
  const phone = normalizePhoneNumber(String(phoneRaw)) || String(phoneRaw)

  if (!phone) {
    return NextResponse.json(
      { error: "Phone number is required for Osiris lead creation" },
      { status: 400 }
    )
  }

  const firstName = (body.first_name as string) || ""
  const lastName = (body.last_name as string) || ""
  const email = (body.email as string) || ""
  const address = (body.address as string) || ""
  const companyName = (body.company_name as string) || ""

  // SAM-specific metadata
  const samProspectId = (body.sam_prospect_id as string) || ""
  const samScore = (body.score as number) || 0
  const samVertical = (body.vertical as string) || ""
  const samLeadType = (body.lead_type as string) || ""
  const samStatus = (body.sam_status as string) || ""
  const samOutreachCount = (body.outreach_count as number) || 0

  const client = getSupabaseServiceClient()

  // Check for existing active lead with this phone (dedup)
  const { data: existingLead } = await client
    .from("leads")
    .select("id, status")
    .eq("tenant_id", tenant.id)
    .eq("phone_number", phone)
    .in("status", ["new", "contacted", "qualified", "booked"])
    .limit(1)
    .single()

  if (existingLead) {
    // Already have an active lead for this phone - don't duplicate
    await logSystemEvent({
      tenant_id: tenant.id,
      source: "sam",
      event_type: "SAM_HANDOFF_DEDUP",
      message: `SAM handoff skipped - active lead already exists (${existingLead.status})`,
      phone_number: phone,
      metadata: {
        existing_lead_id: existingLead.id,
        sam_prospect_id: samProspectId,
      },
    })

    return NextResponse.json({
      success: true,
      deduplicated: true,
      existing_lead_id: existingLead.id,
    })
  }

  // Upsert customer
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
        lead_source: 'sam',
      },
      { onConflict: "tenant_id,phone_number" }
    )
    .select("id")
    .single()

  // Create lead with SAM source
  const { data: lead, error: leadError } = await client
    .from("leads")
    .insert({
      tenant_id: tenant.id,
      source_id: samProspectId ? `sam-${samProspectId}` : `sam-${Date.now()}`,
      phone_number: phone,
      customer_id: customer?.id ?? null,
      first_name: firstName || null,
      last_name: lastName || null,
      email: email || null,
      source: "sam",
      status: "new",
      form_data: {
        sam_handoff: true,
        sam_prospect_id: samProspectId,
        sam_score: samScore,
        sam_vertical: samVertical,
        sam_lead_type: samLeadType,
        sam_status: samStatus,
        sam_outreach_count: samOutreachCount,
        company_name: companyName,
        address,
        handoff_at: new Date().toISOString(),
      },
      followup_stage: 0,
      followup_started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (leadError) {
    console.error(`[SAM Webhook] Error creating lead for ${tenant.slug}:`, leadError)
    return NextResponse.json(
      { error: "Failed to create lead" },
      { status: 500 }
    )
  }

  // Log the handoff
  await logSystemEvent({
    tenant_id: tenant.id,
    source: "sam",
    event_type: "SAM_LEAD_HANDOFF",
    message: `SAM handoff: ${firstName || "Unknown"} ${lastName || ""} (score: ${samScore}, ${samVertical}/${samLeadType})`.trim(),
    phone_number: phone,
    metadata: {
      lead_id: lead?.id,
      sam_prospect_id: samProspectId,
      sam_score: samScore,
      sam_vertical: samVertical,
      sam_lead_type: samLeadType,
      sam_outreach_count: samOutreachCount,
      tenant_slug: tenant.slug,
    },
  })

  // Schedule lead follow-up sequence (SMS + AI calls)
  if (lead?.id) {
    try {
      const leadName = `${firstName || ""} ${lastName || ""}`.trim() || "Customer"
      await scheduleLeadFollowUp(tenant.id, String(lead.id), phone, leadName)
      console.log(
        `[SAM Webhook] Scheduled follow-up for lead ${lead.id} (${tenant.slug})`
      )
    } catch (scheduleError) {
      console.error("[SAM Webhook] Error scheduling follow-up:", scheduleError)
    }
  }

  return NextResponse.json({
    success: true,
    lead_id: lead?.id,
    customer_id: customer?.id,
  })
}
