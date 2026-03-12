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
  const { tenantId, service } = body

  if (!tenantId || !service) {
    return NextResponse.json({ success: false, error: "tenantId and service are required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data: tenant, error: fetchError } = await client
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .single()

  if (fetchError || !tenant) {
    return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { success: false, error: "Base URL not configured. Set NEXT_PUBLIC_BASE_URL or deploy to Vercel." },
      { status: 500 }
    )
  }

  try {
    switch (service) {
      case "telegram": {
        if (!tenant.telegram_bot_token) {
          return NextResponse.json({ success: false, error: "Telegram bot token not configured" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/telegram/${tenant.slug}`
        const result = await registerTelegramWebhook(tenant.telegram_bot_token, webhookUrl)
        const tgUpdate: Record<string, any> = {
          telegram_webhook_registered_at: new Date().toISOString(),
          telegram_webhook_error: null,
          telegram_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          tgUpdate.telegram_webhook_secret = result.secret
        }
        const { error: tgDbError } = await client.from("tenants").update(tgUpdate).eq("id", tenantId)
        if (tgDbError) {
          console.error(`[register-webhook] Failed to save Telegram secret for tenant ${tenantId}:`, tgDbError.message)
          return NextResponse.json({ success: false, error: `Webhook registered at Telegram but failed to save secret: ${tgDbError.message}. Re-register to generate a new secret.` }, { status: 500 })
        }
        return NextResponse.json({ success: true, message: result.message })
      }

      case "stripe": {
        if (!tenant.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key not configured" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/stripe`
        const result = await registerStripeWebhook(tenant.stripe_secret_key, webhookUrl)
        const stripeUpdate: Record<string, any> = {
          stripe_webhook_registered_at: new Date().toISOString(),
          stripe_webhook_error: null,
          stripe_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          stripeUpdate.stripe_webhook_secret = result.secret
        }
        const { error: stripeDbError } = await client.from("tenants").update(stripeUpdate).eq("id", tenantId)
        if (stripeDbError) {
          console.error(`[register-webhook] Failed to save Stripe secret for tenant ${tenantId}:`, stripeDbError.message)
          return NextResponse.json({ success: false, error: `Webhook registered at Stripe but failed to save secret: ${stripeDbError.message}. Re-register to generate a new secret.` }, { status: 500 })
        }
        return NextResponse.json({ success: true, message: result.message })
      }

      case "openphone": {
        if (!tenant.openphone_api_key) {
          return NextResponse.json({ success: false, error: "OpenPhone API key not configured" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/openphone`
        const result = await registerOpenPhoneWebhook(tenant.openphone_api_key, webhookUrl)
        const opUpdate: Record<string, any> = {
          openphone_webhook_registered_at: new Date().toISOString(),
          openphone_webhook_error: null,
          openphone_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          opUpdate.openphone_webhook_secret = result.secret
        }
        const { error: opDbError } = await client.from("tenants").update(opUpdate).eq("id", tenantId)
        if (opDbError) {
          console.error(`[register-webhook] Failed to save OpenPhone secret for tenant ${tenantId}:`, opDbError.message)
          return NextResponse.json({ success: false, error: `Webhook registered at OpenPhone but failed to save secret: ${opDbError.message}. Re-register to generate a new secret.` }, { status: 500 })
        }
        return NextResponse.json({ success: true, message: result.message })
      }

      case "vapi": {
        if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
          return NextResponse.json({ success: false, error: "VAPI API key and assistant ID not configured" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/vapi/${tenant.slug}`
        const assistantIds = [tenant.vapi_assistant_id, ...(tenant.vapi_outbound_assistant_id ? [tenant.vapi_outbound_assistant_id] : [])]
        const result = await registerVapiWebhook(tenant.vapi_api_key, assistantIds, webhookUrl)
        const vapiUpdate: Record<string, any> = {
          vapi_webhook_registered_at: new Date().toISOString(),
          vapi_webhook_error: null,
          vapi_webhook_error_at: null,
          webhook_registered_base_url: baseUrl,
          updated_at: new Date().toISOString(),
        }
        const { error: vapiDbError } = await client.from("tenants").update(vapiUpdate).eq("id", tenantId)
        if (vapiDbError) {
          console.error(`[register-webhook] Failed to save VAPI webhook status for tenant ${tenantId}:`, vapiDbError.message)
          return NextResponse.json({ success: false, error: `Server URL set on VAPI but failed to save status: ${vapiDbError.message}` }, { status: 500 })
        }
        return NextResponse.json({ success: true, message: result.message })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    // Persist error to DB so it survives page reload
    if (service && ["telegram", "stripe", "openphone", "vapi"].includes(service)) {
      try {
        await client.from("tenants").update({
          [`${service}_webhook_error`]: err.message || "Unknown error",
          [`${service}_webhook_error_at`]: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", tenantId)
      } catch {
        // Don't let error-saving failure mask the original error
      }
    }
    return NextResponse.json({ success: false, error: err.message || "Webhook registration failed" }, { status: 500 })
  }
}
