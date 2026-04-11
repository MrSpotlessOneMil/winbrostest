import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import {
  testStripeConnection,
  testOpenPhoneConnection,
  testVapiConnection,
  testVapiKeyOnly,
  testTelegramConnection,
  testWaveConnection,
  testGmailConnection,
  testGmailServiceAccountConnection,
} from "@/lib/admin-onboard"

/**
 * Tests a service connection using raw credentials (no tenant lookup).
 * Used by the onboarding wizard before the tenant exists.
 */
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

  const { service, credentials } = body

  if (!service || !credentials) {
    return NextResponse.json({ success: false, error: "service and credentials are required" }, { status: 400 })
  }

  try {
    switch (service) {
      case "stripe": {
        if (!credentials.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key is required" }, { status: 400 })
        }
        const result = await testStripeConnection(credentials.stripe_secret_key)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "openphone": {
        if (!credentials.openphone_api_key || !credentials.openphone_phone_id) {
          return NextResponse.json({ success: false, error: "OpenPhone API key and phone ID are required" }, { status: 400 })
        }
        const result = await testOpenPhoneConnection(credentials.openphone_api_key, credentials.openphone_phone_id)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "vapi": {
        if (!credentials.vapi_api_key || !credentials.vapi_assistant_id) {
          return NextResponse.json({ success: false, error: "VAPI API key and assistant ID are required" }, { status: 400 })
        }
        const result = await testVapiConnection(credentials.vapi_api_key, credentials.vapi_assistant_id)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "vapi-key-only": {
        if (!credentials.vapi_api_key) {
          return NextResponse.json({ success: false, error: "VAPI API key is required" }, { status: 400 })
        }
        const result = await testVapiKeyOnly(credentials.vapi_api_key)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "telegram": {
        if (!credentials.telegram_bot_token) {
          return NextResponse.json({ success: false, error: "Telegram bot token is required" }, { status: 400 })
        }
        const result = await testTelegramConnection(credentials.telegram_bot_token)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "wave": {
        if (!credentials.wave_api_token || !credentials.wave_business_id) {
          return NextResponse.json({ success: false, error: "Wave API token and business ID are required" }, { status: 400 })
        }
        const result = await testWaveConnection(credentials.wave_api_token, credentials.wave_business_id)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "gmail": {
        if (!credentials.gmail_user || !credentials.gmail_app_password) {
          return NextResponse.json({ success: false, error: "Gmail address and app password are required" }, { status: 400 })
        }
        const result = await testGmailConnection(credentials.gmail_user, credentials.gmail_app_password)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "gmail-service-account": {
        if (!credentials.gmail_service_account_json || !credentials.gmail_impersonated_user) {
          return NextResponse.json({ success: false, error: "Service account JSON and impersonated user email are required" }, { status: 400 })
        }
        const result = await testGmailServiceAccountConnection(credentials.gmail_service_account_json, credentials.gmail_impersonated_user)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Connection test failed" })
  }
}
