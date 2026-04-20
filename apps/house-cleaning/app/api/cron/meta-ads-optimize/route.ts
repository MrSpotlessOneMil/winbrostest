/**
 * Meta Ads Auto-Optimizer (Spotless Scrubbers)
 *
 * Runs daily at 10 AM PT (17:00 UTC).
 *
 * Iterates over every ACTIVE campaign on the Spotless ad account and applies:
 *   PAUSE  — ad set CPL > $60 with 1000+ impressions over last 7 days
 *   SCALE  — campaign budget +20% if best ad set CPL < $20 with 5+ leads (7d)
 *            (only scales once per 7 days per campaign; hard cap $100/day)
 *
 * Token resolution order:
 *   1. process.env.META_ACCESS_TOKEN (preferred — Vercel env var)
 *   2. tenants.workflow_config.meta_ads_access_token (DB fallback)
 *
 * Self-healing:
 *   - Missing token / auth failure → sends Dominic ONE setup SMS per 24h, then stays quiet
 *   - Transient 5xx from Meta → retries 3x with exponential backoff
 *   - Any fatal error → logged to system_health with status='error' for the monitor to surface
 *   - Decisions logged to system_health for historical tracking and cooldown
 *
 * Endpoint: GET /api/cron/meta-ads-optimize
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantBySlug } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SPOTLESS_AD_ACCOUNT_ID = 'act_2746942098983588'
const SPOTLESS_SLUG = 'spotless-scrubbers'
const DOMINIC_PHONE = '+14242755847'
const META_API_BASE = 'https://graph.facebook.com/v21.0'

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
      if (res.ok) {
        return (await res.json()) as T
      }
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

async function resolveAccessToken(): Promise<string | null> {
  const envToken = process.env.META_ACCESS_TOKEN
  if (envToken && envToken.trim()) return envToken.trim()

  try {
    const client = getSupabaseServiceClient()
    const { data } = await client
      .from('tenants')
      .select('workflow_config')
      .eq('slug', SPOTLESS_SLUG)
      .single()
    const wc = (data?.workflow_config || {}) as Record<string, unknown>
    const dbToken = wc.meta_ads_access_token
    if (typeof dbToken === 'string' && dbToken.trim()) return dbToken.trim()
  } catch (err) {
    console.error('[MetaAdsOptimize] Could not read DB token fallback:', err)
  }
  return null
}

async function shouldSendSetupAlert(): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - SETUP_ALERT_COOLDOWN_HOURS * 3600 * 1000).toISOString()
    const { data } = await client
      .from('system_health')
      .select('id')
      .eq('check_name', 'meta_ads_optimize_setup_alert')
      .gte('checked_at', cutoff)
      .limit(1)
    return !data || data.length === 0
  } catch {
    return false
  }
}

async function sendSetupAlertIfDue(reason: string): Promise<void> {
  if (!(await shouldSendSetupAlert())) {
    console.log('[MetaAdsOptimize] Setup alert cooldown active — staying quiet')
    return
  }
  try {
    const spotless = await getTenantBySlug(SPOTLESS_SLUG)
    if (!spotless) return
    const msg = [
      '⚠️ Meta Ads Auto-Optimize paused',
      '',
      reason,
      '',
      'To unblock:',
      '1. business.facebook.com → Business Settings → System Users',
      '2. Add System User → Generate Token',
      '3. Scopes: ads_management, ads_read, business_management',
      '4. Paste into Vercel env META_ACCESS_TOKEN (osiris-house-cleaning)',
      '',
      "I'll keep quiet until this is fixed.",
    ].join('\n')
    await sendSMS(spotless, DOMINIC_PHONE, msg, {
      source: 'meta_ads_optimize',
      bypassFilters: true,
    })
    await recordDecision('meta_ads_optimize_setup_alert', { reason }, 'warning')
  } catch (err) {
    console.error('[MetaAdsOptimize] Setup alert send failed:', err)
  }
}

async function wasCampaignScaledRecently(campaignId: string): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - SCALE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data } = await client
      .from('system_health')
      .select('id, details')
      .eq('check_name', 'meta_ads_scaled')
      .gte('checked_at', cutoff)
      .limit(50)

    if (!data) return false
    return data.some((row) => {
      const details = row.details as { campaign_id?: string } | null
      return details?.campaign_id === campaignId
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

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const token = await resolveAccessToken()
  if (!token) {
    await sendSetupAlertIfDue('META_ACCESS_TOKEN not configured (env or DB).')
    return NextResponse.json(
      { success: false, error: 'META_ACCESS_TOKEN not configured', recoverable: true },
      { status: 503 }
    )
  }

  const actions: string[] = []
  const results: AdSetResult[] = []
  let activeCampaigns: MetaCampaign[] = []

  try {
    const campaignsResp = await metaGet<{ data: MetaCampaign[] }>(
      `${SPOTLESS_AD_ACCOUNT_ID}/campaigns`,
      {
        fields: 'id,name,status,daily_budget,effective_status',
        effective_status: JSON.stringify(['ACTIVE']),
        limit: '50',
      },
      token
    )

    activeCampaigns = (campaignsResp.data || []).filter((c) => c.status === 'ACTIVE')

    if (!activeCampaigns.length) {
      await recordDecision('meta_ads_optimize_run', { note: 'no active campaigns' })
      return NextResponse.json({ success: true, message: 'No active Spotless campaigns', results: [] })
    }

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
        const msg = err instanceof Error ? err.message : 'unknown'
        console.error(`[MetaAdsOptimize] Failed to fetch adsets for ${campaign.name}:`, msg)
        await recordDecision(
          'meta_ads_optimize_partial',
          { campaign_id: campaign.id, campaign_name: campaign.name, stage: 'adsets', error: msg },
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
        const msg = err instanceof Error ? err.message : 'unknown'
        console.error(`[MetaAdsOptimize] Failed to fetch insights for ${campaign.name}:`, msg)
        await recordDecision(
          'meta_ads_optimize_partial',
          { campaign_id: campaign.id, campaign_name: campaign.name, stage: 'insights', error: msg },
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
        const insight = insightMap.get(adSet.id)

        if (!insight) {
          results.push({
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
            actions.push(`⛔ Paused "${adSet.name}" in ${campaign.name} (CPL $${cpl.toFixed(2)})`)
            await recordDecision('meta_ads_paused', {
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
        const alreadyScaled = await wasCampaignScaledRecently(campaign.id)

        if (alreadyScaled) {
          // cooldown active — skip
        } else if (currentBudgetCents === 0) {
          // no daily budget set — campaign uses CBO or adset-level, skip
        } else if (currentBudgetCents >= MAX_DAILY_BUDGET_CENTS) {
          // already at cap
        } else {
          const newBudgetCents = Math.min(
            Math.round(currentBudgetCents * SCALE_FACTOR),
            MAX_DAILY_BUDGET_CENTS
          )

          try {
            await metaPost(campaign.id, { daily_budget: String(newBudgetCents) }, token)
            await recordDecision('meta_ads_scaled', {
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              old_daily_budget_cents: currentBudgetCents,
              new_daily_budget_cents: newBudgetCents,
              best_cpl: bestCpl,
              best_leads: bestLeads,
            })
            const oldDollars = (currentBudgetCents / 100).toFixed(0)
            const newDollars = (newBudgetCents / 100).toFixed(0)
            actions.push(
              `📈 Scaled ${campaign.name}: $${oldDollars}/day → $${newDollars}/day (CPL $${bestCpl.toFixed(2)})`
            )
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown'
            console.error(`[MetaAdsOptimize] Failed to scale ${campaign.name}:`, msg)
            await recordDecision(
              'meta_ads_optimize_partial',
              { campaign_id: campaign.id, stage: 'scale', error: msg },
              'warning'
            )
          }
        }
      }
    }

    if (actions.length > 0) {
      try {
        const spotless = await getTenantBySlug(SPOTLESS_SLUG)
        if (spotless) {
          const summary = [
            '🤖 Meta Ads Auto-Optimize',
            ...actions,
            '',
            `${results.length} ad sets evaluated across ${activeCampaigns.length} campaigns (7d).`,
          ].join('\n')

          await sendSMS(spotless, DOMINIC_PHONE, summary, {
            source: 'meta_ads_optimize',
            bypassFilters: true,
          })
        }
      } catch (smsErr) {
        console.error('[MetaAdsOptimize] SMS notify failed:', smsErr)
      }
    }

    await recordDecision('meta_ads_optimize_run', {
      campaigns: activeCampaigns.length,
      adsets: results.length,
      actions_taken: actions.length,
    })

    return NextResponse.json({
      success: true,
      actions,
      campaigns_evaluated: activeCampaigns.length,
      ad_sets_evaluated: results.length,
      results,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[MetaAdsOptimize] Fatal error:', message)

    if (err instanceof MetaAuthError) {
      await sendSetupAlertIfDue(`Meta rejected the current token: ${message}`)
      return NextResponse.json(
        { success: false, error: 'Meta auth failed', detail: message, recoverable: true },
        { status: 401 }
      )
    }

    await recordDecision('meta_ads_optimize_error', { error: message }, 'error')
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
