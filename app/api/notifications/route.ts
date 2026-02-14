import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth, getAuthTenant } from "@/lib/auth"

type NotificationItem = {
  id: string
  title: string
  subtitle?: string
  time: string
  created_at?: string
  source?: string
  event_type?: string
}

function relTime(iso?: string | null) {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  const diff = Date.now() - t
  const mins = Math.max(0, Math.round(diff / 60000))
  if (mins < 2) return "Just now"
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function titleFrom(row: any): { title: string; subtitle?: string } {
  const source = String(row.source || "system")
  const eventType = String(row.event_type || "EVENT")
  const message = String(row.message || "")

  // Use message as subtitle and derive a short title.
  const prettyEvent = eventType.replaceAll("_", " ")
  return {
    title: `${prettyEvent} (${source})`,
    subtitle: message || undefined,
  }
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getAuthTenant(req)
  if (!tenant) {
    return NextResponse.json({ success: true, data: [] })
  }

  const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "10")))
  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from("system_events")
    .select("id,event_type,source,message,created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message, data: [] }, { status: 500 })
  }

  const items: NotificationItem[] = (data || []).map((row: any) => {
    const createdAt = row.created_at ? String(row.created_at) : undefined
    const { title, subtitle } = titleFrom(row)
    return {
      id: String(row.id),
      title,
      subtitle,
      time: relTime(createdAt),
      created_at: createdAt,
      source: row.source ? String(row.source) : undefined,
      event_type: row.event_type ? String(row.event_type) : undefined,
    }
  })

  return NextResponse.json({ success: true, data: items })
}

