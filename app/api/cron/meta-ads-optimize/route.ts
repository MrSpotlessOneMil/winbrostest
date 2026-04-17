/**
 * Meta Ads Auto-Management Cron
 *
 * Runs daily at 10 AM PT (17:00 UTC). Spotless Scrubbers only.
 *
 * Rules (last 7-day window):
 *   PAUSE  — ad set CPL > $50 with 500+ impressions
 *   SCALE  — campaign budget +20% if best ad set CPL < $25 with 3+ leads
 *            (only scales once per 7 days; hard cap $100/day)
 *
 * On any action, SMS Dominic via Spotless tenant owner_phone.
 *
 * Requires: META_ACCESS_TOKEN env var (System User token — does NOT expire).
 * Get one at: Meta Business Suite → Settings → System Users → Generate Token
 *
 * Endpoint: GET /api/cron/meta-ads-optimize
 * route-check:no-vercel-cron
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Spotless Scrubbers campaign constants ─────────────────────────────────────
const SPOTLESS_CAMPAIGN_ID = '120245014254890706'
const META_API_BASE = 'https://graph.facebook.com/v21.0'

// ── Optimization thresholds ───────────────────────────────────────────────────
const CPL_KILL = 50            // pause ad sets with CPL > $50
const CPL_SCALE = 25           // scale campaign if best CPL < $25
const MIN_IMPRESSIONS_TO_KILL = 500  // need real data before killing
const MIN_LEADS_TO_SCALE = 3         // need 3+ leads to confirm it's working
const SCALE_FACTOR = 1.2             // 20% budget increase per scale event
const MAX_DAILY_BUDGET_CENTS = 10_000 // $100/day hard cap
const SCALE_COOLDOWN_DAYS = 7        // only scale once per 7 days

// ── Types ─────────────────────────────────────────────────────────────────────

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
  adset_id: string
  adset_name: string
  impressions: string
  spend: string
  actions?: MetaAction[]
}

interface AdSetResult {
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

// ── Meta Graph API helpers ────────────────────────────────────────────────────

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
    clearTimeout(timer)
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meta ${res.status}: ${body.slice(0, 300)}`)
    }
    return (await res.json()) as T
  } catch (err) {
    clearTimeout(timer)
    throw err
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
    clearTimeout(timer)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Meta ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as { success: boolean }
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// ── Cooldown check ────────────────────────────────────────────────────────────

async function wasScaledRecently(): Promise<boolean> {
  try {
    const client = getSupabaseServiceClient()
    const cutoff = new Date(Date.now() - SCALE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const { data } = await client
      .from('system_health')
      .select('id')
      .eq('check_name', 'meta_ads_scaled')
      .gte('checked_at', cutoff)
      .limit(1)
      .maybeSingle()

    return !!data
  } catch {
    return false // fail open — allow scale if we can't check
  }
}

async function recordScaleEvent(campaignId: string, oldBudgetCents: number, newBudgetCents: number): Promise<void> {
  try {
    const client = getSupabaseServiceClient()
    await client.from('system_health').insert({
      check_name: 'meta_ads_scaled',
      component: 'meta_ads',
      status: 'healthy',
      details: {
        campaign_id: campaignId,
        old_daily_budget_cents: oldBudgetCents,
        new_daily_budget_cents: newBudgetCents,
      },
    })
  } catch {
    // non-critical
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const token = process.env.META_ACCESS_TOKEN
  if (!token) {
    console.warn('[MetaAdsOptimize] META_ACCESS_TOKEN not set — skipping. Set a System User token in Vercel env vars.')
    return NextResponse.json({ success: false, error: 'META_ACCESS_TOKEN not configured' }, { status: 503 })
  }

  const actions: string[] = []
  const adSetResults: AdSetResult[] = []
  let campaignScaled = false

  try {
    // ── 1. Get campaign current budget ────────────────────────────────────────
    const campaign = await metaGet<{ id: string; name: string; daily_budget: string; status: string }>(
      SPOTLESS_CAMPAIGN_ID,
      { fields: 'id,name,daily_budget,status' },
      token
    )

    const currentBudgetCents = parseInt(campaign.daily_budget || '2500', 10)
    console.log(`[MetaAdsOptimize] Campaign: ${campaign.name} | status: ${campaign.status} | budget: $${(currentBudgetCents / 100).toFixed(2)}/day`)

    if (campaign.status !== 'ACTIVE') {
      return NextResponse.json({ success: true, message: `Campaign is ${campaign.status} — no action needed`, results: [] })
    }

    // ── 2. Get all active ad sets ─────────────────────────────────────────────
    const adSetsResp = await metaGet<{ data: MetaAdSet[] }>(
      `${SPOTLESS_CAMPAIGN_ID}/adsets`,
      { fields: 'id,name,status', limit: '50' },
      token
    )
    const activeAdSets = (adSetsResp.data || []).filter(a => a.status === 'ACTIVE')

    if (!activeAdSets.length) {
      return NextResponse.json({ success: true, message: 'No active ad sets found', results: [] })
    }

    // ── 3. Get 7-day insights per ad set ──────────────────────────────────────
    const insightsResp = await metaGet<{ data: MetaInsight[] }>(
      `${SPOTLESS_CAMPAIGN_ID}/insights`,
      {
        level: 'adset',
        date_preset: 'last_7d',
        fields: 'adset_id,adset_name,impressions,spend,actions',
        limit: '50',
      },
      token
    )

    // Index insights by adset_id for fast lookup
    const insightMap = new Map<string, MetaInsight>()
    for (const insight of insightsResp.data || []) {
      insightMap.set(insight.adset_id, insight)
    }

    // ── 4. Evaluate each ad set ───────────────────────────────────────────────
    let bestCpl: number | null = null
    let bestLeads = 0

    for (const adSet of activeAdSets) {
      const insight = insightMap.get(adSet.id)

      if (!insight) {
        adSetResults.push({
          adset_id: adSet.id,
          adset_name: adSet.name,
          impressions: 0,
          spend: 0,
          leads: 0,
          cpl: null,
          decision: 'insufficient_data',
          decision_reason: 'No impressions yet',
        })
        continue
      }

      const impressions = parseInt(insight.impressions || '0', 10)
      const spend = parseFloat(insight.spend || '0')

      // Count leads from actions (on_facebook_leads or lead)
      const leadActions = (insight.actions || []).filter(
        a => a.action_type === 'lead' || a.action_type === 'onsite_web_lead' || a.action_type === 'on_facebook_leads'
      )
      const leads = leadActions.reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0)
      const cpl = leads > 0 ? spend / leads : null

      // Track best performer for scaling decision
      if (cpl !== null && leads >= MIN_LEADS_TO_SCALE) {
        if (bestCpl === null || cpl < bestCpl) {
          bestCpl = cpl
          bestLeads = leads
        }
      }

      let decision: AdSetResult['decision'] = 'watching'
      let reason = `CPL: ${cpl !== null ? `$${cpl.toFixed(2)}` : 'no leads yet'} | ${impressions} impressions | ${leads} leads`

      // Kill rule: CPL > threshold with enough data
      if (impressions >= MIN_IMPRESSIONS_TO_KILL && cpl !== null && cpl > CPL_KILL) {
        try {
          await metaPost(adSet.id, { status: 'PAUSED' }, token)
          decision = 'paused'
          reason = `PAUSED — CPL $${cpl.toFixed(2)} > $${CPL_KILL} threshold after ${impressions} impressions`
          actions.push(`⛔ Paused "${adSet.name}" (CPL $${cpl.toFixed(2)})`)
          console.log(`[MetaAdsOptimize] Paused ad set "${adSet.name}" — CPL $${cpl.toFixed(2)}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          reason = `Tried to pause but API error: ${msg}`
          adSetResults.push({
            adset_id: adSet.id, adset_name: adSet.name, impressions, spend, leads, cpl,
            decision: 'watching', decision_reason: reason, api_error: msg,
          })
          continue
        }
      } else if (cpl !== null && cpl < CPL_SCALE && leads >= MIN_LEADS_TO_SCALE) {
        decision = 'scaled_eligible'
        reason = `Winner — CPL $${cpl.toFixed(2)} < $${CPL_SCALE} threshold with ${leads} leads`
      } else if (impressions < MIN_IMPRESSIONS_TO_KILL) {
        decision = 'insufficient_data'
        reason = `Watching — only ${impressions} impressions (need ${MIN_IMPRESSIONS_TO_KILL} to evaluate kill)`
      }

      adSetResults.push({ adset_id: adSet.id, adset_name: adSet.name, impressions, spend, leads, cpl, decision, decision_reason: reason })
    }

    // ── 5. Scale campaign budget if we have a winner ──────────────────────────
    if (bestCpl !== null && bestCpl < CPL_SCALE && bestLeads >= MIN_LEADS_TO_SCALE) {
      const alreadyScaled = await wasScaledRecently()

      if (alreadyScaled) {
        console.log(`[MetaAdsOptimize] Winner found (CPL $${bestCpl.toFixed(2)}) but scale cooldown active — skipping`)
      } else if (currentBudgetCents >= MAX_DAILY_BUDGET_CENTS) {
        console.log(`[MetaAdsOptimize] Winner found but already at $${MAX_DAILY_BUDGET_CENTS / 100}/day cap — skipping scale`)
      } else {
        const newBudgetCents = Math.min(
          Math.round(currentBudgetCents * SCALE_FACTOR),
          MAX_DAILY_BUDGET_CENTS
        )

        try {
          await metaPost(SPOTLESS_CAMPAIGN_ID, { daily_budget: String(newBudgetCents) }, token)
          await recordScaleEvent(SPOTLESS_CAMPAIGN_ID, currentBudgetCents, newBudgetCents)
          campaignScaled = true
          const oldDollars = (currentBudgetCents / 100).toFixed(0)
          const newDollars = (newBudgetCents / 100).toFixed(0)
          actions.push(`📈 Scaled campaign budget $${oldDollars}/day → $${newDollars}/day (best CPL $${bestCpl.toFixed(2)})`)
          console.log(`[MetaAdsOptimize] Scaled campaign budget: $${oldDollars} → $${newDollars}/day`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown'
          console.error('[MetaAdsOptimize] Failed to scale campaign budget:', msg)
        }
      }
    }

    // ── 6. Notify Dominic if anything happened ────────────────────────────────
    if (actions.length > 0) {
      try {
        const tenants = await getAllActiveTenants()
        const spotless = tenants.find(t => t.slug === 'spotless-scrubbers')

        if (spotless?.owner_phone) {
          const summary = [
            '🤖 Meta Ads Auto-Optimize',
            ...actions,
            `\n7-day window. ${adSetResults.length} ad sets evaluated.`,
          ].join('\n')

          await sendSMS(spotless, spotless.owner_phone, summary, {
            skipThrottle: true,
            bypassFilters: true,
          })
        }
      } catch (smsErr) {
        console.error('[MetaAdsOptimize] Failed to send owner SMS:', smsErr)
      }
    }

    return NextResponse.json({
      success: true,
      actions,
      campaign_scaled: campaignScaled,
      ad_sets_evaluated: adSetResults.length,
      results: adSetResults,
    })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[MetaAdsOptimize] Fatal error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
