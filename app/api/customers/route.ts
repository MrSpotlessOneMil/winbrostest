import { NextRequest, NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseClient()
  const tenant = await getAuthTenant(request)

  if (!tenant) {
    return NextResponse.json({ success: false, error: "No tenant found" }, { status: 500 })
  }

  // Fetch customers with their messages and jobs
  const { data: customers, error: customersError } = await client
    .from("customers")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("updated_at", { ascending: false })
    .limit(100)

  if (customersError) {
    return NextResponse.json({ success: false, error: customersError.message }, { status: 500 })
  }

  // Fetch messages for all customers
  const { data: messages, error: messagesError } = await client
    .from("messages")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("timestamp", { ascending: true })

  if (messagesError) {
    return NextResponse.json({ success: false, error: messagesError.message }, { status: 500 })
  }

  // Fetch jobs for all customers
  const { data: jobs, error: jobsError } = await client
    .from("jobs")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (jobsError) {
    return NextResponse.json({ success: false, error: jobsError.message }, { status: 500 })
  }

  // Fetch calls
  const { data: calls, error: callsError } = await client
    .from("calls")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (callsError) {
    return NextResponse.json({ success: false, error: callsError.message }, { status: 500 })
  }

  // Fetch leads for all customers
  const { data: leads, error: leadsError } = await client
    .from("leads")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (leadsError) {
    return NextResponse.json({ success: false, error: leadsError.message }, { status: 500 })
  }

  // Fetch pending scheduled tasks for lead follow-ups
  const { data: scheduledTasks, error: tasksError } = await client
    .from("scheduled_tasks")
    .select("*")
    .eq("tenant_id", tenant.id)
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
