import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { syncContactToOpenPhone } from "@/lib/openphone"

/**
 * POST /api/admin/sync-openphone-contacts
 * Body: { tenant_slug: string, limit?: number, offset?: number }
 *
 * Syncs customer names to OpenPhone contacts so they show up in the app.
 * Uses externalId for dedup so safe to run multiple times.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAdmin(request)
  if (authResult instanceof NextResponse) return authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { tenant_slug, limit = 200, offset = 0 } = body
  if (!tenant_slug) {
    return NextResponse.json({ error: "tenant_slug required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Get tenant
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, openphone_api_key")
    .eq("slug", tenant_slug as string)
    .single()

  if (!tenant || !tenant.openphone_api_key) {
    return NextResponse.json({ error: `Tenant ${tenant_slug} not found or no OpenPhone API key` }, { status: 404 })
  }

  // Get customers with names and phone numbers
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, phone_number, email")
    .eq("tenant_id", tenant.id)
    .not("first_name", "is", null)
    .not("phone_number", "is", null)
    .order("id", { ascending: true })
    .range(Number(offset), Number(offset) + Number(limit) - 1)

  if (error) {
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 })
  }

  let created = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const customer of customers || []) {
    const result = await syncContactToOpenPhone(tenant, customer)

    if (result.success && result.skipped) {
      skipped++
    } else if (result.success) {
      created++
    } else {
      failed++
      if (errors.length < 10) {
        errors.push(`${customer.id} (${customer.first_name}): ${result.error}`)
      }
    }

    // Stay under 10 RPS rate limit
    await new Promise(r => setTimeout(r, 125))
  }

  return NextResponse.json({
    success: true,
    tenant: tenant.slug,
    total: customers?.length || 0,
    created,
    skipped,
    failed,
    errors: errors.length > 0 ? errors : undefined,
    next_offset: errors.length === 0 ? Number(offset) + Number(limit) : undefined,
  })
}
