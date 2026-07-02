import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth, unauthorizedResponse } from "@/lib/cron-auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getAllActiveTenants } from "@/lib/tenant"
import { alertOwner } from "@/lib/owner-alert"
import { computeChannelPnl, rangeToDates } from "@/lib/marketing/channel-pnl"

// route-check:no-vercel-cron

/**
 * Cron: Weekly channel P&L report → owner.
 * Opt-in per tenant via workflow_config.weekly_channel_report === true
 * (default OFF so it never messages other tenants' owners).
 *
 * Sends a plain-language SMS digest (cost per booked job + ROAS per channel) and
 * logs the full P&L as a system_event for the dashboard. Makes lead-gen self-reporting.
 *
 * Schedule (register in QStash, weekly): GET /api/cron/weekly-channel-report
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const supabase = getSupabaseServiceClient()
  const { startISO, endISO, days } = rangeToDates("7d")
  const tenants = (await getAllActiveTenants()).filter(
    (t) => (t.workflow_config as unknown as { weekly_channel_report?: boolean } | undefined)?.weekly_channel_report === true
  )

  const results: Record<string, unknown> = {}

  for (const tenant of tenants) {
    try {
      const pnl = await computeChannelPnl({
        supabase,
        tenantId: tenant.id,
        workflowConfig: tenant.workflow_config as unknown as Record<string, unknown> | undefined,
        startISO,
        endISO,
        days,
      })

      const t = pnl.totals
      const top = pnl.channels.filter((c) => c.leads > 0 || c.bookedJobs > 0).slice(0, 5)
      const lines = top.map((c) => {
        const cpbj = c.costPerBookedJob != null ? `$${c.costPerBookedJob}/booked` : "organic"
        return `• ${c.channel}: ${c.bookedJobs} jobs from ${c.leads} leads (${cpbj})`
      })
      const msg =
        `Spotless — last 7 days\n` +
        `${t.bookedJobs} booked jobs · $${t.revenue.toLocaleString()} revenue · $${t.spend.toLocaleString()} ad spend` +
        (t.blendedCostPerBookedJob != null ? ` · $${t.blendedCostPerBookedJob}/booked blended` : "") +
        (lines.length ? `\n${lines.join("\n")}` : "\n(no leads yet this week)")

      await alertOwner(msg, { tenant, metadata: { report: "weekly_channel_pnl", pnl } })
      results[tenant.slug] = { sent: true, bookedJobs: t.bookedJobs, revenue: t.revenue, spend: t.spend }
    } catch (e) {
      results[tenant.slug] = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  return NextResponse.json({ success: true, tenants: tenants.length, results })
}
