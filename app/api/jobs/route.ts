import { NextRequest, NextResponse } from "next/server"
import type { Job, ApiResponse, PaginatedResponse } from "@/lib/types"
import { getSupabaseServiceClient, getTenantScopedClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"
import { getTenantById, tenantUsesFeature } from "@/lib/tenant"
import { sendSMS } from "@/lib/openphone"
import { normalizePhoneNumber } from "@/lib/phone-utils"
import { syncNewJobToHCP } from "@/lib/hcp-job-sync"
import { cleanerAssigned } from "@/lib/sms-templates"
import { triggerCleanerAssignment } from "@/lib/cleaner-assignment"

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
      return "quoted"
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
    .select("*, customers (*), teams ( id, name ), cleaners!jobs_cleaner_id_fkey ( id, name ), cleaner_assignments ( cleaner_id, status, cleaners ( id, name ) )", { count: "exact" })
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

    // Resolve cleaner name: direct FK first, then cleaner_assignments fallback
    let cleanerName: string | undefined
    const directCleaner = Array.isArray(row.cleaners) ? row.cleaners[0] : row.cleaners
    if (directCleaner?.name) {
      cleanerName = directCleaner.name
    } else if (Array.isArray(row.cleaner_assignments) && row.cleaner_assignments.length > 0) {
      const active = row.cleaner_assignments.find((a: any) => a.status === "confirmed")
        || row.cleaner_assignments.find((a: any) => a.status === "accepted")
        || row.cleaner_assignments.find((a: any) => a.status === "pending")
      if (active) {
        const c = Array.isArray(active.cleaners) ? active.cleaners[0] : active.cleaners
        if (c?.name) cleanerName = c.name
      }
    }

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
      cleaner_name: cleanerName || null,
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
    if (body.service_type !== undefined) updates.service_type = body.service_type
    if (body.address !== undefined) updates.address = body.address
    if (body.price !== undefined) updates.price = body.price
    if (body.status !== undefined) updates.status = body.status
    if (body.notes !== undefined) updates.notes = body.notes

    // Handle cleaner reassignment
    const { cleaner_id } = body
    if (cleaner_id !== undefined) {
      // Update the direct cleaner_id on jobs table so the calendar join reflects the change
      updates.cleaner_id = cleaner_id ? Number(cleaner_id) : null
      const tenantId = tenant?.id || (oldJob as any)?.tenant_id
      if (tenantId) {
        // Cancel all active assignments for this job
        await getSupabaseServiceClient()
          .from("cleaner_assignments")
          .update({ status: "cancelled" })
          .eq("job_id", Number(id))
          .in("status", ["pending", "accepted", "confirmed"])
        if (cleaner_id) {
          await getSupabaseServiceClient().from("cleaner_assignments").insert({
            job_id: Number(id),
            cleaner_id: Number(cleaner_id),
            status: "confirmed",
            tenant_id: tenantId,
            assigned_at: new Date().toISOString(),
            responded_at: new Date().toISOString(),
          })

          // Notify cleaner via Telegram + send customer confirmation SMS (fire-and-forget)
          const assignTenant = tenant || (tenantId ? await getTenantById(tenantId) : null)
          if (assignTenant) {
            const svc = getSupabaseServiceClient()
            const { data: cleaner } = await svc
              .from("cleaners")
              .select("id, name, phone, portal_token")
              .eq("id", Number(cleaner_id))
              .single()

            if (cleaner) {
              // SMS info message to cleaner with portal link
              if (cleaner.phone) {
                const jobDate = date || oldJob?.date || "TBD"
                const jobTime = scheduled_at || oldJob?.scheduled_at || ""
                const jobAddress = body.address || oldJob?.address || "TBD"
                const timeParts = String(jobTime).match(/^(\d{1,2}):(\d{2})/)
                let timeDisplay = ""
                if (timeParts) {
                  const h = parseInt(timeParts[1])
                  const m = timeParts[2]
                  const ampm = h >= 12 ? "PM" : "AM"
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                  timeDisplay = ` at ${h12}:${m} ${ampm}`
                }
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cleanmachine.live')
                const portalLink = cleaner.portal_token ? `\n\nView details & checklist:\n${baseUrl}/crew/${cleaner.portal_token}/job/${id}` : ''
                const smsMsg = `You've been assigned a new job! ${jobAddress}, ${jobDate}${timeDisplay}.${portalLink}`
                sendSMS(assignTenant as any, cleaner.phone, smsMsg).catch((err) =>
                  console.error("[Jobs PATCH] Failed to send SMS to cleaner:", err)
                )
              }

              // Customer SMS on reassignment — DISABLED (customers complained about spam)
              // Cleaner changes are internal; customer doesn't need to know
              if (false) {
              const customer = Array.isArray(oldJob?.customers) ? oldJob.customers[0] : oldJob?.customers
              const customerPhone = customer?.phone_number || oldJob?.phone_number
              const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() || "there"
              if (customerPhone) {
                const jobDate = date || oldJob?.date
                const jobTime = scheduled_at || oldJob?.scheduled_at || ""
                const dateFormatted = jobDate
                  ? new Date(jobDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                  : "your scheduled date"
                const timeParts = String(jobTime).match(/^(\d{1,2}):(\d{2})/)
                let timeFormatted = "your scheduled time"
                if (timeParts) {
                  const h = parseInt(timeParts[1])
                  const m = timeParts[2]
                  const ampm = h >= 12 ? "PM" : "AM"
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
                  timeFormatted = `${h12}:${m} ${ampm}`
                }
                const smsMsg = cleanerAssigned(customerName, cleaner.name || "Your cleaner", dateFormatted, timeFormatted)
                sendSMS(assignTenant as any, customerPhone, smsMsg).catch((err) =>
                  console.error("[Jobs PATCH] Failed to send assignment SMS:", err)
                )
                // Log outbound SMS
                svc.from("messages").insert({
                  tenant_id: assignTenant.id,
                  customer_id: customer?.id || oldJob?.customer_id || null,
                  phone_number: customerPhone,
                  role: "assistant",
                  content: smsMsg,
                  direction: "outbound",
                  message_type: "sms",
                  ai_generated: false,
                  source: "calendar_assign",
                  job_id: Number(id),
                  timestamp: new Date().toISOString(),
                }).then(({ error: logErr }) => {
                  if (logErr) console.error("[Jobs PATCH] Failed to log assignment message:", logErr)
                })
              }
              } // end disabled customer SMS block
            }
          }
        }
      }
    }

    let updateQuery = client
      .from("jobs")
      .update(updates)
      .eq("id", Number(id))
    if (tenant) updateQuery = updateQuery.eq("tenant_id", tenant.id)

    const { data, error } = await updateQuery
      .select("*, customers (*), cleaners!jobs_cleaner_id_fkey (*)")
      .single()

    if (error) throw error

    // Send SMS notification if date or time changed
    // Skip for recurring child jobs (bulk setup) — only notify for the parent/standalone
    // For admin, look up the job's tenant for business name
    const jobTenant = tenant || (oldJob?.tenant_id ? await getTenantById(oldJob.tenant_id) : null)
    const isRecurringChild = !!(oldJob?.parent_job_id)
    if (oldJob && jobTenant && !isRecurringChild && (date !== undefined || scheduled_at !== undefined)) {
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

    // Clean up related records before deleting
    // pending_sms_assignments references cleaner_assignments (no CASCADE), so delete first
    const { data: assignments } = await svc.from("cleaner_assignments").select("id").eq("job_id", Number(id)).eq("tenant_id", tenant.id)
    if (assignments && assignments.length > 0) {
      const assignmentIds = assignments.map((a: any) => a.id)
      await svc.from("pending_sms_assignments").delete().in("assignment_id", assignmentIds)
    }

    // Null out job references in tables that use SET NULL (messages, calls, leads)
    await svc.from("messages").update({ job_id: null }).eq("job_id", Number(id))
    await svc.from("calls").update({ job_id: null }).eq("job_id", Number(id))
    await svc.from("leads").update({ converted_to_job_id: null }).eq("converted_to_job_id", Number(id))

    // Delete the job — DB cascade handles cleaner_assignments, reviews, tips, upsells
    // Use service client (auth already verified above) with tenant_id filter for safety
    let deleteQuery = svc.from("jobs").delete().eq("id", Number(id))
    if (tenant) deleteQuery = deleteQuery.eq("tenant_id", tenant.id)

    const { data: deleted, error } = await deleteQuery.select("id")
    if (error) throw error

    // If tenant mismatch or already deleted, report failure
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ success: false, error: "Job not found or already deleted" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Failed to delete job:", error)
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to delete job" },
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
        // Update customer property details if provided
        const custUpdates: Record<string, any> = {}
        if (body.bedrooms != null) custUpdates.bedrooms = Number(body.bedrooms)
        if (body.bathrooms != null) custUpdates.bathrooms = Number(body.bathrooms)
        if (body.sqft != null) custUpdates.sqft = Number(body.sqft)
        if (body.lead_source) custUpdates.lead_source = String(body.lead_source)
        if (Object.keys(custUpdates).length > 0) {
          await client.from("customers").update(custUpdates).eq("id", customerId)
        }
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
            bedrooms: body.bedrooms != null ? Number(body.bedrooms) : undefined,
            bathrooms: body.bathrooms != null ? Number(body.bathrooms) : undefined,
            sqft: body.sqft != null ? Number(body.sqft) : undefined,
            lead_source: body.lead_source || undefined,
          })
          .select("*")
          .single()
        if (created.error) throw created.error
        customerId = Number(created.data.id)
      }
    }

    // Validate membership belongs to this tenant before linking
    let validatedMembershipId: string | undefined
    if (body.membership_id) {
      const { data: mem } = await client
        .from("customer_memberships")
        .select("id")
        .eq("id", body.membership_id)
        .eq("tenant_id", tenant.id)
        .eq("status", "active")
        .maybeSingle()
      if (!mem) {
        return NextResponse.json({ error: "Invalid or inactive membership" }, { status: 404 })
      }
      validatedMembershipId = mem.id
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
        status: body.status === "quoted" ? "quoted" : "scheduled",
        booked: body.status !== "quoted",
        addons: body.addons ? JSON.stringify(body.addons) : undefined,
        bedrooms: body.bedrooms != null ? Number(body.bedrooms) : undefined,
        bathrooms: body.bathrooms != null ? Number(body.bathrooms) : undefined,
        sqft: body.sqft != null ? Number(body.sqft) : undefined,
        frequency: body.frequency || "one-time",
        membership_id: validatedMembershipId,
        credited_salesman_id: body.credited_salesman_id ? Number(body.credited_salesman_id) : undefined,
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
      source: 'dashboard',
    })

    // Handle cleaner assignment at creation time
    // assignment_mode: "auto_broadcast" (default) | "specific" | "unassigned"
    // Supports cleaner_ids[] (multi) or legacy cleaner_id (single)
    const cleanerIds: string[] = Array.isArray(body.cleaner_ids) && body.cleaner_ids.length > 0
      ? body.cleaner_ids
      : body.cleaner_id ? [body.cleaner_id] : []
    const assignmentMode = body.assignment_mode || (cleanerIds.length > 0 ? 'specific' : 'auto_broadcast')

    if (assignmentMode === 'specific' && cleanerIds.length > 0) {
      // Manual assignment — create confirmed assignments + notify each cleaner
      const svc = getSupabaseServiceClient()
      const jobAddress = body.address || "TBD"
      const jobDate = scheduledDate || "TBD"
      const jobTime = scheduledAt || ""
      const timeParts = String(jobTime).match(/^(\d{1,2}):(\d{2})/)
      let timeDisplay = ""
      if (timeParts) {
        const h = parseInt(timeParts[1])
        const m = timeParts[2]
        const ampm = h >= 12 ? "PM" : "AM"
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
        timeDisplay = ` at ${h12}:${m} ${ampm}`
      }

      // Set first cleaner as primary on jobs table
      await svc.from("jobs").update({ cleaner_id: Number(cleanerIds[0]) }).eq("id", row.id)

      const cleanerNames: string[] = []
      for (const cId of cleanerIds) {
        await svc.from("cleaner_assignments").insert({
          job_id: Number(row.id),
          cleaner_id: Number(cId),
          status: "confirmed",
          tenant_id: tenant.id,
          assigned_at: new Date().toISOString(),
          responded_at: new Date().toISOString(),
        })

        const { data: cleaner } = await svc
          .from("cleaners")
          .select("id, name, phone, portal_token")
          .eq("id", Number(cId))
          .single()

        if (cleaner) {
          cleanerNames.push(cleaner.name || "Cleaner")
          if (cleaner.phone) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cleanmachine.live')
            const portalLink = cleaner.portal_token ? `\n\nView details & checklist:\n${baseUrl}/crew/${cleaner.portal_token}/job/${row.id}` : ''
            const smsMsg = `You've been assigned a new job! ${jobAddress}, ${jobDate}${timeDisplay}.${portalLink}`
            sendSMS(tenant as any, cleaner.phone, smsMsg).catch((err) =>
              console.error("[Jobs POST] Failed to send SMS to cleaner:", err)
            )
          }
        }
      }

      // Customer confirmation SMS (once, listing all assigned cleaners)
      if (phone) {
        const custName = [first_name, last_name].filter(Boolean).join(" ").trim() || "there"
        const dateFormatted = scheduledDate
          ? new Date(scheduledDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
          : "your scheduled date"
        const custTimeParts = String(scheduledAt || "").match(/^(\d{1,2}):(\d{2})/)
        let timeFormatted = "your scheduled time"
        if (custTimeParts) {
          const h = parseInt(custTimeParts[1])
          const m = custTimeParts[2]
          const ampm = h >= 12 ? "PM" : "AM"
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
          timeFormatted = `${h12}:${m} ${ampm}`
        }
        const teamLabel = cleanerNames.length > 1 ? `Your team (${cleanerNames.join(" & ")})` : (cleanerNames[0] || "Your cleaner")
        const smsMsg = cleanerAssigned(custName, teamLabel, dateFormatted, timeFormatted)
        sendSMS(tenant as any, phone, smsMsg).catch((err) =>
          console.error("[Jobs POST] Failed to send assignment SMS:", err)
        )
        svc.from("messages").insert({
          tenant_id: tenant.id,
          customer_id: customerId,
          phone_number: phone,
          role: "assistant",
          content: smsMsg,
          direction: "outbound",
          message_type: "sms",
          ai_generated: false,
          source: "calendar_assign",
          job_id: Number(row.id),
          timestamp: new Date().toISOString(),
        }).then(({ error: logErr }) => {
          if (logErr) console.error("[Jobs POST] Failed to log assignment message:", logErr)
        })
      }
    } else if ((assignmentMode === 'auto_broadcast' || assignmentMode === 'ranked') && tenantUsesFeature(tenant as any, 'use_cleaner_dispatch')) {
      // Auto-dispatch: pass explicit mode override when ranked is selected from dropdown
      const modeOverride = assignmentMode === 'ranked' ? 'ranked' as const : undefined
      triggerCleanerAssignment(String(row.id), undefined, modeOverride).catch((err) =>
        console.error("[Jobs POST] Auto-dispatch failed:", err)
      )
    }
    // assignmentMode === 'unassigned' → do nothing, job sits unassigned until manually picked

    // Generate recurring instances if frequency is not one-time
    const freq = body.frequency || "one-time"
    if (freq !== "one-time" && scheduledDate) {
      generateRecurringInstances({
        parentJobId: Number(row.id),
        tenantId: tenant.id,
        customerId,
        phone,
        address: body.address || undefined,
        serviceType: body.service_type || "Standard cleaning",
        scheduledAt,
        hours: body.duration_minutes ? Number(body.duration_minutes) / 60 : undefined,
        price: body.estimated_value != null ? Number(body.estimated_value) : undefined,
        notes: body.notes || undefined,
        bedrooms: body.bedrooms != null ? Number(body.bedrooms) : undefined,
        bathrooms: body.bathrooms != null ? Number(body.bathrooms) : undefined,
        sqft: body.sqft != null ? Number(body.sqft) : undefined,
        frequency: freq,
        startDate: scheduledDate,
        addons: body.addons ? JSON.stringify(body.addons) : undefined,
      }).catch((err) => console.error("[Jobs POST] Failed to generate recurring instances:", err))
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

// ─── Recurring Job Generation ───────────────────────────────────────────────

const RECURRING_HORIZON_WEEKS = 52 // Generate 1 year ahead — cron extends daily, so effectively infinite

function calculateNextDate(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + "T12:00:00")
  switch (frequency) {
    case "weekly":
      d.setDate(d.getDate() + 7)
      break
    case "bi-weekly":
      d.setDate(d.getDate() + 14)
      break
    case "monthly":
      d.setMonth(d.getMonth() + 1)
      break
    default:
      return dateStr
  }
  return d.toISOString().split("T")[0]
}

