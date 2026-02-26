import Stripe from "stripe"

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface StepResult {
  ok: boolean
  message: string
  data?: any
}

// ---------------------------------------------------------------------------
// Flow type → workflow_config presets
// ---------------------------------------------------------------------------

export function getWorkflowConfigForFlowType(flowType: string): Record<string, any> {
  switch (flowType) {
    case "winbros":
      return {
        use_housecall_pro: true,
        use_route_optimization: true,
        use_hcp_mirror: true,
        use_rainy_day_reschedule: true,
        use_team_routing: true,
        use_cleaner_dispatch: true,
        use_review_request: true,
        use_retargeting: true,
        use_payment_collection: true,
        cleaner_assignment_auto: true,
        skip_calls_for_sms_leads: true,
        use_vapi_inbound: true,
        use_vapi_outbound: true,
      }
    case "spotless":
      return {
        use_housecall_pro: false,
        use_route_optimization: false,
        use_hcp_mirror: false,
        use_rainy_day_reschedule: false,
        use_team_routing: false,
        use_cleaner_dispatch: true,
        use_review_request: true,
        use_retargeting: true,
        use_payment_collection: true,
        cleaner_assignment_auto: false,
        skip_calls_for_sms_leads: false,
        use_vapi_inbound: true,
        use_vapi_outbound: true,
      }
    case "cedar":
      return {
        use_housecall_pro: false,
        use_route_optimization: false,
        use_hcp_mirror: false,
        use_rainy_day_reschedule: false,
        use_team_routing: false,
        use_cleaner_dispatch: false,
        use_review_request: true,
        use_retargeting: false,
        use_payment_collection: false,
        cleaner_assignment_auto: false,
        skip_calls_for_sms_leads: true,
        use_vapi_inbound: true,
        use_vapi_outbound: false,
      }
    default:
      return {}
  }
}

// ---------------------------------------------------------------------------
// Base URL utility
// ---------------------------------------------------------------------------

export function getBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return null
}

// ---------------------------------------------------------------------------
// Connection tests
// ---------------------------------------------------------------------------

export async function testStripeConnection(key: string): Promise<StepResult> {
  const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" as any })
  const balance = await stripe.balance.retrieve()
  const balanceStr = balance.available
    .map((b: any) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`)
    .join(", ")
  return { ok: true, message: `Connected. Balance: ${balanceStr || "0.00"}` }
}

export async function testOpenPhoneConnection(key: string, phoneId: string): Promise<StepResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch(`https://api.openphone.com/v1/phone-numbers/${phoneId}`, {
    headers: { Authorization: key },
    signal: controller.signal,
  })
  clearTimeout(timeout)
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenPhone API returned ${res.status}: ${errText}`)
  }
  const data = await res.json()
  return { ok: true, message: `Connected. Phone: ${data.data?.formattedNumber || data.data?.phoneNumber || "OK"}` }
}

export async function testVapiConnection(key: string, assistantId: string): Promise<StepResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: controller.signal,
  })
  clearTimeout(timeout)
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`VAPI API returned ${res.status}: ${errText}`)
  }
  const data = await res.json()
  return { ok: true, message: `Connected. Assistant: ${data.name || data.id || "OK"}` }
}

export async function testTelegramConnection(token: string): Promise<StepResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
    signal: controller.signal,
  })
  clearTimeout(timeout)
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Telegram API returned ${res.status}: ${errText}`)
  }
  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.description || "Telegram API error")
  }
  return { ok: true, message: `Connected. Bot: @${data.result?.username || "OK"}` }
}

