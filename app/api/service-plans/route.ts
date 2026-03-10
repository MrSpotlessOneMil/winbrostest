import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()
  const { data: plans, error } = await supabase
    .from("service_plans")
    .select("id, slug, name, visits_per_year, interval_months, discount_per_visit, free_addons, active")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("name")

  if (error) {
    console.error("[Service Plans GET] Error:", error.message)
    return NextResponse.json({ error: "Failed to load plans" }, { status: 500 })
  }

  return NextResponse.json({ success: true, plans: plans || [] })
}
