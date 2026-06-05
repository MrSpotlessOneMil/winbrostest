import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { calculateCleanerPay } from "@/lib/tenant"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  try {
    const tenant = await getAuthTenant(request)

    // Admin user (no tenant_id) sees all tenants' data
    if (!tenant && authResult.user.username !== 'admin') {
      return NextResponse.json({ jobs: [] }, { status: 403 })
    }

    const client = tenant
      ? await getTenantScopedClient(tenant.id)
      : getSupabaseServiceClient()

    const query = client
      .from("jobs")
      .select("*, customers (*), cleaners!jobs_cleaner_id_fkey (*), cleaner_assignments ( cleaner_id, status, cleaners ( id, name, active, deleted_at ) ), teams ( id, name ), leads!converted_to_job_id ( source )")

    if (tenant) {
      query.eq("tenant_id", tenant.id)
    }

    // Only show confirmed jobs on the calendar (not quotes or cancelled)
    query.in("status", ["scheduled", "in_progress", "completed"])

    // Order by DATE (not created_at) and lift the cap. The old
    // `created_at desc + limit(2000)` silently dropped the oldest-CREATED rows
    // once a tenant/admin exceeded 2000 jobs — which includes far-future
    // recurring appointments generated long ago, making them vanish from the
    // calendar (and flicker back as the set shifted). Ordering by date means any
    // future cut hits the oldest PAST dates first, never upcoming appointments.
    const { data, error } = await query
      .order("date", { ascending: false })
      .limit(10000)

    if (error) {
      throw error
    }

    // Enrich each job with computed_cleaner_pay so the dashboard bubble can
    // display pay for normal jobs (override takes precedence when set).
    // A removed/inactive cleaner must not appear on the calendar. Drop assignment
    // rows whose cleaner is inactive or soft-deleted, and clear the direct
    // job→cleaner link when that cleaner is gone, so jobs staffed only by removed
    // cleaners render as unassigned (prompting manual reassignment).
    const isActiveCleaner = (c: any) => c && c.active !== false && !c.deleted_at

    const enriched = (data || []).map((job: any) => {
      const price = Number(job.price || job.estimated_value || 0)
      const hours = Number(job.hours || 2)
      const override = job.cleaner_pay_override != null ? Number(job.cleaner_pay_override) : null
      const computed = tenant && price > 0
        ? calculateCleanerPay(tenant, price, hours, job.service_type)
        : null
      const assignments = Array.isArray(job.cleaner_assignments)
        ? job.cleaner_assignments.filter((a: any) => isActiveCleaner(a?.cleaners))
        : job.cleaner_assignments
      return {
        ...job,
        cleaner_assignments: assignments,
        cleaners: isActiveCleaner(job.cleaners) ? job.cleaners : null,
        computed_cleaner_pay: override != null ? override : computed,
        computed_cleaner_pay_source: override != null ? 'override' : (computed != null ? 'calculated' : null),
      }
    })

    return NextResponse.json({ jobs: enriched })
  } catch (error) {
    console.error("Failed to load calendar jobs:", error)
    return NextResponse.json({ jobs: [] }, { status: 500 })
  }
}
