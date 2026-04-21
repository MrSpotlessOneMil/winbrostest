import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { getStripeClientForTenant } from "@/lib/stripe-client"
import { computeMrr, computeMrrTrend, type RecurringSeries } from "@/lib/mrr"
import type Stripe from "stripe"

// route-check:no-vercel-cron

interface TopCustomer {
  customerId: string
  name: string
  revenue: number
  jobCount: number
}

interface RevenueInsightsResponse {
  totalRevenue: number
  recurringRevenue: number
  oneTimeRevenue: number
  mrr: number
  arr: number
  recurringJobCount: number
  oneTimeJobCount: number
  totalJobCount: number
  averageJobValue: number
  estimatedProfit: number
  profitMargin: number
  topCustomers: TopCustomer[]
  dailyBreakdown: {
    date: string
    recurring: number
    oneTime: number
  }[]
  monthlyTrend: {
    month: string
    label: string
    revenue: number
    recurring: number
    oneTime: number
  }[]
  /**
   * Active recurring customer count — parent recurring series that are not paused
   * and have a known cadence. Supersedes `recurringJobCount` (sum of in-period
   * jobs) as the real count of paying recurring customers.
   */
  activeRecurringSeries: number
  /** Month-over-month MRR trend for the last 6 months. */
  mrrTrend: {
    month: string
    label: string
    mrr: number
    momGrowth: number | null
  }[]
  month: string
}

function getMonthRange(month: string): { start: string; end: string } {
  const [year, m] = month.split("-").map(Number)
  const startDate = new Date(Date.UTC(year, m - 1, 1))
  const endDate = new Date(Date.UTC(year, m, 0)) // last day of month
  const start = startDate.toISOString().slice(0, 10)
  const end = endDate.toISOString().slice(0, 10)
  return { start, end }
}

