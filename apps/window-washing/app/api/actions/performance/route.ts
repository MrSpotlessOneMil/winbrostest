/**
 * Performance API
 * GET /api/actions/performance
 *
 * Returns salesman + technician performance metrics for the tenant.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// route-check:no-vercel-cron

interface SalesmanMetric {
  salesman_id: number | null
  salesman_name: string
  total_quotes: number
  converted_quotes: number
  conversion_rate: number
  active_plans: number
  total_arr: number
}

interface TechnicianMetric {
  technician_id: number | null
  technician_name: string
  total_visits_completed: number
  total_revenue: number
  upsell_revenue: number
  avg_minutes_per_job: number | null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  const client = getSupabaseServiceClient()
  const tenantId = authTenant.id

  // ── Salesman Metrics ────────────────────────────────────────────────────
  // Fetch all quotes for this tenant
  const { data: quotes } = await client
    .from("quotes")
    .select("id, salesman_id, status")
    .eq("tenant_id", tenantId)

  // Fetch active service plans
  const { data: plans } = await client
    .from("service_plans")
    .select("id, salesman_id, status, plan_price, frequency")
    .eq("tenant_id", tenantId)

  // Fetch cleaner names for salesman lookup
  const { data: cleaners } = await client
    .from("cleaners")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)

  const cleanerMap = new Map<number, string>()
  for (const c of cleaners ?? []) {
    cleanerMap.set(c.id, c.name)
  }

  // Frequency to annual multiplier
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
      default: return 4 // default quarterly
    }
  }

  // Group salesman metrics
  const salesmanAgg = new Map<number | null, { total: number; converted: number }>()
  for (const q of quotes ?? []) {
    const sid = q.salesman_id ?? null
    const agg = salesmanAgg.get(sid) ?? { total: 0, converted: 0 }
    agg.total++
    if (q.status === "converted") agg.converted++
    salesmanAgg.set(sid, agg)
  }

  // Add plan counts + ARR by salesman
  const planAgg = new Map<number | null, { active: number; arr: number }>()
  for (const p of plans ?? []) {
    if (p.status !== "active") continue
    const sid = p.salesman_id ?? null
    const agg = planAgg.get(sid) ?? { active: 0, arr: 0 }
    agg.active++
    agg.arr += (p.plan_price ?? 0) * freqMultiplier(p.frequency)
    planAgg.set(sid, agg)
  }

  // Merge all salesman IDs
  const allSalesmanIds = new Set<number | null>([...salesmanAgg.keys(), ...planAgg.keys()])

  const salesmanMetrics: SalesmanMetric[] = Array.from(allSalesmanIds).map((sid) => {
    const qa = salesmanAgg.get(sid) ?? { total: 0, converted: 0 }
    const pa = planAgg.get(sid) ?? { active: 0, arr: 0 }
    return {
      salesman_id: sid,
      salesman_name: sid ? (cleanerMap.get(sid) ?? `Salesman #${sid}`) : "Unassigned",
      total_quotes: qa.total,
      converted_quotes: qa.converted,
      conversion_rate: qa.total > 0 ? Math.round((qa.converted / qa.total) * 100) : 0,
      active_plans: pa.active,
      total_arr: Math.round(pa.arr * 100) / 100,
    }
  })

  // Sort by total quotes desc
  salesmanMetrics.sort((a, b) => b.total_quotes - a.total_quotes)

  // ── Technician Metrics ──────────────────────────────────────────────────
  // Fetch closed visits
  const { data: visits } = await client
    .from("visits")
    .select("id, status, technicians, payment_amount, started_at, stopped_at")
    .eq("tenant_id", tenantId)
    .eq("status", "closed")

  // Fetch upsell line items for closed visits
  const visitIds = (visits ?? []).map((v) => v.id)
  let upsellMap = new Map<number, number>()
  if (visitIds.length > 0) {
    const { data: lineItems } = await client
      .from("visit_line_items")
      .select("visit_id, amount")
      .in("visit_id", visitIds)
      .eq("revenue_type", "technician_upsell")

    for (const li of lineItems ?? []) {
      upsellMap.set(li.visit_id, (upsellMap.get(li.visit_id) ?? 0) + (li.amount ?? 0))
    }
  }

  // Group by first technician
  const techAgg = new Map<
    number | null,
    { completed: number; revenue: number; upsell: number; totalMinutes: number; jobsWithTime: number }
  >()

  for (const v of visits ?? []) {
    // technicians is a JSONB array — get first tech
    const techs = Array.isArray(v.technicians) ? v.technicians : []
    const techId: number | null = techs.length > 0 ? Number(techs[0]) : null

    const agg = techAgg.get(techId) ?? { completed: 0, revenue: 0, upsell: 0, totalMinutes: 0, jobsWithTime: 0 }
    agg.completed++
    agg.revenue += v.payment_amount ?? 0
    agg.upsell += upsellMap.get(v.id) ?? 0

    // Calculate time if both timestamps exist
    if (v.started_at && v.stopped_at) {
      const start = new Date(v.started_at).getTime()
      const stop = new Date(v.stopped_at).getTime()
      if (stop > start) {
        agg.totalMinutes += (stop - start) / 60000
        agg.jobsWithTime++
      }
    }

    techAgg.set(techId, agg)
  }

  const technicianMetrics: TechnicianMetric[] = Array.from(techAgg.entries()).map(([tid, agg]) => ({
    technician_id: tid,
    technician_name: tid ? (cleanerMap.get(tid) ?? `Tech #${tid}`) : "Unassigned",
    total_visits_completed: agg.completed,
    total_revenue: Math.round(agg.revenue * 100) / 100,
    upsell_revenue: Math.round(agg.upsell * 100) / 100,
    avg_minutes_per_job: agg.jobsWithTime > 0 ? Math.round(agg.totalMinutes / agg.jobsWithTime) : null,
  }))

  // Sort by visits completed desc
  technicianMetrics.sort((a, b) => b.total_visits_completed - a.total_visits_completed)

  return NextResponse.json({
    success: true,
    salesman: salesmanMetrics,
    technician: technicianMetrics,
  })
}
