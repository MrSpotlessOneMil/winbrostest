import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

type TeamRow = { id: number; name: string; active: boolean; deleted_at?: string | null }
type CleanerRow = { id: number; name: string; phone?: string | null; active: boolean; deleted_at?: string | null }
type TeamMemberRow = { id: number; team_id: number; cleaner_id: number; role: "lead" | "technician"; is_active: boolean }

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

export async function GET() {
  const client = getSupabaseServiceClient()

  const [teamsRes, cleanersRes, membersRes] = await Promise.all([
    client.from("teams").select("id,name,active,deleted_at").is("deleted_at", null).order("created_at", { ascending: true }),
    client.from("cleaners").select("id,name,phone,active,deleted_at").is("deleted_at", null).order("created_at", { ascending: true }),
    client.from("team_members").select("id,team_id,cleaner_id,role,is_active").order("created_at", { ascending: true }),
  ])

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
  const client = getSupabaseServiceClient()
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "")

  if (action === "create_team") {
    const name = String(body.name || "").trim()
    if (!name) return jsonError("Team name is required")
    const { data, error } = await client.from("teams").insert({ name, active: true }).select("id,name,active,deleted_at").single()
    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ success: true, data })
  }

  if (action === "create_cleaner") {
    const name = String(body.name || "").trim()
    const phone = body.phone != null ? String(body.phone).trim() : null
    if (!name) return jsonError("Cleaner name is required")
    const { data, error } = await client
      .from("cleaners")
      .insert({ name, phone: phone || null, active: true })
      .select("id,name,phone,active,deleted_at")
      .single()
    if (error) return jsonError(error.message, 500)
    return NextResponse.json({ success: true, data })
  }

  if (action === "move_cleaner") {
    const cleaner_id = Number(body.cleaner_id)
    const team_id = body.team_id == null ? null : Number(body.team_id)
    if (!Number.isFinite(cleaner_id)) return jsonError("cleaner_id is required")

    // Deactivate any existing memberships for this cleaner
    const deactivate = await client.from("team_members").update({ is_active: false }).eq("cleaner_id", cleaner_id)
    if (deactivate.error) return jsonError(deactivate.error.message, 500)

    // If moving to "Unassigned", we’re done
    if (team_id == null || !Number.isFinite(team_id)) {
      return NextResponse.json({ success: true, data: { cleaner_id, team_id: null } })
    }

    // Ensure active membership row exists
    const upsert = await client
      .from("team_members")
      .upsert({ team_id, cleaner_id, role: "technician", is_active: true }, { onConflict: "team_id,cleaner_id" })
      .select("id,team_id,cleaner_id,role,is_active")
      .single()

    if (upsert.error) return jsonError(upsert.error.message, 500)
    return NextResponse.json({ success: true, data: upsert.data })
  }

  if (action === "delete_team") {
    const team_id = Number(body.team_id)
    if (!Number.isFinite(team_id)) return jsonError("team_id is required")
    // Soft-delete to avoid FK issues (jobs/tips/upsells may reference team_id)
    const { error } = await client.from("teams").update({ active: false, deleted_at: new Date().toISOString() }).eq("id", team_id)
    if (error) return jsonError(error.message, 500)
    // Also deactivate memberships
    await client.from("team_members").update({ is_active: false }).eq("team_id", team_id)
    return NextResponse.json({ success: true, data: { team_id } })
  }

  if (action === "delete_cleaner") {
    const cleaner_id = Number(body.cleaner_id)
    if (!Number.isFinite(cleaner_id)) return jsonError("cleaner_id is required")
    const { error } = await client
      .from("cleaners")
      .update({ active: false, deleted_at: new Date().toISOString() })
      .eq("id", cleaner_id)
    if (error) return jsonError(error.message, 500)
    await client.from("team_members").update({ is_active: false }).eq("cleaner_id", cleaner_id)
    return NextResponse.json({ success: true, data: { cleaner_id } })
  }

  return jsonError(`Unknown action: ${action}`)
}

