import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"


// GET - List all tenants with all credential fields
export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const client = getSupabaseServiceClient()

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
      service_description,
      timezone,
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
      stripe_publishable_key,
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
      gmail_user,
      gmail_app_password,
      telegram_webhook_registered_at,
      telegram_webhook_error,
      telegram_webhook_error_at,
      stripe_webhook_registered_at,
      stripe_webhook_error,
      stripe_webhook_error_at,
      openphone_webhook_registered_at,
      openphone_webhook_error,
      openphone_webhook_error_at,
      vapi_webhook_registered_at,
      vapi_webhook_error,
      vapi_webhook_error_at,
      workflow_config,
      active,
      created_at,
      updated_at
    `)
    .order("name")

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Batch-fetch cleaner and pricing counts per tenant
  const tenantIds = (tenants || []).map((t: any) => t.id)

  const { data: cleanerRows } = tenantIds.length > 0
    ? await client
        .from("cleaners")
        .select("tenant_id")
        .in("tenant_id", tenantIds)
        .eq("active", true)
        .is("deleted_at", null)
    : { data: [] }

  const { data: pricingRows } = tenantIds.length > 0
    ? await client
        .from("pricing_tiers")
        .select("tenant_id")
        .in("tenant_id", tenantIds)
    : { data: [] }

  const cleanerCountMap: Record<string, number> = {}
  for (const row of cleanerRows || []) {
    cleanerCountMap[row.tenant_id] = (cleanerCountMap[row.tenant_id] || 0) + 1
  }

  const pricingCountMap: Record<string, number> = {}
  for (const row of pricingRows || []) {
    pricingCountMap[row.tenant_id] = (pricingCountMap[row.tenant_id] || 0) + 1
  }

  // Batch-fetch latest webhook events per tenant per source (for HCP/GHL/VAPI health)
  const webhookSources = ["housecall_pro", "ghl", "vapi"]
  const { data: webhookEventRows } = tenantIds.length > 0
    ? await client
        .from("system_events")
        .select("tenant_id, source, event_type, created_at")
        .in("tenant_id", tenantIds)
        .in("source", webhookSources)
        .order("created_at", { ascending: false })
        .limit(300)
    : { data: [] }

  // Deduplicate: keep only the latest event per (tenant_id, source)
  const webhookHealthMap: Record<string, Record<string, { last_event_at: string; last_event_type: string }>> = {}
  for (const row of webhookEventRows || []) {
    if (!webhookHealthMap[row.tenant_id]) webhookHealthMap[row.tenant_id] = {}
    if (!webhookHealthMap[row.tenant_id][row.source]) {
      webhookHealthMap[row.tenant_id][row.source] = {
        last_event_at: row.created_at,
        last_event_type: row.event_type,
      }
    }
  }

  // Mask secret values — show only last 4 chars
  const SECRET_FIELDS = [
    'openphone_api_key', 'vapi_api_key', 'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret',
    'housecall_pro_api_key', 'housecall_pro_webhook_secret', 'ghl_webhook_secret',
    'telegram_bot_token', 'wave_api_token', 'openphone_webhook_secret',
  ]
  function maskSecret(val: string | null): string | null {
    if (!val) return null
    if (val.length <= 8) return '****'
    return '****' + val.slice(-4)
  }

  const enrichedTenants = (tenants || []).map((t: any) => {
    const masked = { ...t }
    for (const field of SECRET_FIELDS) {
      if (masked[field]) masked[field] = maskSecret(masked[field])
    }
    return {
      ...masked,
      cleaner_count: cleanerCountMap[t.id] || 0,
      pricing_tier_count: pricingCountMap[t.id] || 0,
      webhook_health: {
        housecall_pro: webhookHealthMap[t.id]?.housecall_pro || null,
        ghl: webhookHealthMap[t.id]?.ghl || null,
        vapi: webhookHealthMap[t.id]?.vapi || null,
      },
    }
  })

  return NextResponse.json({ success: true, data: enrichedTenants })
}

// POST - Create new tenant
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const {
    name, slug, email, password,
    business_name, business_name_short, service_area, service_description,
    sdr_persona, owner_phone, owner_email, timezone,
    flow_flags, // optional: { use_hcp_mirror, use_team_routing, use_cleaner_dispatch, ... }
  } = body

  if (!name || !slug) {
    return NextResponse.json({ success: false, error: "Name and slug are required" }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ success: false, error: "Slug must be lowercase alphanumeric with hyphens only" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

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
      business_name: business_name || name,
      business_name_short: business_name_short || null,
      service_area: service_area || null,
      service_description: service_description || null,
      sdr_persona: sdr_persona || 'Mary',
      owner_phone: owner_phone || null,
      owner_email: owner_email || email || null,
      timezone: timezone || 'America/Chicago',
      active: true,
      workflow_config: {
        // Integration toggles
        use_housecall_pro: false,
        use_vapi_inbound: true,
        use_vapi_outbound: true,
        use_ghl: false,
        use_stripe: true,
        use_wave: false,
        use_route_optimization: false,
        // Lead follow-up
        lead_followup_enabled: true,
        lead_followup_stages: 6,
        skip_calls_for_sms_leads: true,
        followup_delays_minutes: [0, 15, 1440, 4320, 10080, 20160],
        // Post-cleaning follow-up
        post_cleaning_followup_enabled: true,
        post_cleaning_delay_hours: 2,
        // Monthly follow-up
        monthly_followup_enabled: true,
        monthly_followup_days: 30,
        monthly_followup_discount: "15%",
        // Cleaner assignment
        cleaner_assignment_auto: true,
        require_deposit: true,
        deposit_percentage: 50,
        sms_auto_response_enabled: true,
        // Lifecycle messaging
        seasonal_reminders_enabled: false,
        frequency_nudge_enabled: false,
        frequency_nudge_days: 21,
        review_only_followup_enabled: false,
        seasonal_campaigns: [],
        // Flow flags (set based on body.flow_flags or default to standard house cleaning flow)
        use_hcp_mirror: body.flow_flags?.use_hcp_mirror ?? false,
        use_rainy_day_reschedule: body.flow_flags?.use_rainy_day_reschedule ?? false,
        use_team_routing: body.flow_flags?.use_team_routing ?? false,
        use_cleaner_dispatch: body.flow_flags?.use_cleaner_dispatch ?? true,
        use_review_request: body.flow_flags?.use_review_request ?? true,
        use_retargeting: body.flow_flags?.use_retargeting ?? true,
        use_payment_collection: body.flow_flags?.use_payment_collection ?? true,
      },
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  // Auto-create a login user for this tenant (username = slug)
  if (tenant) {
    const userPassword = password || randomBytes(12).toString('base64url') // Generate random password if not provided
    const { error: userError } = await client.rpc("create_user_with_password", {
      p_username: slug,
      p_password: userPassword,
      p_display_name: slug,
      p_email: email || null,
      p_tenant_id: tenant.id,
    })

    if (userError) {
      console.error("[Admin] Failed to auto-create user for tenant:", userError.message)
    }

    // Auto-seed default pricing tiers (7 standard + 7 deep clean)
    const defaultTiers = [
      { service_type: "standard", bedrooms: 1, bathrooms: 1, max_sq_ft: 800, price: 200, price_min: 200, price_max: 200, labor_hours: 4, cleaners: 1, hours_per_cleaner: 4 },
      { service_type: "standard", bedrooms: 2, bathrooms: 1, max_sq_ft: 999, price: 237.5, price_min: 225, price_max: 250, labor_hours: 4.5, cleaners: 1, hours_per_cleaner: 4.5 },
      { service_type: "standard", bedrooms: 2, bathrooms: 2, max_sq_ft: 1250, price: 262.5, price_min: 250, price_max: 275, labor_hours: 5.5, cleaners: 1, hours_per_cleaner: 5.5 },
      { service_type: "standard", bedrooms: 3, bathrooms: 2, max_sq_ft: 1500, price: 362.5, price_min: 350, price_max: 375, labor_hours: 7, cleaners: 2, hours_per_cleaner: 3.5 },
      { service_type: "standard", bedrooms: 3, bathrooms: 3, max_sq_ft: 1999, price: 400, price_min: 375, price_max: 425, labor_hours: 8, cleaners: 2, hours_per_cleaner: 4 },
      { service_type: "standard", bedrooms: 4, bathrooms: 2, max_sq_ft: 2124, price: 475, price_min: 450, price_max: 500, labor_hours: 9.5, cleaners: 2, hours_per_cleaner: 4.75 },
      { service_type: "standard", bedrooms: 4, bathrooms: 3, max_sq_ft: 2374, price: 525, price_min: 500, price_max: 550, labor_hours: 10.5, cleaners: 2, hours_per_cleaner: 5.25 },
      { service_type: "deep", bedrooms: 1, bathrooms: 1, max_sq_ft: 800, price: 225, price_min: 200, price_max: 250, labor_hours: 4.5, cleaners: 1, hours_per_cleaner: 4.5 },
      { service_type: "deep", bedrooms: 2, bathrooms: 1, max_sq_ft: 999, price: 287.5, price_min: 275, price_max: 300, labor_hours: 5.5, cleaners: 1, hours_per_cleaner: 5.5 },
      { service_type: "deep", bedrooms: 2, bathrooms: 2, max_sq_ft: 1250, price: 325, price_min: 300, price_max: 350, labor_hours: 6.5, cleaners: 1, hours_per_cleaner: 6.5 },
      { service_type: "deep", bedrooms: 3, bathrooms: 2, max_sq_ft: 1500, price: 425, price_min: 400, price_max: 450, labor_hours: 9, cleaners: 2, hours_per_cleaner: 4.5 },
      { service_type: "deep", bedrooms: 3, bathrooms: 3, max_sq_ft: 1999, price: 475, price_min: 450, price_max: 500, labor_hours: 10, cleaners: 2, hours_per_cleaner: 5 },
      { service_type: "deep", bedrooms: 4, bathrooms: 2, max_sq_ft: 2001, price: 625, price_min: 600, price_max: 650, labor_hours: 13, cleaners: 2, hours_per_cleaner: 6.5 },
      { service_type: "deep", bedrooms: 4, bathrooms: 3, max_sq_ft: 2499, price: 725, price_min: 700, price_max: 750, labor_hours: 15, cleaners: 2, hours_per_cleaner: 7.5 },
    ].map((t) => ({ ...t, tenant_id: tenant.id }))

    const { error: tierError } = await client.from("pricing_tiers").insert(defaultTiers)
    if (tierError) {
      console.error("[Admin] Failed to seed pricing tiers:", tierError.message)
    }

    // Auto-seed default pricing addons (7 addons)
    const defaultAddons = [
      { addon_key: "inside_fridge", label: "Inside fridge", minutes: 30, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside fridge", "fridge interior"] },
      { addon_key: "inside_oven", label: "Inside oven", minutes: 30, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside oven", "oven interior"] },
      { addon_key: "inside_cabinets", label: "Inside cabinets", minutes: 60, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside cabinets", "cabinet interior"] },
      { addon_key: "windows_interior", label: "Interior windows", minutes: 30, flat_price: 50, price_multiplier: 1, included_in: null, keywords: ["interior windows", "inside windows"] },
      { addon_key: "windows_exterior", label: "Exterior windows", minutes: 60, flat_price: 100, price_multiplier: 1, included_in: null, keywords: ["exterior windows", "outside windows"] },
      { addon_key: "windows_both", label: "Interior + exterior windows", minutes: 90, flat_price: 150, price_multiplier: 1, included_in: null, keywords: ["both windows", "all windows"] },
      { addon_key: "pet_fee", label: "Pet fee", minutes: 0, flat_price: 25, price_multiplier: 1, included_in: null, keywords: ["pet", "pets", "dog", "cat"] },
    ].map((a) => ({ ...a, tenant_id: tenant.id, active: true }))

    const { error: addonError } = await client.from("pricing_addons").insert(defaultAddons)
    if (addonError) {
      console.error("[Admin] Failed to seed pricing addons:", addonError.message)
    }
  }

  return NextResponse.json({ success: true, data: tenant })
}

// PATCH - Update tenant settings
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tenantId, updates: rawUpdates } = body

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "tenantId is required" }, { status: 400 })
  }

  // Whitelist allowed fields to prevent injection of arbitrary columns
  const ALLOWED_FIELDS = new Set([
    'name', 'slug', 'email', 'business_name', 'business_name_short', 'service_area', 'service_description',
    'sdr_persona', 'owner_phone', 'owner_email', 'google_review_link', 'timezone',
    'openphone_api_key', 'openphone_phone_id', 'openphone_phone_number',
    'openphone_webhook_secret',
    'vapi_api_key', 'vapi_assistant_id', 'vapi_outbound_assistant_id', 'vapi_phone_id',
    'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret',
    'housecall_pro_api_key', 'housecall_pro_company_id', 'housecall_pro_webhook_secret',
    'ghl_location_id', 'ghl_webhook_secret',
    'telegram_bot_token', 'owner_telegram_chat_id',
    'wave_api_token', 'wave_business_id', 'wave_income_account_id',
    'gmail_user', 'gmail_app_password',
    'workflow_config', 'active',
  ])
  // Secret fields that are masked in GET — skip if the value looks masked
  const SECRET_PATCH_FIELDS = new Set([
    'openphone_api_key', 'vapi_api_key', 'stripe_secret_key', 'stripe_publishable_key', 'stripe_webhook_secret',
    'housecall_pro_api_key', 'housecall_pro_webhook_secret', 'ghl_webhook_secret',
    'telegram_bot_token', 'wave_api_token', 'openphone_webhook_secret',
    'gmail_app_password',
  ])
  const updates: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawUpdates || {})) {
    if (!ALLOWED_FIELDS.has(key)) continue
    // Skip masked values to prevent overwriting real secrets with "****xxxx"
    if (SECRET_PATCH_FIELDS.has(key) && typeof value === 'string' && value.startsWith('****')) continue
    updates[key] = value
  }

  const client = getSupabaseServiceClient()

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

  // If slug is being changed, validate and sync the user's username
  if (updates.slug) {
    if (!/^[a-z0-9-]+$/.test(updates.slug)) {
      return NextResponse.json({ success: false, error: "Slug must be lowercase alphanumeric with hyphens only" }, { status: 400 })
    }

    // Check for duplicate slug
    const { data: existingSlug } = await client
      .from("tenants")
      .select("id")
      .eq("slug", updates.slug)
      .neq("id", tenantId)
      .single()

    if (existingSlug) {
      return NextResponse.json({ success: false, error: "A business with this slug already exists" }, { status: 400 })
    }
  }

  // Invalidate webhook registration and errors when API keys change
  if (updates.telegram_bot_token !== undefined) {
    updates.telegram_webhook_registered_at = null
    updates.telegram_webhook_secret = null
    updates.telegram_webhook_error = null
    updates.telegram_webhook_error_at = null
  }
  if (updates.stripe_secret_key !== undefined) {
    updates.stripe_webhook_registered_at = null
    updates.stripe_webhook_secret = null
    updates.stripe_webhook_error = null
    updates.stripe_webhook_error_at = null
  }
  if (updates.openphone_api_key !== undefined) {
    updates.openphone_webhook_registered_at = null
    updates.openphone_webhook_secret = null
    updates.openphone_webhook_error = null
    updates.openphone_webhook_error_at = null
  }
  if (updates.vapi_api_key !== undefined || updates.vapi_assistant_id !== undefined) {
    updates.vapi_webhook_registered_at = null
    updates.vapi_webhook_error = null
    updates.vapi_webhook_error_at = null
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

  // Sync username when slug changes
  if (updates.slug) {
    await client
      .from("users")
      .update({ username: updates.slug, display_name: updates.slug })
      .eq("tenant_id", tenantId)
  }

  return NextResponse.json({ success: true, data })
}

// DELETE - Remove a tenant and all associated data
export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tenantId } = body

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "tenantId is required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

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
    "pricing_tiers",
    "pricing_addons",
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
