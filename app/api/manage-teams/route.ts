import { NextRequest, NextResponse } from "next/server"
import { getTenantScopedClient, getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

type TeamRow = { id: number; name: string; active: boolean; deleted_at?: string | null }
type CleanerRow = { id: number; name: string; phone?: string | null; email?: string | null; telegram_id?: string | null; active: boolean; deleted_at?: string | null; is_team_lead?: boolean }
type TeamMemberRow = { id: number; team_id: number; cleaner_id: number; role: "lead" | "technician"; is_active: boolean }

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return jsonError("No tenant configured. Please set up the winbros tenant first.", 500)
  }

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  let teamsQ = client.from("teams").select("id,name,active,deleted_at").is("deleted_at", null).order("created_at", { ascending: true })
  let cleanersQ = client.from("cleaners").select("id,name,phone,email,telegram_id,active,deleted_at,is_team_lead").is("deleted_at", null).order("created_at", { ascending: true })
  let membersQ = client.from("team_members").select("id,team_id,cleaner_id,role,is_active").order("created_at", { ascending: true })
  if (tenant) {
    teamsQ = teamsQ.eq("tenant_id", tenant.id)
    cleanersQ = cleanersQ.eq("tenant_id", tenant.id)
    membersQ = membersQ.eq("tenant_id", tenant.id)
  }

  const [teamsRes, cleanersRes, membersRes] = await Promise.all([teamsQ, cleanersQ, membersQ])

  if (teamsRes.error) return jsonError(teamsRes.error.message, 500)
  if (cleanersRes.error) return jsonError(cleanersRes.error.message, 500)
  if (membersRes.error) return jsonError(membersRes.error.message, 500)

  const teams = (teamsRes.data || []).filter((t: any) => Boolean(t.active)) as TeamRow[]
  const cleaners = (cleanersRes.data || []).filter((c: any) => Boolean(c.active)) as CleanerRow[]
  const members = (membersRes.data || []).filter((m: any) => Boolean(m.is_active)) as TeamMemberRow[]

  // Map cleaner -> team_id (first active membership wins)
  const cleanerTeam = new Map<number, number>()
  for (const m of members) {
    if (!cleanerTeam.has(Number(m.cleaner_id))) {
      cleanerTeam.set(Number(m.cleaner_id), Number(m.team_id))
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      teams,
      cleaners: cleaners.map((c) => ({ ...c, team_id: cleanerTeam.get(Number(c.id)) ?? null })),
    },
  })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data; writes still need a tenant
  if (!tenant && authResult.user.username !== 'admin') {
    return jsonError("No tenant configured. Please set up the winbros tenant first.", 500)
  }
  if (!tenant) {
    return jsonError("Switch to a tenant account to manage teams", 400)
  }

  const client = await getTenantScopedClient(tenant.id)
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "")

  if (action === "create_team") {
    const name = String(body.name || "").trim()
    if (!name) return jsonError("Team name is required")
    const { data, error } = await client.from("teams").insert({ tenant_id: tenant.id, name, active: true }).select("id,name,active,deleted_at").single()
    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ success: true, data })
  }

  if (action === "create_cleaner") {
    const name = String(body.name || "").trim()
    const phone = body.phone != null ? String(body.phone).trim() : null
    const email = body.email != null ? String(body.email).trim() : null
    const telegram_id = body.telegram_id != null ? String(body.telegram_id).trim() : null
    const is_team_lead = Boolean(body.is_team_lead)

    if (!name) return jsonError("Cleaner name is required")

    const { data, error } = await client
      .from("cleaners")
      .insert({
        tenant_id: tenant.id,
        name,
        phone: phone || null,
        email: email || null,
        telegram_id: telegram_id || null,
        is_team_lead,
        active: true
      })
      .select("id,name,phone,email,telegram_id,is_team_lead,active,deleted_at")
      .single()
    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ success: true, data })
  }

  if (action === "update_cleaner") {
    const cleaner_id = Number(body.cleaner_id)
    if (!Number.isFinite(cleaner_id)) return jsonError("cleaner_id is required")

    const updates: Record<string, unknown> = {}
    if (body.name != null) updates.name = String(body.name).trim()
    if (body.phone != null) updates.phone = String(body.phone).trim() || null
    if (body.email != null) updates.email = String(body.email).trim() || null
    if (body.telegram_id != null) updates.telegram_id = String(body.telegram_id).trim() || null
    if (body.is_team_lead != null) updates.is_team_lead = Boolean(body.is_team_lead)

    if (Object.keys(updates).length === 0) return jsonError("No updates provided")

    const { data, error } = await client
      .from("cleaners")
      .update(updates)
      .eq("tenant_id", tenant.id)
      .eq("id", cleaner_id)
      .select("id,name,phone,email,telegram_id,is_team_lead,active,deleted_at")
      .single()
    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ success: true, data })
  }

  if (action === "move_cleaner") {
    const cleaner_id = Number(body.cleaner_id)
    const team_id = body.team_id == null ? null : Number(body.team_id)
    if (!Number.isFinite(cleaner_id)) return jsonError("cleaner_id is required")

    // Remove ALL existing memberships for this cleaner (clean slate prevents duplicates)
    const del = await client.from("team_members").delete().eq("tenant_id", tenant.id).eq("cleaner_id", cleaner_id)
    if (del.error) return jsonError(del.error.message, 500)

    // If moving to "Unassigned", we're done
    if (team_id == null || !Number.isFinite(team_id)) {
      return NextResponse.json({ success: true, data: { cleaner_id, team_id: null } })
    }

    // Insert single membership row
    const insert = await client
      .from("team_members")
      .insert({ tenant_id: tenant.id, team_id, cleaner_id, role: "technician", is_active: true })
      .select("id,team_id,cleaner_id,role,is_active")
      .single()

    if (insert.error) return jsonError(insert.error.message, 500)
    return NextResponse.json({ success: true, data: insert.data })
  }

  if (action === "delete_team") {
    const team_id = Number(body.team_id)
    if (!Number.isFinite(team_id)) return jsonError("team_id is required")
    // Soft-delete to avoid FK issues (jobs/tips/upsells may reference team_id)
    const { error } = await client.from("teams").update({ active: false, deleted_at: new Date().toISOString() }).eq("tenant_id", tenant.id).eq("id", team_id)
    if (error) return jsonError(error.message, 500)
    // Also deactivate memberships
    await client.from("team_members").update({ is_active: false }).eq("tenant_id", tenant.id).eq("team_id", team_id)
    return NextResponse.json({ success: true, data: { team_id } })
  }

  if (action === "delete_cleaner") {
    const cleaner_id = Number(body.cleaner_id)
    if (!Number.isFinite(cleaner_id)) return jsonError("cleaner_id is required")
    const { error } = await client
      .from("cleaners")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("tenant_id", tenant.id)
      .eq("id", cleaner_id)
    if (error) return jsonError(error.message, 500)
    await client.from("team_members").update({ is_active: false }).eq("tenant_id", tenant.id).eq("cleaner_id", cleaner_id)
    return NextResponse.json({ success: true, data: { cleaner_id } })
  }

  return jsonError(`Unknown action: ${action}`)
}
