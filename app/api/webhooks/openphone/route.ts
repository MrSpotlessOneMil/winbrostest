import { NextRequest, NextResponse } from "next/server"
import { extractMessageFromOpenPhonePayload, normalizePhoneNumber, validateOpenPhoneWebhook } from "@/lib/openphone"
import { getSupabaseClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  const signature =
    request.headers.get("x-openphone-signature") ||
    request.headers.get("X-OpenPhone-Signature")
  const timestamp = request.headers.get("x-openphone-timestamp")

  const rawBody = await request.text()
  const ok = await validateOpenPhoneWebhook(rawBody, signature, timestamp)
  if (!ok) {
    return NextResponse.json({ success: false, error: "Invalid OpenPhone signature" }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const extracted = extractMessageFromOpenPhonePayload(payload)
  if (!extracted) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const fromE164 = normalizePhoneNumber(extracted.from) || extracted.from
  const phone = normalizePhoneNumber(fromE164)
  if (!phone) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const client = getSupabaseClient()

  // Upsert customer by phone_number
  const { data: customer, error: custErr } = await client
    .from("customers")
    .upsert({ phone_number: phone }, { onConflict: "phone_number" })
    .select("*")
    .single()

  if (custErr) {
    return NextResponse.json({ success: false, error: `Failed to upsert customer: ${custErr.message}` }, { status: 500 })
  }

  // Store the inbound message for dashboard display
  const { error: msgErr } = await client.from("messages").insert({
    customer_id: customer.id,
    phone_number: phone,
    role: "client",
    content: extracted.content,
    direction: extracted.direction || "inbound",
    message_type: "sms",
    ai_generated: false,
    timestamp: extracted.createdAt,
    source: "openphone",
    metadata: payload,
  })

  if (msgErr) {
    return NextResponse.json({ success: false, error: `Failed to insert message: ${msgErr.message}` }, { status: 500 })
  }

  // Optional: mirror a lead if none exists (simple “lead intake” behavior)
  const { data: existingLead } = await client
    .from("leads")
    .select("id")
    .eq("phone_number", phone)
    .maybeSingle()

  if (!existingLead) {
    await client.from("leads").insert({
      source_id: `openphone-${Date.now()}`,
      phone_number: phone,
      source: "sms",
      status: "new",
    })
  }

  return NextResponse.json({ success: true })
}

