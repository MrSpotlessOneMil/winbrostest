import { NextRequest, NextResponse } from "next/server"
import { extractVapiCallData } from "@/lib/vapi"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { getSupabaseClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  // Vapi supports webhook secrets, but implementations vary by account setup.
  // For now we accept the payload and store call + transcript; you can add signature validation later.
  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const data = extractVapiCallData(payload)
  if (!data) {
    return NextResponse.json({ success: true, ignored: true })
  }

  const phone = normalizePhoneNumber(data.phone || "") || data.phone || ""
  const client = getSupabaseClient()

  // Upsert customer so calls can be linked for dashboard
  let customerId: number | null = null
  if (phone) {
    const { data: customer, error } = await client
      .from("customers")
      .upsert({ phone_number: phone }, { onConflict: "phone_number" })
      .select("id")
      .single()
    if (!error && customer?.id != null) customerId = Number(customer.id)
  }

  const providerCallId = data.callId || null
  const nowIso = new Date().toISOString()

  // Insert call row
  const { error: callErr } = await client.from("calls").insert({
    customer_id: customerId,
    phone_number: phone,
    direction: "inbound",
    provider: "vapi",
    provider_call_id: providerCallId,
    vapi_call_id: providerCallId,
    transcript: data.transcript || null,
    audio_url: data.audioUrl || null,
    duration_seconds: data.duration ? Math.round(Number(data.duration)) : null,
    outcome: data.outcome || null,
    status: "completed",
    started_at: nowIso,
    date: nowIso,
    created_at: nowIso,
  })

  if (callErr) {
    return NextResponse.json({ success: false, error: `Failed to insert call: ${callErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

