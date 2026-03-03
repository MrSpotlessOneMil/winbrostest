import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { scheduleRetargetingSequence, type RetargetingSequenceType } from "@/lib/scheduler"

/**
 * GET — Pipeline summary: counts per lifecycle stage + retargeting status
 * POST — Enroll a segment (or specific customers) in a retargeting sequence
 */

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  // Refresh lifecycle stages first
  await supabase.rpc('refresh_customer_lifecycles', { p_tenant_id: tenant.id })

  // Get pipeline summary
  const { data: pipeline } = await supabase
    .from("customers")
    .select("id, lifecycle_stage, retargeting_sequence, retargeting_step, retargeting_stopped_reason")
    .eq("tenant_id", tenant.id)

  if (!pipeline) {
    return NextResponse.json({ error: "Failed to load pipeline" }, { status: 500 })
  }

  // Compute counts per stage
  const stages: Record<string, { total: number; in_sequence: number; completed_sequence: number; converted: number }> = {}

  for (const c of pipeline) {
    const stage = c.lifecycle_stage || "unknown"
    if (!stages[stage]) {
      stages[stage] = { total: 0, in_sequence: 0, completed_sequence: 0, converted: 0 }
    }
    stages[stage].total++
    if (c.retargeting_sequence && !c.retargeting_stopped_reason) {
      stages[stage].in_sequence++
    }
    if (c.retargeting_stopped_reason === "completed") {
      stages[stage].completed_sequence++
    }
    if (c.retargeting_stopped_reason === "converted") {
      stages[stage].converted++
    }
  }

  return NextResponse.json({ success: true, stages, total: pipeline.length })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { segment, customer_ids } = await request.json()

  const validSequences: RetargetingSequenceType[] = ["unresponsive", "quoted_not_booked", "one_time", "lapsed"]
  if (!validSequences.includes(segment)) {
    return NextResponse.json({ error: `Invalid segment. Must be one of: ${validSequences.join(", ")}` }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Get customers to enroll — either specific IDs or all in this lifecycle stage
  let query = supabase
    .from("customers")
    .select("id, phone_number, first_name, last_name")
    .eq("tenant_id", tenant.id)
    .is("retargeting_sequence", null) // Not already in a sequence

  if (customer_ids && Array.isArray(customer_ids) && customer_ids.length > 0) {
    query = query.in("id", customer_ids)
  } else {
    // Enroll all customers in this lifecycle stage
    query = query.eq("lifecycle_stage", segment)
  }

  const { data: customers } = await query

  if (!customers || customers.length === 0) {
    return NextResponse.json({ success: true, enrolled: 0, message: "No eligible customers found" })
  }

  // Cap at 50 per batch to avoid timeouts
  const batch = customers.slice(0, 50)
  let enrolled = 0
  const errors: string[] = []

  for (const c of batch) {
    if (!c.phone_number) {
      errors.push(`Skipped ${c.first_name || "unknown"}: no phone number`)
      continue
    }

    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "there"

    try {
      await scheduleRetargetingSequence(
        tenant.id,
        c.id,
        c.phone_number,
        name,
        segment as RetargetingSequenceType,
      )
      enrolled++
    } catch (err) {
      errors.push(`Failed for ${c.first_name}: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  return NextResponse.json({
    success: true,
    enrolled,
    total_eligible: customers.length,
    errors,
  })
}
