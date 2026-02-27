import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import {
  getBaseUrl,
  registerTelegramWebhook,
  registerStripeWebhook,
  registerOpenPhoneWebhook,
} from "@/lib/admin-onboard"

/**
 * Registers a webhook using raw credentials (no tenant lookup).
 * Used by the onboarding wizard before the tenant exists.
 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { service, credentials } = await request.json()

  if (!service || !credentials) {
    return NextResponse.json({ success: false, error: "service and credentials are required" }, { status: 400 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: "Base URL not configured" }, { status: 500 })
  }

  try {
    switch (service) {
      case "telegram": {
        if (!credentials.telegram_bot_token || !credentials.slug) {
          return NextResponse.json({ success: false, error: "Bot token and slug are required" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/telegram/${credentials.slug}`
        const result = await registerTelegramWebhook(credentials.telegram_bot_token, webhookUrl)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "stripe": {
        if (!credentials.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key is required" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/stripe`
        const result = await registerStripeWebhook(credentials.stripe_secret_key, webhookUrl)
        return NextResponse.json({ success: result.ok, message: result.message, secret: result.secret })
      }

      case "openphone": {
        if (!credentials.openphone_api_key) {
          return NextResponse.json({ success: false, error: "OpenPhone API key is required" }, { status: 400 })
        }
        const webhookUrl = `${baseUrl}/api/webhooks/openphone`
        const result = await registerOpenPhoneWebhook(credentials.openphone_api_key, webhookUrl)
        return NextResponse.json({ success: result.ok, message: result.message, secret: result.secret })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Webhook registration failed" }, { status: 500 })
  }
}
