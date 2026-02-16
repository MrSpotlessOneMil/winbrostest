import { NextRequest, NextResponse } from "next/server"
import { handleVapiWebhook } from "@/lib/vapi-webhook-handler"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  return NextResponse.json({
    status: "ok",
    service: `VAPI Webhook - ${slug}`,
    timestamp: new Date().toISOString(),
    message: "Webhook endpoint is active. POST your VAPI events here.",
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  console.log(`[VAPI/${slug}] ====== REQUEST RECEIVED ======`)
  console.log(`[VAPI/${slug}] Request URL: ${request.url}`)

  let payload: any
  try {
    payload = await request.json()
  } catch (e) {
    console.error(`[VAPI/${slug}] Failed to parse JSON:`, e)
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  console.log(`[VAPI/${slug}] FULL PAYLOAD:`, JSON.stringify(payload, null, 2))

  return handleVapiWebhook(payload, slug)
}
