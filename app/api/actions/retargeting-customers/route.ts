import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — List customers in a specific lifecycle stage
 * Query params: stage (lifecycle_stage value)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const stage = request.nextUrl.searchParams.get("stage")
  if (!stage) {
    return NextResponse.json({ error: "stage parameter required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone_number, email, lifecycle_stage, retargeting_sequence, retargeting_step, retargeting_enrolled_at, retargeting_completed_at, retargeting_stopped_reason, sms_opt_out, created_at, updated_at")
    .eq("tenant_id", tenant.id)
    .eq("lifecycle_stage", stage)
    .order("updated_at", { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, customers: customers || [] })
}
