import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  if (!user.tenant_id) {
    // Admin user has no tenant — return a safe default
    return NextResponse.json({
      success: true,
      active: true,
      tenantName: "Admin",
      isAdmin: true,
    })
  }

  const client = getSupabaseServiceClient()

  // Query tenant directly WITHOUT active filter (so we can see inactive tenants)
  const { data: tenant, error } = await client
    .from("tenants")
    .select("id, name, active")
    .eq("id", user.tenant_id)
    .single()

  if (error || !tenant) {
    return NextResponse.json({
      success: false,
      error: "Business not found",
    }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    active: tenant.active,
    tenantName: tenant.name,
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult
  const { user } = authResult

  const { active } = await request.json()

  if (typeof active !== "boolean") {
    return NextResponse.json({
      success: false,
      error: "active (boolean) is required",
    }, { status: 400 })
  }

  if (!user.tenant_id) {
    return NextResponse.json({
      success: false,
      error: "Admin cannot toggle tenant status from here",
    }, { status: 403 })
  }

  const client = getSupabaseServiceClient()

  // Update tenant active status
  const { data: tenant, error } = await client
    .from("tenants")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", user.tenant_id)
    .select("id, name, active")
    .single()

  if (error || !tenant) {
    return NextResponse.json({
      success: false,
      error: "Failed to update status",
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    active: tenant.active,
    tenantName: tenant.name,
  })
}
