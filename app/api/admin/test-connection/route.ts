import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"
import {
  testStripeConnection,
  testOpenPhoneConnection,
  testVapiConnection,
  testTelegramConnection,
  testWaveConnection,
  testGmailConnection,
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

  try {
    switch (service) {
      case "stripe": {
        if (!tenant.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key not configured" }, { status: 400 })
        }
        const result = await testStripeConnection(tenant.stripe_secret_key)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "openphone": {
        if (!tenant.openphone_api_key || !tenant.openphone_phone_id) {
          return NextResponse.json({ success: false, error: "OpenPhone API key or phone ID not configured" }, { status: 400 })
        }
        const result = await testOpenPhoneConnection(tenant.openphone_api_key, tenant.openphone_phone_id)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "vapi": {
        if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
          return NextResponse.json({ success: false, error: "VAPI API key or assistant ID not configured" }, { status: 400 })
        }
        const result = await testVapiConnection(tenant.vapi_api_key, tenant.vapi_assistant_id, {
          outboundAssistantId: tenant.vapi_outbound_assistant_id || undefined,
        })
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "telegram": {
        if (!tenant.telegram_bot_token) {
          return NextResponse.json({ success: false, error: "Telegram bot token not configured" }, { status: 400 })
        }
        const result = await testTelegramConnection(tenant.telegram_bot_token)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "wave": {
        if (!tenant.wave_api_token || !tenant.wave_business_id) {
          return NextResponse.json({ success: false, error: "Wave API token or business ID not configured" }, { status: 400 })
        }
        const result = await testWaveConnection(tenant.wave_api_token, tenant.wave_business_id)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      case "gmail": {
        if (!tenant.gmail_user || !tenant.gmail_app_password) {
          return NextResponse.json({ success: false, error: "Gmail address or app password not configured" }, { status: 400 })
        }
        const result = await testGmailConnection(tenant.gmail_user, tenant.gmail_app_password)
        return NextResponse.json({ success: result.ok, message: result.message })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Connection test failed" }, { status: 500 })
  }
}