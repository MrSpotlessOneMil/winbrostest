/**
 * Ad URL Health Cron — MULTI-TENANT
 *
 * Runs every 6 hours. For every active tenant with both:
 *   workflow_config.meta_ads_access_token  (System User token)
 *   workflow_config.meta_ad_account_id     (e.g. "act_2746942098983588")
 *
 * It lists every ACTIVE ad in the account, extracts each creative's landing
 * URL, and HEAD-probes it with a 10s timeout. Any non-200 response is:
 *   1. Recorded to system_health (component='ad_url_health', status='critical')
 *   2. Auto-paused via Meta Graph API (ad-level pause, campaign keeps running)
 *   3. Sent as an SMS to tenant.owner_phone (de-duped: one alert per ad_id
 *      per 24h so a persistently broken URL doesn't spam)
 *
 * Why this cron exists: on 2026-04-20, ads were created through the Pipeboard
 * MCP with `/spotless/` prefixed URLs that 404'd. 29 real people clicked
 * through to a 404 and $24.04 was burned over ~20 hours before anyone
 * noticed. No code change triggered it — the bug was entirely in ad config
 * typed through the API, so a CI test on the website would not have caught
 * it. This is the runtime check.
 *
 * Tokens: read from tenants.workflow_config.meta_ads_access_token.
 *         (Spotless-only fallback: process.env.META_ACCESS_TOKEN if DB missing.)
 *
 * Endpoint: GET /api/cron/ad-url-health
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'
import {
  checkAdAccountUrls,
  pauseAd,
  MetaAuthError,
  type BrokenAd,
} from '@/lib/ad-url-checker'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const SPOTLESS_SLUG = 'spotless-scrubbers'
const ALERT_DEDUP_HOURS = 24

interface TenantRunSummary {
  tenant_slug: string
  tenant_id: string
  ads_checked: number
  broken_count: number
  auto_paused: number
  alerted: number
  skipped_reason?: string
  fatal_error?: string
}

function resolveTenantToken(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as unknown as Record<string, unknown>
  const dbToken = wc.meta_ads_access_token
  if (typeof dbToken === 'string' && dbToken.trim()) return dbToken.trim()
  if (tenant.slug === SPOTLESS_SLUG) {
    const envToken = process.env.META_ACCESS_TOKEN
    if (envToken && envToken.trim()) return envToken.trim()
  }
  return null
}

function resolveTenantAdAccount(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as unknown as Record<string, unknown>
  const v = wc.meta_ad_account_id
  if (typeof v !== 'string' || !v.trim()) return null
  const trimmed = v.trim()
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

async function wasAdAlertedRecently(tenantId: string, adId: string): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - ALERT_DEDUP_HOURS * 3600 * 1000).toISOString()
    const { data } = await client
      .from('system_health')
      .select('id, details')
      .eq('check_name', 'ad_url_broken_alert_sent')
      .gte('checked_at', cutoff)
      .limit(200)
    if (!data) return false
    return data.some((row) => {
      const d = row.details as { tenant_id?: string; ad_id?: string } | null
      return d?.tenant_id === tenantId && d?.ad_id === adId
    })
  } catch {
    return false
  }
}

async function recordSystemHealth(
  checkName: string,
  details: Record<string, unknown>,
  status: 'healthy' | 'warning' | 'critical' | 'error' = 'healthy',
): Promise<void> {
  try {
    const client = getSupabaseServiceClient()
    await client.from('system_health').insert({
      check_name: checkName,
      component: 'ad_url_health',
      status,
      details,
    })
  } catch (err) {
    console.error('[AdUrlHealth] Failed to record system_health row:', err)
  }
}

function formatAlertSMS(tenantName: string, broken: BrokenAd[]): string {
  const lines = [
    `[Osiris] ${broken.length} ${tenantName} ad${broken.length === 1 ? '' : 's'} auto-paused — broken landing URL`,
    '',
  ]
  for (const b of broken.slice(0, 5)) {
    lines.push(`- ${b.ad_name} (${b.http_status})`)
    lines.push(`  ${b.link.slice(0, 140)}`)
  }
  if (broken.length > 5) lines.push(`...and ${broken.length - 5} more`)
  lines.push('')
  lines.push('Fix the creative link then resume in Ads Manager.')
  return lines.join('\n')
}

async function runTenantCheck(tenant: Tenant): Promise<TenantRunSummary> {
  const summary: TenantRunSummary = {
    tenant_slug: tenant.slug,
    tenant_id: tenant.id,
    ads_checked: 0,
    broken_count: 0,
    auto_paused: 0,
    alerted: 0,
  }

  const token = resolveTenantToken(tenant)
  const adAccountId = resolveTenantAdAccount(tenant)
  if (!token || !adAccountId) {
    summary.skipped_reason = !token ? 'no-meta-token' : 'no-ad-account-id'
    return summary
  }

  let result
  try {
    result = await checkAdAccountUrls(adAccountId, token)
  } catch (err) {
    if (err instanceof MetaAuthError) {
      summary.fatal_error = `auth: ${err.message}`
      await recordSystemHealth(
        'ad_url_health_auth_error',
        { tenant_id: tenant.id, tenant_slug: tenant.slug, error: err.message },
        'error',
      )
      return summary
    }
    summary.fatal_error = err instanceof Error ? err.message : 'unknown'
    await recordSystemHealth(
      'ad_url_health_error',
      { tenant_id: tenant.id, tenant_slug: tenant.slug, stage: 'check', error: summary.fatal_error },
      'error',
    )
    return summary
  }

  summary.ads_checked = result.ads_checked
  summary.broken_count = result.broken.length

  if (result.broken.length === 0) {
    await recordSystemHealth(
      'ad_url_health',
      {
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        ads_checked: result.ads_checked,
        broken_count: 0,
        message: `All ${result.ads_checked} active ads return 200`,
      },
      'healthy',
    )
    return summary
  }

  // Pause each broken ad in parallel (cap concurrency).
  const PAUSE_CONCURRENCY = 3
  const queue = [...result.broken]
  async function pauseWorker() {
    while (queue.length) {
      const b = queue.shift()
      if (!b) break
      const ok = await pauseAd(b.ad_id, token!)
      if (ok) summary.auto_paused += 1
      await recordSystemHealth(
        'ad_url_broken_link',
        {
          tenant_id: tenant.id,
          tenant_slug: tenant.slug,
          ad_id: b.ad_id,
          ad_name: b.ad_name,
          campaign_id: b.campaign_id,
          adset_id: b.adset_id,
          link: b.link,
          http_status: b.http_status,
          error_message: b.error_message,
          auto_paused: ok,
        },
        'critical',
      )
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PAUSE_CONCURRENCY, result.broken.length) }, () => pauseWorker()),
  )

  // Determine which broken ads deserve a fresh SMS (dedup: 1 alert per ad/24h).
  const toAlert: BrokenAd[] = []
  for (const b of result.broken) {
    const alreadyAlerted = await wasAdAlertedRecently(tenant.id, b.ad_id)
    if (!alreadyAlerted) toAlert.push(b)
  }

  if (toAlert.length > 0 && tenant.owner_phone) {
    try {
      const msg = formatAlertSMS(tenant.name, toAlert)
      const smsResp = await sendSMS(tenant, tenant.owner_phone, msg, {
        source: 'ad_url_health',
        bypassFilters: true,
        kind: 'internal',
      })
      if (smsResp.success) {
        summary.alerted = toAlert.length
        // Record one dedup marker per ad so this alert cools down for 24h.
        for (const b of toAlert) {
          await recordSystemHealth(
            'ad_url_broken_alert_sent',
            { tenant_id: tenant.id, ad_id: b.ad_id, link: b.link },
            'warning',
          )
        }
      }
    } catch (err) {
      console.error(`[AdUrlHealth:${tenant.slug}] SMS send failed:`, err)
    }
  }

  return summary
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const tenants = await getAllActiveTenants()

  const tenantsWithAds = tenants.filter((t) => {
    const wc = (t.workflow_config || {}) as unknown as Record<string, unknown>
    const hasAccount = typeof wc.meta_ad_account_id === 'string' && (wc.meta_ad_account_id as string).trim()
    const hasToken =
      (typeof wc.meta_ads_access_token === 'string' && (wc.meta_ads_access_token as string).trim()) ||
      (t.slug === SPOTLESS_SLUG && !!process.env.META_ACCESS_TOKEN)
    return hasAccount && hasToken
  })

  // Run tenants sequentially — Meta rate-limits per account and the ad
  // universe per tenant is small enough that parallelism isn't worth the risk.
  const summaries: TenantRunSummary[] = []
  for (const tenant of tenantsWithAds) {
    summaries.push(await runTenantCheck(tenant))
  }

  const totalBroken = summaries.reduce((s, x) => s + x.broken_count, 0)
  const totalChecked = summaries.reduce((s, x) => s + x.ads_checked, 0)
  const totalPaused = summaries.reduce((s, x) => s + x.auto_paused, 0)
  const totalAlerted = summaries.reduce((s, x) => s + x.alerted, 0)

  console.log(
    `[AdUrlHealth] ${startedAt} — checked ${totalChecked} ads across ${summaries.length} tenants; ${totalBroken} broken, ${totalPaused} auto-paused, ${totalAlerted} alerts sent.`,
  )

  return NextResponse.json({
    success: true,
    checked_at: startedAt,
    tenants_evaluated: summaries.length,
    ads_checked: totalChecked,
    broken: totalBroken,
    auto_paused: totalPaused,
    alerts_sent: totalAlerted,
    per_tenant: summaries,
  })
}
