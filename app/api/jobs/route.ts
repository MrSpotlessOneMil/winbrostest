import { NextRequest, NextResponse } from "next/server"
import type { Job, ApiResponse, PaginatedResponse } from "@/lib/types"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"

function mapDbStatusToApi(status: string | null | undefined): Job["status"] {
  switch ((status || "").toLowerCase()) {
    case "cancelled":
      return "cancelled"
    case "completed":
      return "completed"
    case "in_progress":
      return "in-progress"
    case "scheduled":
      return "scheduled"
    case "quoted":
      return "confirmed"
    case "lead":
      return "scheduled"
    default:
      return "scheduled"
  }
}

function mapDbServiceTypeToApi(serviceType: string | null | undefined): Job["service_type"] {
  const raw = (serviceType || "").toLowerCase()
  if (raw.includes("gutter")) return "gutter_cleaning"
  if (raw.includes("pressure")) return "pressure_washing"
  if (raw.includes("window")) return "window_cleaning"
  return "full_service"
}

function toIsoDateOnly(value: unknown): string {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function toTimeHHMM(value: unknown): string {
  if (!value) return "09:00"
  const s = String(value)
  // Postgres `time` comes through like "10:30:00"
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5)
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 16)
  return "09:00"
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ data: [], total: 0, page: 1, per_page: 20, total_pages: 0 })
  }

  const searchParams = request.nextUrl.searchParams
  const date = searchParams.get("date")
  const team_id = searchParams.get("team_id")
  const status = searchParams.get("status")
  const page = parseInt(searchParams.get("page") || "1")
  const per_page = parseInt(searchParams.get("per_page") || "20")

  const client = getSupabaseServiceClient()
  const start = (page - 1) * per_page
  const end = start + per_page - 1

  let query = client
    .from("jobs")
    .select("*, customers (*), teams ( id, name )", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (date) query = query.eq("date", date)
  if (status) query = query.eq("status", status === "in-progress" ? "in_progress" : status)
  if (team_id) query = query.eq("team_id", Number(team_id))

  const { data: rows, error, count } = await query.range(start, end)
  if (error) {
    const empty: PaginatedResponse<Job> = { data: [], total: 0, page, per_page, total_pages: 0 }
    return NextResponse.json(empty)
  }

  const jobs: Job[] = (rows || []).map((row: any) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams

    const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || "Unknown"
    const scheduledDate = toIsoDateOnly(row.date || row.created_at)
    const scheduledTime = toTimeHHMM(row.scheduled_at)
    const durationMinutes = row.hours ? Math.round(Number(row.hours) * 60) : 120
    const estimatedValue = row.price ? Number(row.price) : 0

    return {
      id: String(row.id),
      hcp_job_id: row.hcp_job_id ? String(row.hcp_job_id) : "",
      customer_id: customer?.id != null ? String(customer.id) : String(row.customer_id ?? ""),
      customer_name: customerName,
      customer_phone: String(customer?.phone_number || row.phone_number || ""),
      address: String(row.address || customer?.address || ""),
      service_type: mapDbServiceTypeToApi(row.service_type),
      scheduled_date: scheduledDate,
      scheduled_time: scheduledTime,
      duration_minutes: durationMinutes,
      estimated_value: estimatedValue,
      actual_value: row.actual_value != null ? Number(row.actual_value) : undefined,
      status: mapDbStatusToApi(row.status),
      team_id: row.team_id != null ? String(row.team_id) : undefined,
      team_confirmed: Boolean(row.team_id),
      team_confirmed_at: row.updated_at ? String(row.updated_at) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      upsell_notes: row.upsell_notes ? String(row.upsell_notes) : undefined,
      completion_notes: row.completion_notes ? String(row.completion_notes) : undefined,
      created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
      updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    }
  })

  const total = Number(count || 0)
  const response: PaginatedResponse<Job> = {
    data: jobs,
    total,
    page,
    per_page,
    total_pages: total ? Math.ceil(total / per_page) : 0,
  }

  return NextResponse.json(response)
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  try {
    const body = await request.json()

    const client = getSupabaseServiceClient()

    const phone = String(body.customer_phone || body.phone || body.phone_number || "").trim()
    const firstLast = String(body.customer_name || body.name || "Unknown").trim().split(" ")
    const first_name = firstLast[0] || undefined
    const last_name = firstLast.slice(1).join(" ") || undefined

    // Upsert-like behavior: create customer if not found by phone_number.
    let customerId: number | null = null
    if (phone) {
      const existing = await client
        .from("customers")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("phone_number", phone)
        .maybeSingle()
      if (!existing.error && existing.data?.id != null) {
        customerId = Number(existing.data.id)
      } else {
        const created = await client
          .from("customers")
          .insert({
            tenant_id: tenant.id,
            phone_number: phone,
            first_name,
            last_name,
            email: body.email || undefined,
            address: body.address || undefined,
          })
          .select("*")
          .single()
        if (created.error) throw created.error
        customerId = Number(created.data.id)
      }
    }

    const scheduledDate = body.scheduled_date || body.date || undefined
    const scheduledAt = body.scheduled_time || body.scheduled_at || undefined
    const inserted = await client
      .from("jobs")
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        phone_number: phone,
        address: body.address || undefined,
        service_type: body.service_type || "Standard cleaning",
        date: scheduledDate,
        scheduled_at: scheduledAt,
        hours: body.duration_minutes ? Number(body.duration_minutes) / 60 : undefined,
        price: body.estimated_value != null ? Number(body.estimated_value) : undefined,
        status: "scheduled",
        booked: true,
      })
      .select("*, customers (*)")
      .single()
    if (inserted.error) throw inserted.error

    const row: any = inserted.data
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    const customerName =
      [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || body.customer_name || "Unknown"

    const createdJob: Job = {
      id: String(row.id),
      hcp_job_id: "",
      customer_id: customer?.id != null ? String(customer.id) : String(row.customer_id ?? ""),
      customer_name: customerName,
      customer_phone: String(customer?.phone_number || row.phone_number || ""),
      address: String(row.address || customer?.address || ""),
      service_type: mapDbServiceTypeToApi(row.service_type),
      scheduled_date: toIsoDateOnly(row.date || row.created_at),
      scheduled_time: toTimeHHMM(row.scheduled_at),
      duration_minutes: row.hours ? Math.round(Number(row.hours) * 60) : 120,
      estimated_value: row.price ? Number(row.price) : 0,
      status: mapDbStatusToApi(row.status),
      team_confirmed: false,
      created_at: row.created_at ? String(row.created_at) : new Date().toISOString(),
      updated_at: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    }

    const response: ApiResponse<Job> = { success: true, data: createdJob, message: "Job created successfully" }
    return NextResponse.json(response, { status: 201 })
  } catch (error) {
    const response: ApiResponse<never> = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create job",
    }
    return NextResponse.json(response, { status: 400 })
  }
}
