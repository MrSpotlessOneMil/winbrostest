import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — Lead journey stats: follow-up stage breakdown + retargeting + opt-out counts
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  // Fetch leads with followup stage info
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("followup_stage, status, converted_to_job_id")
    .eq("tenant_id", tenant.id)

  if (leadsError) {
    return NextResponse.json({ error: leadsError.message }, { status: 500 })
  }

  // Build follow-up stats
  const byStage: Record<number, number> = {}
  let converted = 0
  let lost = 0
  let responded = 0

  for (const lead of leads || []) {
    const stage = lead.followup_stage ?? 0
    byStage[stage] = (byStage[stage] || 0) + 1

    if (lead.converted_to_job_id) converted++
    if (lead.status === "lost" || lead.status === "unresponsive") lost++
    if (lead.status === "responded" || lead.status === "escalated") responded++
  }

  // Retargeting stats for new_lead sequence
  const { data: retargetingCustomers, error: retargetError } = await supabase
    .from("customers")
    .select("retargeting_sequence, retargeting_stopped_reason")
    .eq("tenant_id", tenant.id)
    .eq("retargeting_sequence", "new_lead")

  if (retargetError) {
    return NextResponse.json({ error: retargetError.message }, { status: 500 })
  }

  let inSequence = 0
  let completedRetargeting = 0
  let convertedRetargeting = 0

  for (const c of retargetingCustomers || []) {
    if (!c.retargeting_stopped_reason) {
      inSequence++
    } else if (c.retargeting_stopped_reason === "completed") {
      completedRetargeting++
    } else if (c.retargeting_stopped_reason === "converted") {
      convertedRetargeting++
    }
  }

  // Opt-out count
  const { count: optedOut, error: optOutError } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("sms_opt_out", true)

  if (optOutError) {
    return NextResponse.json({ error: optOutError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    followup: {
      total: (leads || []).length,
      by_stage: byStage,
      converted,
      lost,
      responded,
    },
    retargeting: {
      in_sequence: inSequence,
      completed: completedRetargeting,
      converted: convertedRetargeting,
    },
    opted_out: optedOut || 0,
  })
}
