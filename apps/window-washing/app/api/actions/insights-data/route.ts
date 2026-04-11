import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuthWithTenant } from "@/lib/auth"

/**
 * GET /api/actions/insights-data
 *
 * Returns cleaner performance + message analytics for the Insights page.
 * Auth: requireAuthWithTenant (dashboard action)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = getSupabaseServiceClient()

  // --- Cleaner Performance ---
  const { data: cleaners } = await client
    .from("cleaners")
    .select("id, name, active")
    .eq("tenant_id", tenant.id)
    .eq("active", true)

  const cleanerPerformance: Array<{
    id: string
    name: string
    jobsCompleted: number
    revenue: number
  }> = []

  if (cleaners && cleaners.length > 0) {
    // Get completed jobs with cleaner_id in last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: jobs } = await client
      .from("jobs")
      .select("cleaner_id, price, status")
      .eq("tenant_id", tenant.id)
      .eq("status", "completed")
      .gte("date", ninetyDaysAgo)
      .not("cleaner_id", "is", null)

    const jobsByCleanerId: Record<string, { count: number; revenue: number }> = {}
    for (const job of (jobs || [])) {
      const cid = String(job.cleaner_id)
      if (!jobsByCleanerId[cid]) jobsByCleanerId[cid] = { count: 0, revenue: 0 }
      jobsByCleanerId[cid].count++
      jobsByCleanerId[cid].revenue += Number(job.price || 0)
    }

    for (const c of cleaners) {
      const stats = jobsByCleanerId[c.id] || { count: 0, revenue: 0 }
      cleanerPerformance.push({
        id: c.id,
        name: c.name || "Unknown",
        jobsCompleted: stats.count,
        revenue: Math.round(stats.revenue),
      })
    }

    // Sort by jobs completed desc
    cleanerPerformance.sort((a, b) => b.jobsCompleted - a.jobsCompleted)
  }

  // --- Message Analytics ---
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Total messages in/out last 30 days
  const { count: totalInbound } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("direction", "inbound")
    .gte("timestamp", thirtyDaysAgo)

  const { count: totalOutbound } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("direction", "outbound")
    .gte("timestamp", thirtyDaysAgo)

  // AI vs manual outbound
  const { count: aiMessages } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .eq("direction", "outbound")
    .eq("ai_generated", true)
    .gte("timestamp", thirtyDaysAgo)

  // Unique conversations (distinct phone numbers with messages)
  const { data: uniquePhones } = await client
    .from("messages")
    .select("phone_number")
    .eq("tenant_id", tenant.id)
    .gte("timestamp", thirtyDaysAgo)

  const uniqueConversations = new Set((uniquePhones || []).map((m: any) => m.phone_number)).size

  // Lead source breakdown (last 30 days)
  const { data: recentLeads } = await client
    .from("leads")
    .select("source, status")
    .eq("tenant_id", tenant.id)
    .gte("created_at", thirtyDaysAgo)

  const leadsBySource: Record<string, { total: number; booked: number }> = {}
  for (const lead of (recentLeads || [])) {
    const src = lead.source || "unknown"
    if (!leadsBySource[src]) leadsBySource[src] = { total: 0, booked: 0 }
    leadsBySource[src].total++
    if (lead.status === "booked") leadsBySource[src].booked++
  }

  return NextResponse.json({
    success: true,
    cleanerPerformance,
    messageAnalytics: {
      totalInbound: totalInbound || 0,
      totalOutbound: totalOutbound || 0,
      aiMessages: aiMessages || 0,
      manualMessages: (totalOutbound || 0) - (aiMessages || 0),
      uniqueConversations,
      period: "30d",
    },
    leadsBySource,
  })
}
