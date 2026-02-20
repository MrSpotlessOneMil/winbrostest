import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const tenant = await getAuthTenant(request)

    // Admin user (no tenant_id) sees all tenants' data
    if (!tenant && authResult.user.username !== 'admin') {
      return NextResponse.json({ jobs: [] }, { status: 403 })
    }

    const client = tenant
      ? await getTenantScopedClient(tenant.id)
      : getSupabaseServiceClient()

    const query = client
      .from("jobs")
      .select("*, customers (*), cleaners (*)")

    if (tenant) {
      query.eq("tenant_id", tenant.id)
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(2000)

    if (error) {
      throw error
    }

    return NextResponse.json({ jobs: data || [] })
  } catch (error) {
    console.error("Failed to load calendar jobs:", error)
    return NextResponse.json({ jobs: [] }, { status: 500 })
  }
}
