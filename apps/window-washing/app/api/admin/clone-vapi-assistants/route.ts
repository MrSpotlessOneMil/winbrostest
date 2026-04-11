import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { cloneVapiForTenant, getTemplatesForFlow } from "@/lib/vapi-templates"
import { getBaseUrl } from "@/lib/admin-onboard"

/**
 * Clones VAPI template assistants onto a tenant's VAPI account.
 * Called by the onboarding wizard before the main onboard pipeline.
 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const { vapi_api_key, flow_type, slug, business_name, service_area, service_type, sdr_persona, owner_first_name, owner_phone } = body

  if (!vapi_api_key) {
    return NextResponse.json({ success: false, error: "VAPI API key is required" }, { status: 400 })
  }
  if (!flow_type || !slug) {
    return NextResponse.json({ success: false, error: "flow_type and slug are required" }, { status: 400 })
  }

  const templates = getTemplatesForFlow(flow_type)
  if (!templates.hasInbound) {
    return NextResponse.json({ success: false, error: `No VAPI templates available for flow type: ${flow_type}` }, { status: 400 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: "Could not determine base URL (NEXT_PUBLIC_BASE_URL or VERCEL_PROJECT_PRODUCTION_URL not set)" }, { status: 500 })
  }

  const webhookUrl = `${baseUrl}/api/webhooks/vapi/${slug}`

  try {
    const result = await cloneVapiForTenant(vapi_api_key, flow_type, {
      slug,
      businessName: business_name || slug,
      serviceArea: service_area || "",
      serviceType: service_type || "cleaning",
      sdrPersona: sdr_persona || "Mary",
      ownerFirstName: owner_first_name || "",
      ownerPhone: owner_phone || "",
      webhookUrl,
      baseUrl,
    })

    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      inbound_assistant_id: result.data.inboundAssistantId,
      outbound_assistant_id: result.data.outboundAssistantId || null,
    })
  } catch (err: any) {
    console.error("[clone-vapi-assistants] Error:", err)
    return NextResponse.json({ success: false, error: err.message || "Clone failed" }, { status: 500 })
  }
}
