import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

// Check if user is admin
async function isAdmin(request: NextRequest): Promise<boolean> {
  const cookieStore = await cookies()
  // Use the correct session cookie name from auth.ts
  const sessionToken = cookieStore.get("winbros_session")?.value

  if (!sessionToken) return false

  const client = getAdminClient()
  const { data: session } = await client
    .from("sessions")
    .select("user_id, users!inner(username)")
    .eq("token", sessionToken)
    .gt("expires_at", new Date().toISOString())
    .single()

  if (!session) return false

  // Check if user is admin
  const user = session.users as { username: string }
  return user.username === "admin"
}

// GET - List all tenants
export async function GET(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = getAdminClient()

  const { data: tenants, error } = await client
    .from("tenants")
    .select(`
      id,
      name,
      slug,
      business_name,
      business_name_short,
      openphone_phone_number,
      service_area,
      sdr_persona,
      workflow_config,
      active,
      created_at,
      updated_at
    `)
    .order("name")

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: tenants })
}

// PATCH - Update tenant settings
export async function PATCH(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tenantId, updates } = body

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "tenantId is required" }, { status: 400 })
  }

  const client = getAdminClient()

  // If updating workflow_config, merge with existing
  if (updates.workflow_config) {
    const { data: existing } = await client
      .from("tenants")
      .select("workflow_config")
      .eq("id", tenantId)
      .single()

    if (existing) {
      updates.workflow_config = {
        ...existing.workflow_config,
        ...updates.workflow_config,
      }
    }
  }

  const { data, error } = await client
    .from("tenants")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tenantId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}
