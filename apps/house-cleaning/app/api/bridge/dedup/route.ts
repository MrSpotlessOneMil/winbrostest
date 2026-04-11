import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * POST /api/bridge/dedup
 *
 * SAM/ANDREW ask: "Are any of these phone numbers already active Osiris customers?"
 * Prevents agents from cold-texting existing paying customers.
 *
 * Auth: X-Agent-Secret header.
 * Body: { phones: string[] }
 * Response: { results: [{ phone, is_customer, has_active_job, lifecycle_stage }] }
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-agent-secret")
  if (!secret || secret !== process.env.AGENT_BRIDGE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { phones: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (!body.phones?.length) {
    return NextResponse.json({ results: [] })
  }

  const client = getSupabaseServiceClient()

  // Normalize phones to E.164
  const normalized = body.phones.map(p => {
    const digits = p.replace(/\D/g, "")
    return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : p
  })

  const { data: customers } = await client
    .from("customers")
    .select("phone_number, lifecycle_stage, card_on_file_at")
    .in("phone_number", normalized)

  const { data: activeJobs } = await client
    .from("jobs")
    .select("phone_number")
    .in("phone_number", normalized)
    .in("status", ["pending", "scheduled", "in_progress"])

  const customerMap = new Map((customers || []).map(c => [c.phone_number, c]))
  const activeJobPhones = new Set((activeJobs || []).map(j => j.phone_number))

  const results = normalized.map(phone => {
    const c = customerMap.get(phone)
    return {
      phone,
      is_customer: !!c,
      has_active_job: activeJobPhones.has(phone),
      lifecycle_stage: c?.lifecycle_stage || null,
      has_card: !!c?.card_on_file_at,
    }
  })

  return NextResponse.json({ results })
}
