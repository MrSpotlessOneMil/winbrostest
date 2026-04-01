import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"
import Stripe from "stripe"
import { sanitizeServiceAccountJson } from "@/lib/gmail-client"
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
  registerVapiWebhook,
  getDefaultPricingTiers,
  getDefaultPricingAddons,
  StepResult,
} from "@/lib/admin-onboard"


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

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 })
  }

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
    service_description,
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
    stripe_publishable_key,
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
    gmail_user,
    gmail_app_password,
    gmail_service_account_json,
    gmail_impersonated_user,
    custom_credentials,
    seed_pricing,
  } = body

  if (!name || !slug || !password) {
    return NextResponse.json({ success: false, error: "Name, slug, and password are required" }, { status: 400 })
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 50) {
    return NextResponse.json({ success: false, error: "Slug must be 3-50 chars, lowercase alphanumeric with hyphens (no leading/trailing hyphens)" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
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
  // Step 1: Create tenant (idempotent — resumes if slug already exists)
  // -------------------------------------------------------------------------

  let tenant: any

  const { data: existingTenant } = await client
    .from("tenants")
    .select("*")
    .eq("slug", slug)
    .single()

  if (existingTenant) {
    // Resume from previous partial onboard
    tenant = existingTenant
    result.tenantId = tenant.id
    result.steps.create_tenant = { status: "skipped", message: `Tenant "${name}" already exists (${tenant.id}) — resuming` }
  } else {
    const flowPreset = getWorkflowConfigForFlowType(flow_type || "spotless")
    const workflowConfig = {
      use_housecall_pro: false,
      use_vapi_inbound: true,
      use_vapi_outbound: true,
      use_ghl: false,
      use_stripe: true,
      use_wave: false,
      use_route_optimization: false,
      lead_followup_enabled: true,
      lead_followup_stages: 6,
      skip_calls_for_sms_leads: true,
      followup_delays_minutes: [0, 15, 1440, 4320, 10080, 20160],
      post_cleaning_followup_enabled: true,
      post_cleaning_delay_hours: 2,
      monthly_followup_enabled: true,
      monthly_followup_days: 30,
      monthly_followup_discount: "15%",
      cleaner_assignment_auto: true,
      require_deposit: true,
      deposit_percentage: 50,
      sms_auto_response_enabled: true,
      seasonal_reminders_enabled: false,
      frequency_nudge_enabled: false,
      frequency_nudge_days: 21,
      review_only_followup_enabled: false,
      seasonal_campaigns: [],
      use_hcp_mirror: false,
      use_rainy_day_reschedule: false,
      use_team_routing: false,
      use_cleaner_dispatch: true,
      use_review_request: true,
      use_retargeting: true,
      use_payment_collection: true,
      ...flowPreset,
    }

    const { data: newTenant, error: tenantError } = await client
      .from("tenants")
      .insert({
        name,
        slug,
        email: email || null,
        business_name: business_name || name,
        business_name_short: business_name_short || null,
        service_area: service_area || null,
        service_description: service_description || null,
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

    if (tenantError || !newTenant) {
      result.steps.create_tenant = { status: "failed", message: tenantError?.message || "Unknown error" }
      return NextResponse.json({ success: false, result })
    }

    tenant = newTenant
    result.tenantId = tenant.id
    result.steps.create_tenant = { status: "success", message: `Tenant "${name}" created (${tenant.id})` }
  }

  // -------------------------------------------------------------------------
  // Step 2: Create login user (skip if already exists)
  // -------------------------------------------------------------------------

  const { data: existingUser } = await client
    .from("users")
    .select("id")
    .eq("username", slug)
    .single()

  if (existingUser) {
    result.steps.create_user = { status: "skipped", message: `User "${slug}" already exists` }
  } else {
    try {
      const { error: userError } = await client.rpc("create_user_with_password", {
        p_username: slug,
        p_password: password,
        p_display_name: slug,
        p_email: email || null,
        p_tenant_id: tenant.id,
      })

      if (userError) throw new Error(userError.message)
      result.steps.create_user = { status: "success", message: `User "${slug}" created` }
    } catch (err: any) {
      result.steps.create_user = { status: "failed", message: err.message || "Failed to create user" }
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Seed pricing (skip if already seeded)
  // -------------------------------------------------------------------------

  if (seed_pricing === "skip") {
    result.steps.seed_pricing = { status: "skipped", message: "Skipped by user" }
  } else {
    const { count: existingTiers } = await client
      .from("pricing_tiers")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)

    if (existingTiers && existingTiers > 0) {
      result.steps.seed_pricing = { status: "skipped", message: `${existingTiers} pricing tiers already exist` }
    } else {
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
    }
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
  if (stripe_publishable_key) credentials.stripe_publishable_key = stripe_publishable_key
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
  if (gmail_user) credentials.gmail_user = gmail_user
  if (gmail_app_password) credentials.gmail_app_password = gmail_app_password
  if (gmail_service_account_json) credentials.gmail_service_account_json = sanitizeServiceAccountJson(gmail_service_account_json)
  if (gmail_impersonated_user) credentials.gmail_impersonated_user = gmail_impersonated_user
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
  // Step 6: Register webhooks (parallel) — skip services that failed connection test
  // -------------------------------------------------------------------------

  const failedConnections = new Set(
    Object.entries(result.steps.test_connections)
      .filter(([, v]) => v.status === "failed")
      .map(([k]) => k)
  )

  const baseUrl = getBaseUrl()

  if (baseUrl) {
    const webhookRegistrations: Array<{
      key: string
      fn: () => Promise<StepResult & { secret?: string }>
    }> = []

    if (telegram_bot_token && !failedConnections.has("telegram")) {
      const webhookUrl = `${baseUrl}/api/webhooks/telegram/${slug}`
      webhookRegistrations.push({
        key: "telegram",
        fn: () => registerTelegramWebhook(telegram_bot_token, webhookUrl),
      })
    } else if (telegram_bot_token && failedConnections.has("telegram")) {
      result.steps.register_webhooks.telegram = { status: "skipped", message: "Skipped — connection test failed" }
    }
    if (stripe_secret_key && !failedConnections.has("stripe")) {
      const webhookUrl = `${baseUrl}/api/webhooks/stripe`
      webhookRegistrations.push({
        key: "stripe",
        fn: () => registerStripeWebhook(stripe_secret_key, webhookUrl),
      })
    } else if (stripe_secret_key && failedConnections.has("stripe")) {
      result.steps.register_webhooks.stripe = { status: "skipped", message: "Skipped — connection test failed" }
    }
    if (openphone_api_key && !failedConnections.has("openphone")) {
      const webhookUrl = `${baseUrl}/api/webhooks/openphone`
      webhookRegistrations.push({
        key: "openphone",
        fn: () => registerOpenPhoneWebhook(openphone_api_key, webhookUrl),
      })
    } else if (openphone_api_key && failedConnections.has("openphone")) {
      result.steps.register_webhooks.openphone = { status: "skipped", message: "Skipped — connection test failed" }
    }
    if (vapi_api_key && vapi_assistant_id && !failedConnections.has("vapi")) {
      const webhookUrl = `${baseUrl}/api/webhooks/vapi/${slug}`
      const assistantIds = [vapi_assistant_id, ...(vapi_outbound_assistant_id ? [vapi_outbound_assistant_id] : [])]
      webhookRegistrations.push({
        key: "vapi",
        fn: () => registerVapiWebhook(vapi_api_key, assistantIds, webhookUrl),
      })
    } else if (vapi_api_key && vapi_assistant_id && failedConnections.has("vapi")) {
      result.steps.register_webhooks.vapi = { status: "skipped", message: "Skipped — connection test failed" }
    }

    if (webhookRegistrations.length > 0) {
      const whResults = await Promise.allSettled(webhookRegistrations.map((r) => r.fn()))

      // -----------------------------------------------------------------------
      // Step 7: Save webhook results to tenant
      // -----------------------------------------------------------------------

      const webhookUpdate: Record<string, any> = { updated_at: new Date().toISOString(), webhook_registered_base_url: baseUrl }

      for (let i = 0; i < webhookRegistrations.length; i++) {
        const key = webhookRegistrations[i].key
        const settled = whResults[i]

        if (settled.status === "fulfilled" && settled.value.ok) {
          result.steps.register_webhooks[key] = { status: "success", message: settled.value.message }
          webhookUpdate[`${key}_webhook_registered_at`] = new Date().toISOString()
          webhookUpdate[`${key}_webhook_error`] = null
          webhookUpdate[`${key}_webhook_error_at`] = null

          // Save webhook signing secrets
          if (key === "stripe" && (settled.value as any).secret) {
            webhookUpdate.stripe_webhook_secret = (settled.value as any).secret
          }
          if (key === "openphone" && (settled.value as any).secret) {
            webhookUpdate.openphone_webhook_secret = (settled.value as any).secret
          }
          if (key === "telegram" && (settled.value as any).secret) {
            webhookUpdate.telegram_webhook_secret = (settled.value as any).secret
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

      const { error: webhookDbError } = await client.from("tenants").update(webhookUpdate).eq("id", tenant.id)
      if (webhookDbError) {
        console.error(`[onboard] Failed to save webhook secrets for tenant ${tenant.id}:`, webhookDbError.message)
        for (const key of Object.keys(result.steps.register_webhooks)) {
          if (result.steps.register_webhooks[key].status === "success") {
            result.steps.register_webhooks[key] = {
              status: "failed",
              message: `Registered but failed to save secret: ${webhookDbError.message}. Re-register to generate a new secret.`,
            }
          }
        }
      }
    }
  } else {
    // No base URL — skip webhook registration
    if (telegram_bot_token || stripe_secret_key || openphone_api_key || (vapi_api_key && vapi_assistant_id)) {
      const msg = "Base URL not configured — webhook registration skipped"
      if (telegram_bot_token) result.steps.register_webhooks.telegram = { status: "skipped", message: msg }
      if (stripe_secret_key) result.steps.register_webhooks.stripe = { status: "skipped", message: msg }
      if (openphone_api_key) result.steps.register_webhooks.openphone = { status: "skipped", message: msg }
      if (vapi_api_key && vapi_assistant_id) result.steps.register_webhooks.vapi = { status: "skipped", message: msg }
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
          const stripe = new Stripe(stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any, timeout: 10_000 })
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

    if (vapi_api_key && vapi_assistant_id && result.steps.register_webhooks.vapi?.status === "success") {
      const expectedUrl = `${baseUrl}/api/webhooks/vapi/${slug}`
      verifications.push({
        key: "vapi",
        fn: async () => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch(`https://api.vapi.ai/assistant/${vapi_assistant_id}`, {
            headers: { Authorization: `Bearer ${vapi_api_key}` },
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (!res.ok) return { status: "failed", message: `VAPI API returned ${res.status}` }
          const data = await res.json()
          if (data.server?.url === expectedUrl) {
            return { status: "success", message: "Verified — server URL active" }
          }
          return { status: "failed", message: data.server?.url ? `Points to: ${data.server.url}` : "No server URL configured" }
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

  // Check if any step failed to signal partial success to the client
  const hasFailures =
    result.steps.create_tenant.status === "failed" ||
    result.steps.create_user.status === "failed" ||
    result.steps.seed_pricing.status === "failed" ||
    result.steps.save_credentials.status === "failed" ||
    Object.values(result.steps.test_connections).some((s) => s.status === "failed") ||
    Object.values(result.steps.register_webhooks).some((s) => s.status === "failed") ||
    Object.values(result.steps.verify_webhooks).some((s) => s.status === "failed")

  return NextResponse.json({ success: true, partial: hasFailures, result })
}
