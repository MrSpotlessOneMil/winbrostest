import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { chargeCardOnFile } from "@/lib/stripe-client"
import { sendSMS } from "@/lib/openphone"
import { getTenantById, getTenantBusinessName } from "@/lib/tenant"
import { logSystemEvent } from "@/lib/system-events"

type RecurringAction = "change-frequency" | "skip-next" | "pause" | "resume" | "cancel" | "delete-future"

/**
 * Charge cancellation fee if job is within the cancellation window.
 * Returns { charged: boolean, amount?: number } — never throws.
 */
async function maybeCancelFee(
  tenantId: string,
  jobDate: string | null,
  customerId: string | null,
  phoneNumber: string | null,
  jobId: number
): Promise<{ charged: boolean; amount?: number; error?: string }> {
  if (!jobDate || !customerId) return { charged: false }

  const tenant = await getTenantById(tenantId)
  if (!tenant) return { charged: false }

  const wc = tenant.workflow_config as any
  if (!wc?.use_card_on_file || !wc?.cancellation_fee_cents) return { charged: false }

  const windowHours = wc.cancellation_window_hours || 24
  const feeCents = wc.cancellation_fee_cents as number

  // Check if job is within cancellation window
  const jobDateTime = new Date(jobDate + 'T00:00:00')
  const now = new Date()
  const hoursUntilJob = (jobDateTime.getTime() - now.getTime()) / (1000 * 60 * 60)
  if (hoursUntilJob > windowHours || hoursUntilJob < 0) return { charged: false }

  // Look up customer's Stripe ID
  const client = getSupabaseServiceClient()
  const { data: customer } = await client
    .from("customers")
    .select("stripe_customer_id, phone_number")
    .eq("id", customerId)
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!customer?.stripe_customer_id || !tenant.stripe_secret_key) {
    // No card on file — log for manual follow-up
    if (phoneNumber) {
      const businessName = getTenantBusinessName(tenant)
      const feeAmount = (feeCents / 100).toFixed(2)
      await sendSMS(tenant, phoneNumber, `Your service has been cancelled within ${windowHours}hrs. A $${feeAmount} cancellation fee applies per our policy. Please contact ${businessName} to arrange payment.`)
    }
    await logSystemEvent({
      tenant_id: tenantId,
      source: "actions",
      event_type: "CANCELLATION_FEE_MANUAL",
      message: `Cancellation fee owed but no card on file for job ${jobId}.`,
      job_id: String(jobId),
      customer_id: customerId,
      phone_number: phoneNumber || undefined,
      metadata: { fee_cents: feeCents },
    })
    return { charged: false, error: "No card on file" }
  }

  // Charge the cancellation fee
  const result = await chargeCardOnFile(tenant.stripe_secret_key, customer.stripe_customer_id, feeCents, {
    job_id: String(jobId),
    payment_type: "CANCELLATION_FEE",
    phone_number: phoneNumber || "",
  })

  const feeAmount = (feeCents / 100).toFixed(2)
  if (result.success) {
    if (phoneNumber) {
      const businessName = getTenantBusinessName(tenant)
      const jobDateFormatted = new Date(jobDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      await sendSMS(tenant, phoneNumber, `Your service on ${jobDateFormatted} has been cancelled. A $${feeAmount} cancellation fee has been charged per our policy. - ${businessName}`)
    }
    await logSystemEvent({
      tenant_id: tenantId,
      source: "actions",
      event_type: "CANCELLATION_FEE_CHARGED",
      message: `Cancellation fee $${feeAmount} charged for job ${jobId}.`,
      job_id: String(jobId),
      customer_id: customerId,
      phone_number: phoneNumber || undefined,
      metadata: { fee_cents: feeCents, payment_intent_id: result.paymentIntentId },
    })
    return { charged: true, amount: feeCents / 100 }
  }

  console.error(`[recurring] Cancellation fee charge failed for job ${jobId}: ${result.error}`)
  return { charged: false, error: result.error }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthWithTenant(request)
  if (auth instanceof NextResponse) return auth
  const { tenant } = auth

  let action: RecurringAction
  let parent_job_id: number | undefined
  let job_id: number | undefined
  let frequency: string | undefined
  try {
    const body = await request.json()
    ;({ action, parent_job_id, job_id, frequency } = body)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
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
      .select("id, tenant_id, customer_id, frequency, parent_job_id, date, status, phone_number")
      .eq("id", targetId)
      .maybeSingle()

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }
    if (job.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Check cancellation fee for the clicked job
    const cancelFee = await maybeCancelFee(
      tenant.id,
      job.date,
      job.customer_id,
      job.phone_number,
      job.id
    )

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

    return NextResponse.json({
      success: true,
      action: "delete-future",
      deleted_count: deletedCount,
      cancellation_fee_charged: cancelFee.charged,
      cancellation_fee_amount: cancelFee.amount,
    })
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
      // Check if the next upcoming job is within cancellation fee window
      const { data: nextJob } = await client
        .from("jobs")
        .select("id, date, customer_id, phone_number")
        .eq("parent_job_id", parent_job_id)
        .gte("date", today)
        .in("status", ["scheduled", "pending"])
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle()

      let cancellationFee: { charged: boolean; amount?: number } = { charged: false }
      if (nextJob) {
        cancellationFee = await maybeCancelFee(
          tenant.id,
          nextJob.date,
          nextJob.customer_id,
          nextJob.phone_number,
          nextJob.id
        )
      }

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

      return NextResponse.json({
        success: true,
        action: "cancel",
        cancelled_count: count || 0,
        cancellation_fee_charged: cancellationFee.charged,
        cancellation_fee_amount: cancellationFee.amount,
      })
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
