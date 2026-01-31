import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const searchParams = request.nextUrl.searchParams
  const range = searchParams.get("range") || "month"

  const client = getSupabaseServiceClient()

  const now = new Date()
  const start = new Date(now)
  if (range === "week") start.setDate(now.getDate() - 6)
  else if (range === "quarter") start.setDate(now.getDate() - 89)
  else if (range === "year") start.setDate(now.getDate() - 364)
  else start.setDate(now.getDate() - 29)

  const startIso = start.toISOString()

  const [tipsRes, upsellsRes, jobsRes, teamsRes] = await Promise.all([
    client.from("tips").select("amount,team_id,created_at").eq("tenant_id", tenant.id).gte("created_at", startIso),
    client.from("upsells").select("value,team_id,created_at").eq("tenant_id", tenant.id).gte("created_at", startIso),
    client.from("jobs").select("id,team_id,status,created_at").eq("tenant_id", tenant.id).gte("created_at", startIso),
    client.from("teams").select("id,name").eq("tenant_id", tenant.id).eq("active", true),
  ])

  if (tipsRes.error) return NextResponse.json({ success: false, error: tipsRes.error.message }, { status: 500 })
  if (upsellsRes.error) return NextResponse.json({ success: false, error: upsellsRes.error.message }, { status: 500 })
  if (jobsRes.error) return NextResponse.json({ success: false, error: jobsRes.error.message }, { status: 500 })

  const teamName = new Map<number, string>()
  for (const t of teamsRes.data || []) teamName.set(Number((t as any).id), String((t as any).name))

  function ensure(teamId: number) {
    if (!agg.has(teamId)) {
      agg.set(teamId, { teamId, team: teamName.get(teamId) || `Team ${teamId}`, tips: 0, upsells: 0, jobs: 0 })
    }
    return agg.get(teamId)!
  }

  const agg = new Map<number, { teamId: number; team: string; tips: number; upsells: number; jobs: number }>()

  for (const t of tipsRes.data as any[]) {
    const teamId = t.team_id != null ? Number(t.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    ensure(teamId).tips += Number(t.amount || 0)
  }
  for (const u of upsellsRes.data as any[]) {
    const teamId = u.team_id != null ? Number(u.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    ensure(teamId).upsells += Number(u.value || 0)
  }
  for (const j of jobsRes.data as any[]) {
    const teamId = j.team_id != null ? Number(j.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    ensure(teamId).jobs += 1
  }

  const rows = Array.from(agg.values())

  function topBy(key: "tips" | "upsells" | "jobs") {
    return rows
      .slice()
      .sort((a, b) => (b[key] as number) - (a[key] as number))
      .slice(0, 10)
      .map((r, idx) => ({
        rank: idx + 1,
        name: r.team,
        team: r.team,
        value: key === "jobs" ? r.jobs : key === "tips" ? Math.round(r.tips) : Math.round(r.upsells),
        change: "—",
      }))
  }

  return NextResponse.json({
    success: true,
    data: {
      range,
      tips: topBy("tips"),
      upsells: topBy("upsells"),
      jobs: topBy("jobs"),
      reviews: [], // placeholder until review table exists
    },
  })
}
