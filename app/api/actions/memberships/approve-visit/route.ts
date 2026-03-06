import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const { job_id, action, new_date } = await request.json()

  if (!job_id || !action) {
    return NextResponse.json({ error: "job_id and action are required" }, { status: 400 })
  }

  if (!["approve", "reschedule", "decline"].includes(action)) {
    return NextResponse.json({ error: "action must be approve, reschedule, or decline" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Look up and verify ownership
  const { data: job } = await supabase
    .from("jobs")
    .select("id, tenant_id, status, membership_id")
    .eq("id", job_id)
    .single()

  if (!job || job.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 })
  }

  if (job.status !== "pending_approval") {
    return NextResponse.json({ error: `Job is already ${job.status}` }, { status: 400 })
  }

  if (action === "approve") {
    // Move to pending (normal job flow)
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ status: "pending", booked: true })
      .eq("id", job_id)
      .eq("status", "pending_approval")

    if (updateError) {
      return NextResponse.json({ error: "Failed to approve" }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: "pending" })
  }

  if (action === "reschedule") {
    if (!new_date) {
      return NextResponse.json({ error: "new_date is required for reschedule" }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from("jobs")
      .update({ date: new_date })
      .eq("id", job_id)
      .eq("status", "pending_approval")

    if (updateError) {
      return NextResponse.json({ error: "Failed to reschedule" }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: "pending_approval", new_date })
  }

  if (action === "decline") {
    // Cancel the job and update membership next_visit_at to push it forward
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ status: "cancelled" })
      .eq("id", job_id)
      .eq("status", "pending_approval")

    if (updateError) {
      return NextResponse.json({ error: "Failed to decline" }, { status: 500 })
    }

    // If linked to a membership, push next_visit_at forward by the interval
    if (job.membership_id) {
      try {
        const { data: membership } = await supabase
          .from("customer_memberships")
          .select("id, next_visit_at, service_plans!inner(interval_months)")
          .eq("id", job.membership_id)
          .single()

        if (membership) {
          const plan = membership.service_plans as any
          const nextVisit = new Date(membership.next_visit_at || new Date())
          nextVisit.setMonth(nextVisit.getMonth() + (plan.interval_months || 3))

          await supabase
            .from("customer_memberships")
            .update({ next_visit_at: nextVisit.toISOString() })
            .eq("id", job.membership_id)
        }
      } catch (err) {
        console.error("[approve-visit] Failed to update membership next_visit:", err)
      }
    }

    return NextResponse.json({ success: true, status: "cancelled" })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
