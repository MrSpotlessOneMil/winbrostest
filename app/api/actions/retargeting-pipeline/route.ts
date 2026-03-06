import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { scheduleRetargetingSequence, type RetargetingSequenceType } from "@/lib/scheduler"

/**
 * GET — Pipeline summary: counts per lifecycle stage + retargeting status
 * POST — Enroll a segment (or specific customers) in a retargeting sequence
 * PATCH — Override lifecycle stage for specific customers (e.g. mark as lost/bad experience)
 * DELETE — Cancel retargeting for specific customers or an entire segment
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

  const validSequences: RetargetingSequenceType[] = ["unresponsive", "quoted_not_booked", "one_time", "lapsed", "new_lead", "repeat", "active", "lost"]
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

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { customer_ids, override } = await request.json()

  if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
    return NextResponse.json({ error: "customer_ids array is required" }, { status: 400 })
  }

  const validOverrides = ["lost", "new_lead", "unresponsive", "quoted_not_booked", null]
  if (!validOverrides.includes(override)) {
    return NextResponse.json({ error: `Invalid override. Must be one of: ${validOverrides.filter(Boolean).join(", ")}, or null to clear` }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Verify tenant ownership
  const { data: customers } = await supabase
    .from("customers")
    .select("id")
    .eq("tenant_id", tenant.id)
    .in("id", customer_ids)

  if (!customers || customers.length === 0) {
    return NextResponse.json({ error: "No matching customers found" }, { status: 404 })
  }

  let updated = 0
  for (const c of customers) {
    // Cancel any active retargeting sequences when marking as lost
    if (override === "lost") {
      await supabase
        .from("scheduled_tasks")
        .update({ status: "cancelled" })
        .eq("tenant_id", tenant.id)
        .eq("task_type", "retargeting")
        .like("task_key", `retarget-${c.id}-%`)
        .in("status", ["pending", "processing"])
    }

    const updatePayload: Record<string, unknown> = {
      lifecycle_stage_override: override,
    }
    // When setting an override, also set lifecycle_stage directly
    if (override) {
      updatePayload.lifecycle_stage = override
    }
    // When marking as lost, also cancel retargeting state
    if (override === "lost") {
      updatePayload.retargeting_sequence = null
      updatePayload.retargeting_step = null
      updatePayload.retargeting_enrolled_at = null
      updatePayload.retargeting_completed_at = null
      updatePayload.retargeting_stopped_reason = null
    }

    await supabase
      .from("customers")
      .update(updatePayload)
      .eq("id", c.id)
      .eq("tenant_id", tenant.id)

    updated++
  }

  return NextResponse.json({ success: true, updated })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { customer_ids } = await request.json()

  if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
    return NextResponse.json({ error: "customer_ids array is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Get customers to cancel — verify tenant ownership and active sequence
  const { data: customers } = await supabase
    .from("customers")
    .select("id, retargeting_sequence")
    .eq("tenant_id", tenant.id)
    .in("id", customer_ids)
    .not("retargeting_sequence", "is", null)

  if (!customers || customers.length === 0) {
    return NextResponse.json({ success: true, cancelled: 0, message: "No active sequences found" })
  }

  let cancelled = 0

  for (const c of customers) {
    // Cancel pending scheduled tasks for this customer
    await supabase
      .from("scheduled_tasks")
      .update({ status: "cancelled" })
      .eq("tenant_id", tenant.id)
      .eq("task_type", "retargeting")
      .like("task_key", `retarget-${c.id}-%`)
      .in("status", ["pending", "processing"])

    // Reset customer retargeting state
    await supabase
      .from("customers")
      .update({
        retargeting_sequence: null,
        retargeting_step: null,
        retargeting_enrolled_at: null,
        retargeting_completed_at: null,
        retargeting_stopped_reason: null,
      })
      .eq("id", c.id)
      .eq("tenant_id", tenant.id)

    cancelled++
  }

  return NextResponse.json({ success: true, cancelled })
}
