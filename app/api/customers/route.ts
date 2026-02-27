import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, requireAuthWithTenant, getAuthTenant } from "@/lib/auth"
import { syncCustomerToHCP } from "@/lib/hcp-job-sync"

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
  const allowed = ["first_name", "last_name", "email", "phone_number", "address", "notes"]
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
    if (tenant.housecall_pro_api_key) {
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

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : (await import("@/lib/supabase")).getSupabaseServiceClient()

  // Fetch customers with their messages and jobs
  const { data: customers, error: customersError } = await client
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100)

  if (customersError) {
    return NextResponse.json({ success: false, error: customersError.message }, { status: 500 })
  }

  // Fetch messages for all customers
  const { data: messages, error: messagesError } = await client
    .from("messages")
    .select("*")
    .order("timestamp", { ascending: true })

  if (messagesError) {
    return NextResponse.json({ success: false, error: messagesError.message }, { status: 500 })
  }

  // Fetch jobs for all customers
  const { data: jobs, error: jobsError } = await client
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })

  if (jobsError) {
    return NextResponse.json({ success: false, error: jobsError.message }, { status: 500 })
  }

  // Fetch calls
  const { data: calls, error: callsError } = await client
    .from("calls")
    .select("*")
    .order("created_at", { ascending: false })

  if (callsError) {
    return NextResponse.json({ success: false, error: callsError.message }, { status: 500 })
  }

  // Fetch leads for all customers
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

  return NextResponse.json({
    success: true,
    data: {
      customers: customers || [],
      messages: messages || [],
      jobs: jobs || [],
      calls: calls || [],
      leads: leads || [],
      scheduledTasks: scheduledTasks || [],
    },
  })
}
