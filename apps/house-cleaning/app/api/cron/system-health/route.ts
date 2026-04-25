/**
 * System Health Cron
 *
 * Runs every 6 hours. Checks the health of:
 * - SAM scrapers (scrape_runs, prospects)
 * - SAM outreach (outreach_log)
 * - SAM enrichment (phone/email coverage)
 * - Osiris auto-responder (AI messages per tenant)
 * - Osiris conversation scoring
 * - Osiris brain (chunks + embedding ratio)
 * - Osiris pricing tiers (house cleaning tenants)
 * - Osiris jobs (new jobs per tenant)
 *
 * Endpoint: GET /api/cron/system-health
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getAllActiveTenants } from '@/lib/tenant'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SAM's Supabase config (separate project)
const SAM_SUPABASE_URL = 'https://huswpybjqepwpnwhotkf.supabase.co'
const SAM_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1c3dweWJqcWVwd3Bud2hvdGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MzQyMDAsImV4cCI6MjA4OTQxMDIwMH0.pvGvtTipvM04yzQphiwDNIhJMOpwQbSPhv_NsO5v_Rk'

type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown'

interface HealthCheck {
  check_name: string
  component: string
  status: HealthStatus
  details: Record<string, unknown>
}

// ── SAM Supabase REST helper ──────────────────────────────────────────
async function samQuery(
  table: string,
  params: Record<string, string>
): Promise<{ data: unknown[]; count: number | null; error: string | null }> {
  const url = new URL(`${SAM_SUPABASE_URL}/rest/v1/${table}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const headers: Record<string, string> = {
      apikey: SAM_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    }

    // If caller wants a count, request it via Prefer header
    if (params['select'] === 'count') {
      headers['Prefer'] = 'count=exact'
      // For count-only queries, use head: true pattern
      const countUrl = new URL(`${SAM_SUPABASE_URL}/rest/v1/${table}`)
      for (const [key, value] of Object.entries(params)) {
        if (key !== 'select') countUrl.searchParams.set(key, value)
      }
      countUrl.searchParams.set('select', '*')
      const res = await fetch(countUrl.toString(), {
        headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
        signal: controller.signal,
      })
      const contentRange = res.headers.get('content-range')
      const total = contentRange ? parseInt(contentRange.split('/')[1]) || 0 : 0
      return { data: [], count: total, error: null }
    }

    const res = await fetch(url.toString(), { headers, signal: controller.signal })
    if (!res.ok) {
      return { data: [], count: null, error: `HTTP ${res.status}` }
    }
    const data = await res.json()
    return { data: Array.isArray(data) ? data : [], count: null, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return { data: [], count: null, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

// ── Individual health checks ──────────────────────────────────────────

async function checkSamScrapers(): Promise<HealthCheck> {
  try {
    // Get last 5 runs per source to detect stale scrapers
    const { data: runs, error } = await samQuery('scrape_runs', {
      select: 'id,source,prospects_new,status,completed_at',
      order: 'completed_at.desc',
      limit: '50',
    })

    if (error) {
      return {
        check_name: 'SAM scraper activity',
        component: 'sam_scraper',
        status: 'unknown',
        details: { error },
      }
    }

    const typedRuns = runs as Array<{
      source: string
      prospects_new: number
      status: string
      completed_at: string
    }>

    // Group by source, check last 5 runs each
    const bySource: Record<string, typeof typedRuns> = {}
    for (const run of typedRuns) {
      if (!run.source) continue
      if (!bySource[run.source]) bySource[run.source] = []
      if (bySource[run.source].length < 5) bySource[run.source].push(run)
    }

    const stale: string[] = []
    const summary: Record<string, { runs: number; totalNew: number }> = {}

    for (const [source, sourceRuns] of Object.entries(bySource)) {
      const totalNew = sourceRuns.reduce((sum, r) => sum + (r.prospects_new || 0), 0)
      summary[source] = { runs: sourceRuns.length, totalNew }

      // If 5 consecutive runs all produced 0 new prospects, flag as stale
      if (sourceRuns.length >= 5 && totalNew === 0) {
        stale.push(source)
      }
    }

    let status: HealthStatus = 'healthy'
    if (stale.length > 0) status = 'critical'
    else if (Object.keys(bySource).length === 0) status = 'warning'

    return {
      check_name: 'SAM scraper activity',
      component: 'sam_scraper',
      status,
      details: {
        stale_scrapers: stale,
        sources: summary,
        message:
          stale.length > 0
            ? `${stale.join(', ')} had 0 new prospects in last 5 runs`
            : `${Object.keys(bySource).length} scrapers active`,
      },
    }
  } catch (err) {
    return {
      check_name: 'SAM scraper activity',
      component: 'sam_scraper',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkSamProspects(): Promise<HealthCheck> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await samQuery('prospects', {
      select: 'id',
      'created_at': `gte.${since}`,
      limit: '1',
    })

    if (error) {
      return {
        check_name: 'New prospects (24h)',
        component: 'sam_scraper',
        status: 'unknown',
        details: { error },
      }
    }

    // Also get a count via count query
    const countUrl = new URL(`${SAM_SUPABASE_URL}/rest/v1/prospects`)
    countUrl.searchParams.set('select', '*')
    countUrl.searchParams.set('created_at', `gte.${since}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    let count = 0
    try {
      const res = await fetch(countUrl.toString(), {
        headers: {
          apikey: SAM_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
          Prefer: 'count=exact',
          Range: '0-0',
        },
        signal: controller.signal,
      })
      const contentRange = res.headers.get('content-range')
      count = contentRange ? parseInt(contentRange.split('/')[1]) || 0 : data.length
    } finally {
      clearTimeout(timeout)
    }

    let status: HealthStatus = 'healthy'
    if (count === 0) status = 'critical'
    else if (count < 5) status = 'warning'

    return {
      check_name: 'New prospects (24h)',
      component: 'sam_scraper',
      status,
      details: { count, message: `${count} new prospects in last 24h` },
    }
  } catch (err) {
    return {
      check_name: 'New prospects (24h)',
      component: 'sam_scraper',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkSamOutreach(): Promise<HealthCheck> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const countUrl = new URL(`${SAM_SUPABASE_URL}/rest/v1/outreach_log`)
    countUrl.searchParams.set('select', '*')
    countUrl.searchParams.set('created_at', `gte.${since}`)
    countUrl.searchParams.set('status', 'eq.sent')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    let count = 0
    try {
      const res = await fetch(countUrl.toString(), {
        headers: {
          apikey: SAM_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
          Prefer: 'count=exact',
          Range: '0-0',
        },
        signal: controller.signal,
      })
      const contentRange = res.headers.get('content-range')
      count = contentRange ? parseInt(contentRange.split('/')[1]) || 0 : 0
    } finally {
      clearTimeout(timeout)
    }

    // Only flag during business hours (8am-8pm PT)
    const now = new Date()
    const ptHour = parseInt(
      now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false })
    )
    const isBusinessHours = ptHour >= 8 && ptHour < 20

    let status: HealthStatus = 'healthy'
    if (count === 0 && isBusinessHours) status = 'warning'
    else if (count === 0 && !isBusinessHours) status = 'healthy' // Expected to be quiet at night

    return {
      check_name: 'SAM outreach sends (24h)',
      component: 'sam_outreach',
      status,
      details: {
        sends_24h: count,
        is_business_hours: isBusinessHours,
        message: `${count} sends today${!isBusinessHours ? ' (after hours)' : ''}`,
      },
    }
  } catch (err) {
    return {
      check_name: 'SAM outreach sends (24h)',
      component: 'sam_outreach',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkSamEnrichment(): Promise<HealthCheck> {
  try {
    // Count prospects with phone vs total
    const [withPhone, withEmail, total] = await Promise.all([
      (async () => {
        const url = new URL(`${SAM_SUPABASE_URL}/rest/v1/prospects`)
        url.searchParams.set('select', '*')
        url.searchParams.set('phone', 'not.is.null')
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 10000)
        try {
          const res = await fetch(url.toString(), {
            headers: {
              apikey: SAM_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
              Prefer: 'count=exact',
              Range: '0-0',
            },
            signal: controller.signal,
          })
          const cr = res.headers.get('content-range')
          return cr ? parseInt(cr.split('/')[1]) || 0 : 0
        } finally {
          clearTimeout(t)
        }
      })(),
      (async () => {
        const url = new URL(`${SAM_SUPABASE_URL}/rest/v1/prospects`)
        url.searchParams.set('select', '*')
        url.searchParams.set('email', 'not.is.null')
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 10000)
        try {
          const res = await fetch(url.toString(), {
            headers: {
              apikey: SAM_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
              Prefer: 'count=exact',
              Range: '0-0',
            },
            signal: controller.signal,
          })
          const cr = res.headers.get('content-range')
          return cr ? parseInt(cr.split('/')[1]) || 0 : 0
        } finally {
          clearTimeout(t)
        }
      })(),
      (async () => {
        const url = new URL(`${SAM_SUPABASE_URL}/rest/v1/prospects`)
        url.searchParams.set('select', '*')
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 10000)
        try {
          const res = await fetch(url.toString(), {
            headers: {
              apikey: SAM_SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SAM_SUPABASE_ANON_KEY}`,
              Prefer: 'count=exact',
              Range: '0-0',
            },
            signal: controller.signal,
          })
          const cr = res.headers.get('content-range')
          return cr ? parseInt(cr.split('/')[1]) || 0 : 0
        } finally {
          clearTimeout(t)
        }
      })(),
    ])

    const phoneRate = total > 0 ? Math.round((withPhone / total) * 100) : 0
    const emailRate = total > 0 ? Math.round((withEmail / total) * 100) : 0

    let status: HealthStatus = 'healthy'
    if (phoneRate < 10 && total > 50) status = 'warning'

    return {
      check_name: 'SAM prospect enrichment',
      component: 'sam_enrichment',
      status,
      details: {
        total_prospects: total,
        with_phone: withPhone,
        with_email: withEmail,
        phone_rate_pct: phoneRate,
        email_rate_pct: emailRate,
        message: `${withPhone} phones (${phoneRate}%), ${withEmail} emails (${emailRate}%) of ${total} total`,
      },
    }
  } catch (err) {
    return {
      check_name: 'SAM prospect enrichment',
      component: 'sam_enrichment',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkOsirisResponder(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const results: Record<string, number> = {}
    const silent: string[] = []

    for (const tenant of tenants) {
      const { count } = await client
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('direction', 'outbound')
        .eq('ai_generated', true)
        .gte('created_at', since)

      const msgCount = count ?? 0
      results[tenant.slug] = msgCount
      if (msgCount === 0) silent.push(tenant.slug)
    }

    let status: HealthStatus = 'healthy'
    if (silent.length > 0) status = 'warning'
    if (silent.length === tenants.length) status = 'critical'

    const totalMessages = Object.values(results).reduce((a, b) => a + b, 0)

    return {
      check_name: 'Osiris AI auto-responder (24h)',
      component: 'osiris_responder',
      status,
      details: {
        per_tenant: results,
        silent_tenants: silent,
        total_ai_messages: totalMessages,
        message:
          silent.length > 0
            ? `${totalMessages} AI messages — ${silent.join(', ')} had 0`
            : `${totalMessages} AI messages across ${tenants.length} tenants`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Osiris AI auto-responder (24h)',
      component: 'osiris_responder',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkOsirisScoring(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

    const { count } = await client
      .from('conversation_outcomes')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since)

    const scoreCount = count ?? 0

    let status: HealthStatus = 'healthy'
    if (scoreCount === 0) status = 'warning'

    return {
      check_name: 'Conversation scoring (48h)',
      component: 'osiris_scoring',
      status,
      details: {
        scores_48h: scoreCount,
        message: `${scoreCount} new scores in last 48h`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Conversation scoring (48h)',
      component: 'osiris_scoring',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkOsirisBrain(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()

    const [totalResult, embeddedResult] = await Promise.all([
      client.from('brain_chunks').select('id', { count: 'exact', head: true }),
      client.from('brain_chunks').select('id', { count: 'exact', head: true }).not('embedded_at', 'is', null),
    ])

    const total = totalResult.count ?? 0
    const embedded = embeddedResult.count ?? 0
    const ratio = total > 0 ? Math.round((embedded / total) * 100) : 100

    let status: HealthStatus = 'healthy'
    if (ratio < 80) status = 'warning'
    if (ratio < 50) status = 'critical'
    if (total === 0) status = 'warning'

    return {
      check_name: 'Osiris Brain health',
      component: 'osiris_brain',
      status,
      details: {
        total_chunks: total,
        embedded_chunks: embedded,
        embedding_ratio_pct: ratio,
        message: `${total} chunks, ${ratio}% embedded`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Osiris Brain health',
      component: 'osiris_brain',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkOsirisPricing(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()

    // Pricing-tier check applies ONLY to house-cleaning tenants. Window
    // cleaning businesses (WinBros, Crystal Clear) store their pricebook in
    // tenants.workflow_config.window_tiers JSONB — see pricebook-db.ts —
    // so the pricing_tiers table is intentionally empty for them.
    //
    // Discriminator (most reliable first):
    //   1. workflow_config.use_hcp_mirror === true  → WinBros HCP-mirror flow
    //   2. workflow_config.use_team_routing === true → window-style ops
    //   3. tenant name or service_description contains "window"
    const isWindowTenant = (t: any): boolean => {
      const wc = (t.workflow_config || {}) as Record<string, unknown>
      if (wc.use_hcp_mirror === true) return true
      if (wc.use_team_routing === true) return true
      const text = `${t.name || ''} ${t.service_description || ''}`.toLowerCase()
      return text.includes('window')
    }
    const tieredTenants = tenants.filter((t) => !isWindowTenant(t))

    const missing: string[] = []
    const counts: Record<string, number> = {}

    for (const tenant of tieredTenants) {
      const { count } = await client
        .from('pricing_tiers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)

      const tierCount = count ?? 0
      counts[tenant.slug] = tierCount
      if (tierCount === 0) missing.push(tenant.slug)
    }

    let status: HealthStatus = 'healthy'
    if (missing.length > 0) status = 'critical'

    return {
      check_name: 'Pricing tiers coverage',
      component: 'osiris_pricing',
      status,
      details: {
        per_tenant: counts,
        missing_tiers: missing,
        message:
          missing.length > 0
            ? `${missing.join(', ')} missing pricing tiers!`
            : `All ${tieredTenants.length} tenants have pricing tiers`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Pricing tiers coverage',
      component: 'osiris_pricing',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

async function checkOsirisJobs(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const counts: Record<string, number> = {}

    for (const tenant of tenants) {
      const { count } = await client
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .gte('created_at', since)

      counts[tenant.slug] = count ?? 0
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    let status: HealthStatus = 'healthy'
    if (total === 0) status = 'warning'

    return {
      check_name: 'New jobs (7d)',
      component: 'osiris_jobs',
      status,
      details: {
        per_tenant: counts,
        total_7d: total,
        message: `${total} new jobs across ${tenants.length} tenants in last 7d`,
      },
    }
  } catch (err) {
    return {
      check_name: 'New jobs (7d)',
      component: 'osiris_jobs',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

// Tenant website intake watchdog — catches the Texas Nova / Zadapt
// failure mode where a tenant has a live website but its form silently
// drops every submission (502 upstream, never reaches our webhook).
//
// Rule: if a tenant has website_url set AND zero WEBSITE_LEAD_RECEIVED
// events in the last 14 days, flag critical. Uses system_events as the
// ground truth — no synthetic POSTs, no fake leads created.
async function checkTenantWebsiteIntake(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

    // Only check house-cleaning tenants with a live website. Window-cleaning
    // tenants (WinBros, Crystal Clear) don't use the /api/webhooks/website
    // form — they intake via HCP/OpenPhone/phone, so zero website leads is
    // expected and not a bug.
    const isWindowTenant = (t: any): boolean => {
      const wc = (t.workflow_config || {}) as Record<string, unknown>
      if (wc.use_hcp_mirror === true) return true
      if (wc.use_team_routing === true) return true
      const text = `${t.name || ''} ${t.service_description || ''}`.toLowerCase()
      return text.includes('window')
    }
    const tenantsWithSite = tenants.filter((t) => {
      if (isWindowTenant(t)) return false
      const url = (t as { website_url?: string | null }).website_url
      return typeof url === 'string' && url.trim().length > 0
    })

    const perTenant: Record<string, number> = {}
    const silent: string[] = []

    for (const tenant of tenantsWithSite) {
      const { count } = await client
        .from('system_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id)
        .eq('event_type', 'WEBSITE_LEAD_RECEIVED')
        .gte('created_at', since)

      const c = count ?? 0
      perTenant[tenant.slug] = c
      if (c === 0) silent.push(tenant.slug)
    }

    let status: HealthStatus = 'healthy'
    if (silent.length > 0) status = 'critical'

    return {
      check_name: 'Tenant website intake (14d)',
      component: 'tenant_websites',
      status,
      details: {
        per_tenant: perTenant,
        silent_tenants: silent,
        message:
          silent.length > 0
            ? `Website form appears dead for: ${silent.join(', ')} (0 leads in 14d). Check upstream — Zadapt/vendor /api/leads may be crashing.`
            : `All ${tenantsWithSite.length} tenant websites received at least 1 form lead in last 14d`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Tenant website intake (14d)',
      component: 'tenant_websites',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

// Detect silent inbound SMS pipelines per tenant — catches the recurring
// OpenPhone webhook auto-disable (incidents 2026-04-20 + 2026-04-24, both
// dropped 38–46h of customer replies before manual discovery).
//
// Rule: tenant had inbounds in last 7d but zero in last 4h → suspicious.
// Restricted to LA/Iowa/Ontario business hours (8am–10pm local = roughly
// 13:00–05:00 UTC) so off-hours quiet ≠ alarm. Cron runs every 6h so 4h
// window guarantees at least one full check inside business hours.
async function checkInboundFlow(): Promise<HealthCheck> {
  try {
    const client = getSupabaseServiceClient()
    const tenants = await getAllActiveTenants()
    const tenantsWithPhone = tenants.filter(
      (t) => typeof (t as { openphone_phone_number?: string }).openphone_phone_number === 'string'
    )

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()

    // Business-hours check vs UTC: skip alert if every covered tenant TZ is
    // currently outside 8am–10pm. Spotless=PT, Cedar=CT, Niagara=ET, Texas=CT.
    // Anchor on PT (covers all): if PT is between 22:00–08:00, off-hours.
    const ptHour = (() => {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false,
      })
      return parseInt(fmt.format(new Date()), 10)
    })()
    const isBusinessHours = ptHour >= 8 && ptHour < 22

    const perTenant: Record<string, { last_7d: number; last_4h: number }> = {}
    const stranded: string[] = []

    for (const tenant of tenantsWithPhone) {
      const [{ count: count7d }, { count: count4h }] = await Promise.all([
        client
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('direction', 'inbound')
          .gte('created_at', sevenDaysAgo),
        client
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('direction', 'inbound')
          .gte('created_at', fourHoursAgo),
      ])

      const c7 = count7d ?? 0
      const c4 = count4h ?? 0
      perTenant[tenant.slug] = { last_7d: c7, last_4h: c4 }

      // Tenant is "stranded" if it had real recent activity but went quiet.
      // Threshold of 5/7d filters out very quiet tenants (Cedar, WinBros)
      // where 0/4h is normal.
      if (c7 >= 5 && c4 === 0) stranded.push(tenant.slug)
    }

    let status: HealthStatus = 'healthy'
    if (stranded.length > 0) status = isBusinessHours ? 'critical' : 'warning'

    return {
      check_name: 'Inbound SMS flow (4h)',
      component: 'inbound_flow',
      status,
      details: {
        per_tenant: perTenant,
        stranded_tenants: stranded,
        is_business_hours: isBusinessHours,
        pt_hour: ptHour,
        message:
          stranded.length > 0
            ? `Possible webhook drift — ${stranded.join(', ')} had inbounds in last 7d but ZERO in last 4h${isBusinessHours ? ' (business hours)' : ' (off-hours, lower confidence)'}`
            : `All ${tenantsWithPhone.length} tenants with phones receiving inbounds normally`,
      },
    }
  } catch (err) {
    return {
      check_name: 'Inbound SMS flow (4h)',
      component: 'inbound_flow',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

// Detect disabled OpenPhone message webhooks before they cause silent drops.
// OpenPhone auto-disables a webhook URL after consecutive 5xx/timeout
// responses. The call webhook stays enabled while the message webhook gets
// disabled, so per-tenant call success ≠ message success.
async function checkOpenPhoneWebhooks(): Promise<HealthCheck> {
  try {
    const tenants = await getAllActiveTenants()
    const tenantsWithKey = tenants.filter(
      (t) => typeof (t as { openphone_api_key?: string }).openphone_api_key === 'string'
    )

    // Some tenants share an OpenPhone workspace (Spotless/Texas Nova/West
    // Niagara/WinBros all share one; Cedar Rapids has its own). Hitting the
    // same workspace once per tenant is wasteful but harmless — and matters
    // for fail-isolation (one bad key only fails its own check).
    const disabledMessageWebhooks: Array<{
      tenant: string
      url: string
      events: string[]
    }> = []
    const errors: Record<string, string> = {}

    await Promise.all(
      tenantsWithKey.map(async (tenant) => {
        const apiKey = (tenant as { openphone_api_key: string }).openphone_api_key
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        try {
          const res = await fetch('https://api.openphone.com/v1/webhooks', {
            headers: { Authorization: apiKey },
            signal: controller.signal,
          })
          if (!res.ok) {
            errors[tenant.slug] = `HTTP ${res.status}`
            return
          }
          const body = (await res.json()) as { data?: Array<{
            status?: string
            url?: string
            events?: string[]
          }> }
          for (const w of body.data ?? []) {
            const isMessage = (w.events ?? []).some((e) => e.startsWith('message.'))
            if (isMessage && w.status === 'disabled') {
              disabledMessageWebhooks.push({
                tenant: tenant.slug,
                url: w.url ?? '?',
                events: w.events ?? [],
              })
            }
          }
        } catch (err) {
          errors[tenant.slug] = err instanceof Error ? err.message : 'fetch_failed'
        } finally {
          clearTimeout(timeout)
        }
      })
    )

    let status: HealthStatus = 'healthy'
    if (disabledMessageWebhooks.length > 0) status = 'critical'
    if (Object.keys(errors).length > 0 && status === 'healthy') status = 'warning'

    return {
      check_name: 'OpenPhone webhook status',
      component: 'openphone_webhooks',
      status,
      details: {
        disabled_message_webhooks: disabledMessageWebhooks,
        api_errors: errors,
        checked_tenants: tenantsWithKey.length,
        message:
          disabledMessageWebhooks.length > 0
            ? `${disabledMessageWebhooks.length} disabled message webhook(s): ${disabledMessageWebhooks
                .map((w) => `${w.tenant}→${w.url}`)
                .join('; ')}`
            : `All ${tenantsWithKey.length} tenant message webhooks enabled`,
      },
    }
  } catch (err) {
    return {
      check_name: 'OpenPhone webhook status',
      component: 'openphone_webhooks',
      status: 'unknown',
      details: { error: err instanceof Error ? err.message : 'Unknown error' },
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────

const STATUS_ICON: Record<HealthStatus, string> = {
  healthy: 'HEALTHY',
  warning: 'WARNING',
  critical: 'CRITICAL',
  unknown: 'UNKNOWN',
}

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const startedAt = new Date().toISOString()

  // Run all checks in parallel
  const results = await Promise.all([
    checkSamScrapers(),
    checkSamProspects(),
    checkSamOutreach(),
    checkSamEnrichment(),
    checkOsirisResponder(),
    checkOsirisScoring(),
    checkOsirisBrain(),
    checkOsirisPricing(),
    checkOsirisJobs(),
    checkTenantWebsiteIntake(),
    checkInboundFlow(),
    checkOpenPhoneWebhooks(),
  ])

  // Store results in system_health table
  const client = getSupabaseServiceClient()
  const rows = results.map((r) => ({
    check_name: r.check_name,
    component: r.component,
    status: r.status,
    details: r.details,
    checked_at: startedAt,
  }))

  const { error: insertError } = await client.from('system_health').insert(rows)
  if (insertError) {
    console.error('[SystemHealth] Failed to store results:', insertError.message)
  }

  // Build console summary
  const summary = results
    .map((r) => {
      const icon = STATUS_ICON[r.status]
      const msg = typeof r.details?.message === 'string' ? r.details.message : r.status
      return `  ${r.component.padEnd(20)} ${icon.padEnd(10)} ${msg}`
    })
    .join('\n')

  console.log(`[SYSTEM HEALTH] ${startedAt}\n${summary}`)

  // Determine overall status
  const hasUnknown = results.some((r) => r.status === 'unknown')
  const hasCritical = results.some((r) => r.status === 'critical')
  const hasWarning = results.some((r) => r.status === 'warning')
  let overallStatus: HealthStatus = 'healthy'
  if (hasWarning) overallStatus = 'warning'
  if (hasCritical) overallStatus = 'critical'
  if (hasUnknown && !hasCritical) overallStatus = 'warning'

  return NextResponse.json({
    success: true,
    status: overallStatus,
    checked_at: startedAt,
    checks: results,
    stored: !insertError,
  })
}
