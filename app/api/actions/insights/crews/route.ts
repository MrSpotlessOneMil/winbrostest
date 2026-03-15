import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Date-range helpers (same pattern as funnel route)
// ---------------------------------------------------------------------------

function computeDateRange(
  range: string,
  from: string | null,
  to: string | null,
  timezone: string
): { start: string; end: string; prevStart: string; prevEnd: string } {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone })
  )
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  let start: Date
  let end: Date = new Date(today)
  end.setHours(23, 59, 59, 999)

  switch (range) {
    case "7d": {
      start = new Date(today)
      start.setDate(start.getDate() - 6)
      break
    }
    case "30d": {
      start = new Date(today)
      start.setDate(start.getDate() - 29)
      break
    }
    case "90d": {
      start = new Date(today)
      start.setDate(start.getDate() - 89)
      break
    }
    case "ytd": {
      start = new Date(today.getFullYear(), 0, 1)
      break
    }
    case "custom": {
      if (!from || !to) {
        start = new Date(today)
        start.setDate(start.getDate() - 29)
        break
      }
      start = new Date(from + "T00:00:00")
      end = new Date(to + "T23:59:59.999")
      break
    }
    default: {
      start = new Date(today)
      start.setDate(start.getDate() - 29)
    }
  }

  const durationMs = end.getTime() - start.getTime()

  let prevStart: Date
  let prevEnd: Date

  if (range === "ytd") {
    prevStart = new Date(start)
    prevStart.setFullYear(prevStart.getFullYear() - 1)
    prevEnd = new Date(end)
    prevEnd.setFullYear(prevEnd.getFullYear() - 1)
  } else {
    prevEnd = new Date(start.getTime() - 1)
    prevStart = new Date(prevEnd.getTime() - durationMs)
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prevStart: prevStart.toISOString(),
    prevEnd: prevEnd.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// GET /api/actions/insights/crews
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const url = new URL(request.url)
  const range = url.searchParams.get("range") || "30d"
  const fromParam = url.searchParams.get("from")
  const toParam = url.searchParams.get("to")

  const tz = tenant.timezone || "America/Chicago"
  const { start, end, prevStart, prevEnd } = computeDateRange(range, fromParam, toParam, tz)

  // -----------------------------------------------------------------------
  // 1. Active teams
  // -----------------------------------------------------------------------
  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .is("deleted_at", null)

  if (teamsErr) {
    return NextResponse.json({ error: "Failed to fetch teams" }, { status: 500 })
  }

  const teams = teamsData ?? []
  const teamMap = new Map(teams.map((t) => [t.id, t.name]))

  // -----------------------------------------------------------------------
  // 2. Team members + cleaners
  // -----------------------------------------------------------------------
  const { data: membersData } = await supabase
    .from("team_members")
    .select("team_id, cleaner_id")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true)

  const members = membersData ?? []
  const cleanerTeamMap = new Map<string, string>()
  for (const m of members) {
    cleanerTeamMap.set(m.cleaner_id, m.team_id)
  }

  const cleanerIds = [...new Set(members.map((m) => m.cleaner_id))]
  let cleanerNameMap = new Map<string, string>()
  if (cleanerIds.length > 0) {
    const { data: cleanersData } = await supabase
      .from("cleaners")
      .select("id, name")
      .in("id", cleanerIds)
      .eq("tenant_id", tenant.id)

    if (cleanersData) {
      cleanerNameMap = new Map(cleanersData.map((c) => [c.id, c.name]))
    }
  }

  // -----------------------------------------------------------------------
  // 3. Current-period jobs (completed, with team_id)
  // -----------------------------------------------------------------------
  const { data: currentJobs, error: jobsErr } = await supabase
    .from("jobs")
    .select("id, team_id, price, hours, date, completed_at")
    .eq("tenant_id", tenant.id)
    .eq("status", "completed")
    .not("team_id", "is", null)
    .or(`date.gte.${start},completed_at.gte.${start}`)
    .or(`date.lte.${end},completed_at.lte.${end}`)

  if (jobsErr) {
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 })
  }

  // Filter jobs that fall within the date range (using date or completed_at)
  const jobs = (currentJobs ?? []).filter((j) => {
    const jobDate = j.date || j.completed_at
    if (!jobDate) return false
    return jobDate >= start.slice(0, 10) && jobDate <= end.slice(0, 10) ||
           (j.completed_at && j.completed_at >= start && j.completed_at <= end)
  })

  // -----------------------------------------------------------------------
  // 4. Previous-period jobs
  // -----------------------------------------------------------------------
  const { data: prevJobsData } = await supabase
    .from("jobs")
    .select("id, team_id, price, hours, date, completed_at")
    .eq("tenant_id", tenant.id)
    .eq("status", "completed")
    .not("team_id", "is", null)
    .or(`date.gte.${prevStart},completed_at.gte.${prevStart}`)
    .or(`date.lte.${prevEnd},completed_at.lte.${prevEnd}`)

  const prevJobs = (prevJobsData ?? []).filter((j) => {
    const jobDate = j.date || j.completed_at
    if (!jobDate) return false
    return jobDate >= prevStart.slice(0, 10) && jobDate <= prevEnd.slice(0, 10) ||
           (j.completed_at && j.completed_at >= prevStart && j.completed_at <= prevEnd)
  })

  // -----------------------------------------------------------------------
  // 5. Tips (current period)
  // -----------------------------------------------------------------------
  const { data: tipsData } = await supabase
    .from("tips")
    .select("team_id, amount")
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  const tips = tipsData ?? []

  // -----------------------------------------------------------------------
  // 6. Upsells (current period)
  // -----------------------------------------------------------------------
  const { data: upsellsData } = await supabase
    .from("upsells")
    .select("team_id, value, job_id")
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  const upsells = upsellsData ?? []

  // -----------------------------------------------------------------------
  // 7. Reviews (current period)
  // -----------------------------------------------------------------------
  const { data: reviewsData } = await supabase
    .from("reviews")
    .select("team_id, rating")
    .eq("tenant_id", tenant.id)
    .gte("created_at", start)
    .lte("created_at", end)

  const reviews = reviewsData ?? []

  // -----------------------------------------------------------------------
  // 8. Cleaner assignments (current period)
  // -----------------------------------------------------------------------
  const { data: assignmentsData } = await supabase
    .from("cleaner_assignments")
    .select("cleaner_id, status, assigned_at, responded_at")
    .eq("tenant_id", tenant.id)
    .gte("assigned_at", start)
    .lte("assigned_at", end)

  const assignments = assignmentsData ?? []

  // -----------------------------------------------------------------------
  // Aggregate by team
  // -----------------------------------------------------------------------

  // Upsell job IDs per team
  const upsellJobsByTeam = new Map<string, Set<string>>()
  for (const u of upsells) {
    if (!u.team_id) continue
    if (!upsellJobsByTeam.has(u.team_id)) upsellJobsByTeam.set(u.team_id, new Set())
    upsellJobsByTeam.get(u.team_id)!.add(u.job_id)
  }

  const teamsResult = teams.map((team) => {
    const teamJobs = jobs.filter((j) => j.team_id === team.id)
    const prevTeamJobs = prevJobs.filter((j) => j.team_id === team.id)
    const teamTips = tips.filter((t) => t.team_id === team.id)
    const teamReviews = reviews.filter((r) => r.team_id === team.id)

    const jobsCompleted = teamJobs.length
    const previousJobs = prevTeamJobs.length
    const revenue = teamJobs.reduce((sum, j) => sum + (j.price || 0), 0)
    const previousRevenue = prevTeamJobs.reduce((sum, j) => sum + (j.price || 0), 0)
    const totalHours = teamJobs.reduce((sum, j) => sum + (j.hours || 0), 0)
    const tipsTotal = teamTips.reduce((sum, t) => sum + (t.amount || 0), 0)

    const ratingSum = teamReviews.reduce((sum, r) => sum + (r.rating || 0), 0)
    const reviewCount = teamReviews.length
    const avgRating = reviewCount > 0 ? Math.round((ratingSum / reviewCount) * 10) / 10 : 0

    // Upsell rate: jobs with at least one upsell / total completed jobs
    const upsellJobSet = upsellJobsByTeam.get(team.id) ?? new Set()
    const jobsWithUpsell = teamJobs.filter((j) => upsellJobSet.has(j.id)).length
    const upsellRate = jobsCompleted > 0 ? Math.round((jobsWithUpsell / jobsCompleted) * 1000) / 10 : 0
    const upsellRevenue = upsells
      .filter((u) => u.team_id === team.id)
      .reduce((sum, u) => sum + (u.value || 0), 0)

    const revenuePerHour = totalHours > 0 ? Math.round((revenue / totalHours) * 100) / 100 : 0

    return {
      teamId: team.id,
      teamName: team.name,
      jobsCompleted,
      previousJobs,
      revenue,
      previousRevenue,
      avgRating,
      reviewCount,
      tipsTotal,
      upsellRate,
      upsellRevenue,
      revenuePerHour,
    }
  })

  // -----------------------------------------------------------------------
  // Daily trend by team
  // -----------------------------------------------------------------------
  const trendMap: Record<string, Record<string, { jobs: number; revenue: number }>> = {}

  for (const j of jobs) {
    const day = (j.date || j.completed_at || "").slice(0, 10)
    if (!day || !j.team_id) continue
    if (!trendMap[day]) trendMap[day] = {}
    if (!trendMap[day][j.team_id]) trendMap[day][j.team_id] = { jobs: 0, revenue: 0 }
    trendMap[day][j.team_id].jobs++
    trendMap[day][j.team_id].revenue += j.price || 0
  }

  const sortedDays = Object.keys(trendMap).sort()
  const trends: Array<{ date: string; teamId: string; teamName: string; jobs: number; revenue: number }> = []

  for (const day of sortedDays) {
    for (const [teamId, data] of Object.entries(trendMap[day])) {
      trends.push({
        date: day,
        teamId,
        teamName: teamMap.get(teamId) || "Unknown",
        jobs: data.jobs,
        revenue: data.revenue,
      })
    }
  }

  // -----------------------------------------------------------------------
  // Cleaner details
  // -----------------------------------------------------------------------
  const cleanerStats = new Map<string, {
    accepted: number
    total: number
    responseMinutesSum: number
    responseCount: number
    jobsCompleted: number
  }>()

  for (const a of assignments) {
    if (!a.cleaner_id) continue
    if (!cleanerStats.has(a.cleaner_id)) {
      cleanerStats.set(a.cleaner_id, {
        accepted: 0,
        total: 0,
        responseMinutesSum: 0,
        responseCount: 0,
        jobsCompleted: 0,
      })
    }
    const stats = cleanerStats.get(a.cleaner_id)!
    stats.total++
    if (a.status === "accepted" || a.status === "confirmed") {
      stats.accepted++
    }
    if (a.responded_at && a.assigned_at) {
      const diff = new Date(a.responded_at).getTime() - new Date(a.assigned_at).getTime()
      if (diff >= 0) {
        stats.responseMinutesSum += diff / 60000
        stats.responseCount++
      }
    }
  }

  // Count completed jobs per team, attribute evenly to team cleaners
  const jobsByTeam = new Map<string, number>()
  for (const j of jobs) {
    if (!j.team_id) continue
    jobsByTeam.set(j.team_id, (jobsByTeam.get(j.team_id) || 0) + 1)
  }

  const cleanerDetails: Array<{
    cleanerId: string
    cleanerName: string
    teamId: string
    acceptanceRate: number
    avgResponseMinutes: number
    jobsCompleted: number
  }> = []

  for (const cid of cleanerIds) {
    const stats = cleanerStats.get(cid)
    const teamId = cleanerTeamMap.get(cid) || ""
    const teamJobCount = jobsByTeam.get(teamId) || 0

    // Count how many team members share this team
    const teamMemberCount = members.filter((m) => m.team_id === teamId).length

    cleanerDetails.push({
      cleanerId: cid,
      cleanerName: cleanerNameMap.get(cid) || "Unknown",
      teamId,
      acceptanceRate: stats && stats.total > 0
        ? Math.round((stats.accepted / stats.total) * 1000) / 10
        : 0,
      avgResponseMinutes: stats && stats.responseCount > 0
        ? Math.round(stats.responseMinutesSum / stats.responseCount)
        : 0,
      jobsCompleted: teamMemberCount > 0
        ? Math.round(teamJobCount / teamMemberCount)
        : 0,
    })
  }

  // Sort by jobsCompleted descending
  cleanerDetails.sort((a, b) => b.jobsCompleted - a.jobsCompleted)

  // -----------------------------------------------------------------------
  // Sparklines: daily totals across all teams
  // -----------------------------------------------------------------------
  const dailyTotalRevenue = sortedDays.map((day) => {
    const dayTeams = trendMap[day] || {}
    return Object.values(dayTeams).reduce((sum, t) => sum + t.revenue, 0)
  })

  const dailyTotalJobs = sortedDays.map((day) => {
    const dayTeams = trendMap[day] || {}
    return Object.values(dayTeams).reduce((sum, t) => sum + t.jobs, 0)
  })

  // -----------------------------------------------------------------------
  // Response
  // -----------------------------------------------------------------------
  return NextResponse.json({
    teams: teamsResult,
    trends,
    cleanerDetails,
    sparklines: {
      totalRevenue: dailyTotalRevenue,
      totalJobs: dailyTotalJobs,
    },
  })
}
