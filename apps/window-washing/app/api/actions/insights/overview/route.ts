import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Date-range helpers (same pattern as other insights routes)
// ---------------------------------------------------------------------------

function computeDateRange(
  range: string,
  from: string | null,
  to: string | null,
  timezone: string
): { start: string; end: string; prevStart: string; prevEnd: string } {
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
// Helpers
// ---------------------------------------------------------------------------

/** Group an array by a key-producing fn and return counts per bucket */
function countByBucket<T>(items: T[], bucketFn: (item: T) => string): Record<string, number> {
  const map: Record<string, number> = {}
  for (const item of items) {
    const key = bucketFn(item)
    map[key] = (map[key] || 0) + 1
  }
  return map
}

// ---------------------------------------------------------------------------
// GET /api/actions/insights/overview
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
  // 1. Revenue — completed jobs in range
  // -----------------------------------------------------------------------
  const [jobsResult, prevJobsResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, price, completed_at, team_id, customer_id")
      .eq("tenant_id", tenant.id)
      .gte("completed_at", start)
      .lte("completed_at", end),
    supabase
      .from("jobs")
      .select("id, status, price, completed_at")
      .eq("tenant_id", tenant.id)
      .gte("completed_at", prevStart)
      .lte("completed_at", prevEnd),
  ])

  const jobs = (jobsResult.data ?? []).filter((j) => j.status === "completed")
  const prevJobs = (prevJobsResult.data ?? []).filter((j) => j.status === "completed")

  const totalRevenue = jobs.reduce((s, j) => s + (j.price || 0), 0)
  const prevTotalRevenue = prevJobs.reduce((s, j) => s + (j.price || 0), 0)

  // Weekly revenue trend (group completed_at by week start)
  const weekBuckets = countByBucket(jobs, (j) => {
    const d = new Date(j.completed_at)
    const dayOfWeek = d.getDay()
    const weekStart = new Date(d)
    weekStart.setDate(weekStart.getDate() - dayOfWeek)
    return weekStart.toISOString().slice(0, 10)
  })

  const weeklyRevenueMap: Record<string, number> = {}
  for (const j of jobs) {
    const d = new Date(j.completed_at)
    const dayOfWeek = d.getDay()
    const weekStart = new Date(d)
    weekStart.setDate(weekStart.getDate() - dayOfWeek)
    const key = weekStart.toISOString().slice(0, 10)
    weeklyRevenueMap[key] = (weeklyRevenueMap[key] || 0) + (j.price || 0)
  }

  const revenueTrend = Object.entries(weeklyRevenueMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, revenue]) => ({
      week,
      revenue: Math.round(revenue),
      jobs: weekBuckets[week] || 0,
    }))

  // -----------------------------------------------------------------------
  // 2. Job completion rates — all scheduled jobs in range
  // -----------------------------------------------------------------------
  const { data: allScheduledJobs } = await supabase
    .from("jobs")
    .select("id, status, scheduled_date")
    .eq("tenant_id", tenant.id)
    .gte("scheduled_date", start.slice(0, 10))
    .lte("scheduled_date", end.slice(0, 10))

  const scheduledJobs = allScheduledJobs ?? []
  const totalScheduled = scheduledJobs.length
  const completedCount = scheduledJobs.filter((j) => j.status === "completed").length
  const completionRate = totalScheduled > 0 ? Math.round((completedCount / totalScheduled) * 1000) / 10 : 0

  // Previous period
  const { data: prevScheduledJobs } = await supabase
    .from("jobs")
    .select("id, status, scheduled_date")
    .eq("tenant_id", tenant.id)
    .gte("scheduled_date", prevStart.slice(0, 10))
    .lte("scheduled_date", prevEnd.slice(0, 10))

  const prevScheduled = prevScheduledJobs ?? []
  const prevTotalScheduled = prevScheduled.length
  const prevCompletedCount = prevScheduled.filter((j) => j.status === "completed").length
  const prevCompletionRate = prevTotalScheduled > 0 ? Math.round((prevCompletedCount / prevTotalScheduled) * 1000) / 10 : 0

  // -----------------------------------------------------------------------
  // 3. Customer acquisition — new customers per week
  // -----------------------------------------------------------------------
  const [custResult, prevCustResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", start)
      .lte("created_at", end),
    supabase
      .from("customers")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd),
  ])

  const newCustomers = custResult.data ?? []
  const prevNewCustomers = prevCustResult.data ?? []

  const customerWeekMap = countByBucket(newCustomers, (c) => {
    const d = new Date(c.created_at)
    const dayOfWeek = d.getDay()
    const weekStart = new Date(d)
    weekStart.setDate(weekStart.getDate() - dayOfWeek)
    return weekStart.toISOString().slice(0, 10)
  })

  const customerTrend = Object.entries(customerWeekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }))

  // -----------------------------------------------------------------------
  // 4. Service plan conversion — quotes vs service_plans
  // -----------------------------------------------------------------------
  const [quotesResult, prevQuotesResult, plansResult, prevPlansResult] = await Promise.all([
    supabase
      .from("quotes")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", start)
      .lte("created_at", end),
    supabase
      .from("quotes")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd),
    supabase
      .from("service_plans")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", start)
      .lte("created_at", end),
    supabase
      .from("service_plans")
      .select("id, created_at")
      .eq("tenant_id", tenant.id)
      .gte("created_at", prevStart)
      .lte("created_at", prevEnd),
  ])

  const quotes = quotesResult.data ?? []
  const prevQuotes = prevQuotesResult.data ?? []
  const plans = plansResult.data ?? []
  const prevPlans = prevPlansResult.data ?? []

  const conversionRate = quotes.length > 0
    ? Math.round((plans.length / quotes.length) * 1000) / 10
    : 0
  const prevConversionRate = prevQuotes.length > 0
    ? Math.round((prevPlans.length / prevQuotes.length) * 1000) / 10
    : 0

  // -----------------------------------------------------------------------
  // 5. Team productivity — revenue per team (crew)
  // -----------------------------------------------------------------------
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", tenant.id)

  const teamMap = new Map<string, string>()
  for (const t of teams ?? []) {
    teamMap.set(t.id, t.name)
  }

  const teamRevenue: Record<string, { name: string; revenue: number; jobs: number }> = {}
  for (const j of jobs) {
    const teamId = j.team_id || "unassigned"
    if (!teamRevenue[teamId]) {
      teamRevenue[teamId] = {
        name: teamMap.get(teamId) || "Unassigned",
        revenue: 0,
        jobs: 0,
      }
    }
    teamRevenue[teamId].revenue += j.price || 0
    teamRevenue[teamId].jobs += 1
  }

  const crewProductivity = Object.entries(teamRevenue)
    .map(([teamId, data]) => ({
      teamId,
      name: data.name,
      revenue: Math.round(data.revenue),
      jobs: data.jobs,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  // -----------------------------------------------------------------------
  // Build response
  // -----------------------------------------------------------------------
  return NextResponse.json({
    revenue: {
      total: Math.round(totalRevenue),
      previous: Math.round(prevTotalRevenue),
      trend: revenueTrend,
    },
    completion: {
      rate: completionRate,
      previousRate: prevCompletionRate,
      completed: completedCount,
      scheduled: totalScheduled,
    },
    customers: {
      new: newCustomers.length,
      previousNew: prevNewCustomers.length,
      trend: customerTrend,
    },
    conversion: {
      rate: conversionRate,
      previousRate: prevConversionRate,
      quotes: quotes.length,
      plans: plans.length,
    },
    crews: crewProductivity,
  })
}
