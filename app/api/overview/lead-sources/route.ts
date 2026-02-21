import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant && authResult.user.username !== "admin") {
    return NextResponse.json({ data: [] })
  }

  const supabase = getSupabaseServiceClient()

  let query = supabase
    .from("leads")
    .select("source, converted_to_job_id")

  if (tenant) {
    query = query.eq("tenant_id", tenant.id)
  }

  const { data: leads, error } = await query

  if (error) {
    return NextResponse.json({ data: [] })
  }

  // Aggregate by source
  const sourceMap: Record<string, { leads: number; jobs: number }> = {}

  for (const lead of leads || []) {
    const src = lead.source || "unknown"
    if (!sourceMap[src]) sourceMap[src] = { leads: 0, jobs: 0 }
    sourceMap[src].leads++
    if (lead.converted_to_job_id) sourceMap[src].jobs++
  }

  const data = Object.entries(sourceMap).map(([source, counts]) => ({
    source,
    leads: counts.leads,
    jobs: counts.jobs,
  }))

  return NextResponse.json({ data })
}
