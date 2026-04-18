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
 * Decisions logged to system_health for historical tracking and cooldown.
 * Dominic gets an SMS summary ONLY when actions are taken.
 *
 * Requires env var: META_ACCESS_TOKEN (System User token — does not expire)
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

async function metaGet<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${META_API_BASE}/${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meta ${res.status}: ${body.slice(0, 300)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

async function metaPost(path: string, fields: Record<string, string>, token: string): Promise<{ success: boolean }> {
  const url = `${META_API_BASE}/${path}`
  const body = new URLSearchParams({ access_token: token, ...fields })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meta ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as { success: boolean }
  } finally {
    clearTimeout(timer)
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

async function recordDecision(checkName: string, details: Record<string, unknown>): Promise<void> {
  try {
    const client = getSupabaseServiceClient()
    await client.from('system_health').insert({
      check_name: checkName,
      component: 'meta_ads',
      status: 'healthy',
      details,
    })
  } catch {
    // non-critical
  }
}

function countLeadsFromActions(actions: MetaAction[] | undefined): number {
  if (!actions) return 0
  const leadTypes = new Set(['lead', 'onsite_web_lead', 'on_facebook_leads', 'offsite_conversion.fb_pixel_lead'])
  return actions
    .filter((a) => leadTypes.has(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0)
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    console.warn('[MetaAdsOptimize] META_ACCESS_TOKEN not set — skipping run.')
    return NextResponse.json({ success: false, error: 'META_ACCESS_TOKEN not configured' }, { status: 503 })
  }

  const actions: string[] = []
  const results: AdSetResult[] = []

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

    const activeCampaigns = (campaignsResp.data || []).filter((c) => c.status === 'ACTIVE')

    if (!activeCampaigns.length) {
      return NextResponse.json({ success: true, message: 'No active Spotless campaigns', results: [] })
    }

    for (const campaign of activeCampaigns) {
      const currentBudgetCents = parseInt(campaign.daily_budget || '0', 10)

      const adSetsResp = await metaGet<{ data: MetaAdSet[] }>(
        `${campaign.id}/adsets`,
        { fields: 'id,name,status', limit: '50' },
        token
      )
      const activeAdSets = (adSetsResp.data || []).filter((a) => a.status === 'ACTIVE')

      if (!activeAdSets.length) continue

      const insightsResp = await metaGet<{ data: MetaInsight[] }>(
        `${campaign.id}/insights`,
        {
          level: 'adset',
          date_preset: 'last_7d',
          fields: 'adset_id,adset_name,impressions,spend,actions',
          limit: '50',
        },
        token
      )

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
            console.log(`[MetaAdsOptimize] Paused "${adSet.name}" — CPL $${cpl.toFixed(2)}`)
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
          console.log(`[MetaAdsOptimize] ${campaign.name}: winner but scale cooldown active`)
        } else if (currentBudgetCents === 0) {
          console.log(`[MetaAdsOptimize] ${campaign.name}: no daily budget set — skipping scale`)
        } else if (currentBudgetCents >= MAX_DAILY_BUDGET_CENTS) {
          console.log(`[MetaAdsOptimize] ${campaign.name}: already at $${MAX_DAILY_BUDGET_CENTS / 100}/day cap`)
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
            actions.push(`📈 Scaled ${campaign.name}: $${oldDollars}/day → $${newDollars}/day (CPL $${bestCpl.toFixed(2)})`)
            console.log(`[MetaAdsOptimize] Scaled ${campaign.name}: $${oldDollars} → $${newDollars}/day`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown'
            console.error(`[MetaAdsOptimize] Failed to scale ${campaign.name}:`, msg)
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
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
