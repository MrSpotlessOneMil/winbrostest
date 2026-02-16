import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseClient()
  const tenant = await getAuthTenant(request)

  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  // Fetch customers with their messages and jobs
  let customersQuery = client
    .from("customers")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(100)
  if (tenant) customersQuery = customersQuery.eq("tenant_id", tenant.id)
  const { data: customers, error: customersError } = await customersQuery

  if (customersError) {
    return NextResponse.json({ success: false, error: customersError.message }, { status: 500 })
  }

  // Fetch messages for all customers
  let messagesQuery = client
    .from("messages")
    .select("*")
    .order("timestamp", { ascending: true })
  if (tenant) messagesQuery = messagesQuery.eq("tenant_id", tenant.id)
  const { data: messages, error: messagesError } = await messagesQuery

  if (messagesError) {
    return NextResponse.json({ success: false, error: messagesError.message }, { status: 500 })
  }

  // Fetch jobs for all customers
  let jobsQuery = client
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false })
  if (tenant) jobsQuery = jobsQuery.eq("tenant_id", tenant.id)
  const { data: jobs, error: jobsError } = await jobsQuery

  if (jobsError) {
    return NextResponse.json({ success: false, error: jobsError.message }, { status: 500 })
  }

  // Fetch calls
  let callsQuery = client
    .from("calls")
    .select("*")
    .order("created_at", { ascending: false })
  if (tenant) callsQuery = callsQuery.eq("tenant_id", tenant.id)
  const { data: calls, error: callsError } = await callsQuery

  if (callsError) {
    return NextResponse.json({ success: false, error: callsError.message }, { status: 500 })
  }

  // Fetch leads for all customers
  let leadsQuery = client
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
  if (tenant) leadsQuery = leadsQuery.eq("tenant_id", tenant.id)
  const { data: leads, error: leadsError } = await leadsQuery

  if (leadsError) {
    return NextResponse.json({ success: false, error: leadsError.message }, { status: 500 })
  }

  // Fetch pending scheduled tasks for lead follow-ups
  let tasksQuery = client
    .from("scheduled_tasks")
    .select("*")
    .eq("task_type", "lead_followup")
    .in("status", ["pending", "processing"])
    .order("scheduled_for", { ascending: true })
  if (tenant) tasksQuery = tasksQuery.eq("tenant_id", tenant.id)
  const { data: scheduledTasks, error: tasksError } = await tasksQuery

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
