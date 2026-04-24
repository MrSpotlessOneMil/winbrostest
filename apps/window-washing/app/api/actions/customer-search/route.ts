import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuthWithTenant } from "@/lib/auth"

/**
 * GET /api/actions/customer-search?search=<term>
 *
 * Picker-only endpoint used by the Round 2 quote builder and the New
 * Appointment modal. Returns a compact customer list — id, name, phone,
 * email, address — scoped to the authenticated user's tenant.
 *
 * Uses the service-role client with an explicit `tenant_id` equality
 * filter (instead of `getTenantScopedClient`) so the picker remains
 * functional in local dev where the anon-key JWT flow is flaky.
 * Cross-tenant isolation is enforced by the filter below.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const searchRaw = request.nextUrl.searchParams.get("search")?.trim() || ""
  const client = getSupabaseServiceClient()

  let query = client
    .from("customers")
    .select("id, first_name, last_name, phone_number, email, address")
    .eq("tenant_id", tenant.id)
    .order("updated_at", { ascending: false })

  if (searchRaw) {
    const digits = searchRaw.replace(/\D/g, "")
    if (digits.length >= 4) {
      query = query.or(
        `phone_number.ilike.%${digits}%,first_name.ilike.%${searchRaw}%,last_name.ilike.%${searchRaw}%,email.ilike.%${searchRaw}%,address.ilike.%${searchRaw}%`
      )
    } else {
      query = query.or(
        `first_name.ilike.%${searchRaw}%,last_name.ilike.%${searchRaw}%,email.ilike.%${searchRaw}%,address.ilike.%${searchRaw}%`
      )
    }
    query = query.limit(25)
  } else {
    query = query.limit(25)
  }

  const { data, error } = await query
  if (error) {
    console.error("[customer-search] query failed:", error.message)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, data: data || [] })
}
