// Shared channel-P&L computation used by both the API route
// (app/api/actions/insights/channel-pnl) and the weekly auto-report cron
// (app/api/cron/weekly-channel-report). Cost per booked job, ROAS, book rate,
// AND recurring-member LTV — per marketing channel. First-touch attribution.
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeChannel, type Channel } from "./attribution"

// Recurring plan cadence → services per year (for annual recurring value).
const VISITS_PER_YEAR: Record<string, number> = {
  monthly: 12, quarterly: 4, triannual: 3, triannual_exterior: 3, biannual: 2,
}
const DEFAULT_LTV_YEARS = 1.5 // conservative avg member lifetime; override via workflow_config.ltv_years

export interface ChannelRow {
  channel: Channel
  leads: number
  bookedJobs: number
  revenue: number // first/completed-job revenue in range
  spend: number
  activeMembers: number // recurring service plans (status active/signed) attributed here
  annualRecurringValue: number // sum(plan_price × visits/yr)
  ltvValue: number // annualRecurringValue × ltvYears
  trueValue: number // revenue + ltvValue (the "real money" from this channel's customers)
  costPerLead: number | null
  costPerBookedJob: number | null
  revenuePerBookedJob: number | null
  bookRate: number | null
  roas: number | null // first-job revenue / spend
  trueRoas: number | null // (revenue + LTV) / spend
}

export interface ChannelPnl {
  range: { start: string; end: string; days: number }
  ltvYears: number
  channels: ChannelRow[]
  totals: {
    leads: number
    bookedJobs: number
    revenue: number
    spend: number
    activeMembers: number
    ltvValue: number
    trueValue: number
    blendedCostPerBookedJob: number | null
    blendedRoas: number | null
    blendedTrueRoas: number | null
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

interface Bucket {
  channel: Channel
  leads: number
  bookedJobs: number
  revenue: number
  spend: number
  activeMembers: number
  arr: number
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
  const ltvYears = Number(workflowConfig?.ltv_years) > 0 ? Number(workflowConfig?.ltv_years) : DEFAULT_LTV_YEARS

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

  // Active recurring members (ongoing — not date-bounded; they're current value)
  const { data: plans } = await supabase
    .from("service_plans")
    .select("customer_id, plan_type, plan_price, status")
    .eq("tenant_id", tenantId)
    .in("status", ["active", "signed"])

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

  const buckets = new Map<Channel, Bucket>()
  const b = (ch: Channel) => {
    if (!buckets.has(ch)) buckets.set(ch, { channel: ch, leads: 0, bookedJobs: 0, revenue: 0, spend: 0, activeMembers: 0, arr: 0 })
    return buckets.get(ch)!
  }
  for (const l of leads ?? []) b(normalizeChannel({ source: l.source, formData: l.form_data as Record<string, unknown> }).channel).leads++
  for (const j of jobs ?? []) {
    const ch = (j.customer_id != null && customerChannel.get(j.customer_id)) || "direct"
    const bk = b(ch)
    bk.bookedJobs++
    bk.revenue += Number(j.price) || 0
  }
  for (const p of plans ?? []) {
    const ch = (p.customer_id != null && customerChannel.get(p.customer_id)) || "direct"
    const bk = b(ch)
    bk.activeMembers++
    bk.arr += (Number(p.plan_price) || 0) * (VISITS_PER_YEAR[p.plan_type as string] ?? 4)
  }
  b("lsa").spend += lsaSpend
  for (const [ch, monthly] of Object.entries(monthlyCosts)) if (monthly > 0) b(ch as Channel).spend += prorate(Number(monthly))

  const channels: ChannelRow[] = Array.from(buckets.values()).map((r) => {
    const ltvValue = r.arr * ltvYears
    const trueValue = r.revenue + ltvValue
    return {
      channel: r.channel,
      leads: r.leads,
      bookedJobs: r.bookedJobs,
      revenue: Math.round(r.revenue),
      spend: Math.round(r.spend),
      activeMembers: r.activeMembers,
      annualRecurringValue: Math.round(r.arr),
      ltvValue: Math.round(ltvValue),
      trueValue: Math.round(trueValue),
      costPerLead: r.leads > 0 && r.spend > 0 ? round2(r.spend / r.leads) : null,
      costPerBookedJob: r.bookedJobs > 0 && r.spend > 0 ? round2(r.spend / r.bookedJobs) : null,
      revenuePerBookedJob: r.bookedJobs > 0 ? Math.round(r.revenue / r.bookedJobs) : null,
      bookRate: r.leads > 0 ? Math.round((r.bookedJobs / r.leads) * 1000) / 10 : null,
      roas: r.spend > 0 ? round2(r.revenue / r.spend) : null,
      trueRoas: r.spend > 0 ? round2(trueValue / r.spend) : null,
    }
  })
  channels.sort((a, z) => z.trueValue - a.trueValue || z.bookedJobs - a.bookedJobs)

  const sum = (k: keyof ChannelRow) => channels.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const totalRevenue = sum("revenue"), totalSpend = sum("spend"), totalLtv = sum("ltvValue"), totalBooked = sum("bookedJobs")
  const totalTrue = totalRevenue + totalLtv

  return {
    range: { start: startISO, end: endISO, days },
    ltvYears,
    channels,
    totals: {
      leads: sum("leads"),
      bookedJobs: totalBooked,
      revenue: totalRevenue,
      spend: totalSpend,
      activeMembers: sum("activeMembers"),
      ltvValue: totalLtv,
      trueValue: totalTrue,
      blendedCostPerBookedJob: totalBooked > 0 && totalSpend > 0 ? round2(totalSpend / totalBooked) : null,
      blendedRoas: totalSpend > 0 ? round2(totalRevenue / totalSpend) : null,
      blendedTrueRoas: totalSpend > 0 ? round2(totalTrue / totalSpend) : null,
    },
    notes: {
      attribution: "first-touch: each completed job + recurring member credited to the channel of the customer's earliest lead",
      lsa_spend: "latest LSA_METRICS_SNAPSHOT (month-to-date account total); other channels from workflow_config.channel_costs (prorated) or $0",
      revenue: "completed jobs' price in range (first-job value)",
      ltv: `activeMembers = service_plans status active/signed; ltvValue = annualRecurringValue × ${ltvYears} yr (override via workflow_config.ltv_years). trueValue/trueRoas = first-job revenue + LTV.`,
    },
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
