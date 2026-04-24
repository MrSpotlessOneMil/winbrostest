import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET /api/crew/[token]/availability?days=14
 *
 * Token-authenticated lightweight availability feed for the salesman
 * door-knock portal (Wave 3e). Returns `[{ date, count }]` for the next N
 * days (default 14, cap 30) scoped to the cleaner's tenant.
 *
 * Aggregation-only: no address / customer leak. Safe for the employee
 * token path, which has no admin session cookie.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from("cleaners")
    .select("id, tenant_id, active")
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (!cleaner || !cleaner.active) {
    return NextResponse.json(
      { success: false, error: "Invalid portal link" },
      { status: 404 }
    )
  }

  const url = new URL(request.url)
  const days = Math.min(
    30,
    Math.max(1, Number(url.searchParams.get("days")) || 14)
  )

  // Build the date range in the tenant's local day. The DB is UTC; the
  // salesman cares about "tomorrow" in their wall-clock. We use the
  // server's UTC date as a practical approximation — WinBros is in Chicago,
  // so at most a 6-hour skew in edge cases. Keep simple for now.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const start = today.toISOString().slice(0, 10)
  const endDate = new Date(today)
  endDate.setUTCDate(endDate.getUTCDate() + days - 1)
  const end = endDate.toISOString().slice(0, 10)

  const { data: jobs, error } = await client
    .from("jobs")
    .select("date")
    .eq("tenant_id", cleaner.tenant_id)
    .gte("date", start)
    .lte("date", end)
    .not("status", "eq", "cancelled")

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  const counts = new Map<string, number>()
  for (const j of jobs ?? []) {
    if (typeof j.date !== "string") continue
    counts.set(j.date, (counts.get(j.date) || 0) + 1)
  }

  const out: Array<{ date: string; count: number }> = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    out.push({ date: iso, count: counts.get(iso) ?? 0 })
  }

  return NextResponse.json({ success: true, data: out })
}
