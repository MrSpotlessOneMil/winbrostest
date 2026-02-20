import { NextRequest, NextResponse } from "next/server"
import type { Team, TeamDailyMetrics, ApiResponse } from "@/lib/types"
import { getSupabaseServiceClient, getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyTarget(): number {
  const raw = process.env.DAILY_TARGET_PER_CREW || process.env.DAILY_TARGET || process.env.BOOKING_DAILY_TARGET
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : 1200
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const searchParams = request.nextUrl.searchParams
  const include_metrics = searchParams.get("include_metrics") === "true"


  // Get tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json(
      {
        success: false,
        error: "No tenant configured. Please set up your tenant first.",
      } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }

  const client = tenant ? await getTenantScopedClient(tenant.id) : getSupabaseServiceClient()
  const date = searchParams.get("date") || todayISO()

  // Load teams and their members (cleaners) including location fields
  let teamsQuery = client
    .from("teams")
    .select("id,name,active,created_at,team_members ( id, role, is_active, cleaners ( id, name, phone, telegram_id, telegram_username, active, is_team_lead, last_location_lat, last_location_lng, last_location_accuracy_meters, last_location_updated_at ) )")
    .eq("active", true)
    .order("created_at", { ascending: true })
  if (tenant) teamsQuery = teamsQuery.eq("tenant_id", tenant.id)
  const teamsRes = await teamsQuery

  if (teamsRes.error) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to load teams: ${teamsRes.error.message}`,
      } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }

  // Preload jobs for the date to derive status + metrics
  let jobsQuery = client
    .from("jobs")
    .select("id, date, status, price, team_id")
    .eq("date", date)
    .neq("status", "cancelled")
  if (tenant) jobsQuery = jobsQuery.eq("tenant_id", tenant.id)
  const jobsRes = await jobsQuery

  const jobsByTeam = new Map<number, any[]>()
  for (const j of jobsRes.data || []) {
    const teamId = j.team_id != null ? Number(j.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    const arr = jobsByTeam.get(teamId) || []
    arr.push(j)
    jobsByTeam.set(teamId, arr)
  }

  // Collect all cleaner IDs that belong to a team
  const assignedCleanerIds = new Set<number>()

  const teamsBase: Team[] = (teamsRes.data || []).map((t: any) => {
    const teamId = String(t.id)
    const rawMembers = Array.isArray(t.team_members) ? t.team_members : []
    const members = rawMembers
      .filter((tm: any) => Boolean(tm.is_active)) // Only active memberships
      .map((tm: any) => {
        const c = tm.cleaners
        if (!c || !c.active) return null
        assignedCleanerIds.add(Number(c.id))
        return {
          id: String(c.id),
          name: String(c.name || "Cleaner"),
          phone: String(c.phone || ""),
          telegram_id: c.telegram_id || undefined,
          role: tm.role === "lead" ? "lead" : "technician",
          team_id: teamId,
          is_active: true,
          last_location_lat: c.last_location_lat ?? null,
          last_location_lng: c.last_location_lng ?? null,
          last_location_accuracy_meters: c.last_location_accuracy_meters ?? null,
          last_location_updated_at: c.last_location_updated_at ?? null,
        } as any
      })
      .filter(Boolean)

    const lead = members.find((m: any) => m.role === "lead") || members[0]
    const leadId = lead?.id ? String(lead.id) : teamId

    const teamJobs = jobsByTeam.get(Number(t.id)) || []
    const hasInProgress = teamJobs.some((j) => String(j.status) === "in_progress")
    const hasScheduled = teamJobs.some((j) => String(j.status) === "scheduled")

    let status: Team["status"] = "available"
    if (hasInProgress) status = "on-job"
    else if (hasScheduled) status = "traveling"

    const currentJob = teamJobs.find((j) => String(j.status) === "in_progress") || teamJobs.find((j) => String(j.status) === "scheduled")

    return {
      id: teamId,
      name: String(t.name || `Team ${teamId}`),
      lead_id: leadId,
      members,
      status,
      current_job_id: currentJob?.id != null ? String(currentJob.id) : undefined,
      daily_target: dailyTarget(),
      is_active: Boolean(t.active),
    }
  })

  // Load unassigned cleaners (active cleaners not in any team)
  let unassignedQuery = client
    .from("cleaners")
    .select("id, name, phone, telegram_id, telegram_username, active, is_team_lead, last_location_lat, last_location_lng, last_location_accuracy_meters, last_location_updated_at")
    .eq("active", true)
    .is("deleted_at", null)
    .order("name")
  if (tenant) unassignedQuery = unassignedQuery.eq("tenant_id", tenant.id)
  const unassignedRes = await unassignedQuery

  if (unassignedRes.error) {
    console.error(`[Teams API] Failed to load unassigned cleaners:`, unassignedRes.error.message)
  }

  const allCleaners = unassignedRes.data || []
  const unassignedCleaners = allCleaners
    .filter((c: any) => !assignedCleanerIds.has(Number(c.id)))
    .map((c: any) => ({
      id: String(c.id),
      name: String(c.name || "Cleaner"),
      phone: String(c.phone || ""),
      telegram_id: c.telegram_id || undefined,
      role: c.is_team_lead ? "lead" : "technician",
      team_id: null,
      is_active: Boolean(c.active),
      last_location_lat: c.last_location_lat ?? null,
      last_location_lng: c.last_location_lng ?? null,
      last_location_accuracy_meters: c.last_location_accuracy_meters ?? null,
      last_location_updated_at: c.last_location_updated_at ?? null,
    }))

  console.log(`[Teams API] tenant=${tenant?.slug || 'admin'} teams=${teamsBase.length} assigned=${assignedCleanerIds.size} allCleaners=${allCleaners.length} unassigned=${unassignedCleaners.length}`)

  let teamsWithMetrics: any[] = teamsBase
  if (include_metrics) {
    teamsWithMetrics = teamsBase.map((team) => {
      const teamJobs = jobsByTeam.get(Number(team.id)) || []
      const completed = teamJobs.filter((j) => String(j.status) === "completed")
      const scheduled = teamJobs.filter((j) => String(j.status) === "scheduled" || String(j.status) === "in_progress")
      const revenue = completed.reduce((sum, j) => sum + (j.price != null ? Number(j.price) : 0), 0)

      const daily_metrics: TeamDailyMetrics = {
        team_id: team.id,
        date,
        revenue,
        target: dailyTarget(),
        jobs_completed: completed.length,
        jobs_scheduled: scheduled.length,
        tips: 0,
        upsells: 0,
      }

      return { ...team, daily_metrics }
    })
  }

  return NextResponse.json({ success: true, data: teamsWithMetrics, unassigned_cleaners: unassignedCleaners })
}
