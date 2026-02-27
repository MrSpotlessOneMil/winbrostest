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

  if (!user.tenant_id) {
    return NextResponse.json({
      success: false,
      error: "Admin cannot toggle tenant status from here",
    }, { status: 403 })
  }

  const body = await request.json()
  const client = getSupabaseServiceClient()

  // Toggle sms_auto_response_enabled
  if (typeof body.sms_auto_response_enabled === "boolean") {
    const { data: tenant, error } = await client
      .from("tenants")
      .select("id, name, workflow_config")
      .eq("id", user.tenant_id)
      .single()

    if (error || !tenant) {
      return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 })
    }

    const wc = (tenant.workflow_config as Record<string, any>) || {}
    wc.sms_auto_response_enabled = body.sms_auto_response_enabled

    const { error: updateErr } = await client
      .from("tenants")
      .update({ workflow_config: wc, updated_at: new Date().toISOString() })
      .eq("id", user.tenant_id)

    if (updateErr) {
      return NextResponse.json({ success: false, error: "Failed to update" }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      sms_auto_response_enabled: body.sms_auto_response_enabled,
    })
  }

  // Toggle active status
  if (typeof body.active !== "boolean") {
    return NextResponse.json({
      success: false,
      error: "active (boolean) or sms_auto_response_enabled (boolean) is required",
    }, { status: 400 })
  }

  const { data: tenant, error } = await client
    .from("tenants")
    .update({ active: body.active, updated_at: new Date().toISOString() })
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