function getIntervalDays(frequency: string): number {
  switch (frequency) {
    case "weekly": return 7
    case "bi-weekly": return 14
    case "monthly": return 30
    default: return 0
  }
}

async function generateRecurringInstances(opts: {
  parentJobId: number
  tenantId: string
  customerId: number | null
  phone: string
  address?: string
  serviceType: string
  scheduledAt?: string
  hours?: number
  price?: number
  notes?: string
  bedrooms?: number
  bathrooms?: number
  sqft?: number
  frequency: string
  startDate: string
  addons?: string
}) {
  const client = getSupabaseServiceClient()
  const horizonDays = RECURRING_HORIZON_WEEKS * 7
  const maxDate = new Date()
  maxDate.setDate(maxDate.getDate() + horizonDays)
  const maxDateStr = maxDate.toISOString().split("T")[0]

  const instances: any[] = []
  let nextDate = calculateNextDate(opts.startDate, opts.frequency)

  while (nextDate <= maxDateStr) {
    instances.push({
      tenant_id: opts.tenantId,
      customer_id: opts.customerId,
      phone_number: opts.phone,
      address: opts.address,
      service_type: opts.serviceType,
      date: nextDate,
      scheduled_at: opts.scheduledAt,
      hours: opts.hours,
      price: opts.price,
      notes: opts.notes,
      bedrooms: opts.bedrooms,
      bathrooms: opts.bathrooms,
      sqft: opts.sqft,
      frequency: opts.frequency,
      status: "scheduled",
      booked: false,
      parent_job_id: opts.parentJobId,
      addons: opts.addons,
    })
    nextDate = calculateNextDate(nextDate, opts.frequency)
  }

  if (instances.length === 0) return

  const { error } = await client.from("jobs").insert(instances)
  if (error) {
    console.error(`[Recurring Jobs] Failed to insert ${instances.length} instances:`, error.message)
    return
  }

  // Update parent with last generated date
  const lastDate = instances[instances.length - 1].date
  await client.from("jobs").update({ last_generated_date: lastDate }).eq("id", opts.parentJobId)

  console.log(`[Recurring Jobs] Generated ${instances.length} ${opts.frequency} instances from job ${opts.parentJobId} through ${lastDate}`)
}
