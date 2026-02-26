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

  // Default route uses the default tenant (winbros)
  return handleVapiWebhook(payload, null)
}
