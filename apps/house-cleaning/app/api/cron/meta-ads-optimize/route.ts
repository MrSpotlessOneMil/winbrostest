/**
 * Meta Ads Auto-Optimizer — MULTI-TENANT
 *
 * Runs daily at 10 AM PT (17:00 UTC).
 *
 * For every active tenant with both:
 *   workflow_config.meta_ads_access_token  (System User token)
 *   workflow_config.meta_ad_account_id     (e.g. "act_2746942098983588")
 *
 * Iterates the tenant's ACTIVE campaigns and applies:
 *   PAUSE  — ad set CPL > $60 with 1000+ impressions over last 7 days
 *   SCALE  — campaign budget +20% if best ad set CPL < $20 with 5+ leads (7d)
 *            (only scales once per 7 days per campaign; hard cap $100/day)
 *
 * Tokens: read from tenants.workflow_config.meta_ads_access_token.
 *         (Spotless-only fallback: process.env.META_ACCESS_TOKEN if DB missing.)
 *
 * Self-healing:
 *   - Missing token / auth failure → sends tenant owner ONE setup SMS per 24h
 *   - Transient 5xx from Meta → retries 3x with exponential backoff
 *   - Partial failures per campaign don't abort the whole tenant run
 *   - Decisions logged to system_health with tenant_id in details
 *
 * Endpoint: GET /api/cron/meta-ads-optimize
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants, type Tenant } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const META_API_BASE = 'https://graph.facebook.com/v21.0'
const SPOTLESS_SLUG = 'spotless-scrubbers'

const CPL_KILL_THRESHOLD = 60
const MIN_IMPRESSIONS_TO_KILL = 1000
const CPL_SCALE_THRESHOLD = 20
const MIN_LEADS_TO_SCALE = 5
const SCALE_FACTOR = 1.2
const MAX_DAILY_BUDGET_CENTS = 10_000
const SCALE_COOLDOWN_DAYS = 7
const SETUP_ALERT_COOLDOWN_HOURS = 24

interface MetaCampaign {
  id: string
  name: string
  status: string
  daily_budget?: string
}

interface MetaAdSet {
  id: string
  name: string
  status: string
}

interface MetaAction {
  action_type: string
  value: string
}

interface MetaInsight {
  adset_id?: string
  adset_name?: string
  campaign_id?: string
  impressions?: string
  spend?: string
  actions?: MetaAction[]
}

interface AdSetResult {
  tenant_slug: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  impressions: number
  spend: number
  leads: number
  cpl: number | null
  decision: 'paused' | 'scaled_eligible' | 'watching' | 'insufficient_data'
  decision_reason: string
  api_error?: string
}

interface TenantRunSummary {
  tenant_slug: string
  campaigns_evaluated: number
  ad_sets_evaluated: number
  actions: string[]
  skipped_reason?: string
  fatal_error?: string
}

class MetaAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaAuthError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function metaGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${META_API_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (res.ok) return (await res.json()) as T
      const body = await res.text()
      if (res.status === 401 || res.status === 403) {
        throw new MetaAuthError(`Meta ${res.status}: ${body.slice(0, 200)}`)
      }
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`Meta ${res.status}: ${body.slice(0, 200)}`)
        await sleep(500 * Math.pow(2, attempt))
        continue
      }
      throw new Error(`Meta ${res.status}: ${body.slice(0, 300)}`)
    } catch (err) {
      if (err instanceof MetaAuthError) throw err
      lastError = err
      if (attempt < 2) await sleep(500 * Math.pow(2, attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Meta GET failed after retries')
}

async function metaPost(
  path: string,
  fields: Record<string, string>,
  token: string
): Promise<{ success: boolean }> {
  const url = `${META_API_BASE}/${path}`
  const body = new URLSearchParams({ access_token: token, ...fields })
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      })
      if (res.ok) return (await res.json()) as { success: boolean }
      const text = await res.text()
      if (res.status === 401 || res.status === 403) {
        throw new MetaAuthError(`Meta ${res.status}: ${text.slice(0, 200)}`)
      }
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`Meta ${res.status}: ${text.slice(0, 200)}`)
        await sleep(500 * Math.pow(2, attempt))
        continue
      }
      throw new Error(`Meta ${res.status}: ${text.slice(0, 300)}`)
    } catch (err) {
      if (err instanceof MetaAuthError) throw err
      lastError = err
      if (attempt < 2) await sleep(500 * Math.pow(2, attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Meta POST failed after retries')
}

function resolveTenantToken(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as Record<string, unknown>
  const dbToken = wc.meta_ads_access_token
  if (typeof dbToken === 'string' && dbToken.trim()) return dbToken.trim()
  if (tenant.slug === SPOTLESS_SLUG) {
    const envToken = process.env.META_ACCESS_TOKEN
    if (envToken && envToken.trim()) return envToken.trim()
  }
  return null
}

function resolveTenantAdAccount(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as Record<string, unknown>
  const v = wc.meta_ad_account_id
  if (typeof v !== 'string' || !v.trim()) return null
  const trimmed = v.trim()
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

async function shouldSendSetupAlert(tenantId: string): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - SETUP_ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString()
    const { data } = await client
      .from('system_health')
      .select('id, details')
      .eq('check_name', 'meta_ads_optimize_setup_alert')
      .gte('checked_at', cutoff)
      .limit(50)
    if (!data) return false
    const alreadyAlerted = data.some((row) => {
      const details = row.details as { tenant_id?: string } | null
      return details?.tenant_id === tenantId
    })
    return !alreadyAlerted
  } catch {
    return false
  }
}

async function sendSetupAlertIfDue(tenant: Tenant, reason: string): Promise<void> {
  if (!tenant.owner_phone) return
  if (!(await shouldSendSetupAlert(tenant.id))) return
  try {
    const msg = [
      `⚠️ Meta Ads Auto-Optimize paused for ${tenant.name}`,
      '',
      reason,
      '',
      'To unblock:',
      '1. business.facebook.com → Business Settings → System Users',
      '2. Generate new token against your Meta app',
      '3. Scopes: ads_management, ads_read, business_management',
      '4. Paste token into Osiris dashboard → Connect Meta',
      '',
      "I'll stay quiet until this is fixed.",
    ].join('\n')
    await sendSMS(tenant, tenant.owner_phone, msg, {
      source: 'meta_ads_optimize',
      bypassFilters: true,
    })
    await recordDecision('meta_ads_optimize_setup_alert', { tenant_id: tenant.id, reason }, 'warning')
  } catch (err) {
    console.error(`[MetaAdsOptimize:${tenant.slug}] Setup alert send failed:`, err)
  }
}

async function wasCampaignScaledRecently(tenantId: string, campaignId: string): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - SCALE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data } = await client
      .from('system_health')
      .select('id, details')
      .eq('check_name', 'meta_ads_scaled')
      .gte('checked_at', cutoff)
      .limit(100)
    if (!data) return false
    return data.some((row) => {
      const details = row.details as { campaign_id?: string; tenant_id?: string } | null
      return details?.campaign_id === campaignId && details?.tenant_id === tenantId
    })
  } catch {
    return false
  }
}

async function recordDecision(
  checkName: string,
  details: Record<string, unknown>,
  status: 'healthy' | 'warning' | 'error' = 'healthy'
): Promise<void> {
  try {
    const client = getSupabaseServiceClient()
    await client.from('system_health').insert({
      check_name: checkName,
      component: 'meta_ads',
      status,
      details,
    })
  } catch {
    // non-critical
  }
}

function countLeadsFromActions(actions: MetaAction[] | undefined): number {
  if (!actions) return 0
  const leadTypes = new Set([
    'lead',
    'onsite_web_lead',
    'on_facebook_leads',
    'offsite_conversion.fb_pixel_lead',
  ])
  return actions
    .filter((a) => leadTypes.has(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0)
}

async function runTenantOptimizer(
  tenant: Tenant,
  token: string,
  adAccountId: string,
  results: AdSetResult[]
): Promise<TenantRunSummary> {
  const summary: TenantRunSummary = {
    tenant_slug: tenant.slug,
    campaigns_evaluated: 0,
    ad_sets_evaluated: 0,
    actions: [],
  }

  let activeCampaigns: MetaCampaign[]
  try {
    const campaignsResp = await metaGet<{ data: MetaCampaign[] }>(
      `${adAccountId}/campaigns`,
      {
        fields: 'id,name,status,daily_budget,effective_status',
        effective_status: JSON.stringify(['ACTIVE']),
        limit: '50',
      },
      token
    )
    activeCampaigns = (campaignsResp.data || []).filter((c) => c.status === 'ACTIVE')
  } catch (err) {
    if (err instanceof MetaAuthError) {
      await sendSetupAlertIfDue(tenant, `Meta rejected ${tenant.name}'s token: ${err.message}`)
      summary.fatal_error = `auth: ${err.message}`
    } else {
      summary.fatal_error = err instanceof Error ? err.message : 'unknown'
      await recordDecision(
        'meta_ads_optimize_error',
        { tenant_id: tenant.id, stage: 'list_campaigns', error: summary.fatal_error },
        'error'
      )
    }
    return summary
  }

  summary.campaigns_evaluated = activeCampaigns.length
  if (!activeCampaigns.length) return summary

  for (const campaign of activeCampaigns) {
    const currentBudgetCents = parseInt(campaign.daily_budget || '0', 10)

    let adSetsResp: { data: MetaAdSet[] }
    try {
      adSetsResp = await metaGet<{ data: MetaAdSet[] }>(
        `${campaign.id}/adsets`,
        { fields: 'id,name,status', limit: '50' },
        token
      )
    } catch (err) {
      if (err instanceof MetaAuthError) {
        await sendSetupAlertIfDue(tenant, `Meta token rejected: ${err.message}`)
        summary.fatal_error = `auth: ${err.message}`
        return summary
      }
      await recordDecision(
        'meta_ads_optimize_partial',
        { tenant_id: tenant.id, campaign_id: campaign.id, stage: 'adsets', error: (err as Error).message },
        'warning'
      )
      continue
    }

    const activeAdSets = (adSetsResp.data || []).filter((a) => a.status === 'ACTIVE')
    if (!activeAdSets.length) continue

    let insightsResp: { data: MetaInsight[] }
    try {
      insightsResp = await metaGet<{ data: MetaInsight[] }>(
        `${campaign.id}/insights`,
        {
          level: 'adset',
          date_preset: 'last_7d',
          fields: 'adset_id,adset_name,impressions,spend,actions',
          limit: '50',
        },
        token
      )
    } catch (err) {
      if (err instanceof MetaAuthError) {
        await sendSetupAlertIfDue(tenant, `Meta token rejected: ${err.message}`)
        summary.fatal_error = `auth: ${err.message}`
        return summary
      }
      await recordDecision(
        'meta_ads_optimize_partial',
        { tenant_id: tenant.id, campaign_id: campaign.id, stage: 'insights', error: (err as Error).message },
        'warning'
      )
      continue
    }

    const insightMap = new Map<string, MetaInsight>()
    for (const insight of insightsResp.data || []) {
      if (insight.adset_id) insightMap.set(insight.adset_id, insight)
    }

    let bestCpl: number | null = null
    let bestLeads = 0

    for (const adSet of activeAdSets) {
      summary.ad_sets_evaluated += 1
      const insight = insightMap.get(adSet.id)

      if (!insight) {
        results.push({
          tenant_slug: tenant.slug,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          adset_id: adSet.id,
          adset_name: adSet.name,
          impressions: 0,
          spend: 0,
          leads: 0,
          cpl: null,
          decision: 'insufficient_data',
          decision_reason: 'No impressions in 7d window',
        })
        continue
      }

      const impressions = parseInt(insight.impressions || '0', 10)
      const spend = parseFloat(insight.spend || '0')
      const leads = countLeadsFromActions(insight.actions)
      const cpl = leads > 0 ? spend / leads : null

      if (cpl !== null && leads >= MIN_LEADS_TO_SCALE && (bestCpl === null || cpl < bestCpl)) {
        bestCpl = cpl
        bestLeads = leads
      }

      let decision: AdSetResult['decision'] = 'watching'
      let reason = `CPL: ${cpl !== null ? `$${cpl.toFixed(2)}` : 'no leads yet'} | ${impressions} impr | ${leads} leads`

      if (impressions >= MIN_IMPRESSIONS_TO_KILL && cpl !== null && cpl > CPL_KILL_THRESHOLD) {
        try {
          await metaPost(adSet.id, { status: 'PAUSED' }, token)
          decision = 'paused'
          reason = `PAUSED — CPL $${cpl.toFixed(2)} > $${CPL_KILL_THRESHOLD} after ${impressions} impressions`
          summary.actions.push(`⛔ Paused "${adSet.name}" in ${campaign.name} (CPL $${cpl.toFixed(2)})`)
          await recordDecision('meta_ads_paused', {
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            adset_id: adSet.id,
            adset_name: adSet.name,
            cpl,
            spend,
            leads,
            impressions,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          reason = `Tried to pause but API error: ${msg}`
          results.push({
            tenant_slug: tenant.slug,
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            adset_id: adSet.id,
            adset_name: adSet.name,
            impressions,
            spend,
            leads,
            cpl,
            decision: 'watching',
            decision_reason: reason,
            api_error: msg,
          })
          continue
        }
      } else if (cpl !== null && cpl < CPL_SCALE_THRESHOLD && leads >= MIN_LEADS_TO_SCALE) {
        decision = 'scaled_eligible'
        reason = `Winner — CPL $${cpl.toFixed(2)} < $${CPL_SCALE_THRESHOLD} with ${leads} leads`
      } else if (impressions < MIN_IMPRESSIONS_TO_KILL) {
        decision = 'insufficient_data'
        reason = `Watching — only ${impressions} impressions (need ${MIN_IMPRESSIONS_TO_KILL} to evaluate kill)`
      }

      results.push({
        tenant_slug: tenant.slug,
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        adset_id: adSet.id,
        adset_name: adSet.name,
        impressions,
        spend,
        leads,
        cpl,
        decision,
        decision_reason: reason,
      })
    }

    if (bestCpl !== null && bestCpl < CPL_SCALE_THRESHOLD && bestLeads >= MIN_LEADS_TO_SCALE) {
      const alreadyScaled = await wasCampaignScaledRecently(tenant.id, campaign.id)
      if (alreadyScaled || currentBudgetCents === 0 || currentBudgetCents >= MAX_DAILY_BUDGET_CENTS) {
        // skip
      } else {
        const newBudgetCents = Math.min(
          Math.round(currentBudgetCents * SCALE_FACTOR),
          MAX_DAILY_BUDGET_CENTS
        )
        try {
          await metaPost(campaign.id, { daily_budget: String(newBudgetCents) }, token)
          await recordDecision('meta_ads_scaled', {
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            campaign_id: campaign.id,
            campaign_name: campaign.name,
            old_daily_budget_cents: currentBudgetCents,
            new_daily_budget_cents: newBudgetCents,
            best_cpl: bestCpl,
            best_leads: bestLeads,
          })
          const oldDollars = (currentBudgetCents / 100).toFixed(0)
          const newDollars = (newBudgetCents / 100).toFixed(0)
          summary.actions.push(
            `📈 Scaled ${campaign.name}: $${oldDollars}/day → $${newDollars}/day (CPL $${bestCpl.toFixed(2)})`
          )
        } catch (err) {
          if (err instanceof MetaAuthError) {
            await sendSetupAlertIfDue(tenant, `Meta token rejected on scale: ${err.message}`)
            summary.fatal_error = `auth: ${err.message}`
            return summary
          }
          await recordDecision(
            'meta_ads_optimize_partial',
            { tenant_id: tenant.id, campaign_id: campaign.id, stage: 'scale', error: (err as Error).message },
            'warning'
          )
        }
      }
    }
  }

  if (summary.actions.length > 0 && tenant.owner_phone) {
    try {
      const msg = [
        `🤖 Meta Ads Auto-Optimize — ${tenant.name}`,
        ...summary.actions,
        '',
        `${summary.ad_sets_evaluated} ad sets across ${summary.campaigns_evaluated} campaigns (7d).`,
      ].join('\n')
      await sendSMS(tenant, tenant.owner_phone, msg, {
        source: 'meta_ads_optimize',
        bypassFilters: true,
      })
    } catch (smsErr) {
      console.error(`[MetaAdsOptimize:${tenant.slug}] SMS notify failed:`, smsErr)
    }
  }

  await recordDecision('meta_ads_optimize_run', {
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    campaigns: summary.campaigns_evaluated,
    adsets: summary.ad_sets_evaluated,
    actions_taken: summary.actions.length,
  })

  return summary
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const allTenants = await getAllActiveTenants()
  const eligibleTenants: Array<{ tenant: Tenant; token: string; adAccount: string }> = []
  const skipped: Array<{ slug: string; reason: string }> = []

  for (const tenant of allTenants) {
    const token = resolveTenantToken(tenant)
    const adAccount = resolveTenantAdAccount(tenant)
    if (!token) {
      skipped.push({ slug: tenant.slug, reason: 'no_meta_ads_access_token' })
      continue
    }
    if (!adAccount) {
      skipped.push({ slug: tenant.slug, reason: 'no_meta_ad_account_id' })
      continue
    }
    eligibleTenants.push({ tenant, token, adAccount })
  }

  if (eligibleTenants.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No tenants with Meta credentials configured',
      skipped,
    })
  }

  const results: AdSetResult[] = []
  const tenantSummaries: TenantRunSummary[] = []

  for (const { tenant, token, adAccount } of eligibleTenants) {
    try {
      const summary = await runTenantOptimizer(tenant, token, adAccount, results)
      tenantSummaries.push(summary)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      console.error(`[MetaAdsOptimize:${tenant.slug}] Unhandled error:`, msg)
      tenantSummaries.push({
        tenant_slug: tenant.slug,
        campaigns_evaluated: 0,
        ad_sets_evaluated: 0,
        actions: [],
        fatal_error: msg,
      })
      await recordDecision('meta_ads_optimize_error', { tenant_id: tenant.id, error: msg }, 'error')
    }
  }

  const totalActions = tenantSummaries.reduce((sum, t) => sum + t.actions.length, 0)
  const totalAdSets = tenantSummaries.reduce((sum, t) => sum + t.ad_sets_evaluated, 0)

  return NextResponse.json({
    success: true,
    tenants_evaluated: tenantSummaries.length,
    ad_sets_evaluated: totalAdSets,
    total_actions: totalActions,
    summaries: tenantSummaries,
    skipped,
    results,
  })
}
