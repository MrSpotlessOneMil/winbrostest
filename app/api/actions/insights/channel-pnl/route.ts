import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizeChannel, type Channel } from "@/lib/marketing/attribution"

// ---------------------------------------------------------------------------
// GET /api/actions/insights/channel-pnl?range=30d
//
// The channel P&L scoreboard: per marketing channel, joins leads → booked jobs
// (revenue) AND ad spend to produce the number that actually matters —
// COST PER BOOKED JOB — plus ROAS and book rate. This is the metric the lead-gen
// audit flagged as missing (cost/booked-job was previously unmeasurable).
//
// Attribution is first-touch: every completed job is credited to the channel of
// the earliest lead for that customer, via lib/marketing/attribution.normalizeChannel
// (which decodes leads.source + form_data.source_detail + UTMs, since the website
// webhook pins leads.source='website' and stashes the real detail in form_data).
//
// Spend today: LSA (from system_events LSA_METRICS_SNAPSHOT). Other channels read
// optional monthly costs from tenant.workflow_config.channel_costs (prorated),
// else $0 (organic). Extend as more paid channels are wired.
// ---------------------------------------------------------------------------

function rangeToDates(range: string, from: string | null, to: string | null) {
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
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult
  const supabase = getSupabaseServiceClient()

  const url = new URL(request.url)
  const { startISO, endISO, days } = rangeToDates(
    url.searchParams.get("range") || "30d",
    url.searchParams.get("from"),
    url.searchParams.get("to")
  )

  // 1. Leads in range (channel counts + customer→channel first-touch map)
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, source, status, converted_to_job_id, created_at, customer_id, form_data")
    .eq("tenant_id", tenant.id)
    .gte("created_at", startISO)
    .lte("created_at", endISO)
  if (leadsErr) return NextResponse.json({ error: "Failed to fetch leads" }, { status: 500 })

  // First-touch channel per customer, across ALL their leads (earliest wins).
  const { data: allCustLeads } = await supabase
    .from("leads")
    .select("customer_id, source, form_data, created_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true })
  const customerChannel = new Map<number, Channel>()
  for (const l of allCustLeads ?? []) {
    if (l.customer_id == null) continue
    if (!customerChannel.has(l.customer_id)) {
      customerChannel.set(l.customer_id, normalizeChannel({ source: l.source, formData: l.form_data as any }).channel)
    }
  }

  // 2. Completed (booked+done) jobs in range → revenue, attributed by customer's channel
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, price, status, completed_at, date, customer_id")
    .eq("tenant_id", tenant.id)
    .eq("status", "completed")
    .not("price", "is", null)
    .or(`and(completed_at.gte.${startISO},completed_at.lte.${endISO}),and(completed_at.is.null,date.gte.${startISO.slice(0, 10)},date.lte.${endISO.slice(0, 10)})`)

  // 3. LSA spend from the most recent metrics snapshot in range (month-to-date total)
  const { data: lsaSnaps } = await supabase
    .from("system_events")
    .select("metadata, created_at")
    .eq("tenant_id", tenant.id)
    .eq("event_type", "LSA_METRICS_SNAPSHOT")
    .gte("created_at", startISO)
    .lte("created_at", endISO)
    .order("created_at", { ascending: false })
    .limit(1)
  const lsaSpend = Number((lsaSnaps?.[0]?.metadata as any)?.currentPeriodTotalCost ?? 0) || 0

  // Optional configured monthly costs for other channels (prorated to the range)
  const monthlyCosts: Record<string, number> = (tenant as any).workflow_config?.channel_costs ?? {}
  const prorate = (monthly: number) => (monthly / 30) * days

  // 4. Aggregate
  const buckets = new Map<Channel, Bucket>()
  const b = (ch: Channel): Bucket => {
    if (!buckets.has(ch)) buckets.set(ch, { channel: ch, leads: 0, bookedJobs: 0, revenue: 0, spend: 0 })
    return buckets.get(ch)!
  }

  for (const l of leads ?? []) {
    b(normalizeChannel({ source: l.source, formData: l.form_data as any }).channel).leads++
  }
  for (const j of jobs ?? []) {
    const ch = (j.customer_id != null && customerChannel.get(j.customer_id)) || "direct"
    const bucket = b(ch)
    bucket.bookedJobs++
    bucket.revenue += Number(j.price) || 0
  }
  // spend
  b("lsa").spend += lsaSpend
  for (const [ch, monthly] of Object.entries(monthlyCosts)) {
    if (monthly > 0) b(ch as Channel).spend += prorate(Number(monthly))
  }

  // 5. Derive metrics
  const rows = Array.from(buckets.values()).map((r) => ({
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
  rows.sort((a, z) => z.revenue - a.revenue || z.bookedJobs - a.bookedJobs)

  const totals = {
    leads: rows.reduce((s, r) => s + r.leads, 0),
    bookedJobs: rows.reduce((s, r) => s + r.bookedJobs, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    spend: rows.reduce((s, r) => s + r.spend, 0),
  }

  return NextResponse.json({
    range: { start: startISO, end: endISO, days },
    channels: rows,
    totals: {
      ...totals,
      blendedCostPerBookedJob: totals.bookedJobs > 0 && totals.spend > 0 ? Math.round((totals.spend / totals.bookedJobs) * 100) / 100 : null,
      blendedRoas: totals.spend > 0 ? Math.round((totals.revenue / totals.spend) * 100) / 100 : null,
    },
    notes: {
      attribution: "first-touch: each completed job credited to the channel of the customer's earliest lead",
      lsa_spend: "from latest LSA_METRICS_SNAPSHOT (month-to-date account total); other channels from tenant.workflow_config.channel_costs (prorated) or $0",
      revenue: "sum of completed jobs' price in range (excludes recurring LTV)",
    },
  })
}
