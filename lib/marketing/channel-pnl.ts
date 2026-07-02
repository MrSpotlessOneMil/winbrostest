// Shared channel-P&L computation used by both the API route
// (app/api/actions/insights/channel-pnl) and the weekly auto-report cron
// (app/api/cron/weekly-channel-report). Cost per booked job, ROAS, book rate,
// per marketing channel. First-touch attribution via normalizeChannel.
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeChannel, type Channel } from "./attribution"

export interface ChannelRow {
  channel: Channel
  leads: number
  bookedJobs: number
  revenue: number
  spend: number
  costPerLead: number | null
  costPerBookedJob: number | null
  revenuePerBookedJob: number | null
  bookRate: number | null
  roas: number | null
}

export interface ChannelPnl {
  range: { start: string; end: string; days: number }
  channels: ChannelRow[]
  totals: {
    leads: number
    bookedJobs: number
    revenue: number
    spend: number
    blendedCostPerBookedJob: number | null
    blendedRoas: number | null
  }
  notes: Record<string, string>
}

export function rangeToDates(range: string, from?: string | null, to?: string | null) {
  const now = new Date()
  const end = to ? new Date(to + "T23:59:59.999Z") : now
  let start: Date
  if (range === "custom" && from) start = new Date(from + "T00:00:00Z")
  else {
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "ytd" ? 366 : 30
    start = new Date(end.getTime() - days * 864e5)
  }
  return { startISO: start.toISOString(), endISO: end.toISOString(), days: Math.max(1, Math.round((end.getTime() - start.getTime()) / 864e5)) }
}

export async function computeChannelPnl(opts: {
  supabase: SupabaseClient
  tenantId: string | number
  workflowConfig?: Record<string, unknown> | null
  startISO: string
  endISO: string
  days: number
}): Promise<ChannelPnl> {
  const { supabase, tenantId, workflowConfig, startISO, endISO, days } = opts

  const { data: leads } = await supabase
    .from("leads")
    .select("id, source, status, converted_to_job_id, created_at, customer_id, form_data")
    .eq("tenant_id", tenantId)
    .gte("created_at", startISO)
    .lte("created_at", endISO)

  // First-touch channel per customer (earliest lead wins)
  const { data: allCustLeads } = await supabase
    .from("leads")
    .select("customer_id, source, form_data, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
  const customerChannel = new Map<number, Channel>()
  for (const l of allCustLeads ?? []) {
    if (l.customer_id == null) continue
    if (!customerChannel.has(l.customer_id)) {
      customerChannel.set(l.customer_id, normalizeChannel({ source: l.source, formData: l.form_data as Record<string, unknown> }).channel)
    }
  }

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, price, status, completed_at, date, customer_id")
    .eq("tenant_id", tenantId)
    .eq("status", "completed")
    .not("price", "is", null)
    .or(`and(completed_at.gte.${startISO},completed_at.lte.${endISO}),and(completed_at.is.null,date.gte.${startISO.slice(0, 10)},date.lte.${endISO.slice(0, 10)})`)

  const { data: lsaSnaps } = await supabase
    .from("system_events")
    .select("metadata, created_at")
    .eq("tenant_id", tenantId)
    .eq("event_type", "LSA_METRICS_SNAPSHOT")
    .gte("created_at", startISO)
    .lte("created_at", endISO)
    .order("created_at", { ascending: false })
    .limit(1)
  const lsaSpend = Number((lsaSnaps?.[0]?.metadata as Record<string, unknown>)?.currentPeriodTotalCost ?? 0) || 0

  const monthlyCosts: Record<string, number> = (workflowConfig?.channel_costs as Record<string, number>) ?? {}
  const prorate = (monthly: number) => (monthly / 30) * days

  const buckets = new Map<Channel, { channel: Channel; leads: number; bookedJobs: number; revenue: number; spend: number }>()
  const b = (ch: Channel) => {
    if (!buckets.has(ch)) buckets.set(ch, { channel: ch, leads: 0, bookedJobs: 0, revenue: 0, spend: 0 })
    return buckets.get(ch)!
  }
  for (const l of leads ?? []) b(normalizeChannel({ source: l.source, formData: l.form_data as Record<string, unknown> }).channel).leads++
  for (const j of jobs ?? []) {
    const ch = (j.customer_id != null && customerChannel.get(j.customer_id)) || "direct"
    const bk = b(ch)
    bk.bookedJobs++
    bk.revenue += Number(j.price) || 0
  }
  b("lsa").spend += lsaSpend
  for (const [ch, monthly] of Object.entries(monthlyCosts)) if (monthly > 0) b(ch as Channel).spend += prorate(Number(monthly))

  const channels: ChannelRow[] = Array.from(buckets.values()).map((r) => ({
    channel: r.channel,
    leads: r.leads,
    bookedJobs: r.bookedJobs,
    revenue: Math.round(r.revenue),
    spend: Math.round(r.spend),
    costPerLead: r.leads > 0 && r.spend > 0 ? Math.round((r.spend / r.leads) * 100) / 100 : null,
    costPerBookedJob: r.bookedJobs > 0 && r.spend > 0 ? Math.round((r.spend / r.bookedJobs) * 100) / 100 : null,
    revenuePerBookedJob: r.bookedJobs > 0 ? Math.round(r.revenue / r.bookedJobs) : null,
    bookRate: r.leads > 0 ? Math.round((r.bookedJobs / r.leads) * 1000) / 10 : null,
    roas: r.spend > 0 ? Math.round((r.revenue / r.spend) * 100) / 100 : null,
  }))
  channels.sort((a, z) => z.revenue - a.revenue || z.bookedJobs - a.bookedJobs)

  const totals = {
    leads: channels.reduce((s, r) => s + r.leads, 0),
    bookedJobs: channels.reduce((s, r) => s + r.bookedJobs, 0),
    revenue: channels.reduce((s, r) => s + r.revenue, 0),
    spend: channels.reduce((s, r) => s + r.spend, 0),
  }

  return {
    range: { start: startISO, end: endISO, days },
    channels,
    totals: {
      ...totals,
      blendedCostPerBookedJob: totals.bookedJobs > 0 && totals.spend > 0 ? Math.round((totals.spend / totals.bookedJobs) * 100) / 100 : null,
      blendedRoas: totals.spend > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : null,
    },
    notes: {
      attribution: "first-touch: each completed job credited to the channel of the customer's earliest lead",
      lsa_spend: "latest LSA_METRICS_SNAPSHOT (month-to-date account total); other channels from workflow_config.channel_costs (prorated) or $0",
      revenue: "sum of completed jobs' price in range (excludes recurring LTV)",
    },
  }
}
