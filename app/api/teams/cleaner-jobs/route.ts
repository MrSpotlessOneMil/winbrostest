import { NextRequest, NextResponse } from "next/server"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET /api/teams/cleaner-jobs?cleaner_id=X
 *
 * Returns a cleaner's jobs bucketed into today, upcoming, and recent.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant && authResult.user.username !== "admin") {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const cleanerId = request.nextUrl.searchParams.get("cleaner_id")
  if (!cleanerId) {
    return NextResponse.json({ success: false, error: "cleaner_id is required" }, { status: 400 })
  }

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  const today = new Date().toISOString().slice(0, 10)

  try {
    // Get job IDs assigned to this cleaner via cleaner_assignments
    let assignmentsQuery = client
      .from("cleaner_assignments")
      .select("job_id")
      .eq("cleaner_id", Number(cleanerId))
      .in("status", ["accepted", "confirmed", "pending"])
    if (tenant) assignmentsQuery = assignmentsQuery.eq("tenant_id", tenant.id)
    const { data: assignments } = await assignmentsQuery
    const assignedJobIds = (assignments || []).map((a) => a.job_id)

    // Get jobs where cleaner_id is directly set
    let directJobsQuery = client
      .from("jobs")
      .select("id, address, service_type, date, scheduled_at, status, price, customers(name, phone_number)")
      .eq("cleaner_id", Number(cleanerId))
      .neq("status", "cancelled")
    if (tenant) directJobsQuery = directJobsQuery.eq("tenant_id", tenant.id)
    const { data: directJobs } = await directJobsQuery

    // Get jobs from assignments
    let assignedJobs: any[] = []
    if (assignedJobIds.length > 0) {
      let assignedQuery = client
        .from("jobs")
        .select("id, address, service_type, date, scheduled_at, status, price, customers(name, phone_number)")
        .in("id", assignedJobIds)
        .neq("status", "cancelled")
      if (tenant) assignedQuery = assignedQuery.eq("tenant_id", tenant.id)
      const { data } = await assignedQuery
      assignedJobs = data || []
    }

    // Merge and deduplicate
    const jobMap = new Map<number, any>()
    for (const j of [...(directJobs || []), ...assignedJobs]) {
      if (!jobMap.has(j.id)) jobMap.set(j.id, j)
    }
    const allJobs = Array.from(jobMap.values())

    // Bucket into today, upcoming, recent
    const todayJobs = allJobs
      .filter((j) => j.date === today && j.status !== "completed")
      .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))

    const upcoming = allJobs
      .filter((j) => j.date > today && j.status !== "completed")
      .sort((a, b) => a.date.localeCompare(b.date) || (a.scheduled_at || "").localeCompare(b.scheduled_at || ""))
      .slice(0, 10)

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const recent = allJobs
      .filter((j) => j.status === "completed" && j.date >= thirtyDaysAgo)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)

    const formatJob = (j: any) => ({
      id: j.id,
      address: j.address || "",
      customer_name: j.customers?.name || "Unknown",
      service_type: j.service_type || "",
      scheduled_date: j.date,
      scheduled_time: j.scheduled_at || "",
      status: j.status,
      amount: Number(j.price) || 0,
    })

    return NextResponse.json({
      success: true,
      data: {
        today: todayJobs.map(formatJob),
        upcoming: upcoming.map(formatJob),
        recent: recent.map(formatJob),
      },
    })
  } catch (error) {
    console.error("[cleaner-jobs] error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
