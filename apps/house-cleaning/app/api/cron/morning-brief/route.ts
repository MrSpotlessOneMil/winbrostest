/**
 * Spotless Morning Brief
 *
 * Runs daily at 9 AM PT (16:00 UTC during PDT).
 * Texts Dominic ONE clean SMS:
 *   - Yesterday's Meta ad spend (account total)
 *   - Yesterday's leads with per-lead ad attribution
 *
 * Replaces meta-ads-monitor (which sent overlapping daily reports).
 * Fires for Spotless tenant only — Cedar/WinBros do not run Meta ads.
 *
 * Endpoint: GET /api/cron/morning-brief
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantBySlug, type Tenant } from '@/lib/tenant'
import { sendSMS } from '@/lib/openphone'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const META_API_BASE = 'https://graph.facebook.com/v21.0'
const SPOTLESS_SLUG = 'spotless-scrubbers'
const DOMINIC_PHONE = '+14242755847'

interface MetaAdInsight {
  ad_id?: string
  ad_name?: string
  spend?: string
  effective_status?: string
}

interface InsightsResponse {
  data?: MetaAdInsight[]
}

function getYesterdayInPT(): string {
  // Returns YYYY-MM-DD for yesterday in America/Los_Angeles.
  const now = new Date()
  const ptTodayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const [y, m, d] = ptTodayStr.split('-').map(Number)
  const ptToday = new Date(Date.UTC(y, m - 1, d))
  ptToday.setUTCDate(ptToday.getUTCDate() - 1)
  return ptToday.toISOString().slice(0, 10)
}

function getPTDayBoundsUTC(ptDate: string): { startUtc: string; endUtc: string } {
  // Convert "YYYY-MM-DD" in PT to start/end UTC ISO timestamps.
  // Uses the offset Intl reports for that exact date so it handles DST correctly.
  const [y, m, d] = ptDate.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const tzPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')
  const offsetMatch = tzPart?.value.match(/GMT([+-]\d+)/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -7
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetHours * 3600_000
  const endUtcMs = startUtcMs + 24 * 3600_000
  return {
    startUtc: new Date(startUtcMs).toISOString(),
    endUtc: new Date(endUtcMs).toISOString(),
  }
}

function resolveSpotlessToken(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as unknown as Record<string, unknown>
  const dbToken = wc.meta_ads_access_token
  if (typeof dbToken === 'string' && dbToken.trim()) return dbToken.trim()
  const envToken = process.env.META_ACCESS_TOKEN
  return envToken && envToken.trim() ? envToken.trim() : null
}

function resolveSpotlessAdAccount(tenant: Tenant): string | null {
  const wc = (tenant.workflow_config || {}) as unknown as Record<string, unknown>
  const v = wc.meta_ad_account_id
  if (typeof v !== 'string' || !v.trim()) return null
  const trimmed = v.trim()
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

async function fetchYesterdayInsights(
  accountId: string,
  token: string,
  ptDate: string
): Promise<{ totalSpend: number; adNameById: Map<string, string> }> {
  const url = new URL(`${META_API_BASE}/${accountId}/insights`)
  url.searchParams.set('access_token', token)
  url.searchParams.set('level', 'ad')
  url.searchParams.set('fields', 'ad_id,ad_name,spend')
  url.searchParams.set('time_range', JSON.stringify({ since: ptDate, until: ptDate }))
  url.searchParams.set('limit', '200')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Meta insights ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = (await res.json()) as InsightsResponse
    const adNameById = new Map<string, string>()
    let totalSpend = 0
    for (const row of json.data ?? []) {
      if (row.ad_id && row.ad_name) adNameById.set(row.ad_id, row.ad_name)
      const s = parseFloat(row.spend || '0')
      if (!Number.isNaN(s)) totalSpend += s
    }
    return { totalSpend, adNameById }
  } finally {
    clearTimeout(timer)
  }
}

interface LeadRow {
  id: string
  first_name: string | null
  last_name: string | null
  source: string | null
  form_data: Record<string, unknown> | null
}

function attributeAd(lead: LeadRow, adNameById: Map<string, string>): string {
  const fd = lead.form_data || {}
  const metaAdId = typeof fd.meta_ad_id === 'string' ? fd.meta_ad_id : null
  if (metaAdId && adNameById.has(metaAdId)) return adNameById.get(metaAdId)!
  const utmContent = typeof fd.utm_content === 'string' ? fd.utm_content : null
  if (utmContent) return utmContent
  const utmCampaign = typeof fd.utm_campaign === 'string' ? fd.utm_campaign : null
  if (utmCampaign) return utmCampaign
  return 'Direct/Other'
}

function displayName(lead: LeadRow): string {
  const first = (lead.first_name || '').trim()
  const last = (lead.last_name || '').trim()
  if (first && last) return `${first} ${last.charAt(0)}.`
  if (first) return first
  if (last) return last
  return 'Unknown'
}

function leadCity(lead: LeadRow): string | null {
  const fd = lead.form_data || {}
  const city = typeof fd.city === 'string' ? fd.city.trim() : ''
  return city || null
}

function formatBriefDate(ptDate: string): string {
  const [y, m, d] = ptDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dt)
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const tenant = await getTenantBySlug(SPOTLESS_SLUG)
  if (!tenant) {
    return NextResponse.json({ error: 'Spotless tenant not found' }, { status: 404 })
  }

  const ptDate = getYesterdayInPT()
  const { startUtc, endUtc } = getPTDayBoundsUTC(ptDate)

  const client = getSupabaseServiceClient()
  const { data: leadsRaw, error: leadsErr } = await client
    .from('leads')
    .select('id, first_name, last_name, source, form_data')
    .eq('tenant_id', tenant.id)
    .in('source', ['website', 'meta'])
    .gte('created_at', startUtc)
    .lt('created_at', endUtc)
    .order('created_at', { ascending: true })

  if (leadsErr) {
    console.error('[morning-brief] lead query failed:', leadsErr)
    return NextResponse.json({ error: 'Lead query failed' }, { status: 500 })
  }

  const leads = (leadsRaw || []) as LeadRow[]

  let totalSpend = 0
  let adNameById = new Map<string, string>()
  let metaError: string | null = null

  const token = resolveSpotlessToken(tenant)
  const accountId = resolveSpotlessAdAccount(tenant)
  if (token && accountId) {
    try {
      const result = await fetchYesterdayInsights(accountId, token, ptDate)
      totalSpend = result.totalSpend
      adNameById = result.adNameById
    } catch (err) {
      metaError = err instanceof Error ? err.message : 'Meta insights failed'
      console.error('[morning-brief] meta insights failed:', metaError)
    }
  } else {
    metaError = 'Missing Meta token or ad account ID'
  }

  const dateLabel = formatBriefDate(ptDate)
  const spendLabel = metaError ? '(spend unavailable)' : `$${totalSpend.toFixed(2)} spent`
  let sms = `Spotless — ${dateLabel}\n${spendLabel} → ${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`

  if (leads.length > 0) {
    sms += '\n'
    for (const lead of leads) {
      const ad = attributeAd(lead, adNameById)
      const city = leadCity(lead)
      const cityPart = city ? ` (${city})` : ''
      sms += `\n• ${displayName(lead)}${cityPart} — ${ad}`
    }
  }

  const smsResult = await sendSMS(tenant, DOMINIC_PHONE, sms, {
    source: 'morning_brief',
    bypassFilters: true,
  })

  return NextResponse.json({
    status: 'ok',
    date: ptDate,
    leads_count: leads.length,
    total_spend: totalSpend,
    meta_error: metaError,
    sms_sent: smsResult.success,
  })
}
