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
// GET /api/actions/insights/funnel
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
    .select("id, source, status, converted_to_job_id, created_at, last_contact_at, first_name, last_name")
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  if (leadsErr) {
    return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })
  }

  const leads = currentLeads ?? []

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

  const prevLeads = previousLeads ?? []

  // -----------------------------------------------------------------------
  // 3. Completed jobs from converted leads (current period)
  // -----------------------------------------------------------------------
  const convertedJobIds = leads
    .filter((l) => l.converted_to_job_id)
    .map((l) => l.converted_to_job_id as string)

  const completedJobIds = new Set<string>()
  const completedJobCustomerIds = new Set<string>()

  if (convertedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, customer_id, status")
      .in("id", convertedJobIds)
      .eq("status", "completed")

    if (jobs) {
      for (const j of jobs) {
        completedJobIds.add(j.id)
        if (j.customer_id) completedJobCustomerIds.add(j.customer_id)
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Repeat customers from those completed jobs
  // -----------------------------------------------------------------------
  let repeatCount = 0
  if (completedJobCustomerIds.size > 0) {
    const { data: repeatCustomers } = await supabase
      .from("customers")
      .select("id")
      .in("id", Array.from(completedJobCustomerIds))
      .eq("tenant_id", tenant.id)
      .eq("lifecycle_stage", "repeat")

    repeatCount = repeatCustomers?.length ?? 0
  }

  // -----------------------------------------------------------------------
  // 5. Previous-period completed jobs (for comparison)
  // -----------------------------------------------------------------------
  const prevConvertedJobIds = prevLeads
    .filter((l) => l.converted_to_job_id)
    .map((l) => l.converted_to_job_id as string)

  const prevCompletedJobIds = new Set<string>()
  const prevCompletedCustomerIds = new Set<string>()

  if (prevConvertedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, customer_id, status")
      .in("id", prevConvertedJobIds)
      .eq("status", "completed")

    if (jobs) {
      for (const j of jobs) {
        prevCompletedJobIds.add(j.id)
        if (j.customer_id) prevCompletedCustomerIds.add(j.customer_id)
      }
    }
  }

  let prevRepeatCount = 0
  if (prevCompletedCustomerIds.size > 0) {
    const { data: repeatCustomers } = await supabase
      .from("customers")
      .select("id")
      .in("id", Array.from(prevCompletedCustomerIds))
      .eq("tenant_id", tenant.id)
      .eq("lifecycle_stage", "repeat")

    prevRepeatCount = repeatCustomers?.length ?? 0
  }

  // -----------------------------------------------------------------------
  // 6. Compute funnel stages
  // -----------------------------------------------------------------------
  const CONTACTED_STATUSES = new Set(["contacted", "qualified", "booked", "assigned"])
  const QUALIFIED_STATUSES = new Set(["qualified", "booked", "assigned"])
  const BOOKED_STATUSES = new Set(["booked", "assigned"])

  function computeStages(leadList: Array<{ status: string; converted_to_job_id: string | null }>, completedIds: Set<string>, repeat: number) {
    const leadCount = leadList.length
    const contacted = leadList.filter((l) => CONTACTED_STATUSES.has(l.status)).length
    const qualified = leadList.filter((l) => QUALIFIED_STATUSES.has(l.status)).length
    const booked = leadList.filter(
      (l) => BOOKED_STATUSES.has(l.status) || l.converted_to_job_id
    ).length
    const completed = leadList.filter(
      (l) => l.converted_to_job_id && completedIds.has(l.converted_to_job_id)
    ).length

    return [
      { name: "Lead", count: leadCount },
      { name: "Contacted", count: contacted },
      { name: "Qualified", count: qualified },
      { name: "Booked", count: booked },
      { name: "Completed", count: completed },
      { name: "Repeat", count: repeat },
    ]
  }

  const currentStages = computeStages(leads, completedJobIds, repeatCount)
  const prevStages = computeStages(prevLeads, prevCompletedJobIds, prevRepeatCount)

  // Compute drop-off percentages
  const stages = currentStages.map((stage, i) => {
    const prevStage = i > 0 ? currentStages[i - 1].count : stage.count
    const dropOffPercent =
      prevStage > 0 ? Math.round(((prevStage - stage.count) / prevStage) * 1000) / 10 : 0

    return {
      name: stage.name,
      count: stage.count,
      previousCount: prevStages[i]?.count ?? 0,
      dropOffPercent: i === 0 ? 0 : dropOffPercent,
    }
  })

  // -----------------------------------------------------------------------
  // 7. Stage timing
  // -----------------------------------------------------------------------
  let responseMinutesSum = 0
  let responseCount = 0

  for (const l of leads) {
    if (l.last_contact_at) {
      const diff = new Date(l.last_contact_at).getTime() - new Date(l.created_at).getTime()
      if (diff >= 0) {
        responseMinutesSum += diff / 60000
        responseCount++
      }
    }
  }

  const avgTimeToContact = responseCount > 0 ? Math.round(responseMinutesSum / responseCount) : 0

  // Avg time to book: lead created_at → job date for booked/converted leads
  const bookedLeadsWithJobs = leads.filter((l) => l.converted_to_job_id)
  let bookingHoursSum = 0
  let bookingCount = 0

  if (bookedLeadsWithJobs.length > 0) {
    const jobIds = bookedLeadsWithJobs.map((l) => l.converted_to_job_id as string)
    const { data: bookedJobs } = await supabase
      .from("jobs")
      .select("id, created_at")
      .in("id", jobIds)

    if (bookedJobs) {
      const jobCreatedMap = new Map(bookedJobs.map((j) => [j.id, j.created_at]))
      for (const l of bookedLeadsWithJobs) {
        const jobCreated = jobCreatedMap.get(l.converted_to_job_id as string)
        if (jobCreated) {
          const diff = new Date(jobCreated).getTime() - new Date(l.created_at).getTime()
          if (diff >= 0) {
            bookingHoursSum += diff / 3600000
            bookingCount++
          }
        }
      }
    }
  }

  const avgTimeToBook = bookingCount > 0 ? Math.round((bookingHoursSum / bookingCount) * 10) / 10 : 0

  // -----------------------------------------------------------------------
  // 8. Stale leads
  // -----------------------------------------------------------------------
  const nowMs = Date.now()
  const fortyEightHoursMs = 48 * 60 * 60 * 1000

  // Query stale leads across ALL current leads (not just date-range filtered)
  const { data: staleLeadRows } = await supabase
    .from("leads")
    .select("id, first_name, last_name, source, status, last_contact_at, created_at")
    .eq("tenant_id", tenant.id)
    .in("status", ["new", "contacted"])
    .order("last_contact_at", { ascending: true, nullsFirst: true })
    .limit(50)

  const staleLeads: { count: number; leads: Array<{ id: string; name: string; source: string; daysSinceContact: number }> } = {
    count: 0,
    leads: [],
  }

  for (const l of staleLeadRows ?? []) {
    const contactTime = l.last_contact_at ? new Date(l.last_contact_at).getTime() : null
    const isStale = !contactTime || (nowMs - contactTime) > fortyEightHoursMs

    if (isStale) {
      const daysSince = contactTime
        ? Math.round((nowMs - contactTime) / (86400000))
        : Math.round((nowMs - new Date(l.created_at).getTime()) / 86400000)

      staleLeads.leads.push({
        id: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unknown",
        source: l.source || "unknown",
        daysSinceContact: daysSince,
      })
    }
  }

  // Sort by days descending
  staleLeads.leads.sort((a, b) => b.daysSinceContact - a.daysSinceContact)
  staleLeads.count = staleLeads.leads.length

  // -----------------------------------------------------------------------
  // 9. Bottleneck: stage with highest drop-off
  // -----------------------------------------------------------------------
  let bottleneck = "None"
  let maxDropOff = 0
  for (const s of stages) {
    if (s.dropOffPercent > maxDropOff) {
      maxDropOff = s.dropOffPercent
      bottleneck = s.name
    }
  }

  // -----------------------------------------------------------------------
  // 10. Conversion trend: daily leads created + how many reached booked
  // -----------------------------------------------------------------------
  const dailyMap: Record<string, { leadsIn: number; booked: number }> = {}

  for (const l of leads) {
    const day = l.created_at.slice(0, 10)
    if (!dailyMap[day]) dailyMap[day] = { leadsIn: 0, booked: 0 }
    dailyMap[day].leadsIn++
    if (BOOKED_STATUSES.has(l.status) || l.converted_to_job_id) {
      dailyMap[day].booked++
    }
  }

  const sortedDays = Object.keys(dailyMap).sort()
  const conversionTrend = sortedDays.map((date) => {
    const d = dailyMap[date]
    return {
      date,
      leadsIn: d.leadsIn,
      booked: d.booked,
      rate: d.leadsIn > 0 ? Math.round((d.booked / d.leadsIn) * 1000) / 10 : 0,
    }
  })

  // -----------------------------------------------------------------------
  // 11. Sparklines
  // -----------------------------------------------------------------------
  const sparklineConversionRate = sortedDays.map((d) => {
    const day = dailyMap[d]
    return day.leadsIn > 0 ? Math.round((day.booked / day.leadsIn) * 100) : 0
  })
  const sparklineLeadsIn = sortedDays.map((d) => dailyMap[d].leadsIn)

  // -----------------------------------------------------------------------
  // Response
  // -----------------------------------------------------------------------
  return NextResponse.json({
    stages,
    staleLeads,
    avgTimeToContact,
    avgTimeToBook,
    bottleneck,
    conversionTrend,
    sparklines: {
      conversionRate: sparklineConversionRate,
      leadsIn: sparklineLeadsIn,
    },
  })
}
