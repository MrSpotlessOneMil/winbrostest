import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { requireAuth } from "@/lib/auth"
import { getDefaultTenant } from "@/lib/tenant"

type ExceptionType = "no-confirm" | "high-value" | "routing" | "scheduling" | "system"
type Priority = "high" | "medium" | "low"

export type ExceptionItem = {
  id: string
  type: ExceptionType
  title: string
  description: string
  time: string
  priority: Priority
  action: string
  source?: string
  event_type?: string
  created_at?: string
  metadata?: Record<string, unknown> | null
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

function deriveException(row: any): ExceptionItem {
  const eventType = String(row.event_type || "")
  const source = String(row.source || "system")
  const createdAt = row.created_at ? String(row.created_at) : undefined
  const message = String(row.message || "")

  let priority: Priority = "low"
  let type: ExceptionType = "system"
  let action = "Review"

  const et = eventType.toUpperCase()
  if (et.includes("FAILED") || et.includes("OWNER_ACTION_REQUIRED") || et.includes("PAYMENT_FAILED")) {
    priority = "high"
  } else if (et.includes("MAX_ATTEMPTS") || et.includes("VOICEMAIL") || et.includes("NO_ANSWER")) {
    priority = "medium"
  }

  if (source === "stripe") type = "high-value"
  else if (source === "telegram") type = "routing"
  else if (source === "cron") type = "scheduling"

  if (et.includes("PAYMENT_FAILED")) action = "Retry payment"
  else if (et.includes("OWNER_ACTION_REQUIRED")) action = "Owner action"
  else if (et.includes("RESCHEDULE")) action = "Reschedule"

  const title = `${eventType.replaceAll("_", " ")} (${source})`
  return {
    id: String(row.id),
    type,
    title,
    description: message,
    time: relTime(createdAt),
    priority,
    action,
    source,
    event_type: eventType,
    created_at: createdAt,
    metadata: (row.metadata as any) || null,
  }
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  // Get the default tenant for multi-tenant filtering
  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: true, data: [] as ExceptionItem[] })
  }

  const url = request.nextUrl
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "25")))

  const client = getSupabaseServiceClient()

  // "Exceptions" are derived from recent system_events that indicate problems / attention needed.
  const { data, error } = await client
    .from("system_events")
    .select("id,event_type,source,message,metadata,created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message, data: [] as ExceptionItem[] }, { status: 500 })
  }

  const items = (data || [])
    .map(deriveException)
    .filter((x) => x.priority !== "low" || /owner|fail|error|required|retry/i.test(x.title + " " + x.description))

  return NextResponse.json({ success: true, data: items })
}