export async function testWaveConnection(apiToken: string, businessId: string): Promise<StepResult> {
  const token = apiToken.replace(/[\r\n]/g, "").trim().replace(/^Bearer\s+/i, "")
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch("https://gql.waveapps.com/graphql/public", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query { business(id: "${businessId}") { id name } }`,
    }),
    signal: controller.signal,
  })
  clearTimeout(timeout)
  const payload = await res.json()
  if (!res.ok || payload.errors?.length) {
    throw new Error(payload.errors?.[0]?.message || `Wave API returned ${res.status}`)
  }
  const bizName = payload.data?.business?.name
  return { ok: true, message: `Connected. Business: ${bizName || "OK"}` }
}

// ---------------------------------------------------------------------------
// Webhook registration
// ---------------------------------------------------------------------------

export async function registerTelegramWebhook(token: string, webhookUrl: string): Promise<StepResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
      signal: controller.signal,
    }
  )
  clearTimeout(timeout)
  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.description || "Failed to set Telegram webhook")
  }
  return { ok: true, message: `Webhook registered: ${webhookUrl}` }
}

export async function registerStripeWebhook(key: string, webhookUrl: string): Promise<StepResult & { secret?: string }> {
  const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" as any })

  // Delete existing webhooks with the same URL to avoid duplicates
  const existing = await stripe.webhookEndpoints.list({ limit: 100 })
  for (const wh of existing.data) {
    if (wh.url === webhookUrl) {
      await stripe.webhookEndpoints.del(wh.id)
    }
  }

  const webhook = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: [
      "checkout.session.completed",
      "setup_intent.succeeded",
      "payment_intent.succeeded",
      "payment_intent.payment_failed",
    ],
  })

  return {
    ok: true,
    message: "Stripe webhook registered and signing secret saved.",
    secret: webhook.secret || undefined,
  }
}

export async function registerOpenPhoneWebhook(key: string, webhookUrl: string): Promise<StepResult> {
  // Delete existing webhooks with the same URL
  const listController = new AbortController()
  const listTimeout = setTimeout(() => listController.abort(), 10_000)
  const listRes = await fetch("https://api.openphone.com/v1/webhooks", {
    headers: { Authorization: key },
    signal: listController.signal,
  })
  clearTimeout(listTimeout)
  if (listRes.ok) {
    const listData = await listRes.json()
    for (const wh of (listData.data || [])) {
      if (wh.url === webhookUrl) {
        await fetch(`https://api.openphone.com/v1/webhooks/${wh.id}`, {
          method: "DELETE",
          headers: { Authorization: key },
        })
      }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const res = await fetch("https://api.openphone.com/v1/webhooks", {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      events: [
        "message.received",
        "message.delivered",
        "call.completed",
        "call.ringing",
      ],
    }),
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenPhone API returned ${res.status}: ${errText}`)
  }

  return { ok: true, message: `OpenPhone webhook registered: ${webhookUrl}` }
}

// ---------------------------------------------------------------------------
// Default pricing data (ported from origin/Test commit a84ae86)
// ---------------------------------------------------------------------------

export function getDefaultPricingTiers(tenantId: string) {
  return [
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
  ].map((t) => ({ ...t, tenant_id: tenantId }))
}

export function getDefaultPricingAddons(tenantId: string) {
  return [
    { addon_key: "inside_fridge", label: "Inside fridge", minutes: 30, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside fridge", "fridge interior"] },
    { addon_key: "inside_oven", label: "Inside oven", minutes: 30, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside oven", "oven interior"] },
    { addon_key: "inside_cabinets", label: "Inside cabinets", minutes: 60, flat_price: null, price_multiplier: 1, included_in: ["move"], keywords: ["inside cabinets", "cabinet interior"] },
    { addon_key: "windows_interior", label: "Interior windows", minutes: 30, flat_price: 50, price_multiplier: 1, included_in: null, keywords: ["interior windows", "inside windows"] },
    { addon_key: "windows_exterior", label: "Exterior windows", minutes: 60, flat_price: 100, price_multiplier: 1, included_in: null, keywords: ["exterior windows", "outside windows"] },
    { addon_key: "windows_both", label: "Interior + exterior windows", minutes: 90, flat_price: 150, price_multiplier: 1, included_in: null, keywords: ["both windows", "all windows"] },
    { addon_key: "pet_fee", label: "Pet fee", minutes: 0, flat_price: 25, price_multiplier: 1, included_in: null, keywords: ["pet", "pets", "dog", "cat"] },
  ].map((a) => ({ ...a, tenant_id: tenantId, active: true }))
}
