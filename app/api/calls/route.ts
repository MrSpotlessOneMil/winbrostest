import { NextRequest, NextResponse } from "next/server"
import type { Call, PaginatedResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"

function mapOutcome(value: unknown): Call["outcome"] | undefined {
  const raw = typeof value === "string" ? value.toLowerCase() : ""
  if (
    raw === "booked" ||
    raw === "escalated" ||
    raw === "voicemail" ||
    raw === "callback_scheduled" ||
    raw === "lost"
  ) {
    return raw as Call["outcome"]
  }
  return undefined
}

function mapDirection(value: unknown): Call["call_type"] {
  const raw = typeof value === "string" ? value.toLowerCase() : ""
  return raw === "outbound" ? "outbound" : "inbound"
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ data: [], total: 0, page: 1, per_page: 50, total_pages: 0 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get("page") || "1")
  const per_page = parseInt(searchParams.get("per_page") || "50")
  const phone = searchParams.get("phone")

  const start = (page - 1) * per_page
  const end = start + per_page - 1

  const client = getSupabaseServiceClient()

  let query = client
    .from("calls")
    .select("*, customers (*)", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (phone) query = query.eq("phone_number", phone)

  const { data, error, count } = await query.range(start, end)
  if (error) {
    const empty: PaginatedResponse<Call> = { data: [], total: 0, page, per_page, total_pages: 0 }
    return NextResponse.json(empty)
  }

  const rows: Call[] = (data || []).map((row: any) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const callerName =
      row.caller_name ||
      [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() ||
      undefined

    const created = row.created_at ? String(row.created_at) : new Date().toISOString()
    const isBusinessHours = typeof row.is_business_hours === "boolean" ? row.is_business_hours : true

    return {
      id: String(row.id),
      caller_phone: String(row.phone_number || row.from_number || ""),
      caller_name: callerName,
      call_type: mapDirection(row.direction),
      handler: row.provider === "vapi" ? "vapi" : "human",
      outcome: mapOutcome(row.outcome),
      duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : undefined,
      transcript: row.transcript || undefined,
      lead_id: row.lead_id != null ? String(row.lead_id) : undefined,
      job_id: row.job_id != null ? String(row.job_id) : undefined,
      is_business_hours: isBusinessHours,
      created_at: created,
    }
  })

  const total = Number(count || 0)
  const response: PaginatedResponse<Call> = {
    data: rows,
    total,
    page,
    per_page,
    total_pages: total ? Math.ceil(total / per_page) : 0,
  }

  return NextResponse.json(response)
}

