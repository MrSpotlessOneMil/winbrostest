import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Date-range helpers (same pattern as other insight routes)
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

function daysInRange(start: string, end: string): number {
  return Math.ceil(
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)
  )
}

function toBucket(dateStr: string, useWeeks: boolean): string {
  const d = dateStr.slice(0, 10) // YYYY-MM-DD
  if (!useWeeks) return d
  // Round down to Monday
  const dt = new Date(d + "T00:00:00")
  const day = dt.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = 0
  dt.setDate(dt.getDate() - diff)
  return dt.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// GET /api/actions/insights/pricing
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
  const { start, end, prevStart, prevEnd } = computeDateRange(
    range,
    fromParam,
    toParam,
    tz
  )

  const days = daysInRange(start, end)
  const useWeeks = days > 30

  // -------------------------------------------------------------------------
  // Fetch completed jobs for current + previous period
  // -------------------------------------------------------------------------
  const { data: allJobs, error: jobsErr } = await supabase
    .from("jobs")
    .select("id, price, hours, date, completed_at, created_at, customer_id, service_type, bedrooms, bathrooms")
    .eq("tenant_id", tenant.id)
    .eq("status", "completed")
    .gte("date", prevStart.slice(0, 10))
    .lte("date", end.slice(0, 10))

  if (jobsErr) {
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 })
  }

  const jobs = allJobs ?? []

  // Split into current and previous period
  const currentJobs = jobs.filter((j) => {
    const d = j.date || j.completed_at || j.created_at
    return d && d >= start.slice(0, 10) && d <= end.slice(0, 10)
  })
  const prevJobs = jobs.filter((j) => {
    const d = j.date || j.completed_at || j.created_at
    return d && d >= prevStart.slice(0, 10) && d <= prevEnd.slice(0, 10)
  })

  // -------------------------------------------------------------------------
  // 1. Avg job price
  // -------------------------------------------------------------------------
  function avgMinMax(jobList: typeof jobs) {
    const prices = jobList.filter((j) => j.price != null).map((j) => j.price as number)
    if (prices.length === 0) return { avg: 0, min: 0, max: 0 }
    const sum = prices.reduce((s, p) => s + p, 0)
    return {
      avg: Math.round((sum / prices.length) * 100) / 100,
      min: Math.min(...prices),
      max: Math.max(...prices),
    }
  }

  const currentStats = avgMinMax(currentJobs)
  const prevStats = avgMinMax(prevJobs)

  const avgJobPrice = {
    current: currentStats.avg,
    previous: prevStats.avg,
    min: currentStats.min,
    max: currentStats.max,
  }

  // -------------------------------------------------------------------------
  // 2. Revenue per labor hour
  // -------------------------------------------------------------------------
  function revenuePerHour(jobList: typeof jobs): number {
    const withHours = jobList.filter(
      (j) => j.price != null && j.hours != null && j.hours > 0
    )
    if (withHours.length === 0) return 0
    const totalRevenue = withHours.reduce((s, j) => s + (j.price ?? 0), 0)
    const totalHours = withHours.reduce((s, j) => s + (j.hours ?? 0), 0)
    if (totalHours === 0) return 0
    return Math.round((totalRevenue / totalHours) * 100) / 100
  }

  const revenuePerHourData = {
    current: revenuePerHour(currentJobs),
    previous: revenuePerHour(prevJobs),
  }

  // -------------------------------------------------------------------------
  // 3. Price trend over time
  // -------------------------------------------------------------------------
  const bucketMap: Record<string, { total: number; count: number }> = {}

  for (const j of currentJobs) {
    if (j.price == null) continue
    const d = j.date || j.completed_at || j.created_at || ""
    const bucket = toBucket(d, useWeeks)
    if (!bucketMap[bucket]) bucketMap[bucket] = { total: 0, count: 0 }
    bucketMap[bucket].total += j.price
    bucketMap[bucket].count++
  }

  const priceTrends = Object.entries(bucketMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, count }]) => ({
      date,
      avgPrice: Math.round((total / count) * 100) / 100,
      jobCount: count,
    }))

  // -------------------------------------------------------------------------
  // 4. Add-on attach rates
  // -------------------------------------------------------------------------
  const { data: upsells } = await supabase
    .from("upsells")
    .select("id, job_id, upsell_type, value")
    .eq("tenant_id", tenant.id)

  const currentJobIds = new Set(currentJobs.map((j) => j.id))
  const currentUpsells = (upsells ?? []).filter((u) => currentJobIds.has(u.job_id))

  // Fetch addon labels
  const { data: addons } = await supabase
    .from("pricing_addons")
    .select("addon_key, label")
    .eq("tenant_id", tenant.id)

  const addonLabels: Record<string, string> = {}
  for (const a of addons ?? []) {
    addonLabels[a.addon_key] = a.label
  }

  // Group upsells by type
  const upsellGrouped: Record<
    string,
    { count: number; revenue: number; jobIds: Set<string> }
  > = {}
  for (const u of currentUpsells) {
    const key = u.upsell_type || "unknown"
    if (!upsellGrouped[key]) {
      upsellGrouped[key] = { count: 0, revenue: 0, jobIds: new Set() }
    }
    upsellGrouped[key].count++
    upsellGrouped[key].revenue += u.value ?? 0
    if (u.job_id) upsellGrouped[key].jobIds.add(u.job_id)
  }

  const totalCompletedCount = currentJobs.length
  const addOnAttachRates = Object.entries(upsellGrouped)
    .map(([key, val]) => ({
      addonKey: key,
      label: addonLabels[key] || key.replace(/_/g, " "),
      timesAttached: val.count,
      revenue: Math.round(val.revenue * 100) / 100,
      attachRate:
        totalCompletedCount > 0
          ? Math.round((val.jobIds.size / totalCompletedCount) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.attachRate - a.attachRate)

  // -------------------------------------------------------------------------
  // 5. Tier utilization
  // -------------------------------------------------------------------------
  const { data: tiers } = await supabase
    .from("pricing_tiers")
    .select("id, service_type, bedrooms, bathrooms, price, price_min, price_max")
    .eq("tenant_id", tenant.id)
    .order("service_type")
    .order("bedrooms")
    .order("bathrooms")

  // Check if jobs have enough info for tier matching
  const jobsHaveTierInfo = currentJobs.some(
    (j) => j.service_type || j.bedrooms != null || j.bathrooms != null
  )

  let tierUtilization: Array<{
    serviceType: string
    bedrooms: number
    bathrooms: number
    tierPrice: number
    avgActualPrice: number
    jobCount: number
  }> = []

  let belowMinimum: Array<{
    jobId: string
    price: number
    tierMinimum: number
    customer: string
    date: string
  }> = []

  if (tiers && tiers.length > 0 && jobsHaveTierInfo) {
    // Tier utilization: match jobs to tiers by service_type + bedrooms + bathrooms
    for (const tier of tiers) {
      const matching = currentJobs.filter(
        (j) =>
          j.service_type === tier.service_type &&
          j.bedrooms === tier.bedrooms &&
          j.bathrooms === tier.bathrooms &&
          j.price != null
      )
      const prices = matching.map((j) => j.price as number)
      const avg =
        prices.length > 0
          ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
          : 0

      tierUtilization.push({
        serviceType: tier.service_type,
        bedrooms: tier.bedrooms,
        bathrooms: tier.bathrooms,
        tierPrice: tier.price,
        avgActualPrice: avg,
        jobCount: matching.length,
      })
    }

    // Filter to only show tiers with jobs
    tierUtilization = tierUtilization.filter((t) => t.jobCount > 0)

    // Below minimum: jobs priced below their tier price
    const belowMinJobs: typeof belowMinimum = []
    const customerIds = new Set<string>()

    for (const j of currentJobs) {
      if (j.price == null || !j.service_type) continue
      const matchingTier = tiers.find(
        (t) =>
          t.service_type === j.service_type &&
          t.bedrooms === (j.bedrooms ?? 0) &&
          t.bathrooms === (j.bathrooms ?? 0)
      )
      if (!matchingTier) continue
      const tierMin = matchingTier.price_min ?? matchingTier.price
      if (j.price < tierMin) {
        if (j.customer_id) customerIds.add(j.customer_id)
        belowMinJobs.push({
          jobId: j.id,
          price: j.price,
          tierMinimum: tierMin,
          customer: j.customer_id || "",
          date: (j.date || j.completed_at || j.created_at || "").slice(0, 10),
        })
      }
    }

    // Resolve customer names
    if (customerIds.size > 0) {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, first_name, last_name")
        .in("id", Array.from(customerIds))

      const nameMap: Record<string, string> = {}
      for (const c of customers ?? []) {
        nameMap[c.id] = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown"
      }

      for (const b of belowMinJobs) {
        b.customer = nameMap[b.customer] || "Unknown"
      }
    }

    belowMinimum = belowMinJobs.slice(0, 20)
  } else if (tiers && tiers.length > 0) {
    // Fallback: match by price range (+-20%)
    for (const tier of tiers) {
      const lo = tier.price * 0.8
      const hi = tier.price * 1.2
      const matching = currentJobs.filter(
        (j) => j.price != null && j.price >= lo && j.price <= hi
      )
      const prices = matching.map((j) => j.price as number)
      const avg =
        prices.length > 0
          ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
          : 0

      tierUtilization.push({
        serviceType: tier.service_type,
        bedrooms: tier.bedrooms,
        bathrooms: tier.bathrooms,
        tierPrice: tier.price,
        avgActualPrice: avg,
        jobCount: matching.length,
      })
    }

    tierUtilization = tierUtilization.filter((t) => t.jobCount > 0)

    // Below minimum fallback: jobs below the lowest tier price for their approximate match
    const lowestPrice = Math.min(...tiers.map((t) => t.price_min ?? t.price))
    const belowJobs = currentJobs.filter(
      (j) => j.price != null && j.price < lowestPrice
    )

    if (belowJobs.length > 0) {
      const customerIds = new Set<string>()
      for (const j of belowJobs) {
        if (j.customer_id) customerIds.add(j.customer_id)
      }

      const nameMap: Record<string, string> = {}
      if (customerIds.size > 0) {
        const { data: customers } = await supabase
          .from("customers")
          .select("id, first_name, last_name")
          .in("id", Array.from(customerIds))

        for (const c of customers ?? []) {
          nameMap[c.id] = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown"
        }
      }

      belowMinimum = belowJobs.slice(0, 20).map((j) => ({
        jobId: j.id,
        price: j.price ?? 0,
        tierMinimum: lowestPrice,
        customer: nameMap[j.customer_id ?? ""] || "Unknown",
        date: (j.date || j.completed_at || j.created_at || "").slice(0, 10),
      }))
    }
  }

  // -------------------------------------------------------------------------
  // 7. Sparklines: daily avg price + daily revenue per hour
  // -------------------------------------------------------------------------
  const dailyPrice: Record<string, { total: number; count: number }> = {}
  const dailyRevHours: Record<string, { revenue: number; hours: number }> = {}

  for (const j of currentJobs) {
    const d = (j.date || j.completed_at || j.created_at || "").slice(0, 10)
    if (!d) continue

    if (j.price != null) {
      if (!dailyPrice[d]) dailyPrice[d] = { total: 0, count: 0 }
      dailyPrice[d].total += j.price
      dailyPrice[d].count++
    }

    if (j.price != null && j.hours != null && j.hours > 0) {
      if (!dailyRevHours[d]) dailyRevHours[d] = { revenue: 0, hours: 0 }
      dailyRevHours[d].revenue += j.price
      dailyRevHours[d].hours += j.hours
    }
  }

  const sortedDays = Object.keys(dailyPrice).sort()
  const avgPriceSparkline = sortedDays.map(
    (d) => (dailyPrice[d] ? Math.round(dailyPrice[d].total / dailyPrice[d].count) : 0)
  )
  const revPerHourSparkline = sortedDays.map(
    (d) =>
      dailyRevHours[d] && dailyRevHours[d].hours > 0
        ? Math.round(dailyRevHours[d].revenue / dailyRevHours[d].hours)
        : 0
  )

  // -------------------------------------------------------------------------
  // Response
  // -------------------------------------------------------------------------
  return NextResponse.json({
    avgJobPrice,
    revenuePerHour: revenuePerHourData,
    priceTrends,
    addOnAttachRates,
    tierUtilization,
    belowMinimum,
    sparklines: {
      avgPrice: avgPriceSparkline,
      revenuePerHour: revPerHourSparkline,
    },
  })
}
