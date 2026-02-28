import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

/**
 * GET /api/teams/earnings?period=week|month|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns per-cleaner earnings from completed jobs.
 * Attribution order:
 *   1. jobs.cleaner_id (direct assignment)
 *   2. cleaner_assignments (dispatch flow)
 *   3. jobs.team_id → split among active team members
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant && authResult.user.username !== "admin") {
    return NextResponse.json({ success: false, error: "No tenant" }, { status: 500 })
  }

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  const params = request.nextUrl.searchParams
  const period = params.get("period") || "week"

  // Calculate date range
  const now = new Date()
  let startDate: string
  let endDate: string = now.toISOString().slice(0, 10)

  if (period === "custom") {
    startDate = params.get("start") || endDate
    endDate = params.get("end") || endDate
  } else if (period === "month") {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
  } else {
    // week — start from Monday
    const day = now.getDay()
    const diff = day === 0 ? 6 : day - 1 // Monday = 0 offset
    const monday = new Date(now)
    monday.setDate(now.getDate() - diff)
    startDate = monday.toISOString().slice(0, 10)
  }

  try {
    // 1. Fetch completed jobs in date range
    let jobsQuery = client
      .from("jobs")
      .select("id, price, cleaner_id, team_id, date, service_type, address")
      .eq("status", "completed")
      .gte("date", startDate)
      .lte("date", endDate)
    if (tenant) jobsQuery = jobsQuery.eq("tenant_id", tenant.id)
    const { data: jobs, error: jobsErr } = await jobsQuery

    if (jobsErr) {
      return NextResponse.json({ success: false, error: jobsErr.message }, { status: 500 })
    }

    // 2. Fetch cleaner assignments for these jobs
    const jobIds = (jobs || []).map((j) => j.id)
    let assignments: { job_id: number; cleaner_id: number; status: string }[] = []
    if (jobIds.length > 0) {
      const { data: assignData } = await client
        .from("cleaner_assignments")
        .select("job_id, cleaner_id, status")
        .in("job_id", jobIds)
        .in("status", ["accepted", "confirmed"])
      assignments = assignData || []
    }

    // 3. Fetch all active cleaners for this tenant
    let cleanersQuery = client
      .from("cleaners")
      .select("id, name, phone, telegram_id, employee_type")
      .eq("active", true)
      .is("deleted_at", null)
    if (tenant) cleanersQuery = cleanersQuery.eq("tenant_id", tenant.id)
    const { data: cleaners } = await cleanersQuery

    // 4. Fetch team memberships
    let membersQuery = client
      .from("team_members")
      .select("team_id, cleaner_id")
      .eq("is_active", true)
    if (tenant) membersQuery = membersQuery.eq("tenant_id", tenant.id)
    const { data: teamMembers } = await membersQuery

    // Build lookup maps
    const cleanerMap = new Map<number, { id: number; name: string; phone: string; telegram_id: string | null; employee_type: string }>()
    for (const c of cleaners || []) {
      cleanerMap.set(c.id, c)
    }

    const assignmentByJob = new Map<number, number>()
    for (const a of assignments) {
      assignmentByJob.set(a.job_id, a.cleaner_id)
    }

    const membersByTeam = new Map<number, number[]>()
    for (const tm of teamMembers || []) {
      const arr = membersByTeam.get(tm.team_id) || []
      arr.push(tm.cleaner_id)
      membersByTeam.set(tm.team_id, arr)
    }

    // 5. Attribute earnings
    const earnings = new Map<number, { total: number; jobs: number; jobDetails: { id: number; price: number; date: string; service_type: string; split: boolean }[] }>()

    function addEarning(cleanerId: number, jobId: number, amount: number, date: string, serviceType: string, split: boolean) {
      const existing = earnings.get(cleanerId) || { total: 0, jobs: 0, jobDetails: [] }
      existing.total += amount
      existing.jobs += 1
      existing.jobDetails.push({ id: jobId, price: amount, date, service_type: serviceType, split })
      earnings.set(cleanerId, existing)
    }

    for (const job of jobs || []) {
      const price = Number(job.price) || 0
      if (price <= 0) continue

      // Priority 1: Direct cleaner_id on the job
      if (job.cleaner_id) {
        addEarning(job.cleaner_id, job.id, price, job.date, job.service_type || "", false)
        continue
      }

      // Priority 2: Cleaner assignment (dispatch flow)
      const assignedCleaner = assignmentByJob.get(job.id)
      if (assignedCleaner) {
        addEarning(assignedCleaner, job.id, price, job.date, job.service_type || "", false)
        continue
      }

      // Priority 3: Team split
      if (job.team_id) {
        const members = membersByTeam.get(job.team_id)
        if (members && members.length > 0) {
          const split = price / members.length
          for (const memberId of members) {
            addEarning(memberId, job.id, split, job.date, job.service_type || "", true)
          }
          continue
        }
      }

      // Unattributed job — skip (no cleaner linkage)
    }

    // 6. Build response
    const result = Array.from(earnings.entries())
      .map(([cleanerId, data]) => {
        const cleaner = cleanerMap.get(cleanerId)
        return {
          cleaner_id: cleanerId,
          name: cleaner?.name || `Cleaner #${cleanerId}`,
          phone: cleaner?.phone || "",
          employee_type: cleaner?.employee_type || "technician",
          total: Math.round(data.total * 100) / 100,
          job_count: data.jobs,
          jobs: data.jobDetails,
        }
      })
      .sort((a, b) => b.total - a.total)

    // Include cleaners with zero earnings too
    for (const [cleanerId, cleaner] of cleanerMap) {
      if (!earnings.has(cleanerId)) {
        result.push({
          cleaner_id: cleanerId,
          name: cleaner.name,
          phone: cleaner.phone || "",
          employee_type: cleaner.employee_type || "technician",
          total: 0,
          job_count: 0,
          jobs: [],
        })
      }
    }

    const grandTotal = result.reduce((sum, r) => sum + r.total, 0)
    const totalJobs = (jobs || []).filter((j) => (Number(j.price) || 0) > 0).length

    return NextResponse.json({
      success: true,
      data: {
        cleaners: result,
        summary: {
          grand_total: Math.round(grandTotal * 100) / 100,
          total_jobs: totalJobs,
          period,
          start_date: startDate,
          end_date: endDate,
        },
      },
    })
  } catch (error) {
    console.error("[teams/earnings] error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
