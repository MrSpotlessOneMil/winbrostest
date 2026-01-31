import { NextRequest, NextResponse } from "next/server"
import type { DailyMetrics, ApiResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfDayUTC(dateIso: string): string {
  return `${dateIso}T00:00:00.000Z`
}

function endOfDayUTC(dateIso: string): string {
  return `${dateIso}T23:59:59.999Z`
}

function dailyTargetPerCrew(): number {
  const raw = process.env.DAILY_TARGET_PER_CREW || process.env.DAILY_TARGET || process.env.BOOKING_DAILY_TARGET
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : 1200
}

function safePct(numerator: number, denominator: number): number {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 100)
}

type DbJob = { date: string | null; status: string | null; price: number | null }
type DbLead = { created_at: string; status: string | null }
type DbCall = { created_at: string | null; date: string | null; started_at: string | null }

function pickTimestamp(row: DbCall): string | null {
  return (row.date || row.started_at || row.created_at) ? String(row.date || row.started_at || row.created_at) : null
}

function bucketIso(ts: string): string {
  // Bucket by UTC day
  return new Date(ts).toISOString().slice(0, 10)
}

function computeDayMetrics(params: {
  day: string
  activeCrews: number
  jobs: DbJob[]
  leads: DbLead[]
  calls: DbCall[]
}): DailyMetrics {
  const { day, activeCrews, jobs, leads, calls } = params

  const jobsForDay = jobs.filter((j) => String(j.date || "") === day)
  const completedJobs = jobsForDay.filter((j) => String(j.status || "") === "completed")
  const scheduledJobs = jobsForDay.filter((j) => {
    const s = String(j.status || "")
    return s === "scheduled" || s === "in_progress" || s === "completed"
  })
  const totalRevenue = completedJobs.reduce((sum, j) => sum + (j.price != null ? Number(j.price) : 0), 0)

  const leadsForDay = leads.filter((l) => bucketIso(l.created_at) === day)
  const leadsIn = leadsForDay.length
  const leadsBooked = leadsForDay.filter((l) => String(l.status || "").toLowerCase() === "booked").length

  const callsForDay = calls.filter((c) => {
    const ts = pickTimestamp(c)
    return ts ? bucketIso(ts) === day : false
  })

  return {
    date: day,
    total_revenue: totalRevenue,
    target_revenue: activeCrews * dailyTargetPerCrew(),
    jobs_completed: completedJobs.length,
    jobs_scheduled: scheduledJobs.length,
    leads_in: leadsIn,
    leads_booked: leadsBooked,
    close_rate: safePct(leadsBooked, leadsIn),
    tips_collected: 0,
    upsells_value: 0,
    calls_handled: callsForDay.length,
    after_hours_calls: 0,
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const searchParams = request.nextUrl.searchParams
  const range = searchParams.get("range") || "today"
  const date = searchParams.get("date")

  let responseData: DailyMetrics | DailyMetrics[]

  const client = getSupabaseServiceClient()
  const baseDate = date ? new Date(`${date}T00:00:00Z`) : new Date()

  const cleanersRes = await client.from("cleaners").select("id").eq("tenant_id", tenant.id).eq("active", true)
  const activeCrews = cleanersRes.data ? cleanersRes.data.length : 0

  let startDate: string
  let endDate: string
  if (range === "week") {
    startDate = isoDate(addDays(baseDate, -6))
    endDate = isoDate(baseDate)
  } else if (range === "specific" && date) {
    startDate = date
    endDate = date
  } else {
    const today = isoDate(baseDate)
    startDate = today
    endDate = today
  }

  const jobsRes = await client
    .from("jobs")
    .select("date,status,price")
    .eq("tenant_id", tenant.id)
    .gte("date", startDate)
    .lte("date", endDate)
    .neq("status", "cancelled")

  const leadsRes = await client
    .from("leads")
    .select("created_at,status")
    .eq("tenant_id", tenant.id)
    .gte("created_at", startOfDayUTC(startDate))
    .lte("created_at", endOfDayUTC(endDate))

  const callsRes = await client
    .from("calls")
    .select("created_at,date,started_at")
    .eq("tenant_id", tenant.id)
    .gte("created_at", startOfDayUTC(startDate))
    .lte("created_at", endOfDayUTC(endDate))

  const jobs: DbJob[] = (jobsRes.data || []) as any
  const leads: DbLead[] = (leadsRes.data || []) as any
  const calls: DbCall[] = (callsRes.data || []) as any

  if (range === "week") {
    const days: string[] = []
    for (let i = 0; i < 7; i++) days.push(isoDate(addDays(baseDate, i - 6)))
    responseData = days.map((day) => computeDayMetrics({ day, activeCrews, jobs, leads, calls }))
  } else {
    const day = range === "specific" && date ? date : isoDate(baseDate)
    responseData = computeDayMetrics({ day, activeCrews, jobs, leads, calls })
  }

  const response: ApiResponse<typeof responseData> = {
    success: true,
    data: responseData,
  }

  return NextResponse.json(response)
}
