import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"
import {
  getBaseUrl,
  registerTelegramWebhook,
  registerStripeWebhook,
  registerOpenPhoneWebhook,
} from "@/lib/admin-onboard"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { tenantId, service } = await request.json()

  if (!tenantId || !service) {
    return NextResponse.json({ success: false, error: "tenantId and service are required" }, { status: 400 })
  }

  const client = getAdminClient()
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
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          tgUpdate.telegram_webhook_secret = result.secret
        }
        await client.from("tenants").update(tgUpdate).eq("id", tenantId)
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
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          stripeUpdate.stripe_webhook_secret = result.secret
        }
        await client.from("tenants").update(stripeUpdate).eq("id", tenantId)
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
          updated_at: new Date().toISOString(),
        }
        if (result.secret) {
          opUpdate.openphone_webhook_secret = result.secret
        }
        await client.from("tenants").update(opUpdate).eq("id", tenantId)
        return NextResponse.json({ success: true, message: result.message })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    // Persist error to DB so it survives page reload
    if (service && ["telegram", "stripe", "openphone"].includes(service)) {
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
