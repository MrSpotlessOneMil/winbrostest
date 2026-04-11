import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuthWithTenant } from "@/lib/auth"
import { toE164 } from "@/lib/phone-utils"

const MAX_LOGS = 500

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const phone = request.nextUrl.searchParams.get("phone")
  const customerId = request.nextUrl.searchParams.get("customer_id")

  if (!phone && !customerId) {
    return NextResponse.json({ error: "phone or customer_id required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const e164Phone = phone ? toE164(phone) : null

  // Build query — match by phone_number OR by customer-linked fields (lead_id, job_id)
  // system_events has: phone_number, job_id, lead_id, tenant_id
  let query = client
    .from("system_events")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(MAX_LOGS)

  if (e164Phone) {
    query = query.eq("phone_number", e164Phone)
  }

  const { data: logs, error } = await query

  if (error) {
    console.error("[customer-logs] fetch error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Prune: if this customer has more than MAX_LOGS, delete the oldest ones
  if (logs && logs.length === MAX_LOGS && e164Phone) {
    const oldestKeptId = logs[logs.length - 1].id
    const oldestKeptDate = logs[logs.length - 1].created_at

    // Delete older logs for this phone+tenant (fire and forget)
    client
      .from("system_events")
      .delete()
      .eq("tenant_id", tenant.id)
      .eq("phone_number", e164Phone)
      .lt("created_at", oldestKeptDate)
      .then(({ error: delErr }) => {
        if (delErr) console.error("[customer-logs] prune error:", delErr.message)
      })
  }

  return NextResponse.json({ data: logs || [] })
}
