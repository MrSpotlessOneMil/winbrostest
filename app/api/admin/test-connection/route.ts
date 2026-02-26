import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"
import Stripe from "stripe"

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

  try {
    switch (service) {
      case "stripe": {
        if (!tenant.stripe_secret_key) {
          return NextResponse.json({ success: false, error: "Stripe secret key not configured" }, { status: 400 })
        }
        const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
        const balance = await stripe.balance.retrieve()
        const balanceStr = balance.available
          .map((b: any) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`)
          .join(", ")
        return NextResponse.json({
          success: true,
          message: `Connected. Balance: ${balanceStr || "0.00"}`,
        })
      }

      case "openphone": {
        if (!tenant.openphone_api_key || !tenant.openphone_phone_id) {
          return NextResponse.json({ success: false, error: "OpenPhone API key or phone ID not configured" }, { status: 400 })
        }
        const res = await fetch(`https://api.openphone.com/v1/phone-numbers/${tenant.openphone_phone_id}`, {
          headers: { Authorization: tenant.openphone_api_key },
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`OpenPhone API returned ${res.status}: ${errText}`)
        }
        const data = await res.json()
        return NextResponse.json({
          success: true,
          message: `Connected. Phone: ${data.data?.formattedNumber || data.data?.phoneNumber || "OK"}`,
        })
      }

      case "vapi": {
        if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
          return NextResponse.json({ success: false, error: "VAPI API key or assistant ID not configured" }, { status: 400 })
        }
        const res = await fetch(`https://api.vapi.ai/assistant/${tenant.vapi_assistant_id}`, {
          headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`VAPI API returned ${res.status}: ${errText}`)
        }
        const data = await res.json()
        return NextResponse.json({
          success: true,
          message: `Connected. Assistant: ${data.name || data.id || "OK"}`,
        })
      }

      case "telegram": {
        if (!tenant.telegram_bot_token) {
          return NextResponse.json({ success: false, error: "Telegram bot token not configured" }, { status: 400 })
        }
        const res = await fetch(`https://api.telegram.org/bot${tenant.telegram_bot_token}/getMe`)
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Telegram API returned ${res.status}: ${errText}`)
        }
        const data = await res.json()
        if (!data.ok) {
          throw new Error(data.description || "Telegram API error")
        }
        return NextResponse.json({
          success: true,
          message: `Connected. Bot: @${data.result?.username || "OK"}`,
        })
      }

      case "wave": {
        if (!tenant.wave_api_token || !tenant.wave_business_id) {
          return NextResponse.json({ success: false, error: "Wave API token or business ID not configured" }, { status: 400 })
        }
        const token = tenant.wave_api_token.replace(/[\r\n]/g, "").trim().replace(/^Bearer\s+/i, "")
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch("https://gql.waveapps.com/graphql/public", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `query { business(id: "${tenant.wave_business_id}") { id name } }`,
          }),
          signal: controller.signal,
        })
        clearTimeout(timeout)
        const payload = await res.json()
        if (!res.ok || payload.errors?.length) {
          throw new Error(payload.errors?.[0]?.message || `Wave API returned ${res.status}`)
        }
        const bizName = payload.data?.business?.name
        return NextResponse.json({
          success: true,
          message: `Connected. Business: ${bizName || "OK"}`,
        })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown service: ${service}` }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "Connection test failed" }, { status: 500 })
  }
}
