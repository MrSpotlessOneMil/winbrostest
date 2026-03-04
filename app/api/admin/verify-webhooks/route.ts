import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireAdmin } from "@/lib/auth"
import { getBaseUrl } from "@/lib/admin-onboard"
import Stripe from "stripe"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

interface VerifyResult {
  active: boolean
  url: string | null
  message: string
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { tenantId, service } = await request.json()

  if (!tenantId) {
    return NextResponse.json({ success: false, error: "tenantId is required" }, { status: 400 })
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
      { success: false, error: "Base URL not configured." },
      { status: 500 }
    )
  }

  const services = service
    ? [service]
    : ["telegram", "stripe", "openphone", "vapi"].filter((s) => {
        if (s === "telegram") return !!tenant.telegram_bot_token
        if (s === "stripe") return !!tenant.stripe_secret_key && tenant.workflow_config?.use_stripe
        if (s === "openphone") return !!tenant.openphone_api_key
        if (s === "vapi") return !!tenant.vapi_api_key && !!tenant.vapi_assistant_id
        return false
      })

  const results: Record<string, VerifyResult> = {}

  for (const svc of services) {
    try {
      switch (svc) {
        case "telegram": {
          if (!tenant.telegram_bot_token) {
            results.telegram = { active: false, url: null, message: "Bot token not configured" }
            break
          }
          const expectedUrl = `${baseUrl}/api/webhooks/telegram/${tenant.slug}`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch(
            `https://api.telegram.org/bot${tenant.telegram_bot_token}/getWebhookInfo`,
            { signal: controller.signal }
          )
          clearTimeout(timeout)
          const data = await res.json()
          if (!data.ok) {
            results.telegram = { active: false, url: null, message: data.description || "API error" }
          } else if (data.result?.url === expectedUrl) {
            results.telegram = { active: true, url: data.result.url, message: "Webhook active" }
          } else if (data.result?.url) {
            results.telegram = { active: false, url: data.result.url, message: `Webhook points to different URL: ${data.result.url}` }
          } else {
            results.telegram = { active: false, url: null, message: "No webhook configured" }
          }
          break
        }

        case "stripe": {
          if (!tenant.stripe_secret_key) {
            results.stripe = { active: false, url: null, message: "Stripe key not configured" }
            break
          }
          const expectedUrl = `${baseUrl}/api/webhooks/stripe`
          const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
          const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
          const match = endpoints.data.find((wh) => wh.url === expectedUrl)
          if (match) {
            const eventCount = match.enabled_events?.length || 0
            results.stripe = {
              active: match.status === "enabled",
              url: match.url,
              message: match.status === "enabled"
                ? `Webhook active, ${eventCount} events`
                : `Webhook exists but status: ${match.status}`,
            }
          } else {
            results.stripe = { active: false, url: null, message: "No webhook found for this URL" }
          }
          break
        }

        case "openphone": {
          if (!tenant.openphone_api_key) {
            results.openphone = { active: false, url: null, message: "OpenPhone key not configured" }
            break
          }
          const expectedUrl = `${baseUrl}/api/webhooks/openphone`
          const controller2 = new AbortController()
          const timeout2 = setTimeout(() => controller2.abort(), 10_000)
          const listRes = await fetch("https://api.openphone.com/v1/webhooks", {
            headers: { Authorization: tenant.openphone_api_key },
            signal: controller2.signal,
          })
          clearTimeout(timeout2)
          if (!listRes.ok) {
            const errText = await listRes.text()
            results.openphone = { active: false, url: null, message: `API returned ${listRes.status}: ${errText}` }
          } else {
            const listData = await listRes.json()
            const match = (listData.data || []).find((wh: any) => wh.url === expectedUrl)
            if (match) {
              results.openphone = { active: true, url: match.url, message: "Webhook active" }
            } else {
              results.openphone = { active: false, url: null, message: "No webhook found for this URL" }
            }
          }
          break
        }

        case "vapi": {
          if (!tenant.vapi_api_key || !tenant.vapi_assistant_id) {
            results.vapi = { active: false, url: null, message: "VAPI credentials not configured" }
            break
          }
          const expectedVapiUrl = `${baseUrl}/api/webhooks/vapi/${tenant.slug}`
          const assistantIds = [tenant.vapi_assistant_id, ...(tenant.vapi_outbound_assistant_id ? [tenant.vapi_outbound_assistant_id] : [])]
          let allMatch = true
          const mismatches: string[] = []
          for (const aId of assistantIds) {
            const vapiController = new AbortController()
            const vapiTimeout = setTimeout(() => vapiController.abort(), 10_000)
            const vapiRes = await fetch(`https://api.vapi.ai/assistant/${aId}`, {
              headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
              signal: vapiController.signal,
            })
            clearTimeout(vapiTimeout)
            if (!vapiRes.ok) {
              allMatch = false
              mismatches.push(`${aId}: API returned ${vapiRes.status}`)
              continue
            }
            const vapiData = await vapiRes.json()
            if (vapiData.server?.url !== expectedVapiUrl) {
              allMatch = false
              mismatches.push(`${aId}: ${vapiData.server?.url || "no server URL"}`)
            }
          }
          if (allMatch) {
            results.vapi = { active: true, url: expectedVapiUrl, message: `Server URL active on ${assistantIds.length} assistant(s)` }
          } else {
            results.vapi = { active: false, url: null, message: `Mismatch: ${mismatches.join("; ")}` }
          }
          break
        }

        default:
          results[svc] = { active: false, url: null, message: `Unknown service: ${svc}` }
      }
    } catch (err: any) {
      results[svc] = { active: false, url: null, message: err.message || "Verification failed" }
    }
  }

  return NextResponse.json({ success: true, results })
}
