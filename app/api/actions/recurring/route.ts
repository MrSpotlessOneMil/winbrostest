import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

type RecurringAction = "change-frequency" | "skip-next" | "pause" | "resume" | "cancel" | "delete-future"

export async function POST(request: NextRequest) {
  const auth = await requireAuthWithTenant(request)
  if (auth instanceof NextResponse) return auth
  const { tenant } = auth

  const body = await request.json()
  const { action, parent_job_id, job_id, frequency } = body as {
    action: RecurringAction
    parent_job_id?: number
    job_id?: number
    frequency?: string
  }

  if (!action) {
    return NextResponse.json({ error: "action required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const today = new Date().toISOString().split("T")[0]

  // delete-future uses job_id instead of parent_job_id
  if (action === "delete-future") {
    const targetId = job_id || parent_job_id
    if (!targetId) {
      return NextResponse.json({ error: "job_id required" }, { status: 400 })
    }

    // Fetch the clicked job
    const { data: job, error: jobErr } = await client
      .from("jobs")
      .select("id, tenant_id, customer_id, frequency, parent_job_id, date, status")
      .eq("id", targetId)
      .maybeSingle()

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }
    if (job.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const fromDate = job.date || today
    const parentId = job.parent_job_id || job.id
    let deletedCount = 0

    // 1. Delete proper children (parent_job_id matches)
    const { data: children } = await client
      .from("jobs")
      .select("id")
      .eq("parent_job_id", parentId)
      .gte("date", fromDate)
      .neq("status", "completed")
      .eq("tenant_id", tenant.id)

    // 2. Also find orphaned siblings (same customer, same frequency, no parent_job_id, different from clicked)
    const orphanQuery = client
      .from("jobs")
      .select("id")
      .eq("customer_id", job.customer_id)
      .eq("tenant_id", tenant.id)
      .is("parent_job_id", null)
      .neq("id", targetId)
      .gte("date", fromDate)
      .neq("status", "completed")

    if (job.frequency && job.frequency !== "one-time") {
      orphanQuery.eq("frequency", job.frequency)
    }

    const { data: orphans } = await orphanQuery

    const allIds = new Set<number>()
    for (const c of children || []) allIds.add(c.id)
    for (const o of orphans || []) allIds.add(o.id)
    allIds.add(targetId) // include the clicked job itself

    // Delete all — null out FKs first, then delete
    for (const id of allIds) {
      await client.from("messages").update({ job_id: null }).eq("job_id", id)
      await client.from("calls").update({ job_id: null }).eq("job_id", id)
      await client.from("leads").update({ converted_to_job_id: null }).eq("converted_to_job_id", id)
      const { error: delErr } = await client.from("jobs").delete().eq("id", id).eq("tenant_id", tenant.id)
      if (!delErr) deletedCount++
    }

    // If there's a parent, pause it to stop future generation
    if (job.parent_job_id) {
      await client
        .from("jobs")
        .update({ paused_at: new Date().toISOString() })
        .eq("id", job.parent_job_id)
        .is("paused_at", null)
    }

    return NextResponse.json({ success: true, action: "delete-future", deleted_count: deletedCount })
  }

  // All other actions require parent_job_id
  if (!parent_job_id) {
    return NextResponse.json({ error: "parent_job_id required" }, { status: 400 })
  }

  // Fetch parent job + cross-tenant validation
  const { data: parentJob, error: fetchErr } = await client
    .from("jobs")
    .select("id, tenant_id, frequency, status, paused_at, date, last_generated_date")
    .eq("id", parent_job_id)
    .is("parent_job_id", null)
    .maybeSingle()

  if (fetchErr || !parentJob) {
    return NextResponse.json({ error: "Recurring series not found" }, { status: 404 })
  }

  if (parentJob.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  if (parentJob.frequency === "one-time") {
    return NextResponse.json({ error: "Job is not recurring" }, { status: 400 })
  }

  // Status guard: reject mutations on cancelled/completed series
  if (parentJob.status === "cancelled" || parentJob.status === "completed") {
    return NextResponse.json({ error: `Cannot modify a ${parentJob.status} series` }, { status: 400 })
  }

  switch (action) {
    case "change-frequency": {
      if (!frequency || !["weekly", "bi-weekly", "monthly"].includes(frequency)) {
        return NextResponse.json({ error: "Valid frequency required" }, { status: 400 })
      }

      // Update parent
      await client.from("jobs").update({ frequency }).eq("id", parent_job_id)

      // Update all future child instances
      await client
        .from("jobs")
        .update({ frequency })
        .eq("parent_job_id", parent_job_id)
        .gte("date", today)
        .in("status", ["scheduled", "pending"])

      return NextResponse.json({ success: true, action: "change-frequency", frequency })
    }

    case "skip-next": {
      // Find the next upcoming instance
      const { data: nextInstance } = await client
        .from("jobs")
        .select("id, date")
        .eq("parent_job_id", parent_job_id)
        .gte("date", today)
        .in("status", ["scheduled", "pending"])
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle()

      if (!nextInstance) {
        return NextResponse.json({ error: "No upcoming instance to skip" }, { status: 404 })
      }

      // Atomic update with status guard to prevent TOCTOU race
      const { data: skipped } = await client
        .from("jobs")
        .update({ status: "cancelled", notes: `Skipped by dashboard on ${new Date().toISOString()}` })
        .eq("id", nextInstance.id)
        .in("status", ["scheduled", "pending"])
        .select("id")
        .maybeSingle()

      if (!skipped) {
        return NextResponse.json({ error: "Job already transitioned" }, { status: 409 })
      }

      return NextResponse.json({ success: true, action: "skip-next", skipped_job_id: nextInstance.id, skipped_date: nextInstance.date })
    }

    case "pause": {
      if (parentJob.paused_at) {
        return NextResponse.json({ error: "Already paused" }, { status: 400 })
      }

      await client
        .from("jobs")
        .update({ paused_at: new Date().toISOString() })
        .eq("id", parent_job_id)
        .is("paused_at", null) // Atomic guard

      return NextResponse.json({ success: true, action: "pause" })
    }

    case "resume": {
      if (!parentJob.paused_at) {
        return NextResponse.json({ error: "Not paused" }, { status: 400 })
      }

      // Clear pause — the cron will regenerate instances on its next run
      await client
        .from("jobs")
        .update({ paused_at: null })
        .eq("id", parent_job_id)

      return NextResponse.json({ success: true, action: "resume" })
    }

    case "cancel": {
      // Cancel all future child instances
      const { count } = await client
        .from("jobs")
        .update({ status: "cancelled" })
        .eq("parent_job_id", parent_job_id)
        .gte("date", today)
        .in("status", ["scheduled", "pending"])

      // Mark parent as cancelled (atomic — only if not already cancelled)
      await client
        .from("jobs")
        .update({ status: "cancelled", frequency: "one-time" })
        .eq("id", parent_job_id)
        .neq("status", "cancelled")

      return NextResponse.json({ success: true, action: "cancel", cancelled_count: count || 0 })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
