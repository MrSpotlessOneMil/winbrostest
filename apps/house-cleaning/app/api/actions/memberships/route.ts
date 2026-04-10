import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/** Safely add months without JS Date overflow (Jan 31 + 1 month = Feb 28, not Mar 3) */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setMonth(result.getMonth() + months)
  if (result.getDate() !== day) {
    result.setDate(0)
  }
  return result
}

/**
 * GET -- List memberships for the tenant
 * Query params: status (optional), limit (default 50)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const customerId = searchParams.get("customer_id")
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200)

  let query = supabase
    .from("customer_memberships")
    .select(`
      *,
      customers ( id, first_name, last_name, phone_number, email, address ),
      service_plans ( id, name, slug, visits_per_year, interval_months, discount_per_visit, free_addons )
    `)
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq("status", status)
  }
  if (customerId) {
    query = query.eq("customer_id", customerId)
  }

  const { data: memberships, error } = await query

  if (error) {
    console.error("[Memberships GET] Error:", error.message)
    return NextResponse.json({ error: "Failed to load memberships" }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: memberships, memberships })
}

/**
 * POST -- Create a membership manually
 * Body: { customer_id, plan_slug }
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { customer_id, plan_slug } = body

  if (!customer_id || !plan_slug || typeof plan_slug !== "string") {
    return NextResponse.json({ error: "customer_id and plan_slug (string) are required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check: verify customer belongs to tenant
  const { data: customer } = await supabase
    .from("customers")
    .select("id, tenant_id")
    .eq("id", customer_id)
    .single()

  if (!customer || customer.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  }

  // Look up plan by slug + tenant_id
  const { data: plan, error: planError } = await supabase
    .from("service_plans")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("slug", plan_slug)
    .eq("active", true)
    .single()

  if (planError || !plan) {
    return NextResponse.json({ error: "Service plan not found" }, { status: 404 })
  }

  // Check for existing active membership for this customer + plan
  const { data: existing } = await supabase
    .from("customer_memberships")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("customer_id", customer_id)
    .eq("plan_id", plan.id)
    .eq("status", "active")
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "Customer already has an active membership for this plan" }, { status: 409 })
  }

  // Calculate next_visit_at based on plan interval
  const nextVisit = addMonths(new Date(), plan.interval_months)

  const { data: membership, error: insertError } = await supabase
    .from("customer_memberships")
    .insert({
      tenant_id: tenant.id,
      customer_id,
      plan_id: plan.id,
      status: "active",
      started_at: new Date().toISOString(),
      next_visit_at: nextVisit.toISOString(),
      visits_completed: 0,
    })
    .select("*")
    .single()

  if (insertError) {
    console.error("[Memberships POST] Insert error:", insertError.message)
    return NextResponse.json({ error: "Failed to create membership" }, { status: 500 })
  }

  return NextResponse.json({ success: true, membership })
}

/**
 * PATCH -- Update membership (pause/cancel/resume)
 * Body: { membership_id, action: 'pause' | 'cancel' | 'resume' }
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { membership_id, action } = body

  if (!membership_id || !action) {
    return NextResponse.json({ error: "membership_id and action are required" }, { status: 400 })
  }

  if (!["pause", "cancel", "resume"].includes(action as string)) {
    return NextResponse.json({ error: "action must be pause, cancel, or resume" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check: fetch membership and verify tenant
  const { data: membership, error: fetchError } = await supabase
    .from("customer_memberships")
    .select(`
      *,
      service_plans ( visits_per_year, interval_months )
    `)
    .eq("id", membership_id)
    .single()

  if (fetchError || !membership) {
    return NextResponse.json({ error: "Membership not found" }, { status: 404 })
  }

  if (membership.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Membership not found" }, { status: 404 })
  }

  const plan = membership.service_plans as any
  const updates: Record<string, any> = { updated_at: new Date().toISOString() }

  switch (action) {
    case "pause": {
      if (membership.status !== "active") {
        return NextResponse.json({ error: "Can only pause active memberships" }, { status: 400 })
      }
      updates.status = "paused"
      break
    }

    case "cancel": {
      if (membership.status === "cancelled" || membership.status === "completed") {
        return NextResponse.json({ error: `Cannot cancel a ${membership.status} membership` }, { status: 400 })
      }
      updates.status = "cancelled"
      updates.cancelled_at = new Date().toISOString()
      break
    }

    case "resume": {
      if (membership.status !== "paused") {
        return NextResponse.json({ error: "Can only resume paused memberships" }, { status: 400 })
      }
      updates.status = "active"

      // If next_visit_at is in the past, recalculate from now
      if (membership.next_visit_at && new Date(membership.next_visit_at) < new Date()) {
        updates.next_visit_at = addMonths(new Date(), plan?.interval_months || 1).toISOString()
      }
      break
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from("customer_memberships")
    .update(updates)
    .eq("id", membership_id)
    .eq("tenant_id", tenant.id) // Belt-and-suspenders tenant check
    .select("*")
    .single()

  if (updateError) {
    console.error("[Memberships PATCH] Update error:", updateError.message)
    return NextResponse.json({ error: "Failed to update membership" }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    membership: updated,
    action,
  })
}
