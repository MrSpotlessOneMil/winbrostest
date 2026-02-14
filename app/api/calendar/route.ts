import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const tenant = await getAuthTenant(request)
    if (!tenant) {
      return NextResponse.json({ jobs: [] }, { status: 403 })
    }

    const client = getSupabaseClient()
    const { data, error } = await client
      .from("jobs")
      .select("*, customers (*), cleaners (*)")
      .eq("tenant_id", tenant.id)
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
