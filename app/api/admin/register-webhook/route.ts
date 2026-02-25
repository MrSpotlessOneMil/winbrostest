import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"
import Stripe from "stripe"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

function getBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return null
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
        const res = await fetch(
          `https://api.telegram.org/bot${tenant.telegram_bot_token}/setWebhook`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: webhookUrl }),
          }
        )
        const data = await res.json()
        if (!data.ok) {
          throw new Error(data.description || "Failed to set Telegram webhook")
        }
        return NextResponse.json({
          success: true,
          message: `Webhook registered: ${webhookUrl}`,
        })
      }

      case "stripe": {
        if (!tenant.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key not configured" }, { status: 400 })
        }
        const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
        const webhookUrl = `${baseUrl}/api/webhooks/stripe`

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

        // Save the webhook signing secret
        if (webhook.secret) {
          await client
            .from("tenants")
            .update({
              stripe_webhook_secret: webhook.secret,
              updated_at: new Date().toISOString(),
            })
            .eq("id", tenantId)
        }

        return NextResponse.json({
          success: true,
          message: "Stripe webhook registered and signing secret saved.",
        })
      }

      case "openphone": {
        if (!tenant.openphone_api_key) {
          return NextResponse.json({ success: false, error: "OpenPhone API key not configured" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/openphone`

        // Delete existing webhooks with the same URL
        const listRes = await fetch("https://api.openphone.com/v1/webhooks", {
          headers: { Authorization: tenant.openphone_api_key },
        })
        if (listRes.ok) {
          const listData = await listRes.json()
          for (const wh of (listData.data || [])) {
            if (wh.url === webhookUrl) {
              await fetch(`https://api.openphone.com/v1/webhooks/${wh.id}`, {
                method: "DELETE",
                headers: { Authorization: tenant.openphone_api_key },
              })
            }
          }
        }

        const res = await fetch("https://api.openphone.com/v1/webhooks", {
          method: "POST",
          headers: {
            Authorization: tenant.openphone_api_key,
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
        })

        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`OpenPhone API returned ${res.status}: ${errText}`)
        }

        return NextResponse.json({
          success: true,
          message: `OpenPhone webhook registered: ${webhookUrl}`,
        })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Webhook registration failed" }, { status: 500 })
  }
}
