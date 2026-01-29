import { NextRequest, NextResponse } from "next/server"
import type { Lead, ApiResponse, PaginatedResponse } from "@/lib/types"
import { getSupabaseClient } from "@/lib/supabase"

function mapLead(row: any): Lead {
  const name =
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    row.name ||
    "Unknown"

  const sourceRaw = String(row.source || "").toLowerCase()
  const source: Lead["source"] =
    sourceRaw === "meta" || sourceRaw === "website" || sourceRaw === "sms" || sourceRaw === "vapi" || sourceRaw === "phone"
      ? (sourceRaw as Lead["source"])
      : "phone"

  const statusRaw = String(row.status || "").toLowerCase()
  const status: Lead["status"] =
    statusRaw === "new" ||
    statusRaw === "contacted" ||
    statusRaw === "qualified" ||
    statusRaw === "booked" ||
    statusRaw === "nurturing" ||
    statusRaw === "escalated" ||
    statusRaw === "lost"
      ? (statusRaw as Lead["status"])
      : "new"

  return {
    id: String(row.id),
    name,
    phone: String(row.phone_number || row.phone || ""),
    email: row.email || undefined,
    source,
    status,
    service_interest: String(row.service_interest || row.notes || row.service_type || "Service inquiry"),
    estimated_value: row.estimated_value != null ? Number(row.estimated_value) : undefined,
    notes: row.notes || undefined,
    conversation_context: row.conversation_context || undefined,
    hcp_customer_id: row.hcp_customer_id || undefined,
    created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    contacted_at: row.contacted_at ? String(row.contacted_at) : undefined,
    booked_at: row.booked_at ? String(row.booked_at) : undefined,
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const source = searchParams.get("source")
  const status = searchParams.get("status")
  const page = parseInt(searchParams.get("page") || "1")
  const per_page = parseInt(searchParams.get("per_page") || "20")

  const client = getSupabaseClient()
  const start = (page - 1) * per_page
  const end = start + per_page - 1

  let query = client
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })

  if (source) query = query.eq("source", source)
  if (status) query = query.eq("status", status)

  const { data, error, count } = await query.range(start, end)
  if (error) {
    const empty: PaginatedResponse<Lead> = { data: [], total: 0, page, per_page, total_pages: 0 }
    return NextResponse.json(empty)
  }

  const rows = (data || []).map(mapLead)
  const total = Number(count || 0)

  const response: PaginatedResponse<Lead> = {
    data: rows,
    total,
    page,
    per_page,
    total_pages: total ? Math.ceil(total / per_page) : 0,
  }

  return NextResponse.json(response)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const client = getSupabaseClient()

    const name = String(body.name || "").trim()
    const parts = name ? name.split(" ") : []
    const first_name = body.first_name || parts[0] || null
    const last_name = body.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : null)

    const inserted = await client
      .from("leads")
      .insert({
        source_id: body.source_id || `manual-${Date.now()}`,
        ghl_location_id: body.ghl_location_id || null,
        phone_number: body.phone || body.phone_number || "",
        first_name,
        last_name,
        email: body.email || null,
        source: body.source || "phone",
        status: "new",
        service_interest: body.service_interest || body.notes || null,
        estimated_value: body.estimated_value != null ? Number(body.estimated_value) : null,
        notes: body.notes || null,
        conversation_context: body.conversation_context || null,
        contacted_at: null,
        booked_at: null,
      })
      .select("*")
      .single()

    if (inserted.error) throw inserted.error

    const response: ApiResponse<Lead> = {
      success: true,
      data: mapLead(inserted.data),
      message: "Lead created successfully",
    }

    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create lead",
    }
    return NextResponse.json(response, { status: 400 })
  }
}
