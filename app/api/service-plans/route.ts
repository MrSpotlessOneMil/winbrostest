import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()
  const { data: plans, error } = await supabase
    .from("service_plans")
    .select("id, slug, name, visits_per_year, interval_months, discount_per_visit, free_addons, active")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("name")

  if (error) {
    console.error("[Service Plans GET] Error:", error.message)
    return NextResponse.json({ error: "Failed to load plans" }, { status: 500 })
  }

  return NextResponse.json({ success: true, plans: plans || [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { name, visits_per_year, interval_months, discount_per_visit, free_addons } = body

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Plan name is required" }, { status: 400 })
  }
  if (!visits_per_year || typeof visits_per_year !== "number" || visits_per_year < 1) {
    return NextResponse.json({ error: "visits_per_year must be at least 1" }, { status: 400 })
  }
  if (!interval_months || typeof interval_months !== "number" || interval_months < 1) {
    return NextResponse.json({ error: "interval_months must be at least 1" }, { status: 400 })
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")

  const supabase = getSupabaseServiceClient()
  const { data: plan, error } = await supabase
    .from("service_plans")
    .insert({
      tenant_id: tenant.id,
      slug,
      name: name.trim(),
      visits_per_year,
      interval_months,
      discount_per_visit: discount_per_visit || 0,
      free_addons: free_addons || [],
      active: true,
    })
    .select()
    .single()

  if (error) {
    console.error("[Service Plans POST] Error:", error.message)
    return NextResponse.json({ error: "Failed to create plan" }, { status: 500 })
  }

  return NextResponse.json({ success: true, plan })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id, ...updates } = body

  if (!id) {
    return NextResponse.json({ error: "Plan id is required" }, { status: 400 })
  }

  // Only allow safe fields to be updated
  const allowed: Record<string, unknown> = {}
  if (typeof updates.name === "string") allowed.name = updates.name.trim()
  if (typeof updates.visits_per_year === "number") allowed.visits_per_year = updates.visits_per_year
  if (typeof updates.interval_months === "number") allowed.interval_months = updates.interval_months
  if (typeof updates.discount_per_visit === "number") allowed.discount_per_visit = updates.discount_per_visit
  if (Array.isArray(updates.free_addons)) allowed.free_addons = updates.free_addons

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check
  const { data: existing } = await supabase
    .from("service_plans")
    .select("id, tenant_id")
    .eq("id", id)
    .single()

  if (!existing || existing.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  const { error } = await supabase
    .from("service_plans")
    .update(allowed)
    .eq("id", id)

  if (error) {
    console.error("[Service Plans PATCH] Error:", error.message)
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = body

  if (!id) {
    return NextResponse.json({ error: "Plan id is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check
  const { data: existing } = await supabase
    .from("service_plans")
    .select("id, tenant_id")
    .eq("id", id)
    .single()

  if (!existing || existing.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  // Soft-delete: set active = false (preserves FK for existing memberships)
  const { error } = await supabase
    .from("service_plans")
    .update({ active: false })
    .eq("id", id)

  if (error) {
    console.error("[Service Plans DELETE] Error:", error.message)
    return NextResponse.json({ error: "Failed to delete plan" }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
