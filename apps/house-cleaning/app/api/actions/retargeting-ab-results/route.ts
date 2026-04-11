import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — A/B test results for retargeting sequences
 * Returns enrolled/replied/converted counts per sequence + variant
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const { data, error } = await supabase
    .from("customers")
    .select("retargeting_sequence, retargeting_variant, retargeting_replied_at, retargeting_stopped_reason")
    .eq("tenant_id", tenant.id)
    .not("retargeting_variant", "is", null)

  if (error) {
    return NextResponse.json({ error: "Failed to load A/B results" }, { status: 500 })
  }

  // Aggregate: { [sequence]: { a: { enrolled, replied, converted }, b: { ... } } }
  const results: Record<string, Record<string, { enrolled: number; replied: number; converted: number }>> = {}

  for (const row of data || []) {
    const seq = row.retargeting_sequence || "unknown"
    const v = row.retargeting_variant || "a"

    if (!results[seq]) results[seq] = {}
    if (!results[seq][v]) results[seq][v] = { enrolled: 0, replied: 0, converted: 0 }

    results[seq][v].enrolled++
    if (row.retargeting_replied_at) results[seq][v].replied++
    if (row.retargeting_stopped_reason === "converted") results[seq][v].converted++
  }

  return NextResponse.json({ success: true, results })
}
