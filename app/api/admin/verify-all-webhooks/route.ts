import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"
import { getBaseUrl } from "@/lib/admin-onboard"
import Stripe from "stripe"

// route-check:no-vercel-cron

interface CheckResult {
  active: boolean
  url?: string | null
  expected?: string
  message: string
}

interface TenantVerification {
  tenantId: string
  slug: string
  webhooks: Record<string, CheckResult>
  connections: Record<string, CheckResult>
  keysPresent: Record<string, boolean>
}

export async function GET(request: NextRequest) {
  return handleVerify(request)
}

export async function POST(request: NextRequest) {
  return handleVerify(request)
}

async function handleVerify(request: NextRequest) {
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
      webhooks: {},
      connections: {},
      keysPresent: {
        stripe_secret_key: !!tenant.stripe_secret_key,
        stripe_webhook_secret: !!tenant.stripe_webhook_secret,
        telegram_bot_token: !!tenant.telegram_bot_token,
        openphone_api_key: !!tenant.openphone_api_key,
        openphone_phone_id: !!tenant.openphone_phone_id,
        vapi_api_key: !!tenant.vapi_api_key,
        vapi_assistant_id: !!tenant.vapi_assistant_id,
        vapi_outbound_assistant_id: !!tenant.vapi_outbound_assistant_id,
        housecall_pro_api_key: !!tenant.housecall_pro_api_key,
      },
    }

    // ===================== CONNECTION TESTS =====================

    // --- Stripe connection ---
    if (tenant.stripe_secret_key) {
      try {
        const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any, timeout: 10_000 })
        const balance = await stripe.balance.retrieve()
        const balanceStr = balance.available
          .map((b: any) => `${(b.amount / 100).toFixed(2)} ${b.currency.toUpperCase()}`)
          .join(", ")
        tenantResult.connections.stripe = { active: true, message: `Connected. Balance: ${balanceStr || "0.00"}` }
      } catch (err: any) {
        tenantResult.connections.stripe = { active: false, message: `FAILED: ${err.message}` }
      }
    }

    // --- Telegram connection ---
    if (tenant.telegram_bot_token) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch(`https://api.telegram.org/bot${tenant.telegram_bot_token}/getMe`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)
        const data = await res.json()
        if (data.ok) {
          tenantResult.connections.telegram = { active: true, message: `Connected. Bot: @${data.result?.username}` }
        } else {
          tenantResult.connections.telegram = { active: false, message: `FAILED: ${data.description}` }
        }
      } catch (err: any) {
        tenantResult.connections.telegram = { active: false, message: `FAILED: ${err.message}` }
      }
    }

    // --- OpenPhone connection ---
    if (tenant.openphone_api_key) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch("https://api.openphone.com/v1/phone-numbers", {
          headers: { Authorization: tenant.openphone_api_key },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (res.ok) {
          const data = await res.json()
          const phones = (data.data || []).map((p: any) => p.formattedNumber || p.phoneNumber).join(", ")
          const matchesPhoneId = tenant.openphone_phone_id
            ? (data.data || []).some((p: any) => p.id === tenant.openphone_phone_id || p.phoneNumberId === tenant.openphone_phone_id)
            : null
          let msg = `Connected. Phones: ${phones || "none"}`
          if (tenant.openphone_phone_id && !matchesPhoneId) {
            msg += ` WARNING: phone_id "${tenant.openphone_phone_id}" NOT found in account!`
          }
          tenantResult.connections.openphone = { active: true, message: msg }
        } else {
          const errText = await res.text()
          tenantResult.connections.openphone = { active: false, message: `FAILED (${res.status}): ${errText}` }
        }
      } catch (err: any) {
        tenantResult.connections.openphone = { active: false, message: `FAILED: ${err.message}` }
      }
    }

    // --- VAPI connection ---
    if (tenant.vapi_api_key) {
      const assistantIds = [
        ...(tenant.vapi_assistant_id ? [{ id: tenant.vapi_assistant_id, label: "inbound" }] : []),
        ...(tenant.vapi_outbound_assistant_id ? [{ id: tenant.vapi_outbound_assistant_id, label: "outbound" }] : []),
      ]
      const details: string[] = []
      let allOk = true
      for (const { id, label } of assistantIds) {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10_000)
          const res = await fetch(`https://api.vapi.ai/assistant/${id}`, {
            headers: { Authorization: `Bearer ${tenant.vapi_api_key}` },
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (res.ok) {
            const data = await res.json()
            details.push(`${label}: "${data.name || id}" OK`)
          } else {
            allOk = false
            details.push(`${label}: FAILED (${res.status})`)
          }
        } catch (err: any) {
          allOk = false
          details.push(`${label}: FAILED — ${err.message}`)
        }
      }
      tenantResult.connections.vapi = {
        active: allOk,
        message: assistantIds.length ? details.join("; ") : "No assistant IDs configured",
      }
    }

    // --- HouseCall Pro connection ---
    if (tenant.housecall_pro_api_key) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10_000)
        const res = await fetch("https://api.housecallpro.com/v1/company", {
          headers: { Authorization: `Bearer ${tenant.housecall_pro_api_key}` },
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (res.ok) {
          const data = await res.json()
          tenantResult.connections.housecall_pro = { active: true, message: `Connected. Company: ${data.name || "OK"}` }
        } else {
          const errText = await res.text()
          tenantResult.connections.housecall_pro = { active: false, message: `FAILED (${res.status}): ${errText}` }
        }
      } catch (err: any) {
        tenantResult.connections.housecall_pro = { active: false, message: `FAILED: ${err.message}` }
      }
    }

    // ===================== WEBHOOK VERIFICATION =====================

    // --- Telegram webhook ---
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
          tenantResult.webhooks.telegram = { active: false, url: null, expected, message: data.description || "API error" }
        } else if (data.result?.url === expected) {
          tenantResult.webhooks.telegram = { active: true, url: data.result.url, expected, message: "Correct" }
        } else if (data.result?.url) {
          tenantResult.webhooks.telegram = { active: false, url: data.result.url, expected, message: `STALE — points to ${data.result.url}` }
        } else {
          tenantResult.webhooks.telegram = { active: false, url: null, expected, message: "Not configured" }
        }
      } catch (err: any) {
        tenantResult.webhooks.telegram = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- Stripe webhook ---
    if (tenant.stripe_secret_key) {
      const expected = `${baseUrl}/api/webhooks/stripe`
      try {
        const stripe = new Stripe(tenant.stripe_secret_key, { apiVersion: "2025-02-24.acacia" as any })
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
        const match = endpoints.data.find((wh) => wh.url === expected)
        if (match) {
          tenantResult.webhooks.stripe = {
            active: match.status === "enabled",
            url: match.url,
            expected,
            message: match.status === "enabled"
              ? `Correct, ${match.enabled_events?.length || 0} events`
              : `Exists but status: ${match.status}`,
          }
        } else {
          const staleUrls = endpoints.data.map((wh) => wh.url)
          tenantResult.webhooks.stripe = {
            active: false,
            url: staleUrls[0] || null,
            expected,
            message: staleUrls.length
              ? `STALE — found: ${staleUrls.join(", ")}`
              : "No endpoints found",
          }
        }
      } catch (err: any) {
        tenantResult.webhooks.stripe = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- OpenPhone webhook ---
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
          tenantResult.webhooks.openphone = { active: false, url: null, expected, message: `API ${listRes.status}: ${errText}` }
        } else {
          const listData = await listRes.json()
          const match = (listData.data || []).find((wh: any) => wh.url === expected)
          if (match) {
            tenantResult.webhooks.openphone = { active: true, url: match.url, expected, message: "Correct" }
          } else {
            const staleUrls = (listData.data || []).map((wh: any) => wh.url)
            tenantResult.webhooks.openphone = {
              active: false,
              url: staleUrls[0] || null,
              expected,
              message: staleUrls.length
                ? `STALE — found: ${[...new Set(staleUrls)].join(", ")}`
                : "No webhooks found",
            }
          }
        }
      } catch (err: any) {
        tenantResult.webhooks.openphone = { active: false, url: null, expected, message: err.message }
      }
    }

    // --- VAPI webhook ---
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
      tenantResult.webhooks.vapi = {
        active: allMatch,
        url: allMatch ? expected : null,
        expected,
        message: allMatch ? `All ${assistantIds.length} assistant(s) correct` : details.join("; "),
      }
    }

    results.push(tenantResult)
  }

  // Summary counts
  const totalWebhooks = results.reduce((sum, r) => sum + Object.keys(r.webhooks).length, 0)
  const activeWebhooks = results.reduce((sum, r) => sum + Object.values(r.webhooks).filter((s) => s.active).length, 0)
  const totalConnections = results.reduce((sum, r) => sum + Object.keys(r.connections).length, 0)
  const activeConnections = results.reduce((sum, r) => sum + Object.values(r.connections).filter((s) => s.active).length, 0)

  return NextResponse.json({
    success: true,
    baseUrl,
    tenantCount: tenants.length,
    summary: {
      webhooks: `${activeWebhooks}/${totalWebhooks} active`,
      connections: `${activeConnections}/${totalConnections} connected`,
      allGood: activeWebhooks === totalWebhooks && activeConnections === totalConnections,
    },
    results,
  })
}
