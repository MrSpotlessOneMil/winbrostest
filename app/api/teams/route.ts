import { NextRequest, NextResponse } from "next/server"
import type { Team, TeamDailyMetrics, ApiResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
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

  // If the server is accidentally running with the anon key (no service role),
  // RLS will block reads after a schema reset. Fail loudly with a clear message.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Server Supabase service role key is missing. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and restart `npm run dev`.",
      } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }

  // Get the default tenant (winbros) for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json(
      {
        success: false,
        error: "No tenant configured. Please set up the winbros tenant first.",
      } satisfies ApiResponse<never>,
      { status: 500 }
    )
  }

  const client = getSupabaseServiceClient()
  const date = searchParams.get("date") || todayISO()

  // Load teams and their members (cleaners) including location fields
  const teamsRes = await client
    .from("teams")
    .select("id,name,active,created_at,team_members ( id, role, is_active, cleaners ( id, name, phone, telegram_id, telegram_username, active, is_team_lead, last_location_lat, last_location_lng, last_location_accuracy_meters, last_location_updated_at ) )")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("created_at", { ascending: true })

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
  const jobsRes = await client
    .from("jobs")
    .select("id, date, status, price, team_id")
    .eq("tenant_id", tenant.id)
    .eq("date", date)
    .neq("status", "cancelled")

  const jobsByTeam = new Map<number, any[]>()
  for (const j of jobsRes.data || []) {
    const teamId = j.team_id != null ? Number(j.team_id) : NaN
    if (!Number.isFinite(teamId)) continue
    const arr = jobsByTeam.get(teamId) || []
    arr.push(j)
    jobsByTeam.set(teamId, arr)
  }

  const teamsBase: Team[] = (teamsRes.data || []).map((t: any) => {
    const teamId = String(t.id)
    const rawMembers = Array.isArray(t.team_members) ? t.team_members : []
    const members = rawMembers
      .map((tm: any) => {
        const c = tm.cleaners
        if (!c) return null
        return {
          id: String(c.id),
          name: String(c.name || "Cleaner"),
          phone: String(c.phone || ""),
          telegram_id: c.telegram_id || undefined,
          role: tm.role === "lead" ? "lead" : "technician",
          team_id: teamId,
          is_active: Boolean(tm.is_active) && Boolean(c.active),
          // extra fields for UI (not typed in TeamMember, but kept for consumers that want it)
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

  const response: ApiResponse<typeof teamsWithMetrics> = { success: true, data: teamsWithMetrics }
  return NextResponse.json(response)
}
