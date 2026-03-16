import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Date-range helpers
// ---------------------------------------------------------------------------

function computeDateRange(
  range: string,
  from: string | null,
  to: string | null,
  timezone: string
): { start: string; end: string; prevStart: string; prevEnd: string } {
  // "now" in the tenant's timezone
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone })
  )
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  let start: Date
  let end: Date = new Date(today)
  end.setHours(23, 59, 59, 999)

  switch (range) {
    case "7d": {
      start = new Date(today)
      start.setDate(start.getDate() - 6)
      break
    }
    case "30d": {
      start = new Date(today)
      start.setDate(start.getDate() - 29)
      break
    }
    case "90d": {
      start = new Date(today)
      start.setDate(start.getDate() - 89)
      break
    }
    case "ytd": {
      start = new Date(today.getFullYear(), 0, 1)
      break
    }
    case "custom": {
      if (!from || !to) {
        // Fall back to 30d
        start = new Date(today)
        start.setDate(start.getDate() - 29)
        break
      }
      start = new Date(from + "T00:00:00")
      end = new Date(to + "T23:59:59.999")
      break
    }
    default: {
      start = new Date(today)
      start.setDate(start.getDate() - 29)
    }
  }

  const durationMs = end.getTime() - start.getTime()

  let prevStart: Date
  let prevEnd: Date

  if (range === "ytd") {
    // Same period last year
    prevStart = new Date(start)
    prevStart.setFullYear(prevStart.getFullYear() - 1)
    prevEnd = new Date(end)
    prevEnd.setFullYear(prevEnd.getFullYear() - 1)
  } else {
    prevEnd = new Date(start.getTime() - 1)
    prevStart = new Date(prevEnd.getTime() - durationMs)
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// GET /api/actions/insights/leads
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const url = new URL(request.url)
  const range = url.searchParams.get("range") || "30d"
  const fromParam = url.searchParams.get("from")
  const toParam = url.searchParams.get("to")

  const tz = tenant.timezone || "America/Chicago"
  const { start, end, prevStart, prevEnd } = computeDateRange(range, fromParam, toParam, tz)

  // -----------------------------------------------------------------------
  // 1. Current-period leads
  // -----------------------------------------------------------------------
  const { data: currentLeads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, source, status, converted_to_job_id, created_at, last_contact_at")
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  if (leadsErr) {
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })
  }

  // -----------------------------------------------------------------------
  // 2. Previous-period leads
  // -----------------------------------------------------------------------
  const { data: previousLeads, error: prevErr } = await supabase
    .from("leads")
    .select("id, source, status, converted_to_job_id, created_at, last_contact_at")
    .eq("tenant_id", tenant.id)
    .gte("created_at", prevStart)
    .lte("created_at", prevEnd)

  if (prevErr) {
    return NextResponse.json({ error: "Failed to fetch previous leads" }, { status: 500 })
  }

  // -----------------------------------------------------------------------
  // 3. Completed jobs tied to converted leads (current period)
  // -----------------------------------------------------------------------
  const convertedJobIds = (currentLeads ?? [])
    .filter((l) => l.converted_to_job_id)
    .map((l) => l.converted_to_job_id as string)

  let jobsByIdCurrent: Record<string, number> = {}
  if (convertedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, price, status")
      .in("id", convertedJobIds)
      .eq("status", "completed")

    if (jobs) {
      for (const j of jobs) {
        jobsByIdCurrent[j.id] = Number(j.price) || 0
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Completed jobs tied to converted leads (previous period)
  // -----------------------------------------------------------------------
  const prevConvertedJobIds = (previousLeads ?? [])
    .filter((l) => l.converted_to_job_id)
    .map((l) => l.converted_to_job_id as string)

  let jobsByIdPrev: Record<string, number> = {}
  if (prevConvertedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, price, status")
      .in("id", prevConvertedJobIds)
      .eq("status", "completed")

    if (jobs) {
      for (const j of jobs) {
        jobsByIdPrev[j.id] = Number(j.price) || 0
      }
    }
  }

  // -----------------------------------------------------------------------
  // Aggregate by source
  // -----------------------------------------------------------------------
  interface SourceBucket {
    leads: number
    conversions: number
    revenue: number
    responseMinutesSum: number
    responseCount: number
    untouched: number
  }

  function aggregate(
    leads: typeof currentLeads,
    jobsById: Record<string, number>
  ): Record<string, SourceBucket> {
    const map: Record<string, SourceBucket> = {}
    for (const l of leads ?? []) {
      const src = l.source || "unknown"
      if (!map[src]) {
        map[src] = { leads: 0, conversions: 0, revenue: 0, responseMinutesSum: 0, responseCount: 0, untouched: 0 }
      }
      const b = map[src]
      b.leads++

      if (l.converted_to_job_id) {
        b.conversions++
        if (jobsById[l.converted_to_job_id]) {
          b.revenue += jobsById[l.converted_to_job_id]
        }
      }

      if (l.last_contact_at) {
        const diff = new Date(l.last_contact_at).getTime() - new Date(l.created_at).getTime()
        if (diff >= 0) {
          b.responseMinutesSum += diff / 60000
          b.responseCount++
        }
      }

      if (l.status === "new" && !l.last_contact_at) {
        b.untouched++
      }
    }
    return map
  }

  const currentBySrc = aggregate(currentLeads, jobsByIdCurrent)
  const prevBySrc = aggregate(previousLeads, jobsByIdPrev)

  // Collect all sources across both periods
  const allSources = new Set([...Object.keys(currentBySrc), ...Object.keys(prevBySrc)])

  const bySource = Array.from(allSources).map((source) => {
    const cur = currentBySrc[source] || { leads: 0, conversions: 0, revenue: 0, responseMinutesSum: 0, responseCount: 0, untouched: 0 }
    const prev = prevBySrc[source] || { leads: 0, conversions: 0, revenue: 0, responseMinutesSum: 0, responseCount: 0, untouched: 0 }

    return {
      source,
      leads: cur.leads,
      previousLeads: prev.leads,
      conversions: cur.conversions,
      previousConversions: prev.conversions,
      revenue: Math.round(cur.revenue),
      previousRevenue: Math.round(prev.revenue),
      conversionRate: cur.leads > 0 ? Math.round((cur.conversions / cur.leads) * 1000) / 10 : 0,
      avgResponseMinutes: cur.responseCount > 0 ? Math.round(cur.responseMinutesSum / cur.responseCount) : 0,
      untouched: cur.untouched,
    }
  })

  // Sort by leads descending
  bySource.sort((a, b) => b.leads - a.leads)

  // -----------------------------------------------------------------------
  // Totals
  // -----------------------------------------------------------------------
  const totals = {
    leads: bySource.reduce((s, r) => s + r.leads, 0),
    previousLeads: bySource.reduce((s, r) => s + r.previousLeads, 0),
    conversions: bySource.reduce((s, r) => s + r.conversions, 0),
    previousConversions: bySource.reduce((s, r) => s + r.previousConversions, 0),
    revenue: bySource.reduce((s, r) => s + r.revenue, 0),
    previousRevenue: bySource.reduce((s, r) => s + r.previousRevenue, 0),
    avgResponseMinutes: 0,
    previousAvgResponseMinutes: 0,
  }

  // Overall avg response (current)
  let totalRespSum = 0
  let totalRespCount = 0
  for (const src of Object.values(currentBySrc)) {
    totalRespSum += src.responseMinutesSum
    totalRespCount += src.responseCount
  }
  totals.avgResponseMinutes = totalRespCount > 0 ? Math.round(totalRespSum / totalRespCount) : 0

  // Overall avg response (previous)
  let prevRespSum = 0
  let prevRespCount = 0
  for (const src of Object.values(prevBySrc)) {
    prevRespSum += src.responseMinutesSum
    prevRespCount += src.responseCount
  }
  totals.previousAvgResponseMinutes = prevRespCount > 0 ? Math.round(prevRespSum / prevRespCount) : 0

  // -----------------------------------------------------------------------
  // Daily trends
  // -----------------------------------------------------------------------
  const trends: Array<{ date: string; source: string; leads: number; conversions: number }> = []
  const trendMap: Record<string, Record<string, { leads: number; conversions: number }>> = {}

  for (const l of currentLeads ?? []) {
    const day = l.created_at.slice(0, 10) // YYYY-MM-DD
    const src = l.source || "unknown"
    if (!trendMap[day]) trendMap[day] = {}
    if (!trendMap[day][src]) trendMap[day][src] = { leads: 0, conversions: 0 }
    trendMap[day][src].leads++
    if (l.converted_to_job_id) trendMap[day][src].conversions++
  }

  const sortedDays = Object.keys(trendMap).sort()
  for (const day of sortedDays) {
    for (const [source, counts] of Object.entries(trendMap[day])) {
      trends.push({ date: day, source, leads: counts.leads, conversions: counts.conversions })
    }
  }

  // -----------------------------------------------------------------------
  // Sparklines: daily totals (all sources combined) for leads, conversions, revenue
  // -----------------------------------------------------------------------
  const dailyLeads: Record<string, number> = {}
  const dailyConversions: Record<string, number> = {}
  const dailyRevenue: Record<string, number> = {}

  for (const l of currentLeads ?? []) {
    const day = l.created_at.slice(0, 10)
    dailyLeads[day] = (dailyLeads[day] || 0) + 1
    if (l.converted_to_job_id) {
      dailyConversions[day] = (dailyConversions[day] || 0) + 1
      if (jobsByIdCurrent[l.converted_to_job_id]) {
        dailyRevenue[day] = (dailyRevenue[day] || 0) + jobsByIdCurrent[l.converted_to_job_id]
      }
    }
  }

  // Build arrays in date order
  const sparklineLeads = sortedDays.map((d) => dailyLeads[d] || 0)
  const sparklineConversions = sortedDays.map((d) => dailyConversions[d] || 0)
  const sparklineRevenue = sortedDays.map((d) => dailyRevenue[d] || 0)

  return NextResponse.json({
    bySource,
    trends,
    totals,
    sparklines: {
      leads: sparklineLeads,
      conversions: sparklineConversions,
      revenue: sparklineRevenue,
    },
  })
}
