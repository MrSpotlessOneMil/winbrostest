import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { computeChannelPnl, rangeToDates } from "@/lib/marketing/channel-pnl"

// ---------------------------------------------------------------------------
// GET /api/actions/insights/channel-pnl?range=7d|30d|90d|ytd|custom&from=&to=
//
// The channel P&L scoreboard: per marketing channel — cost per booked job, ROAS,
// and book rate. This is the lead-gen metric the July 2026 audit flagged as missing.
// All logic lives in lib/marketing/channel-pnl (shared with the weekly cron).
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const url = new URL(request.url)
  const { startISO, endISO, days } = rangeToDates(
    url.searchParams.get("range") || "30d",
    url.searchParams.get("from"),
    url.searchParams.get("to")
  )

  const pnl = await computeChannelPnl({
    supabase: getSupabaseServiceClient(),
    tenantId: tenant.id,
    workflowConfig: tenant.workflow_config as unknown as Record<string, unknown> | undefined,
    startISO,
    endISO,
    days,
  })

  return NextResponse.json(pnl)
}
