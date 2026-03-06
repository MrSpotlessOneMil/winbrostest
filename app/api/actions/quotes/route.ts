import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — List quotes for the tenant
 * POST — Create a new quote
 */

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200)

  let query = supabase
    .from("quotes")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq("status", status)
  }

  const { data: quotes, error } = await query

  if (error) {
    return NextResponse.json({ error: "Failed to load quotes" }, { status: 500 })
  }

  return NextResponse.json({ success: true, quotes })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const body = await request.json()
  const {
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    square_footage,
    property_type,
    notes,
  } = body

  if (!customer_name) {
    return NextResponse.json({ error: "customer_name is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check: verify customer belongs to tenant if customer_id provided
  if (customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("id", customer_id)
      .single()

    if (!customer || customer.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
  }

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenant.id,
      customer_id: customer_id || null,
      customer_name,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      square_footage: square_footage || null,
      property_type: property_type || null,
      notes: notes || null,
    })
    .select()
    .single()

  if (error || !quote) {
    console.error("[quotes/POST] Insert failed:", error)
    return NextResponse.json({ error: "Failed to create quote" }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    quote,
    quote_url: `/quote/${quote.token}`,
  })
}
