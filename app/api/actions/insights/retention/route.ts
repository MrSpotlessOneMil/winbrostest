import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Date-range helpers (same pattern as leads route)
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
// Constants
// ---------------------------------------------------------------------------

const RETARGETABLE_STAGES = ["unresponsive", "quoted_not_booked", "one_time", "lapsed"] as const

// ---------------------------------------------------------------------------
// GET /api/actions/insights/retention
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
  const { start, end } = computeDateRange(range, fromParam, toParam, tz)

  // -------------------------------------------------------------------------
  // 1. Lifecycle distribution (snapshot — NOT date-filtered)
  // -------------------------------------------------------------------------
  const { data: allCustomers, error: custErr } = await supabase
    .from("customers")
    .select(
      "id, first_name, last_name, lifecycle_stage, retargeting_sequence, retargeting_step, retargeting_enrolled_at, retargeting_completed_at, retargeting_stopped_reason"
    )
    .eq("tenant_id", tenant.id)

  if (custErr) {
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }

  const customers = allCustomers ?? []

  const lifecycleDistribution: Record<string, { count: number }> = {}
  for (const c of customers) {
    const stage = c.lifecycle_stage || "unknown"
    if (!lifecycleDistribution[stage]) {
      lifecycleDistribution[stage] = { count: 0 }
    }
    lifecycleDistribution[stage].count++
  }

  // -------------------------------------------------------------------------
  // 2. Retargeting pipeline
  // -------------------------------------------------------------------------
  const stages: Record<string, { total: number; in_sequence: number; completed_sequence: number; converted: number }> = {}

  for (const stageName of RETARGETABLE_STAGES) {
    stages[stageName] = { total: 0, in_sequence: 0, completed_sequence: 0, converted: 0 }
  }

  for (const c of customers) {
    const stage = c.lifecycle_stage
    if (!stage || !RETARGETABLE_STAGES.includes(stage as typeof RETARGETABLE_STAGES[number])) continue

    stages[stage].total++

    if (c.retargeting_sequence && !c.retargeting_stopped_reason) {
      stages[stage].in_sequence++
    }

    if (c.retargeting_stopped_reason === "completed") {
      stages[stage].completed_sequence++
    }

    if (c.retargeting_stopped_reason === "converted") {
      stages[stage].converted++
    }
  }

  const totalEligible = Object.values(stages).reduce((s, v) => s + v.total, 0)
  const inSequence = Object.values(stages).reduce((s, v) => s + v.in_sequence, 0)
  const completedSequence = Object.values(stages).reduce((s, v) => s + v.completed_sequence, 0)
  const converted = Object.values(stages).reduce((s, v) => s + v.converted, 0)
  const notEnrolled = totalEligible - inSequence - completedSequence - converted

  const conversionRate =
    (inSequence + completedSequence + converted) > 0
      ? Math.round((converted / (inSequence + completedSequence + converted)) * 1000) / 10
      : 0

  // -------------------------------------------------------------------------
  // 3. Repeat rate
  // -------------------------------------------------------------------------
  const { data: completedJobs, error: jobsErr } = await supabase
    .from("jobs")
    .select("customer_id, date, satisfaction_response, completed_at, created_at")
    .eq("tenant_id", tenant.id)
    .eq("status", "completed")

  if (jobsErr) {
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 })
  }

  const jobs = completedJobs ?? []

  // Count jobs per customer
  const jobCountByCustomer: Record<string, number> = {}
  const latestJobByCustomer: Record<string, string> = {}

  for (const j of jobs) {
    if (!j.customer_id) continue
    jobCountByCustomer[j.customer_id] = (jobCountByCustomer[j.customer_id] || 0) + 1

    const jobDate = j.date || j.completed_at || j.created_at
    if (jobDate) {
      if (!latestJobByCustomer[j.customer_id] || jobDate > latestJobByCustomer[j.customer_id]) {
        latestJobByCustomer[j.customer_id] = jobDate
      }
    }
  }

  const customersWithJobs = Object.keys(jobCountByCustomer).length
  const customersWithMultipleJobs = Object.values(jobCountByCustomer).filter((c) => c >= 2).length
  const repeatRate = customersWithJobs > 0
    ? Math.round((customersWithMultipleJobs / customersWithJobs) * 1000) / 10
    : 0

  // -------------------------------------------------------------------------
  // 4. At-risk customers (last completed job 60-90 days ago)
  // -------------------------------------------------------------------------
  const nowMs = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  const atRiskCustomers: Array<{
    id: string
    name: string
    daysSinceLastJob: number
    lifecycleStage: string
  }> = []

  for (const [customerId, lastDate] of Object.entries(latestJobByCustomer)) {
    const daysSince = Math.floor((nowMs - new Date(lastDate).getTime()) / dayMs)
    if (daysSince >= 60 && daysSince <= 90) {
      const customer = customers.find((c) => c.id === customerId)
      const name = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown"
        : "Unknown"
      atRiskCustomers.push({
        id: customerId,
        name,
        daysSinceLastJob: daysSince,
        lifecycleStage: customer?.lifecycle_stage || "unknown",
      })
    }
  }

  // Sort by days descending
  atRiskCustomers.sort((a, b) => b.daysSinceLastJob - a.daysSinceLastJob)

  // -------------------------------------------------------------------------
  // 5. Health score: (active + repeat) / total * 100
  // -------------------------------------------------------------------------
  const totalCustomers = customers.length
  const activeCount = lifecycleDistribution["active"]?.count || 0
  const repeatCount = lifecycleDistribution["repeat"]?.count || 0
  const healthScore = totalCustomers > 0
    ? Math.round(((activeCount + repeatCount) / totalCustomers) * 1000) / 10
    : 0

  // -------------------------------------------------------------------------
  // 6. Satisfaction breakdown (date-filtered)
  // -------------------------------------------------------------------------
  const dateFilteredJobs = jobs.filter((j) => {
    const jobDate = j.completed_at || j.date || j.created_at
    return jobDate && jobDate >= start && jobDate <= end
  })

  let positive = 0
  let negative = 0
  let noResponse = 0

  for (const j of dateFilteredJobs) {
    if (j.satisfaction_response === "positive") positive++
    else if (j.satisfaction_response === "negative") negative++
    else noResponse++
  }

  // -------------------------------------------------------------------------
  // 7. Smart recommendations
  // -------------------------------------------------------------------------
  interface Recommendation {
    priority: "high" | "medium" | "low"
    title: string
    description: string
    action?: string
    link?: string
  }

  const recommendations: Recommendation[] = []

  if (notEnrolled > 5) {
    recommendations.push({
      priority: "high",
      title: `${notEnrolled} eligible customers not enrolled`,
      description: `You have ${notEnrolled} retargetable customers who haven't been enrolled in any sequence. Start a campaign to re-engage them.`,
      action: "Start Campaign",
      link: "/campaigns",
    })
  }

  const unresponsiveCount = stages["unresponsive"]?.total || 0
  if (unresponsiveCount > 10) {
    recommendations.push({
      priority: "high",
      title: `${unresponsiveCount} unresponsive customers`,
      description: "A large number of customers haven't responded to outreach. Consider adjusting your messaging or trying a different channel.",
      action: "View Campaigns",
      link: "/campaigns",
    })
  }

  const qnbCount = stages["quoted_not_booked"]?.total || 0
  if (qnbCount > 5) {
    recommendations.push({
      priority: "high",
      title: `${qnbCount} quoted but not booked`,
      description: "These customers received a quote but never booked. A follow-up campaign with a discount could convert them.",
      action: "Start Campaign",
      link: "/campaigns",
    })
  }

  const oneTimeCount = stages["one_time"]?.total || 0
  if (oneTimeCount > 5) {
    recommendations.push({
      priority: "medium",
      title: `${oneTimeCount} one-time customers`,
      description: "These customers only booked once. A re-engagement sequence can turn them into repeat customers.",
      action: "Start Campaign",
      link: "/campaigns",
    })
  }

  const lapsedCount = stages["lapsed"]?.total || 0
  if (lapsedCount > 3) {
    recommendations.push({
      priority: "medium",
      title: `${lapsedCount} lapsed customers`,
      description: "Former repeat customers who haven't booked recently. Win them back with a personalized offer.",
      action: "Start Campaign",
      link: "/campaigns",
    })
  }

  if (conversionRate > 15) {
    recommendations.push({
      priority: "low",
      title: `${conversionRate}% retargeting conversion rate`,
      description: "Your retargeting campaigns are performing well. Keep it up and consider expanding to more segments.",
    })
  }

  // Close rate from leads (for recommendation only)
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  const { count: convertedLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .not("converted_to_job_id", "is", null)
    .gte("created_at", start)
    .lte("created_at", end)

  const closeRate = (totalLeads && totalLeads > 0 && convertedLeads !== null)
    ? Math.round((convertedLeads / totalLeads) * 100)
    : null

  if (closeRate !== null && closeRate < 30) {
    recommendations.push({
      priority: "medium",
      title: `${closeRate}% lead close rate`,
      description: "Your lead-to-job conversion rate is below 30%. Review your follow-up process and response times.",
      action: "View Leads",
      link: "/insights/leads",
    })
  }

  // -------------------------------------------------------------------------
  // 8. Sparklines: daily health score approximation
  // -------------------------------------------------------------------------
  // Build daily repeat-booking counts over the date range
  const dailyRepeatBookings: Record<string, number> = {}

  for (const j of dateFilteredJobs) {
    if (!j.customer_id) continue
    const jobDate = (j.completed_at || j.date || j.created_at || "").slice(0, 10)
    if (!jobDate) continue
    if ((jobCountByCustomer[j.customer_id] || 0) >= 2) {
      dailyRepeatBookings[jobDate] = (dailyRepeatBookings[jobDate] || 0) + 1
    }
  }

  const sortedDays = Object.keys(dailyRepeatBookings).sort()
  const healthScoreSparkline = sortedDays.map((d) => dailyRepeatBookings[d] || 0)

  // -------------------------------------------------------------------------
  // Response
  // -------------------------------------------------------------------------
  return NextResponse.json({
    lifecycleDistribution,
    retargeting: {
      stages,
      totals: {
        totalEligible,
        inSequence,
        completedSequence,
        converted,
        notEnrolled,
      },
      conversionRate,
    },
    repeatRate: { current: repeatRate },
    healthScore,
    atRiskCustomers,
    satisfaction: { positive, negative, noResponse },
    recommendations,
    sparklines: { healthScore: healthScoreSparkline },
  })
}
