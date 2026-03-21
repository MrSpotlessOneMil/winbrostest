import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"
import { getBaseUrl } from "@/lib/admin-onboard"
import Stripe from "stripe"

// route-check:no-vercel-cron

interface VerifyResult {
  active: boolean
  url: string | null
  expected: string
  message: string
}

interface TenantVerification {
  tenantId: string
  slug: string
  services: Record<string, VerifyResult>
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { success: false, error: "Base URL not configured." },
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

  const results: TenantVerification[] = []

  for (const tenant of tenants) {
    const tenantResult: TenantVerification = {
      tenantId: tenant.id,
      slug: tenant.slug,
      services: {},
    }

    // --- Telegram ---
    if (tenant.telegram_bot_token) {
      const expected = `${baseUrl}/api/webhooks/telegram/${tenant.slug}`
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch(
          `https://api.telegram.org/bot${tenant.telegram_bot_token}/getWebhookInfo`,
          { signal: controller.signal }
        )
        clearTimeout(timeout)
        const data = await res.json()
        if (!data.ok) {
          tenantResult.services.telegram = { active: false, url: null, expected, message: data.description || "API error" }
        } else if (data.result?.url === expected) {
          tenantResult.services.telegram = { active: true, url: data.result.url, expected, message: "Webhook active and correct" }
        } else if (data.result?.url) {
          tenantResult.services.telegram = { active: false, url: data.result.url, expected, message: `STALE — points to wrong URL` }
        } else {
          tenantResult.services.telegram = { active: false, url: null, expected, message: "No webhook configured" }
        }
      } catch (err: any) {
        tenantResult.services.telegram = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- Stripe ---
    if (tenant.stripe_secret_key) {
      const expected = `${baseUrl}/api/webhooks/stripe`
      try {
        const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
        const match = endpoints.data.find((wh) => wh.url === expected)
        if (match) {
          tenantResult.services.stripe = {
            active: match.status === "enabled",
            url: match.url,
            expected,
            message: match.status === "enabled"
              ? `Webhook active, ${match.enabled_events?.length || 0} events`
              : `Webhook exists but status: ${match.status}`,
          }
        } else {
          const staleUrls = endpoints.data.map((wh) => wh.url)
          tenantResult.services.stripe = {
            active: false,
            url: staleUrls[0] || null,
            expected,
            message: staleUrls.length
              ? `STALE — found ${staleUrls.length} endpoint(s) but none match expected URL. Found: ${staleUrls.join(", ")}`
              : "No webhook endpoints found",
          }
        }
      } catch (err: any) {
        tenantResult.services.stripe = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- OpenPhone ---
    if (tenant.openphone_api_key) {
      const expected = `${baseUrl}/api/webhooks/openphone`
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const listRes = await fetch("https://api.openphone.com/v1/webhooks", {
          headers: { Authorization: tenant.openphone_api_key },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!listRes.ok) {
          const errText = await listRes.text()
          tenantResult.services.openphone = { active: false, url: null, expected, message: `API returned ${listRes.status}: ${errText}` }
        } else {
          const listData = await listRes.json()
          const match = (listData.data || []).find((wh: any) => wh.url === expected)
          if (match) {
            tenantResult.services.openphone = { active: true, url: match.url, expected, message: "Webhook active and correct" }
          } else {
            const staleUrls = (listData.data || []).map((wh: any) => wh.url)
            tenantResult.services.openphone = {
              active: false,
              url: staleUrls[0] || null,
              expected,
              message: staleUrls.length
                ? `STALE — found webhook(s) but none match. Found: ${[...new Set(staleUrls)].join(", ")}`
                : "No webhooks found",
            }
          }
        }
      } catch (err: any) {
        tenantResult.services.openphone = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- VAPI ---
    if (tenant.vapi_api_key && tenant.vapi_assistant_id) {
      const expected = `${baseUrl}/api/webhooks/vapi/${tenant.slug}`
      const assistantIds = [tenant.vapi_assistant_id, ...(tenant.vapi_outbound_assistant_id ? [tenant.vapi_outbound_assistant_id] : [])]
      let allMatch = true
      const details: string[] = []
      for (const aId of assistantIds) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch(`https://api.vapi.ai/assistant/${aId}`, {
            headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (!res.ok) {
            allMatch = false
            details.push(`${aId}: API ${res.status}`)
          } else {
            const data = await res.json()
            if (data.server?.url === expected) {
              details.push(`${aId}: correct`)
            } else {
              allMatch = false
              details.push(`${aId}: STALE — ${data.server?.url || "no server URL"}`)
            }
          }
        } catch (err: any) {
          allMatch = false
          details.push(`${aId}: ${err.message}`)
        }
      }
      tenantResult.services.vapi = {
        active: allMatch,
        url: allMatch ? expected : null,
        expected,
        message: allMatch ? `All ${assistantIds.length} assistant(s) correct` : details.join("; "),
      }
    }

    results.push(tenantResult)
  }

  const totalChecked = results.reduce((sum, r) => sum + Object.keys(r.services).length, 0)
  const activeCount = results.reduce(
    (sum, r) => sum + Object.values(r.services).filter((s) => s.active).length,
    0
  )
  const staleCount = totalChecked - activeCount

  return NextResponse.json({
    success: true,
    baseUrl,
    tenantCount: tenants.length,
    totalChecked,
    activeCount,
    staleCount,
    allGood: staleCount === 0,
    results,
  })
}
