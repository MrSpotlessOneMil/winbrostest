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

    // Bound the calendar to a window around today, ordered by date ascending.
    // PostgREST caps responses at 1000 rows regardless of limit, so without a
    // date window the recurring jobs that run years ahead would fill the payload
    // and push the CURRENT month out of it (which would blank the calendar).
    // The window (2 months back → 8 months ahead) is well under 1000 rows and
    // always contains the view the user is looking at.
    const horizonNow = new Date()
    const windowStart = new Date(horizonNow); windowStart.setMonth(windowStart.getMonth() - 2)
    const windowEnd = new Date(horizonNow); windowEnd.setMonth(windowEnd.getMonth() + 8)
    const toISODate = (d: Date) => d.toISOString().split("T")[0]
    query.gte("date", toISODate(windowStart)).lte("date", toISODate(windowEnd))

    const { data, error } = await query
      .order("date", { ascending: true })
      .limit(2000)

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
    // Do NOT return `{ jobs: [] }` here — an empty array is indistinguishable
    // from "this tenant genuinely has no appointments", which previously made a
    // DB statement-timeout look like a blank-but-working calendar. Return an
    // explicit error so the dashboard can show "couldn't load" instead.
    const code = (error as { code?: string })?.code
    const message = code === "57014"
      ? "The calendar query timed out. The jobs table likely needs indexing/maintenance."
      : "Failed to load calendar appointments. Please try again."
    return NextResponse.json({ error: message, code }, { status: 500 })
  }
}
