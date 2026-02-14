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

// GET - List all tenants with all credential fields
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
      email,
      business_name,
      business_name_short,
      service_area,
      sdr_persona,
      owner_phone,
      owner_email,
      google_review_link,
      openphone_api_key,
      openphone_phone_id,
      openphone_phone_number,
      vapi_api_key,
      vapi_assistant_id,
      vapi_outbound_assistant_id,
      vapi_phone_id,
      stripe_secret_key,
      stripe_webhook_secret,
      housecall_pro_api_key,
      housecall_pro_company_id,
      housecall_pro_webhook_secret,
      ghl_location_id,
      ghl_webhook_secret,
      telegram_bot_token,
      owner_telegram_chat_id,
      wave_api_token,
      wave_business_id,
      wave_income_account_id,
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

// POST - Create new tenant
export async function POST(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { name, slug, email, password } = body

  if (!name || !slug) {
    return NextResponse.json({ success: false, error: "Name and slug are required" }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ success: false, error: "Slug must be lowercase alphanumeric with hyphens only" }, { status: 400 })
  }

  const client = getAdminClient()

  // Check if slug already exists
  const { data: existing } = await client
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .single()

  if (existing) {
    return NextResponse.json({ success: false, error: "A business with this slug already exists" }, { status: 400 })
  }

  // Create the tenant with default workflow config
  const { data: tenant, error } = await client
    .from("tenants")
    .insert({
      name,
      slug,
      email: email || null,
      business_name: name,
      active: true,
      workflow_config: {
        use_housecall_pro: false,
        use_vapi_inbound: true,
        use_vapi_outbound: true,
        use_ghl: false,
        use_stripe: true,
        use_wave: false,
        use_route_optimization: false,
        lead_followup_enabled: true,
        lead_followup_stages: 5,
        skip_calls_for_sms_leads: true,
        followup_delays_minutes: [0, 10, 15, 20, 30],
        post_cleaning_followup_enabled: true,
        post_cleaning_delay_hours: 2,
        monthly_followup_enabled: true,
        monthly_followup_days: 30,
        monthly_followup_discount: "15%",
        cleaner_assignment_auto: true,
        require_deposit: true,
        deposit_percentage: 50,
        sms_auto_response_enabled: true,
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: tenant })
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

// DELETE - Remove a tenant and all associated data
export async function DELETE(request: NextRequest) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tenantId } = body

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "tenantId is required" }, { status: 400 })
  }

  const client = getAdminClient()

  // Verify tenant exists
  const { data: tenant } = await client
    .from("tenants")
    .select("id, name, slug")
    .eq("id", tenantId)
    .single()

  if (!tenant) {
    return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 })
  }

  // Delete associated data in dependency order
  const deletions: string[] = []

  const tables = [
    "scheduled_tasks",
    "system_events",
    "cleaner_assignments",
    "reviews",
    "tips",
    "upsells",
    "messages",
    "calls",
    "jobs",
    "leads",
    "followup_queue",
    "customers",
    "cleaners",
    "teams",
    "sessions",
    "users",
  ]

  for (const table of tables) {
    const { count, error: delErr } = await client
      .from(table)
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)

    if (!delErr && count && count > 0) {
      deletions.push(`${table}: ${count} rows`)
    }
  }

  // Finally delete the tenant itself
  const { error } = await client
    .from("tenants")
    .delete()
    .eq("id", tenantId)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  deletions.push(`tenant: ${tenant.name} (${tenant.slug})`)

  return NextResponse.json({ success: true, data: { tenantId, deletions } })
}
