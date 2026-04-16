import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAdmin } from "@/lib/auth"

// GET — List cleaners for a tenant
export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = request.nextUrl.searchParams.get("tenant_id")
  if (!tenantId) {
    return NextResponse.json({ error: "tenant_id is required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from("cleaners")
    .select("id, tenant_id, name, phone, email, telegram_id, telegram_username, is_team_lead, home_address, max_jobs_per_day, active, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("active", { ascending: false })
    .order("name", { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cleaners: data })
}

// POST — Create a new cleaner
export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { tenant_id, name, phone, email, telegram_id, telegram_username, is_team_lead, home_address, max_jobs_per_day } = body

  if (!tenant_id || !name?.trim()) {
    return NextResponse.json({ error: "tenant_id and name are required" }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const insert: Record<string, any> = { tenant_id, name: name.trim(), active: true }
  if (phone) insert.phone = phone
  if (email) insert.email = email
  if (telegram_id) insert.telegram_id = telegram_id
  if (telegram_username) insert.telegram_username = telegram_username
  if (is_team_lead !== undefined) insert.is_team_lead = is_team_lead
  if (home_address) insert.home_address = home_address
  if (max_jobs_per_day !== undefined) {
    const parsed = parseInt(max_jobs_per_day)
    if (isNaN(parsed) || parsed < 1) return NextResponse.json({ error: "max_jobs_per_day must be at least 1" }, { status: 400 })
    insert.max_jobs_per_day = parsed
  }

  const { data, error } = await client
    .from("cleaners")
    .insert(insert)
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A cleaner with this phone number already exists for this tenant" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cleaner: data }, { status: 201 })
}

// PUT — Update a cleaner
export async function PUT(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id, tenant_id, ...updates } = body

  if (!id || !tenant_id) {
    return NextResponse.json({ error: "id and tenant_id are required" }, { status: 400 })
  }

  if (updates.name !== undefined && !updates.name?.trim()) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 })
  }

  // Only allow updating safe fields — use explicit null for cleared values
  const clearable = ["phone", "email", "telegram_id", "telegram_username", "home_address"]
  const safeUpdates: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const key of clearable) {
    if (key in updates) safeUpdates[key] = updates[key] || null
  }
  if (updates.name !== undefined) safeUpdates.name = updates.name.trim()
  if (updates.is_team_lead !== undefined) safeUpdates.is_team_lead = updates.is_team_lead
  if (updates.active !== undefined) safeUpdates.active = updates.active
  if (updates.max_jobs_per_day !== undefined) {
    const parsed = parseInt(updates.max_jobs_per_day)
    if (isNaN(parsed) || parsed < 1) return NextResponse.json({ error: "max_jobs_per_day must be at least 1" }, { status: 400 })
    safeUpdates.max_jobs_per_day = parsed
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from("cleaners")
    .update(safeUpdates)
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .is("deleted_at", null)
    .select()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A cleaner with this phone number already exists for this tenant" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Cleaner not found" }, { status: 404 })
  }

  return NextResponse.json({ cleaner: data[0] })
}

// DELETE — Soft-delete a cleaner (set deleted_at + active=false)
export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const id = request.nextUrl.searchParams.get("id")
  const tenantId = request.nextUrl.searchParams.get("tenant_id")

  if (!id || !tenantId) {
    return NextResponse.json({ error: "id and tenant_id are required" }, { status: 400 })
  }

  const parsedId = parseInt(id)
  if (isNaN(parsedId)) {
    return NextResponse.json({ error: "id must be a number" }, { status: 400 })
  }

  const now = new Date().toISOString()
  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from("cleaners")
    .update({ active: false, deleted_at: now, updated_at: now })
    .eq("id", parsedId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Cleaner not found" }, { status: 404 })
  }

  // Unassign all non-completed/non-closed jobs from the deleted cleaner
  // This returns those jobs to the unscheduled bank
  const { data: unassigned } = await client
    .from("jobs")
    .update({ cleaner_id: null })
    .eq("cleaner_id", parsedId)
    .eq("tenant_id", tenantId)
    .not("status", "in", '("completed","closed")')
    .select("id")

  return NextResponse.json({
    success: true,
    unassigned_jobs: unassigned?.length ?? 0,
  })
}