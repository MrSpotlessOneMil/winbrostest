import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

// route-check:no-vercel-cron

interface RevenueInsightsResponse {
  totalRevenue: number
  recurringRevenue: number
  oneTimeRevenue: number
  mrr: number
  arr: number
  recurringJobCount: number
  oneTimeJobCount: number
  totalJobCount: number
  dailyBreakdown: {
    date: string
    recurring: number
    oneTime: number
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
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  const month = searchParams.get("month") || defaultMonth

  // Validate month format
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { success: false, error: "Invalid month format. Use YYYY-MM." },
      { status: 400 }
    )
  }

  const { start, end } = getMonthRange(month)
  const client = await getTenantScopedClient(tenant.id)

  // 1. Get all completed jobs in the month
  const { data: monthJobs, error: jobsError } = await client
    .from("jobs")
    .select("id, price, customer_id, completed_at, date, status")
    .eq("status", "completed")
    .eq("tenant_id", tenant.id)
    .or(
      `and(completed_at.gte.${start}T00:00:00.000Z,completed_at.lte.${end}T23:59:59.999Z),` +
      `and(date.gte.${start},date.lte.${end},completed_at.is.null)`
    )

  if (jobsError) {
    return NextResponse.json(
      { success: false, error: jobsError.message },
      { status: 500 }
    )
  }

  const jobs = monthJobs || []

  // 2. Get unique customer IDs from this month's jobs
  const customerIds = [...new Set(jobs.map((j) => j.customer_id).filter(Boolean))]

  // 3. For each customer, count their total completed jobs ever to determine recurring status
  const recurringCustomerIds = new Set<string>()

  if (customerIds.length > 0) {
    // Batch query: count completed jobs per customer (all time)
    // Supabase doesn't support GROUP BY in the JS client easily,
    // so we fetch completed job counts per customer
    for (let i = 0; i < customerIds.length; i += 50) {
      const batch = customerIds.slice(i, i + 50)
      const { data: customerJobs } = await client
        .from("jobs")
        .select("customer_id")
        .eq("status", "completed")
        .eq("tenant_id", tenant.id)
        .in("customer_id", batch)

      if (customerJobs) {
        // Count jobs per customer
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

  // 4. Split jobs into recurring vs one-time
  let recurringRevenue = 0
  let oneTimeRevenue = 0
  let recurringJobCount = 0
  let oneTimeJobCount = 0

  // Daily breakdown
  const days = getDaysInMonth(month)
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

    if (isRecurring) {
      recurringRevenue += price
      recurringJobCount++
      dailyRecurring.set(completionDay, (dailyRecurring.get(completionDay) || 0) + price)
    } else {
      oneTimeRevenue += price
      oneTimeJobCount++
      dailyOneTime.set(completionDay, (dailyOneTime.get(completionDay) || 0) + price)
    }
  }

  const totalRevenue = recurringRevenue + oneTimeRevenue
  const mrr = recurringRevenue
  const arr = mrr * 12

  const dailyBreakdown = days.map((day) => ({
    date: day,
    recurring: dailyRecurring.get(day) || 0,
    oneTime: dailyOneTime.get(day) || 0,
  }))

  const response: RevenueInsightsResponse = {
    totalRevenue,
    recurringRevenue,
    oneTimeRevenue,
    mrr,
    arr,
    recurringJobCount,
    oneTimeJobCount,
    totalJobCount: recurringJobCount + oneTimeJobCount,
    dailyBreakdown,
    month,
  }

  return NextResponse.json({ success: true, data: response })
}
