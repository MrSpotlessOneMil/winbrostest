import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"
import Stripe from "stripe"
import {
  getWorkflowConfigForFlowType,
  getBaseUrl,
  testStripeConnection,
  testOpenPhoneConnection,
  testVapiConnection,
  testTelegramConnection,
  testWaveConnection,
  registerTelegramWebhook,
  registerStripeWebhook,
  registerOpenPhoneWebhook,
  getDefaultPricingTiers,
  getDefaultPricingAddons,
  StepResult,
} from "@/lib/admin-onboard"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

interface StepStatus {
  status: "success" | "failed" | "skipped"
  message: string
  data?: any
}

interface OnboardResult {
  tenantId: string | null
  steps: {
    create_tenant: StepStatus
    create_user: StepStatus
    seed_pricing: StepStatus
    save_credentials: StepStatus
    test_connections: Record<string, StepStatus>
    register_webhooks: Record<string, StepStatus>
    verify_webhooks: Record<string, StepStatus>
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const {
    // Required
    name,
    slug,
    // Optional business info
    email,
    password,
    flow_type,
    business_name,
    business_name_short,
    service_area,
    timezone,
    sdr_persona,
    owner_phone,
    owner_email,
    google_review_link,
    // API credentials (all optional)
    openphone_api_key,
    openphone_phone_id,
    openphone_phone_number,
    telegram_bot_token,
    owner_telegram_chat_id,
    stripe_secret_key,
    vapi_api_key,
    vapi_assistant_id,
    vapi_outbound_assistant_id,
    vapi_phone_id,
    housecall_pro_api_key,
    housecall_pro_company_id,
    wave_api_token,
    wave_business_id,
    wave_income_account_id,
    ghl_location_id,
    custom_credentials,
  } = body

  if (!name || !slug) {
    return NextResponse.json({ success: false, error: "Name and slug are required" }, { status: 400 })
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ success: false, error: "Slug must be lowercase alphanumeric with hyphens only" }, { status: 400 })
  }

  const client = getAdminClient()
  const result: OnboardResult = {
    tenantId: null,
    steps: {
      create_tenant: { status: "skipped", message: "" },
      create_user: { status: "skipped", message: "" },
      seed_pricing: { status: "skipped", message: "" },
      save_credentials: { status: "skipped", message: "" },
      test_connections: {},
      register_webhooks: {},
      verify_webhooks: {},
    },
  }

  // -------------------------------------------------------------------------
  // Step 1: Create tenant
  // -------------------------------------------------------------------------

  // Check for duplicate slug
  const { data: existingTenant } = await client
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .single()

  if (existingTenant) {
    result.steps.create_tenant = { status: "failed", message: "A business with this slug already exists" }
    return NextResponse.json({ success: false, result })
  }

  // Build workflow_config by merging flow type preset with defaults
  const flowPreset = getWorkflowConfigForFlowType(flow_type || "spotless")
  const workflowConfig = {
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
    lead_followup_stages: 5,
    skip_calls_for_sms_leads: true,
    followup_delays_minutes: [0, 10, 15, 20, 30],
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
    // Flow flags from preset
    use_hcp_mirror: false,
    use_rainy_day_reschedule: false,
    use_team_routing: false,
    use_cleaner_dispatch: true,
    use_review_request: true,
    use_retargeting: true,
    use_payment_collection: true,
    // Override with flow type preset
    ...flowPreset,
  }

  const { data: tenant, error: tenantError } = await client
    .from("tenants")
    .insert({
      name,
      slug,
      email: email || null,
      business_name: business_name || name,
      business_name_short: business_name_short || null,
      service_area: service_area || null,
      sdr_persona: sdr_persona || "Mary",
      owner_phone: owner_phone || null,
      owner_email: owner_email || email || null,
      google_review_link: google_review_link || null,
      timezone: timezone || "America/Chicago",
      active: true,
      workflow_config: workflowConfig,
    })
    .select()
    .single()

  if (tenantError || !tenant) {
    result.steps.create_tenant = { status: "failed", message: tenantError?.message || "Unknown error" }
    return NextResponse.json({ success: false, result })
  }

  result.tenantId = tenant.id
  result.steps.create_tenant = { status: "success", message: `Tenant "${name}" created (${tenant.id})` }

  // -------------------------------------------------------------------------
  // Step 2: Create login user
  // -------------------------------------------------------------------------

  try {
    const userPassword = password || slug
    const { error: userError } = await client.rpc("create_user_with_password", {
      p_username: slug,
      p_password: userPassword,
      p_display_name: slug,
      p_email: email || null,
      p_tenant_id: tenant.id,
    })

    if (userError) throw new Error(userError.message)
    result.steps.create_user = { status: "success", message: `User "${slug}" created` }
  } catch (err: any) {
    result.steps.create_user = { status: "failed", message: err.message || "Failed to create user" }
  }

  // -------------------------------------------------------------------------
  // Step 3: Seed pricing
  // -------------------------------------------------------------------------

  try {
    const tiers = getDefaultPricingTiers(tenant.id)
    const addons = getDefaultPricingAddons(tenant.id)

    const { error: tierError } = await client.from("pricing_tiers").insert(tiers)
    if (tierError) throw new Error(`Tiers: ${tierError.message}`)

    const { error: addonError } = await client.from("pricing_addons").insert(addons)
    if (addonError) throw new Error(`Addons: ${addonError.message}`)

    result.steps.seed_pricing = { status: "success", message: `${tiers.length} tiers + ${addons.length} addons seeded` }
  } catch (err: any) {
    result.steps.seed_pricing = { status: "failed", message: err.message || "Failed to seed pricing" }
  }

  // -------------------------------------------------------------------------
  // Step 4: Save API credentials
  // -------------------------------------------------------------------------

  const credentials: Record<string, any> = {}
  if (openphone_api_key) credentials.openphone_api_key = openphone_api_key
  if (openphone_phone_id) credentials.openphone_phone_id = openphone_phone_id
  if (openphone_phone_number) credentials.openphone_phone_number = openphone_phone_number
  if (telegram_bot_token) credentials.telegram_bot_token = telegram_bot_token
  if (owner_telegram_chat_id) credentials.owner_telegram_chat_id = owner_telegram_chat_id
  if (stripe_secret_key) credentials.stripe_secret_key = stripe_secret_key
  if (vapi_api_key) credentials.vapi_api_key = vapi_api_key
  if (vapi_assistant_id) credentials.vapi_assistant_id = vapi_assistant_id
  if (vapi_outbound_assistant_id) credentials.vapi_outbound_assistant_id = vapi_outbound_assistant_id
  if (vapi_phone_id) credentials.vapi_phone_id = vapi_phone_id
  if (housecall_pro_api_key) credentials.housecall_pro_api_key = housecall_pro_api_key
  if (housecall_pro_company_id) credentials.housecall_pro_company_id = housecall_pro_company_id
  if (wave_api_token) credentials.wave_api_token = wave_api_token
  if (wave_business_id) credentials.wave_business_id = wave_business_id
  if (wave_income_account_id) credentials.wave_income_account_id = wave_income_account_id
  if (ghl_location_id) credentials.ghl_location_id = ghl_location_id
  if (custom_credentials && typeof custom_credentials === "object" && Object.keys(custom_credentials).length > 0) {
    credentials.custom_credentials = custom_credentials
  }

  if (Object.keys(credentials).length > 0) {
    try {
      const { error: credError } = await client
        .from("tenants")
        .update({ ...credentials, updated_at: new Date().toISOString() })
        .eq("id", tenant.id)

      if (credError) throw new Error(credError.message)
      result.steps.save_credentials = {
        status: "success",
        message: `${Object.keys(credentials).length} credentials saved`,
      }
    } catch (err: any) {
      result.steps.save_credentials = { status: "failed", message: err.message || "Failed to save credentials" }
    }
  } else {
    result.steps.save_credentials = { status: "skipped", message: "No credentials provided" }
  }

  // -------------------------------------------------------------------------
  // Step 5: Test connections (parallel)
  // -------------------------------------------------------------------------

  const connectionTests: Array<{ key: string; fn: () => Promise<StepResult> }> = []

  if (stripe_secret_key) {
    connectionTests.push({ key: "stripe", fn: () => testStripeConnection(stripe_secret_key) })
  }
  if (openphone_api_key && openphone_phone_id) {
    connectionTests.push({ key: "openphone", fn: () => testOpenPhoneConnection(openphone_api_key, openphone_phone_id) })
  }
  if (vapi_api_key && vapi_assistant_id) {
    connectionTests.push({ key: "vapi", fn: () => testVapiConnection(vapi_api_key, vapi_assistant_id) })
  }
  if (telegram_bot_token) {
    connectionTests.push({ key: "telegram", fn: () => testTelegramConnection(telegram_bot_token) })
  }
  if (wave_api_token && wave_business_id) {
    connectionTests.push({ key: "wave", fn: () => testWaveConnection(wave_api_token, wave_business_id) })
  }

  if (connectionTests.length > 0) {
    const testResults = await Promise.allSettled(connectionTests.map((t) => t.fn()))
    for (let i = 0; i < connectionTests.length; i++) {
      const key = connectionTests[i].key
      const settled = testResults[i]
      if (settled.status === "fulfilled") {
        result.steps.test_connections[key] = {
          status: settled.value.ok ? "success" : "failed",
          message: settled.value.message,
        }
      } else {
        result.steps.test_connections[key] = {
          status: "failed",
          message: settled.reason?.message || "Connection test failed",
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 6: Register webhooks (parallel)
  // -------------------------------------------------------------------------

  const baseUrl = getBaseUrl()

  if (baseUrl) {
    const webhookRegistrations: Array<{
      key: string
      fn: () => Promise<StepResult & { secret?: string }>
    }> = []

    if (telegram_bot_token) {
      const webhookUrl = `${baseUrl}/api/webhooks/telegram/${slug}`
      webhookRegistrations.push({
        key: "telegram",
        fn: () => registerTelegramWebhook(telegram_bot_token, webhookUrl),
      })
    }
    if (stripe_secret_key) {
      const webhookUrl = `${baseUrl}/api/webhooks/stripe`
      webhookRegistrations.push({
        key: "stripe",
        fn: () => registerStripeWebhook(stripe_secret_key, webhookUrl),
      })
    }
    if (openphone_api_key) {
      const webhookUrl = `${baseUrl}/api/webhooks/openphone`
      webhookRegistrations.push({
        key: "openphone",
        fn: () => registerOpenPhoneWebhook(openphone_api_key, webhookUrl),
      })
    }

    if (webhookRegistrations.length > 0) {
      const whResults = await Promise.allSettled(webhookRegistrations.map((r) => r.fn()))

      // -----------------------------------------------------------------------
      // Step 7: Save webhook results to tenant
      // -----------------------------------------------------------------------

      const webhookUpdate: Record<string, any> = { updated_at: new Date().toISOString() }

      for (let i = 0; i < webhookRegistrations.length; i++) {
        const key = webhookRegistrations[i].key
        const settled = whResults[i]

        if (settled.status === "fulfilled" && settled.value.ok) {
          result.steps.register_webhooks[key] = { status: "success", message: settled.value.message }
          webhookUpdate[`${key}_webhook_registered_at`] = new Date().toISOString()
          webhookUpdate[`${key}_webhook_error`] = null
          webhookUpdate[`${key}_webhook_error_at`] = null

          // Save Stripe webhook signing secret
          if (key === "stripe" && (settled.value as any).secret) {
            webhookUpdate.stripe_webhook_secret = (settled.value as any).secret
          }
        } else {
          const errMsg = settled.status === "rejected"
            ? settled.reason?.message || "Registration failed"
            : settled.value.message
          result.steps.register_webhooks[key] = { status: "failed", message: errMsg }
          webhookUpdate[`${key}_webhook_error`] = errMsg
          webhookUpdate[`${key}_webhook_error_at`] = new Date().toISOString()
        }
      }

      await client.from("tenants").update(webhookUpdate).eq("id", tenant.id)
    }
  } else {
    // No base URL — skip webhook registration
    if (telegram_bot_token || stripe_secret_key || openphone_api_key) {
      const msg = "Base URL not configured — webhook registration skipped"
      if (telegram_bot_token) result.steps.register_webhooks.telegram = { status: "skipped", message: msg }
      if (stripe_secret_key) result.steps.register_webhooks.stripe = { status: "skipped", message: msg }
      if (openphone_api_key) result.steps.register_webhooks.openphone = { status: "skipped", message: msg }
    }
  }

  // -------------------------------------------------------------------------
  // Step 8: Verify webhooks are actually live (parallel)
  // -------------------------------------------------------------------------

  if (baseUrl) {
    const verifications: Array<{ key: string; fn: () => Promise<StepStatus> }> = []

    if (telegram_bot_token && result.steps.register_webhooks.telegram?.status === "success") {
      const expectedUrl = `${baseUrl}/api/webhooks/telegram/${slug}`
      verifications.push({
        key: "telegram",
        fn: async () => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch(`https://api.telegram.org/bot${telegram_bot_token}/getWebhookInfo`, { signal: controller.signal })
          clearTimeout(timeout)
          const data = await res.json()
          if (data.ok && data.result?.url === expectedUrl) {
            return { status: "success", message: "Verified — webhook active" }
          }
          return { status: "failed", message: data.result?.url ? `Points to: ${data.result.url}` : "Not configured" }
        },
      })
    }

    if (stripe_secret_key && result.steps.register_webhooks.stripe?.status === "success") {
      const expectedUrl = `${baseUrl}/api/webhooks/stripe`
      verifications.push({
        key: "stripe",
        fn: async () => {
          const stripe = new Stripe(stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
          const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
          const match = endpoints.data.find((wh) => wh.url === expectedUrl)
          if (match && match.status === "enabled") {
            return { status: "success", message: `Verified — ${match.enabled_events?.length || 0} events` }
          }
          return { status: "failed", message: match ? `Status: ${match.status}` : "Webhook not found" }
        },
      })
    }

    if (openphone_api_key && result.steps.register_webhooks.openphone?.status === "success") {
      const expectedUrl = `${baseUrl}/api/webhooks/openphone`
      verifications.push({
        key: "openphone",
        fn: async () => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch("https://api.openphone.com/v1/webhooks", {
            headers: { Authorization: openphone_api_key },
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (!res.ok) return { status: "failed", message: `API returned ${res.status}` }
          const data = await res.json()
          const match = (data.data || []).find((wh: any) => wh.url === expectedUrl)
          if (match) return { status: "success", message: "Verified — webhook active" }
          return { status: "failed", message: "Webhook not found after registration" }
        },
      })
    }

    if (verifications.length > 0) {
      const vResults = await Promise.allSettled(verifications.map((v) => v.fn()))
      for (let i = 0; i < verifications.length; i++) {
        const key = verifications[i].key
        const settled = vResults[i]
        if (settled.status === "fulfilled") {
          result.steps.verify_webhooks[key] = settled.value
        } else {
          result.steps.verify_webhooks[key] = {
            status: "failed",
            message: settled.reason?.message || "Verification failed",
          }
        }
      }
    }
  }

  return NextResponse.json({ success: true, result })
}
