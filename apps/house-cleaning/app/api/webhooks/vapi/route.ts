import { NextRequest, NextResponse } from "next/server"
import { handleVapiWebhook } from "@/lib/vapi-webhook-handler"

// GET handler for verification - VAPI or browser can ping this to verify endpoint is live
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "VAPI Webhook",
    timestamp: new Date().toISOString(),
    message: "Webhook endpoint is active. POST your VAPI events here.",
  })
}

export async function POST(request: NextRequest) {
  console.log(`[VAPI Webhook] ====== REQUEST RECEIVED ======`)
  console.log(`[VAPI Webhook] Request URL: ${request.url}`)

  let payload: any
  try {
    payload = await request.json()
  } catch (e) {
    console.error(`[VAPI Webhook] Failed to parse JSON:`, e)
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  // Resolve tenant slug from VAPI call metadata. Production traffic should route through
  // /api/webhooks/vapi/[slug]; this catch-all exists for assistants that stamp metadata.tenantSlug.
  // NEVER default to a hardcoded tenant — cross-tenant bleed risk (e.g. HC call landing on WinBros).
  const message = (payload?.message ?? payload) as Record<string, unknown>
  const call = (message?.call ?? payload?.call) as Record<string, unknown> | undefined
  const metadata = (call?.metadata ?? message?.metadata) as Record<string, unknown> | undefined
  const slugFromMetadata = typeof metadata?.tenantSlug === 'string' ? metadata.tenantSlug : null

  if (!slugFromMetadata) {
    console.error('[VAPI Webhook] No tenantSlug in metadata — refusing. Route via /api/webhooks/vapi/[slug] or set metadata.tenantSlug on the VAPI assistant.')
    return NextResponse.json(
      { success: false, error: 'Missing tenantSlug. Route via /api/webhooks/vapi/[slug] or include metadata.tenantSlug.' },
      { status: 400 },
    )
  }

  return handleVapiWebhook(payload, slugFromMetadata)
}
