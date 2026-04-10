import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

/**
 * GET /api/customers/lookup?phone=5551234567
 * GET /api/customers/lookup?q=123+main  (address search)
 *
 * Returns matching customers for auto-populate in the create job form.
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

  const phone = request.nextUrl.searchParams.get("phone")
  const q = request.nextUrl.searchParams.get("q")
  const search = request.nextUrl.searchParams.get("search")

  try {
    // General search — matches name, phone, or email
    if (search && search.length >= 2) {
      const term = search.trim()
      const digits = term.replace(/\D/g, "")
      const isPhoneSearch = digits.length >= 3 && digits.length === term.replace(/[\s\-\(\)\+]/g, "").length

      let query = client
        .from("customers")
        .select("id, first_name, last_name, email, phone_number, address, bedrooms, bathrooms, sqft, notes")

      if (isPhoneSearch) {
        const matchDigits = digits.length >= 10 ? digits.slice(-10) : digits
        query = query.like("phone_number", `%${matchDigits}%`)
      } else {
        // Search by name or email using OR
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
      }

      const { data, error } = await query.limit(8)
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      const customers = data || []
      if (customers.length > 0) {
        const customerIds = customers.map((c: { id: string }) => c.id)
        const { data: lastJobs } = await client
          .from("jobs")
          .select("customer_id, service_type, addons, price")
          .in("customer_id", customerIds)
          .in("status", ["completed", "scheduled", "in_progress"])
          .order("scheduled_at", { ascending: false })
          .limit(20)

        const jobByCustomer = new Map<string, any>()
        for (const job of lastJobs || []) {
          if (!jobByCustomer.has(job.customer_id)) {
            jobByCustomer.set(job.customer_id, job)
          }
        }
        for (const c of customers as (typeof customers[0] & { last_job?: unknown })[]) {
          c.last_job = jobByCustomer.get(c.id) || null
        }
      }

      return NextResponse.json({ success: true, data: customers })
    }

    if (phone) {
      // Strip non-digits for matching
      const digits = phone.replace(/\D/g, "")
      if (digits.length < 3) {
        return NextResponse.json({ success: true, data: [] })
      }

      // Match by trailing digits (handles +1 prefix variations)
      const matchDigits = digits.length >= 10 ? digits.slice(-10) : digits
      const { data, error } = await client
        .from("customers")
        .select("id, first_name, last_name, email, phone_number, address, bedrooms, bathrooms, sqft, notes")
        .like("phone_number", `%${matchDigits}%`)
        .limit(4)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      // Fetch last job for each matched customer
      // Over-fetch to ensure coverage across all customers (Map dedup picks first per customer)
      const customers = data || []
      if (customers.length > 0) {
        const customerIds = customers.map((c: { id: string }) => c.id)
        const { data: lastJobs } = await client
          .from("jobs")
          .select("customer_id, service_type, addons, price")
          .in("customer_id", customerIds)
          .in("status", ["completed", "scheduled", "in_progress"])
          .order("scheduled_at", { ascending: false })
          .limit(20)

        const jobByCustomer = new Map<string, any>()
        for (const job of lastJobs || []) {
          if (!jobByCustomer.has(job.customer_id)) {
            jobByCustomer.set(job.customer_id, job)
          }
        }
        for (const c of customers as (typeof customers[0] & { last_job?: unknown })[]) {
          c.last_job = jobByCustomer.get(c.id) || null
        }
      }

      return NextResponse.json({ success: true, data: customers })
    }

    if (q && q.length >= 2) {
      // Address search — return distinct addresses matching the query
      const { data, error } = await client
        .from("customers")
        .select("id, first_name, last_name, phone_number, address")
        .not("address", "is", null)
        .ilike("address", `%${q}%`)
        .limit(10)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, data: data || [] })
    }

    return NextResponse.json({ success: true, data: [] })
  } catch (error) {
    console.error("[customers/lookup] error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
