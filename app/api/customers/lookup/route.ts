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

  try {
    if (phone) {
      // Strip non-digits for matching
      const digits = phone.replace(/\D/g, "")
      if (digits.length < 7) {
        return NextResponse.json({ success: true, data: [] })
      }

      // Match by last 10 digits (handles +1 prefix variations)
      const last10 = digits.slice(-10)
      const { data, error } = await client
        .from("customers")
        .select("id, first_name, last_name, email, phone_number, address, bedrooms, bathrooms, sqft, notes")
        .like("phone_number", `%${last10}`)
        .limit(5)

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, data: data || [] })
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
