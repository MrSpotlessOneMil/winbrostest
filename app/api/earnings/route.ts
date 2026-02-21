import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const searchParams = request.nextUrl.searchParams
  const range = searchParams.get("range") || "week"

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  // simple ranges
  const today = new Date()
  const start = new Date(today)
  if (range === "today") {
    // same day
  } else if (range === "month") {
    start.setDate(today.getDate() - 29)
  } else {
    start.setDate(today.getDate() - 6)
  }

  const startIso = start.toISOString()

  let tipsQuery = client.from("tips").select("id,amount,team_id,cleaner_id,created_at,job_id").gte("created_at", startIso)
  let upsellsQuery = client.from("upsells").select("id,value,upsell_type,team_id,cleaner_id,created_at,job_id").gte("created_at", startIso)
  let teamsQuery = client.from("teams").select("id,name").eq("active", true)
  if (tenant) {
    tipsQuery = tipsQuery.eq("tenant_id", tenant.id)
    upsellsQuery = upsellsQuery.eq("tenant_id", tenant.id)
    teamsQuery = teamsQuery.eq("tenant_id", tenant.id)
  }

  const [tipsRes, upsellsRes, teamsRes] = await Promise.all([tipsQuery, upsellsQuery, teamsQuery])

  if (tipsRes.error) return NextResponse.json({ success: false, error: tipsRes.error.message }, { status: 500 })
  if (upsellsRes.error) return NextResponse.json({ success: false, error: upsellsRes.error.message }, { status: 500 })

  const teams = new Map<number, string>()
  for (const t of teamsRes.data || []) teams.set(Number((t as any).id), String((t as any).name))

  const tips = tipsRes.data || []
  const upsells = upsellsRes.data || []

  const totalTips = tips.reduce((sum, t: any) => sum + Number(t.amount || 0), 0)
  const totalUpsells = upsells.reduce((sum, u: any) => sum + Number(u.value || 0), 0)

  // team breakdown
  const breakdownMap = new Map<number, { team: string; tips: number; upsells: number; jobs: number }>()
  for (const t of teamsRes.data || []) {
    const id = Number((t as any).id)
    breakdownMap.set(id, { team: teams.get(id) || `Team ${id}`, tips: 0, upsells: 0, jobs: 0 })
  }
  for (const t of tips as any[]) {
    const teamId = t.team_id != null ? Number(t.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    const row = breakdownMap.get(teamId) || { team: teams.get(teamId) || `Team ${teamId}`, tips: 0, upsells: 0, jobs: 0 }
    row.tips += Number(t.amount || 0)
    if (t.job_id != null) row.jobs += 1
    breakdownMap.set(teamId, row)
  }
  for (const u of upsells as any[]) {
    const teamId = u.team_id != null ? Number(u.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    const row = breakdownMap.get(teamId) || { team: teams.get(teamId) || `Team ${teamId}`, tips: 0, upsells: 0, jobs: 0 }
    row.upsells += Number(u.value || 0)
    if (u.job_id != null) row.jobs += 1
    breakdownMap.set(teamId, row)
  }

  const teamBreakdown = Array.from(breakdownMap.values())
    .filter((t) => t.tips > 0 || t.upsells > 0 || t.jobs > 0)
    .sort((a, b) => (b.tips + b.upsells) - (a.tips + a.upsells))

  const recentTips = (tips as any[])
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 25)

  const recentUpsells = (upsells as any[])
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 25)

  return NextResponse.json({
    success: true,
    data: {
      range,
      totalTips,
      totalUpsells,
      teamBreakdown,
      recentTips,
      recentUpsells,
    },
  })
}
