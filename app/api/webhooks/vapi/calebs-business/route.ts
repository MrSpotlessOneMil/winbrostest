import { NextRequest, NextResponse } from "next/server"
import { handleVapiWebhook } from "@/lib/vapi-webhook-handler"

// GET handler for verification
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "VAPI Webhook - Cedar Rapids Cleaning",
    timestamp: new Date().toISOString(),
    message: "Webhook endpoint is active. POST your VAPI events here.",
  })
}

export async function POST(request: NextRequest) {
  console.log(`[VAPI/calebs-business] ====== REQUEST RECEIVED ======`)
  console.log(`[VAPI/calebs-business] Request URL: ${request.url}`)

  let payload: any
  try {
    payload = await request.json()
  } catch (e) {
    console.error(`[VAPI/calebs-business] Failed to parse JSON:`, e)
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  console.log(`[VAPI/calebs-business] FULL PAYLOAD:`, JSON.stringify(payload, null, 2))

  // Route to the Cedar Rapids Cleaning tenant
  return handleVapiWebhook(payload, "calebs-business")
}
