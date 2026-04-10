import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * POST /api/bridge/notify-outreach
 *
 * Called by SAM/ANDREW before they send SMS outreach through OpenPhone.
 * Osiris marks these phone numbers so the OpenPhone webhook knows NOT to
 * trigger manual takeover when the outbound message arrives.
 *
 * Auth: X-Agent-Secret header must match AGENT_BRIDGE_SECRET env var.
 *
 * Body: { agent: "sam"|"andrew", phones: string[], content?: string, campaign_id?: string }
 * Response: { success: true, marked: number }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-agent-secret")
  if (!secret || secret !== process.env.AGENT_BRIDGE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { agent: string; phones: string[]; content?: string; campaign_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { agent, phones, content, campaign_id } = body
  if (!agent || !phones?.length) {
    return NextResponse.json({ error: "agent and phones[] required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 min window

  // Batch upsert into agent_outreach_notices
  const notices = phones.map(phone => ({
    phone_number: phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`,
    agent,
    content: content || null,
    campaign_id: campaign_id || null,
    created_at: now,
    expires_at: expiresAt,
  }))

  const { error, count } = await client
    .from("agent_outreach_notices")
    .upsert(notices, { onConflict: "phone_number,agent", count: "exact" })

  if (error) {
    console.error("[Bridge] Failed to save outreach notices:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[Bridge] ${agent} pre-notified outreach to ${phones.length} numbers`)
  return NextResponse.json({ success: true, marked: count || phones.length })
}
