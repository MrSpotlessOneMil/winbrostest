import { NextRequest, NextResponse } from "next/server"
import type { Team, TeamDailyMetrics, ApiResponse } from "@/lib/types"
import { getSupabaseClient } from "@/lib/supabase"

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function dailyTarget(): number {
  const raw = process.env.DAILY_TARGET_PER_CREW || process.env.DAILY_TARGET || process.env.BOOKING_DAILY_TARGET
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : 1200
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const include_metrics = searchParams.get("include_metrics") === "true"

  const client = getSupabaseClient()
  const date = searchParams.get("date") || todayISO()

  const cleanersRes = await client.from("cleaners").select("*").eq("active", true).order("created_at", { ascending: true })
  if (cleanersRes.error) {
    const response: ApiResponse<Team[]> = { success: true, data: [] }
    return NextResponse.json(response)
  }

  // Preload assignments for the date (to derive "current job" and status).
  const jobsRes = await client
    .from("jobs")
    .select("id, date, status, price")
    .eq("date", date)
    .neq("status", "cancelled")

  const jobById = new Map<number, any>()
  for (const j of jobsRes.data || []) jobById.set(Number(j.id), j)

  const assignmentsRes = await client
    .from("cleaner_assignments")
    .select("job_id, cleaner_id, status, updated_at")
    .neq("status", "cancelled")

  const byCleaner = new Map<number, any[]>()
  for (const a of assignmentsRes.data || []) {
    const cleanerId = Number(a.cleaner_id)
    const jobId = Number(a.job_id)
    const job = jobById.get(jobId)
    if (!job) continue
    const arr = byCleaner.get(cleanerId) || []
    arr.push({ ...a, job })
    byCleaner.set(cleanerId, arr)
  }

  const teamsBase: Team[] = (cleanersRes.data || []).map((c: any) => {
    const cleanerId = Number(c.id)
    const assignments = byCleaner.get(cleanerId) || []
    const inProgress = assignments.find((a) => String(a.job?.status) === "in_progress")
    const scheduled = assignments.find((a) => String(a.job?.status) === "scheduled")
    const current = inProgress || scheduled

    let status: Team["status"] = "available"
    if (current?.job?.status === "in_progress") status = "on-job"
    else if (current?.job?.status === "scheduled") status = "traveling"

    const memberId = String(c.id)
    const teamId = String(c.id)

    return {
      id: teamId,
      name: String(c.name || `Team ${teamId}`),
      lead_id: memberId,
      members: [
        {
          id: memberId,
          name: String(c.name || "Cleaner"),
          phone: String(c.phone || ""),
          telegram_id: c.telegram_id || undefined,
          role: "lead",
          team_id: teamId,
          is_active: Boolean(c.active),
        },
      ],
      status,
      current_job_id: current?.job?.id != null ? String(current.job.id) : undefined,
      daily_target: dailyTarget(),
      is_active: Boolean(c.active),
    }
  })

  let teamsWithMetrics: any[] = teamsBase
  if (include_metrics) {
    teamsWithMetrics = teamsBase.map((team) => {
      const cleanerId = Number(team.id)
      const assignments = byCleaner.get(cleanerId) || []
      const completed = assignments.filter((a) => String(a.job?.status) === "completed")
      const scheduled = assignments.filter((a) => String(a.job?.status) === "scheduled" || String(a.job?.status) === "in_progress")
      const revenue = completed.reduce((sum, a) => sum + (a.job?.price != null ? Number(a.job.price) : 0), 0)

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

  const response: ApiResponse<typeof teamsWithMetrics> = {
    success: true,
    data: teamsWithMetrics,
  }

  return NextResponse.json(response)
}
