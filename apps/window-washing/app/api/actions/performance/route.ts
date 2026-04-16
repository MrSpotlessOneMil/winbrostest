/**
 * Performance API
 * GET /api/actions/performance
 *
 * Returns team lead, admin team, and sales performance metrics.
 * Query params:
 *   period = day | week | month (default: week)
 *   date   = YYYY-MM-DD anchor date (default: today)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

/* ── Period helpers ──────────────────────────────────────────────────────── */

function getDateRange(period: string, anchor: string): { start: string; end: string } {
  const d = new Date(anchor + "T00:00:00")
  if (period === "day") {
    return { start: anchor, end: anchor }
  }
  if (period === "month") {
    const first = new Date(d.getFullYear(), d.getMonth(), 1)
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    return { start: fmt(first), end: fmt(last) }
  }
  // week (Mon–Sun)
  const day = d.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const mon = new Date(d)
  mon.setDate(d.getDate() + diffToMon)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return { start: fmt(mon), end: fmt(sun) }
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function countUniqueDays(dates: (string | null)[]): number {
  const set = new Set<string>()
  for (const d of dates) {
    if (d) set.add(d.slice(0, 10))
  }
  return set.size
}

/* ── Interfaces ──────────────────────────────────────────────────────────── */

interface TeamLeadRow {
  id: number
  name: string
  revenue: number
  jobs_completed: number
  upsells: number
  days_worked: number
  reviews: number
}

interface AdminTeamRow {
  id: number
  name: string
  area: string
  one_time_revenue: number
  plan_revenue: number
  days_worked: number
}

interface SalesRow {
  id: number
  name: string
  arr_sold: number
  one_time_sales: number
  plan_sales: number
  plans_sold: number
}

/* ── Handler ─────────────────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  const url = new URL(request.url)
  const period = url.searchParams.get("period") ?? "week"
  const dateParam = url.searchParams.get("date") ?? fmt(new Date())
  const { start, end } = getDateRange(period, dateParam)

  // ── Fetch cleaners ──────────────────────────────────────────────────────
  const { data: cleaners } = await client
    .from("cleaners")
    .select("id, name, is_team_lead, employee_type, home_address")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  const cleanerMap = new Map<number, {
    name: string
    is_team_lead: boolean
    employee_type: string | null
    area: string
  }>()
  for (const c of cleaners ?? []) {
    cleanerMap.set(Number(c.id), {
      name: c.name,
      is_team_lead: c.is_team_lead ?? false,
      employee_type: c.employee_type ?? null,
      area: c.home_address ? c.home_address.split(",").slice(-2, -1)[0]?.trim() ?? "" : "",
    })
  }

  // ── Fetch visits in period ──────────────────────────────────────────────
  const { data: visits } = await client
    .from("visits")
    .select("id, status, technicians, payment_amount, visit_date, started_at, stopped_at")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")
    .gte("visit_date", start)
    .lte("visit_date", end)

  // Upsell line items for closed visits in period
  const visitIds = (visits ?? []).map((v) => v.id)
  const upsellMap = new Map<number, number>()
  if (visitIds.length > 0) {
    const { data: lineItems } = await client
      .from("visit_line_items")
      .select("visit_id, price")
      .in("visit_id", visitIds)
      .eq("revenue_type", "technician_upsell")

    for (const li of lineItems ?? []) {
      upsellMap.set(li.visit_id, (upsellMap.get(li.visit_id) ?? 0) + (li.price ?? 0))
    }
  }

  // ── Fetch reviews from crew_performance ──────────────────────────────────
  // crew_performance tracks google_reviews_earned per crew per period
  const reviewCountByLead = new Map<number, number>()
  try {
    const { data: perfRows } = await client
      .from("crew_performance")
      .select("crew_id, google_reviews_earned")
      .eq("brand", "winbros")
      .gte("period_start", start)
      .lte("period_start", end)

    // Map crew_id → total reviews (crew_id is the team lead's cleaner id in practice)
    for (const row of perfRows ?? []) {
      if (row.crew_id && row.google_reviews_earned > 0) {
        const cid = Number(row.crew_id)
        reviewCountByLead.set(cid, (reviewCountByLead.get(cid) ?? 0) + row.google_reviews_earned)
      }
    }
  } catch {
    // crew_performance table may not exist yet — reviews will show 0
  }

  // ── Fetch quotes in period ──────────────────────────────────────────────
  const { data: quotes } = await client
    .from("quotes")
    .select("id, salesman_id, status, total_price, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", start + "T00:00:00")
    .lte("created_at", end + "T23:59:59")

  // ── Fetch service plans sold in period ──────────────────────────────────
  const { data: plans } = await client
    .from("service_plans")
    .select("id, salesman_id, status, plan_price, plan_type, created_at")
    .eq("tenant_id", tenantId)
    .gte("created_at", start + "T00:00:00")
    .lte("created_at", end + "T23:59:59")

  const freqMultiplier = (freq: string | null): number => {
    switch (freq) {
      case "monthly": return 12
      case "bimonthly": return 6
      case "quarterly": return 4
      case "triannual": return 3
      case "biannual":
      case "semiannual": return 2
      case "annual":
      case "yearly": return 1
      default: return 4
    }
  }

  // ── Aggregate per-employee ──────────────────────────────────────────────

  // Tech aggregation (visits)
  const techAgg = new Map<number, {
    revenue: number
    upsell: number
    jobs: number
    visitDates: string[]
  }>()

  for (const v of visits ?? []) {
    const techs = Array.isArray(v.technicians) ? v.technicians : []
    for (const tid of techs) {
      const techId = Number(tid)
      const agg = techAgg.get(techId) ?? { revenue: 0, upsell: 0, jobs: 0, visitDates: [] }
      agg.jobs++
      agg.revenue += v.payment_amount ?? 0
      agg.upsell += upsellMap.get(v.id) ?? 0
      if (v.visit_date) agg.visitDates.push(v.visit_date)
      techAgg.set(techId, agg)
    }
  }

  // Sales aggregation (quotes + plans)
  const salesAgg = new Map<number, {
    one_time_sales: number
    one_time_revenue: number
    plan_sales: number
    plans_sold: number
    arr: number
    quoteDates: string[]
  }>()

  for (const q of quotes ?? []) {
    const sid = q.salesman_id ? Number(q.salesman_id) : null
    if (!sid) continue
    const agg = salesAgg.get(sid) ?? { one_time_sales: 0, one_time_revenue: 0, plan_sales: 0, plans_sold: 0, arr: 0, quoteDates: [] }
    if (q.status === "converted") {
      agg.one_time_sales++
      agg.one_time_revenue += q.total_price ?? 0
    }
    if (q.created_at) agg.quoteDates.push(q.created_at.slice(0, 10))
    salesAgg.set(sid, agg)
  }

  for (const p of plans ?? []) {
    const sid = p.salesman_id ? Number(p.salesman_id) : null
    if (!sid) continue
    const agg = salesAgg.get(sid) ?? { one_time_sales: 0, one_time_revenue: 0, plan_sales: 0, plans_sold: 0, arr: 0, quoteDates: [] }
    agg.plans_sold++
    agg.plan_sales += p.plan_price ?? 0
    agg.arr += (p.plan_price ?? 0) * freqMultiplier(p.plan_type)
    if (p.created_at) agg.quoteDates.push(p.created_at.slice(0, 10))
    salesAgg.set(sid, agg)
  }

  // ── Build 3 sections ───────────────────────────────────────────────────

  // Section 1: Team Leads — employees with is_team_lead = true
  const teamLeads: TeamLeadRow[] = []
  for (const [id, info] of cleanerMap) {
    if (!info.is_team_lead) continue
    const tech = techAgg.get(id)
    teamLeads.push({
      id,
      name: info.name,
      revenue: Math.round(tech?.revenue ?? 0),
      jobs_completed: tech?.jobs ?? 0,
      upsells: Math.round(tech?.upsell ?? 0),
      days_worked: countUniqueDays(tech?.visitDates ?? []),
      reviews: reviewCountByLead.get(id) ?? 0,
    })
  }
  teamLeads.sort((a, b) => b.revenue - a.revenue)

  // Section 2: Admin Team — all employees (technician view)
  const adminTeam: AdminTeamRow[] = []
  for (const [id, info] of cleanerMap) {
    const tech = techAgg.get(id)
    const sale = salesAgg.get(id)
    const daysFromTech = countUniqueDays(tech?.visitDates ?? [])
    const daysFromSales = countUniqueDays(sale?.quoteDates ?? [])
    adminTeam.push({
      id,
      name: info.name,
      area: info.area,
      one_time_revenue: Math.round(tech?.revenue ?? 0),
      plan_revenue: Math.round(sale?.plan_sales ?? 0),
      days_worked: Math.max(daysFromTech, daysFromSales),
    })
  }
  adminTeam.sort((a, b) => (b.one_time_revenue + b.plan_revenue) - (a.one_time_revenue + a.plan_revenue))

  // Section 3: Sales — employees with employee_type = 'salesman'
  const sales: SalesRow[] = []
  for (const [id, info] of cleanerMap) {
    if (info.employee_type !== "salesman") continue
    const sale = salesAgg.get(id)
    if (!sale) {
      sales.push({ id, name: info.name, arr_sold: 0, one_time_sales: 0, plan_sales: 0, plans_sold: 0 })
      continue
    }
    sales.push({
      id,
      name: info.name,
      arr_sold: Math.round(sale.arr),
      one_time_sales: sale.one_time_sales,
      plan_sales: Math.round(sale.plan_sales),
      plans_sold: sale.plans_sold,
    })
  }
  sales.sort((a, b) => b.arr_sold - a.arr_sold)

  return NextResponse.json({
    success: true,
    period,
    start,
    end,
    team_leads: teamLeads,
    admin_team: adminTeam,
    sales,
  })
}