function getDaysInMonth(month: string): string[] {
  const { start, end } = getMonthRange(month)
  const days: string[] = []
  const current = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (current <= last) {
    days.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}

function getLast12Months(): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    )
  }
  return months
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json(
      { success: false, error: "No tenant configured" },
      { status: 500 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  // Accept either start/end date range OR month param
  let start: string
  let end: string
  let month: string

  const paramStart = searchParams.get("start")
  const paramEnd = searchParams.get("end")
  const paramMonth = searchParams.get("month")

  if (paramStart) {
    // Date range mode (from insights date picker: 7d, 30d, 90d, YTD, custom)
    start = paramStart
    end = paramEnd || today
    // Cap end at today so future-scheduled jobs don't inflate numbers
    if (end > today) end = today
    month = start.slice(0, 7) // for display label
  } else {
    // Month mode (from month dropdown)
    const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
    month = paramMonth || defaultMonth
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, error: "Invalid month format. Use YYYY-MM." },
        { status: 400 }
      )
    }
    const range = getMonthRange(month)
    start = range.start
    end = range.end
    // Cap at today for current month
    if (end > today) end = today
  }

  const client = await getTenantScopedClient(tenant.id)

  // 1. Get revenue data — try Stripe first (actual money collected), fall back to jobs table
  // This matches the Lead Sources page logic so numbers are consistent
  let jobs: Array<{ id: number; price: number; customer_id: string; completed_at: string | null; date: string | null; status: string }> = []
  let usedStripe = false

  if ((tenant as any).stripe_secret_key) {
    try {
      const stripe = getStripeClientForTenant((tenant as any).stripe_secret_key)
      const startTs = Math.floor(new Date(`${start}T00:00:00.000Z`).getTime() / 1000)
      const endTs = Math.floor(new Date(`${end}T23:59:59.999Z`).getTime() / 1000)

      // Collect all Stripe charges in the date range
      const stripeCharges: Array<{ amount: number; day: string; metaCustomerId: string; stripeCustomerId: string }> = []
      let hasMore = true
      let startingAfter: string | undefined
      while (hasMore) {
        const params: Stripe.ChargeListParams = { limit: 100, created: { gte: startTs, lte: endTs } }
        if (startingAfter) params.starting_after = startingAfter
        const batch = await stripe.charges.list(params)
        const succeeded = batch.data.filter(c => c.status === 'succeeded')
        for (const charge of succeeded) {
          stripeCharges.push({
            amount: charge.amount / 100,
            day: new Date(charge.created * 1000).toISOString().slice(0, 10),
            metaCustomerId: (charge.metadata?.customer_id || charge.metadata?.customerId || '') as string,
            stripeCustomerId: (charge.customer || '') as string,
          })
        }
        hasMore = batch.has_more
        if (batch.data.length > 0) startingAfter = batch.data[batch.data.length - 1].id
        else hasMore = false
      }

      // For charges missing customer_id in metadata, look up by stripe_customer_id in DB
      const missingCustomerIds = stripeCharges.filter(c => !c.metaCustomerId && c.stripeCustomerId)
      if (missingCustomerIds.length > 0) {
        const uniqueStripeIds = [...new Set(missingCustomerIds.map(c => c.stripeCustomerId))]
        // Batch lookup in groups of 50
        const stripeToDbMap = new Map<string, string>()
        for (let i = 0; i < uniqueStripeIds.length; i += 50) {
          const batch = uniqueStripeIds.slice(i, i + 50)
          const { data: customers } = await client
            .from('customers')
            .select('id, stripe_customer_id')
            .in('stripe_customer_id', batch)
          if (customers) {
            for (const c of customers) {
              if (c.stripe_customer_id) stripeToDbMap.set(c.stripe_customer_id, String(c.id))
            }
          }
        }
        // Fill in missing customer_ids
        for (const charge of stripeCharges) {
          if (!charge.metaCustomerId && charge.stripeCustomerId) {
            charge.metaCustomerId = stripeToDbMap.get(charge.stripeCustomerId) || ''
          }
        }
      }

      // Convert to jobs format
      for (const charge of stripeCharges) {
        jobs.push({
          id: 0,
          price: charge.amount,
          customer_id: charge.metaCustomerId,
          completed_at: charge.day,
          date: charge.day,
          status: 'completed',
        })
      }
      usedStripe = true
    } catch (stripeErr) {
      console.error('[Revenue] Stripe query failed, falling back to jobs:', stripeErr)
    }
  }

  // Fallback: use jobs table if Stripe didn't work
  if (!usedStripe) {
    const { data: monthJobs, error: jobsError } = await client
      .from("jobs")
      .select("id, price, customer_id, completed_at, date, status")
      .eq("tenant_id", tenant.id)
      .eq("status", "completed")
      .or(
        `and(completed_at.gte.${start}T00:00:00.000Z,completed_at.lte.${end}T23:59:59.999Z),` +
        `and(date.gte.${start},date.lte.${end})`
      )

    if (jobsError) {
      return NextResponse.json(
        { success: false, error: jobsError.message },
        { status: 500 }
      )
    }
    jobs = (monthJobs || []) as typeof jobs
  }

  // 2. Get unique customer IDs from this month's jobs
  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))]

  // 3. For each customer, count their total completed jobs ever to determine recurring status
  const recurringCustomerIds = new Set<string>()

  if (customerIds.length > 0) {
    for (let i = 0; i < customerIds.length; i += 50) {
      const batch = customerIds.slice(i, i + 50)
      const { data: customerJobs } = await client
        .from("jobs")
        .select("customer_id")
        .eq("status", "completed")
        .eq("tenant_id", tenant.id)
        .in("customer_id", batch)

      if (customerJobs) {
        const counts = new Map<string, number>()
        for (const j of customerJobs) {
          if (j.customer_id) {
            counts.set(j.customer_id, (counts.get(j.customer_id) || 0) + 1)
          }
        }
        for (const [cid, count] of counts) {
          if (count >= 2) {
            recurringCustomerIds.add(cid)
          }
        }
      }
    }
  }

  // 4. Get customer names for top customers
  const customerNameMap = new Map<string, string>()
  if (customerIds.length > 0) {
    for (let i = 0; i < customerIds.length; i += 50) {
      const batch = customerIds.slice(i, i + 50)
      const { data: customers } = await client
        .from("customers")
        .select("id, first_name, last_name")
        .in("id", batch)

      if (customers) {
        for (const c of customers) {
          const name =
            [c.first_name, c.last_name].filter(Boolean).join(" ") ||
            "Unknown"
          customerNameMap.set(c.id, name)
        }
      }
    }
  }

  // 5. Split jobs into recurring vs one-time, compute totals
  let recurringRevenue = 0
  let oneTimeRevenue = 0
  let recurringJobCount = 0
  let oneTimeJobCount = 0
  // No cleaner_pay column exists — profit estimated at ~50% margin (house cleaning industry standard)

  // Per-customer revenue tracking for top customers
  const customerRevenue = new Map<string, { revenue: number; jobCount: number }>()

  // Daily breakdown — use actual start/end range, not month
  const days: string[] = []
  const current = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (current <= last) {
    days.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  const dailyRecurring = new Map<string, number>()
  const dailyOneTime = new Map<string, number>()
  for (const day of days) {
    dailyRecurring.set(day, 0)
    dailyOneTime.set(day, 0)
  }

  for (const job of jobs) {
    const price = Number(job.price || 0)
    const completionDay = job.completed_at
      ? new Date(job.completed_at).toISOString().slice(0, 10)
      : String(job.date || "")
    const isRecurring = job.customer_id && recurringCustomerIds.has(job.customer_id)

    // Track per-customer revenue
    if (job.customer_id) {
      const existing = customerRevenue.get(job.customer_id) || {
        revenue: 0,
        jobCount: 0,
      }
      existing.revenue += price
      existing.jobCount += 1
      customerRevenue.set(job.customer_id, existing)
    }

    if (isRecurring) {
      recurringRevenue += price
      recurringJobCount++
      dailyRecurring.set(
        completionDay,
        (dailyRecurring.get(completionDay) || 0) + price
      )
    } else {
      oneTimeRevenue += price
      oneTimeJobCount++
      dailyOneTime.set(
        completionDay,
        (dailyOneTime.get(completionDay) || 0) + price
      )
    }
  }

  const totalRevenue = recurringRevenue + oneTimeRevenue
  const totalJobCount = recurringJobCount + oneTimeJobCount

  // -----------------------------------------------------------------------
  // Canonical MRR: sum of (price × cadence factor) across active recurring
  // parent series. Supersedes the old mrr=recurringRevenue heuristic.
  // -----------------------------------------------------------------------
  // NOTE: We intentionally do NOT filter on parent_job_id here. The extend-
  // recurring-jobs cron materializes each future occurrence as its own row,
  // and historically many rows were imported with parent_job_id=NULL per
  // occurrence. computeMrr dedupes by customer_id so one customer counts once
  // at price × cadence factor regardless of how many occurrences exist.
  const { data: allParentSeriesRaw } = await client
    .from("jobs")
    .select("id, customer_id, price, frequency, created_at, paused_at")
    .eq("tenant_id", tenant.id)
    .neq("frequency", "one-time")
    .not("frequency", "is", null)
    .not("price", "is", null)

  const allParentSeries: RecurringSeries[] = (allParentSeriesRaw ?? []).map((s) => ({
    id: s.id,
    customer_id: s.customer_id,
    price: s.price,
    frequency: s.frequency,
    created_at: s.created_at,
    paused_at: s.paused_at,
  }))

  const { mrr, activeCount: activeRecurringSeries } = computeMrr(allParentSeries)

  const arr = mrr * 12
  const averageJobValue = totalJobCount > 0 ? Math.round(totalRevenue / totalJobCount) : 0

  // Profit estimated at ~50% margin (house cleaning industry standard)
  const estimatedProfit = Math.round(totalRevenue * 0.5)
  const profitMargin =
    totalRevenue > 0
      ? Math.round((estimatedProfit / totalRevenue) * 100)
      : 0

  // Top 5 customers by revenue
  const topCustomers: TopCustomer[] = [...customerRevenue.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 5)
    .map(([cid, data]) => ({
      customerId: cid,
      name: customerNameMap.get(cid) || "Unknown",
      revenue: data.revenue,
      jobCount: data.jobCount,
    }))

  const dailyBreakdown = days.map((day) => ({
    date: day,
    recurring: dailyRecurring.get(day) || 0,
    oneTime: dailyOneTime.get(day) || 0,
  }))

  // 6. Monthly trend (last 12 months)
  const last12 = getLast12Months()
  const monthlyTrend: RevenueInsightsResponse["monthlyTrend"] = []

  // Fetch all completed jobs in the last 12 months range
  const oldestMonth = last12[last12.length - 1]
  const { start: trendStart } = getMonthRange(oldestMonth)
  const { end: trendEnd } = getMonthRange(last12[0])

  const { data: trendJobs } = await client
    .from("jobs")
    .select("id, price, customer_id, completed_at, date, status")
    .eq("tenant_id", tenant.id)
    .in("status", ["completed", "scheduled", "in_progress"])
    .or(
      `and(completed_at.gte.${trendStart}T00:00:00.000Z,completed_at.lte.${trendEnd}T23:59:59.999Z),` +
      `and(date.gte.${trendStart},date.lte.${trendEnd})`
    )

  // Bucket trend jobs into months
  const monthBuckets = new Map<string, { revenue: number; recurring: number; oneTime: number }>()
  for (const m of last12) {
    monthBuckets.set(m, { revenue: 0, recurring: 0, oneTime: 0 })
  }

  if (trendJobs) {
    for (const job of trendJobs) {
      const price = Number(job.price || 0)
      const jobDate = job.completed_at
        ? new Date(job.completed_at).toISOString().slice(0, 7)
        : String(job.date || "").slice(0, 7)

      if (monthBuckets.has(jobDate)) {
        const bucket = monthBuckets.get(jobDate)!
        bucket.revenue += price
        const isRecurring =
          job.customer_id && recurringCustomerIds.has(job.customer_id)
        if (isRecurring) {
          bucket.recurring += price
        } else {
          bucket.oneTime += price
        }
      }
    }
  }

  for (const m of [...last12].reverse()) {
    const bucket = monthBuckets.get(m) || { revenue: 0, recurring: 0, oneTime: 0 }
    const [y, mo] = m.split("-").map(Number)
    const d = new Date(y, mo - 1, 1)
    monthlyTrend.push({
      month: m,
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      revenue: Math.round(bucket.revenue),
      recurring: Math.round(bucket.recurring),
      oneTime: Math.round(bucket.oneTime),
    })
  }

  // -----------------------------------------------------------------------
  // 6-month MRR trend: reuse the same parent-series fetch above.
  // -----------------------------------------------------------------------
  const mrrTrend = computeMrrTrend(allParentSeries, 6)

  const response: RevenueInsightsResponse = {
    totalRevenue,
    recurringRevenue,
    oneTimeRevenue,
    mrr,
    arr,
    recurringJobCount,
    oneTimeJobCount,
    totalJobCount,
    averageJobValue,
    estimatedProfit,
    profitMargin,
    topCustomers,
    dailyBreakdown,
    monthlyTrend,
    activeRecurringSeries,
    mrrTrend,
    month,
  }

  return NextResponse.json({ success: true, data: response })
}
