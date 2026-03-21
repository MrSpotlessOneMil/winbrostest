import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"
import {
  getBaseUrl,
  registerTelegramWebhook,
  registerStripeWebhook,
  registerOpenPhoneWebhook,
  registerVapiWebhook,
} from "@/lib/admin-onboard"

// route-check:no-vercel-cron

interface ServiceResult {
  ok: boolean
  message: string
  newSecret?: boolean
}

interface TenantResult {
  tenantId: string
  slug: string
  services: Record<string, ServiceResult>
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { success: false, error: "Base URL not configured. Set NEXT_PUBLIC_BASE_URL in Vercel env vars." },
      { status: 500 }
    )
  }

  const client = getSupabaseServiceClient()
  const { data: tenants, error: fetchError } = await client
    .from("tenants")
    .select("*")
    .eq("active", true)

  if (fetchError || !tenants) {
    return NextResponse.json(
      { success: false, error: `Failed to fetch tenants: ${fetchError?.message}` },
      { status: 500 }
    )
  }

  const results: TenantResult[] = []

  for (const tenant of tenants) {
    const tenantResult: TenantResult = {
      tenantId: tenant.id,
      slug: tenant.slug,
      services: {},
    }

    // --- Stripe ---
    if (tenant.stripe_secret_key && tenant.workflow_config?.use_stripe !== false) {
      const webhookUrl = `${baseUrl}/api/webhooks/stripe`
      try {
        const result = await registerStripeWebhook(tenant.stripe_secret_key, webhookUrl)
        const update: Record<string, any> = {
          stripe_webhook_registered_at: new Date().toISOString(),
          stripe_webhook_error: null,
          stripe_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          update.stripe_webhook_secret = result.secret
        }
        await client.from("tenants").update(update).eq("id", tenant.id)
        tenantResult.services.stripe = { ok: true, message: result.message, newSecret: !!result.secret }
      } catch (err: any) {
        tenantResult.services.stripe = { ok: false, message: err.message }
        await client.from("tenants").update({
          stripe_webhook_error: err.message,
          stripe_webhook_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tenant.id)
      }
    }

    // --- Telegram ---
    if (tenant.telegram_bot_token) {
      const webhookUrl = `${baseUrl}/api/webhooks/telegram/${tenant.slug}`
      try {
        const result = await registerTelegramWebhook(tenant.telegram_bot_token, webhookUrl)
        const update: Record<string, any> = {
          telegram_webhook_registered_at: new Date().toISOString(),
          telegram_webhook_error: null,
          telegram_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          update.telegram_webhook_secret = result.secret
        }
        await client.from("tenants").update(update).eq("id", tenant.id)
        tenantResult.services.telegram = { ok: true, message: result.message, newSecret: !!result.secret }
      } catch (err: any) {
        tenantResult.services.telegram = { ok: false, message: err.message }
        await client.from("tenants").update({
          telegram_webhook_error: err.message,
          telegram_webhook_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tenant.id)
      }
    }

    // --- OpenPhone ---
    if (tenant.openphone_api_key) {
      const webhookUrl = `${baseUrl}/api/webhooks/openphone`
      try {
        const result = await registerOpenPhoneWebhook(tenant.openphone_api_key, webhookUrl)
        const update: Record<string, any> = {
          openphone_webhook_registered_at: new Date().toISOString(),
          openphone_webhook_error: null,
          openphone_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          update.openphone_webhook_secret = result.secret
        }
        await client.from("tenants").update(update).eq("id", tenant.id)
        tenantResult.services.openphone = { ok: true, message: result.message, newSecret: !!result.secret }
      } catch (err: any) {
        tenantResult.services.openphone = { ok: false, message: err.message }
        await client.from("tenants").update({
          openphone_webhook_error: err.message,
          openphone_webhook_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tenant.id)
      }
    }

    // --- VAPI ---
    if (tenant.vapi_api_key && tenant.vapi_assistant_id) {
      const webhookUrl = `${baseUrl}/api/webhooks/vapi/${tenant.slug}`
      const assistantIds = [tenant.vapi_assistant_id, ...(tenant.vapi_outbound_assistant_id ? [tenant.vapi_outbound_assistant_id] : [])]
      try {
        const result = await registerVapiWebhook(tenant.vapi_api_key, assistantIds, webhookUrl)
        await client.from("tenants").update({
          vapi_webhook_registered_at: new Date().toISOString(),
          vapi_webhook_error: null,
          vapi_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }).eq("id", tenant.id)
        tenantResult.services.vapi = { ok: true, message: result.message }
      } catch (err: any) {
        tenantResult.services.vapi = { ok: false, message: err.message }
        await client.from("tenants").update({
          vapi_webhook_error: err.message,
          vapi_webhook_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tenant.id)
      }
    }

    results.push(tenantResult)
  }

  const totalServices = results.reduce((sum, r) => sum + Object.keys(r.services).length, 0)
  const successCount = results.reduce(
    (sum, r) => sum + Object.values(r.services).filter((s) => s.ok).length,
    0
  )

  return NextResponse.json({
    success: true,
    baseUrl,
    tenantCount: tenants.length,
    totalServices,
    successCount,
    failedCount: totalServices - successCount,
    results,
  })
}
