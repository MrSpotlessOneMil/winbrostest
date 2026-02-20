import { NextRequest, NextResponse } from "next/server"
import type { Job, ApiResponse, PaginatedResponse } from "@/lib/types"
import { getSupabaseServiceClient, getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { getTenantById } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { syncNewJobToHCP } from "@/lib/hcp-job-sync"

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

  // Get tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ data: [], total: 0, page: 1, per_page: 20, total_pages: 0 })
  }

  const searchParams = request.nextUrl.searchParams
  const date = searchParams.get("date")
  const team_id = searchParams.get("team_id")
  const status = searchParams.get("status")
  const page = parseInt(searchParams.get("page") || "1")
  const per_page = parseInt(searchParams.get("per_page") || "20")

  const client = tenant ? await getTenantScopedClient(tenant.id) : getSupabaseServiceClient()
  const start = (page - 1) * per_page
  const end = start + per_page - 1

  let query = client
    .from("jobs")
    .select("*, customers (*), teams ( id, name )", { count: "exact" })
    .order("created_at", { ascending: false })
  if (tenant) query = query.eq("tenant_id", tenant.id)

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

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  const isAdmin = !tenant && authResult.user.username === 'admin'
  if (!tenant && !isAdmin) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  try {
    const body = await request.json()
    const { id, date, scheduled_at, hours } = body

    if (!id) {
      return NextResponse.json({ success: false, error: "Job ID is required" }, { status: 400 })
    }

    const client = tenant
      ? await getTenantScopedClient(tenant.id)
      : getSupabaseServiceClient()

    // Fetch old job to detect time changes for SMS notification
    let oldJobQuery = client
      .from("jobs")
      .select("*, customers (*)")
      .eq("id", Number(id))
    if (tenant) oldJobQuery = oldJobQuery.eq("tenant_id", tenant.id)
    const { data: oldJob } = await oldJobQuery.single()

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (date !== undefined) updates.date = date
    if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at
    if (hours !== undefined) updates.hours = hours

    // Handle cleaner reassignment
    const { cleaner_id } = body
    if (cleaner_id !== undefined) {
      const tenantId = tenant?.id || (oldJob as any)?.tenant_id
      if (tenantId) {
        // Clear all existing assignments for this job and insert the new one
        await getSupabaseServiceClient().from("cleaner_assignments").delete().eq("job_id", Number(id))
        if (cleaner_id) {
          await getSupabaseServiceClient().from("cleaner_assignments").insert({
            job_id: Number(id),
            cleaner_id: Number(cleaner_id),
            status: "confirmed",
            tenant_id: tenantId,
            assigned_at: new Date().toISOString(),
            responded_at: new Date().toISOString(),
          })
        }
      }
    }

    let updateQuery = client
      .from("jobs")
      .update(updates)
      .eq("id", Number(id))
    if (tenant) updateQuery = updateQuery.eq("tenant_id", tenant.id)

    const { data, error } = await updateQuery
      .select("*, customers (*), cleaners (*)")
      .single()

    if (error) throw error

    // Send SMS notification if date or time changed
    // For admin, look up the job's tenant for business name
    const jobTenant = tenant || (oldJob?.tenant_id ? await getTenantById(oldJob.tenant_id) : null)
    if (oldJob && jobTenant && (date !== undefined || scheduled_at !== undefined)) {
      const oldDate = oldJob.date
      const oldTime = oldJob.scheduled_at
      const timeChanged = (date !== undefined && date !== oldDate) || (scheduled_at !== undefined && scheduled_at !== oldTime)

      if (timeChanged) {
        const customer = Array.isArray(oldJob.customers) ? oldJob.customers[0] : oldJob.customers
        const customerPhone = customer?.phone_number || oldJob.phone_number
        const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || "there"
        const businessName = (jobTenant as any).business_name_short || (jobTenant as any).name || "us"

        if (customerPhone) {
          const newDate = date || oldDate
          const newTime = scheduled_at || oldTime
          const dateFormatted = new Date(newDate + "T12:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
          // Format time for display
          const timeParts = String(newTime).match(/^(\d{1,2}):(\d{2})/)
          let timeFormatted = "9:00 AM"
          if (timeParts) {
            const h = parseInt(timeParts[1])
            const m = timeParts[2]
            const ampm = h >= 12 ? "PM" : "AM"
            const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
            timeFormatted = `${h12}:${m} ${ampm}`
          }

          const smsMessage = `Hi ${customerName}! Your ${businessName} cleaning has been rescheduled to ${dateFormatted} at ${timeFormatted}. Reply with any questions!`

          sendSMS(jobTenant as any, customerPhone, smsMessage).catch((err) =>
            console.error("[Jobs PATCH] Failed to send reschedule SMS:", err)
          )

          // Log the outbound message to the database
          const svcClient = getSupabaseServiceClient()
          svcClient.from("messages").insert({
            tenant_id: jobTenant.id,
            customer_id: customer?.id || oldJob.customer_id || null,
            phone_number: customerPhone,
            role: "assistant",
            content: smsMessage,
            direction: "outbound",
            message_type: "sms",
            ai_generated: false,
            source: "calendar_reschedule",
            job_id: Number(id),
            timestamp: new Date().toISOString(),
          }).then(({ error: logErr }) => {
            if (logErr) console.error("[Jobs PATCH] Failed to log reschedule message:", logErr)
          })
        }
      }
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update job" },
      { status: 400 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  const isAdmin = !tenant && authResult.user.username === "admin"
  if (!tenant && !isAdmin) {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }

  const id = request.nextUrl.searchParams.get("id")
  if (!id) {
    return NextResponse.json({ success: false, error: "Job ID is required" }, { status: 400 })
  }

  try {
    const svc = getSupabaseServiceClient()

    // Null out job references in tables that use SET NULL (messages, calls, leads)
    await svc.from("messages").update({ job_id: null }).eq("job_id", Number(id))
    await svc.from("calls").update({ job_id: null }).eq("job_id", Number(id))
    await svc.from("leads").update({ converted_to_job_id: null }).eq("converted_to_job_id", Number(id))

    // Delete the job — DB cascade handles cleaner_assignments, reviews, tips, upsells
    const client = tenant ? await getTenantScopedClient(tenant.id) : svc
    let deleteQuery = client.from("jobs").delete().eq("id", Number(id))
    if (tenant) deleteQuery = deleteQuery.eq("tenant_id", tenant.id)

    const { error } = await deleteQuery
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to delete job" },
      { status: 400 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) can't create without tenant context
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ success: false, error: "No tenant configured" }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ success: false, error: "Switch to a tenant account to create jobs" }, { status: 400 })
  }

  try {
    const body = await request.json()

    const client = await getTenantScopedClient(tenant.id)

    const rawPhone = String(body.customer_phone || body.phone || body.phone_number || "").trim()
    const phone = normalizePhoneNumber(rawPhone) || rawPhone
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
        notes: body.notes || undefined,
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

    // Sync to HouseCall Pro
    await syncNewJobToHCP({
      tenant: tenant as any,
      jobId: row.id,
      phone,
      firstName: first_name,
      lastName: last_name,
      address: body.address || null,
      serviceType: body.service_type || null,
      scheduledDate: scheduledDate || null,
      scheduledTime: scheduledAt || null,
      price: body.estimated_value != null ? Number(body.estimated_value) : null,
      notes: `Created from dashboard`,
    })

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
