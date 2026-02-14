import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ data: [], total: 0 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get("page") || "1")
  const per_page = parseInt(searchParams.get("per_page") || "100")
  const source = searchParams.get("source")
  const event_type = searchParams.get("event_type")
  const phone = searchParams.get("phone")

  const start = (page - 1) * per_page
  const end = start + per_page - 1

  const client = getSupabaseServiceClient()

  let query = client
    .from("system_events")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })

  // Filter by tenant (or include null tenant_id for system-wide events)
  query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`)

  if (source) query = query.eq("source", source)
  if (event_type) query = query.eq("event_type", event_type)
  if (phone) query = query.eq("phone_number", phone)

  const { data, error, count } = await query.range(start, end)

  if (error) {
    console.error("Error fetching system events:", error)
    return NextResponse.json({ data: [], total: 0, error: error.message })
  }

  return NextResponse.json({
    data: data || [],
    total: count || 0,
    page,
    per_page,
    total_pages: count ? Math.ceil(count / per_page) : 0,
  })
}
