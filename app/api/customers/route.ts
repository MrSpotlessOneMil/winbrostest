import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, requireAuthWithTenant, getAuthTenant } from "@/lib/auth"
import { syncCustomerToHCP } from "@/lib/hcp-job-sync"
import { isHcpSyncEnabled } from "@/lib/tenant"

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const body = await request.json()
  const { phone_number, first_name, last_name, email, address, notes, is_commercial } = body

  if (!phone_number || phone_number.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ success: false, error: "Valid phone number is required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  try {
    const { data, error } = await client
      .from("customers")
      .insert({
        tenant_id: tenant.id,
        phone_number: phone_number.trim(),
        first_name: first_name?.trim() || null,
        last_name: last_name?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
        is_commercial: is_commercial || false,
      })
      .select("*")
      .single()

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ success: false, error: "A customer with this phone number already exists" }, { status: 409 })
      }
      console.error("[customers] POST failed:", error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Sync to HouseCall Pro if enabled
    if (isHcpSyncEnabled(tenant)) {
      syncCustomerToHCP({
        tenantId: tenant.id,
        customerId: data.id,
        phone: data.phone_number,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        address: data.address,
      }).catch((err) => console.error("[customers] HCP sync error:", err))
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[customers] POST error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = await getTenantScopedClient(tenant.id)
  const body = await request.json()
  const { id, ...fields } = body

  if (!id) {
    return NextResponse.json({ success: false, error: "Missing customer id" }, { status: 400 })
  }

  // Whitelist updatable fields
  const allowed = ["first_name", "last_name", "email", "phone_number", "address", "notes", "auto_response_paused", "is_commercial", "lifecycle_stage"]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates[key] = typeof fields[key] === "string" ? fields[key].trim() : fields[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: "No valid fields to update" }, { status: 400 })
  }

  try {
    const { data, error } = await client
      .from("customers")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single()

    if (error) {
      console.error("[customers] PATCH failed:", error.message)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    // Sync changes to HouseCall Pro
    if (isHcpSyncEnabled(tenant)) {
      syncCustomerToHCP({
        tenantId: tenant.id,
        customerId: data.id,
        phone: data.phone_number,
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        address: data.address,
      }).catch((err) => console.error("[customers] HCP sync error:", err))
    }

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error("[customers] PATCH error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)

  // Admin user (no tenant_id) can delete from any tenant; regular users must have a tenant
  const isAdmin = !tenant && authResult.user.username === 'admin'
  if (!tenant && !isAdmin) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get("id")
  if (!customerId) {
    return NextResponse.json({ success: false, error: "Missing customer id" }, { status: 400 })
  }

  // Admin uses service client (bypasses RLS); tenant users use scoped client
  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  try {
    // Fetch the customer first to get phone_number (for related data cleanup)
    const { data: customer, error: fetchError } = await client
      .from("customers")
      .select("phone_number")
      .eq("id", customerId)
      .single()

    if (fetchError || !customer) {
      return NextResponse.json({ success: false, error: "Customer not found" }, { status: 404 })
    }

    const phone = customer.phone_number
    const custId = parseInt(customerId)

    // Get all lead IDs for this customer (needed to clean up lead-dependent FKs)
    const { data: customerLeads } = await client
      .from("leads")
      .select("id")
      .or(`customer_id.eq.${custId},phone_number.eq.${phone}`)
    const leadIds = (customerLeads || []).map((l: { id: number }) => l.id)

    // Get all job IDs for this customer (needed to clean up job-dependent tables)
    const { data: customerJobs } = await client
      .from("jobs")
      .select("id")
      .or(`customer_id.eq.${custId},phone_number.eq.${phone},customer_phone.eq.${phone}`)
    const jobIds = (customerJobs || []).map((j: { id: number }) => j.id)

    // Delete scheduled_tasks for these leads
    for (const leadId of leadIds) {
      await client.from("scheduled_tasks").delete().like("task_key", `lead-${leadId}-%`)
    }

    // Delete in FK-safe order: deepest dependencies first
    if (jobIds.length > 0) {
      await client.from("cleaner_assignments").delete().in("job_id", jobIds)
      await client.from("reviews").delete().in("job_id", jobIds)
      await client.from("tips").delete().in("job_id", jobIds)
      await client.from("upsells").delete().in("job_id", jobIds)
    }
    // Also delete reviews linked directly to customer
    await client.from("reviews").delete().eq("customer_id", custId)

    // Delete system_events by phone
    await client.from("system_events").delete().eq("phone_number", phone)

    // Delete messages and calls — match by customer_id, phone, AND lead_id
    // (messages/calls have FK to leads with NO ACTION, so must be deleted before leads)
    await client.from("messages").delete().or(`customer_id.eq.${custId},phone_number.eq.${phone}`)
    await client.from("calls").delete().or(`customer_id.eq.${custId},phone_number.eq.${phone}`)
    if (leadIds.length > 0) {
      // Catch any messages/calls linked by lead_id but not by customer_id/phone
      await client.from("messages").delete().in("lead_id", leadIds)
      await client.from("calls").delete().in("lead_id", leadIds)
    }

    // Nullify converted_to_job_id in any leads referencing these jobs (other customers' leads)
    if (jobIds.length > 0) {
      await client.from("leads").update({ converted_to_job_id: null }).in("converted_to_job_id", jobIds)
    }

    // Delete leads
    if (leadIds.length > 0) {
      await client.from("leads").delete().in("id", leadIds)
    }

    // Delete followup_queue entries
    await client.from("followup_queue").delete().eq("phone_number", phone)

    // Delete jobs
    if (jobIds.length > 0) {
      await client.from("jobs").delete().in("id", jobIds)
    }

    // Delete the customer
    const { error: deleteError } = await client
      .from("customers")
      .delete()
      .eq("id", customerId)

    if (deleteError) {
      console.error("[customers] DELETE failed:", deleteError.message)
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[customers] DELETE error:", error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)

  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  const searchQuery = request.nextUrl.searchParams.get("search")?.trim() || ""

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : (await import("@/lib/supabase")).getSupabaseServiceClient()

  // Fetch messages first — needed to sort customers by last activity
  const { data: messages, error: messagesError } = await client
    .from("messages")
    .select("*")
    .order("timestamp", { ascending: true })

  if (messagesError) {
    return NextResponse.json({ success: false, error: messagesError.message }, { status: 500 })
  }

  // Fetch customers — server-side search if query provided
  let customersQuery = client
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false })

  if (searchQuery) {
    // Strip non-digits for phone search
    const digits = searchQuery.replace(/\D/g, "")
    if (digits.length >= 4) {
      // Search by phone, name, email, or address
      customersQuery = customersQuery.or(
        `phone_number.ilike.%${digits}%,first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`
      )
    } else {
      // Name, email, or address search
      customersQuery = customersQuery.or(
        `first_name.ilike.%${searchQuery}%,last_name.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%,address.ilike.%${searchQuery}%`
      )
    }
    customersQuery = customersQuery.limit(50)
  } else {
    customersQuery = customersQuery.limit(200)
  }

  const { data: baseCustomers, error: customersError } = await customersQuery

  if (customersError) {
    return NextResponse.json({ success: false, error: customersError.message }, { status: 500 })
  }

  // Normalize phone to 10 digits for comparison
  const normalizePhoneDigits = (phone: string) => {
    let digits = (phone || "").replace(/\D/g, "")
    if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
    return digits
  }

  // When searching, also find customers whose messages contain the search query
  let customers = baseCustomers || []
  if (searchQuery && messages && messages.length > 0) {
    const existingIds = new Set(customers.map((c: { id: number }) => c.id))
    const matchingPhones = new Set<string>()
    const lowerSearch = searchQuery.toLowerCase()
    for (const msg of messages as Array<{ phone_number: string; content?: string }>) {
      if (msg.content && msg.content.toLowerCase().includes(lowerSearch)) {
        matchingPhones.add(msg.phone_number)
      }
    }
    if (matchingPhones.size > 0) {
      const phonesArray = Array.from(matchingPhones).slice(0, 50)
      const { data: msgCustomers } = await client
        .from("customers")
        .select("*")
        .in("phone_number", phonesArray)
      if (msgCustomers) {
        for (const c of msgCustomers) {
          if (!existingIds.has(c.id)) {
            customers.push(c)
            existingIds.add(c.id)
          }
        }
      }
    }
  }

  // Ensure customers with recent messages are included even if they fell outside limit(200)
  if (!searchQuery && messages && messages.length > 0) {
    const existingPhones = new Set(customers.map((c: { phone_number: string }) => normalizePhoneDigits(c.phone_number)))

    // Get unique phone numbers from recent messages not already in our customer list
    const missingPhones = new Set<string>()
    for (const msg of messages as Array<{ phone_number: string }>) {
      const norm = normalizePhoneDigits(msg.phone_number)
      if (norm && !existingPhones.has(norm)) missingPhones.add(msg.phone_number)
    }

    if (missingPhones.size > 0) {
      // Fetch those missing customers
      const phonesArray = Array.from(missingPhones).slice(0, 50)
      const { data: extraCustomers } = await client
        .from("customers")
        .select("*")
        .in("phone_number", phonesArray)
      if (extraCustomers && extraCustomers.length > 0) {
        customers = [...customers, ...extraCustomers]
      }
    }
  }

  const { data: jobs, error: jobsError } = await client
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })

  if (jobsError) {
    return NextResponse.json({ success: false, error: jobsError.message }, { status: 500 })
  }

  const { data: calls, error: callsError } = await client
    .from("calls")
    .select("*")
    .order("created_at", { ascending: false })

  if (callsError) {
    return NextResponse.json({ success: false, error: callsError.message }, { status: 500 })
  }

  const { data: leads, error: leadsError } = await client
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })

  if (leadsError) {
    return NextResponse.json({ success: false, error: leadsError.message }, { status: 500 })
  }

  // Fetch pending scheduled tasks for lead follow-ups
  const { data: scheduledTasks, error: tasksError } = await client
    .from("scheduled_tasks")
    .select("*")
    .eq("task_type", "lead_followup")
    .in("status", ["pending", "processing"])
    .order("scheduled_for", { ascending: true })

  if (tasksError) {
    console.error("Error fetching scheduled tasks:", tasksError.message)
    // Don't fail the whole request if tasks fail
  }

  // Sort customers by last message/lead activity (most recent first)
  // Build a map of phone -> latest activity timestamp
  const lastActivityMap = new Map<string, number>()
  for (const msg of (messages || []) as Array<{ phone_number: string; timestamp: string }>) {
    const key = normalizePhoneDigits(msg.phone_number)
    const ts = new Date(msg.timestamp).getTime()
    const cur = lastActivityMap.get(key) || 0
    if (ts > cur) lastActivityMap.set(key, ts)
  }
  for (const lead of (leads || []) as Array<{ phone_number: string; last_contact_at?: string; created_at: string }>) {
    const key = normalizePhoneDigits(lead.phone_number)
    const ts = new Date(lead.last_contact_at || lead.created_at).getTime()
    const cur = lastActivityMap.get(key) || 0
    if (ts > cur) lastActivityMap.set(key, ts)
  }

  // Sort: customers with recent activity first, then by updated_at
  const sortedCustomers = (customers || []).sort((a: { phone_number: string; updated_at: string }, b: { phone_number: string; updated_at: string }) => {
    const aActivity = lastActivityMap.get(normalizePhoneDigits(a.phone_number)) || 0
    const bActivity = lastActivityMap.get(normalizePhoneDigits(b.phone_number)) || 0
    if (aActivity !== bActivity) return bActivity - aActivity
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

  // Fetch active cleaner phones for badge display
  let cleanerPhones: string[] = []
  if (tenant) {
    const serviceClient = getSupabaseServiceClient()
    const { data: cleaners } = await serviceClient
      .from("cleaners")
      .select("phone")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .not("phone", "is", null)

    if (cleaners) {
      cleanerPhones = cleaners
        .map((c: { phone: string }) => {
          let digits = (c.phone || "").replace(/\D/g, "")
          if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
          return digits
        })
        .filter((p: string) => p.length >= 7)
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      customers: sortedCustomers,
      messages,
      jobs,
      calls,
      leads,
      scheduledTasks: scheduledTasks || [],
      cleanerPhones,
    },
  })
}
