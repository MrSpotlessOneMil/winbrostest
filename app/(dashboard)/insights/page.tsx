"use client"

import { useEffect, useState } from "react"
import CubeLoader from "@/components/ui/cube-loader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  DollarSign, TrendingUp, Repeat, Users, Target,
  RefreshCcw, ArrowUpRight, ArrowDownRight, Minus,
  Lightbulb,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts"

interface InsightsData {
  revenue: {
    monthly: number
    monthly_recurring: number
    monthly_one_time: number
    annual: number
    annual_recurring: number
    annual_one_time: number
    projected_annual: number
    recurring_client_count: number
  }
  pnl: {
    revenue: number
    cleaner_pay: number
    cleaner_pay_pct: number
    ad_spend: number
    other_expenses: number
    total_expenses: number
    profit: number
    margin_pct: number
  }
  lead_sources: {
    source: string
    leads: number
    booked: number
    revenue: number
    cost: number
    conversionRate: number
    roi: number | null
    profit: number
  }[]
  monthly_chart: { month: string; revenue: number; jobs: number }[]
  month_name: string
}

const SOURCE_LABELS: Record<string, string> = {
  phone: "Phone",
  meta: "Meta Ads",
  website: "Website",
  vapi: "VAPI (AI)",
  sms: "SMS",
  google: "Google",
  google_lsa: "Google LSA",
  thumbtack: "Thumbtack",
  angi: "Angi",
  sam: "SAM",
  ghl: "GoHighLevel",
  housecall_pro: "HCP",
  manual: "Manual",
  email: "Email",
  retargeting: "Retargeting",
  unknown: "Unknown",
}

const PIE_COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"]

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtFull(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/actions/insights-v2", { cache: "no-store" })
      const json = await res.json()
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <CubeLoader />
  if (!data) return <div className="p-6 text-muted-foreground">Failed to load insights</div>

  const { revenue, pnl, lead_sources, month_name } = data

  // AI Recommendations
  const recommendations: { text: string; type: "up" | "down" | "info" }[] = []
  const topSource = lead_sources.filter(s => s.revenue > 0).sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0))[0]
  const worstSource = lead_sources.filter(s => s.cost > 0 && s.profit < 0).sort((a, b) => a.profit - b.profit)[0]
  if (topSource?.roi && topSource.roi > 0) {
    recommendations.push({ text: `${SOURCE_LABELS[topSource.source] || topSource.source} has ${topSource.roi}% ROI — consider increasing spend`, type: "up" })
  }
  if (worstSource) {
    recommendations.push({ text: `${SOURCE_LABELS[worstSource.source] || worstSource.source} is losing ${fmtFull(Math.abs(worstSource.profit))} — consider cutting or pausing`, type: "down" })
  }
  if (revenue.recurring_client_count > 0) {
    const recurringPct = revenue.monthly > 0 ? Math.round((revenue.monthly_recurring / revenue.monthly) * 100) : 0
    recommendations.push({ text: `${recurringPct}% of revenue is recurring from ${revenue.recurring_client_count} clients`, type: "info" })
  }
  const avgJobValue = revenue.monthly > 0 && lead_sources.reduce((s, l) => s + l.booked, 0) > 0
    ? Math.round(revenue.monthly / lead_sources.reduce((s, l) => s + l.booked, 0))
    : 0
  if (avgJobValue > 0) {
    recommendations.push({ text: `Average job value: ${fmtFull(avgJobValue)}`, type: "info" })
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insights</h1>
          <p className="text-sm text-muted-foreground">{month_name} — Real numbers, no bullshit</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ═══ SECTION 1: Revenue Overview (4 cards) ═══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RevenueCard
          title="Monthly Revenue"
          amount={revenue.monthly}
          subtitle={`${fmtFull(revenue.monthly_recurring)} recurring / ${fmtFull(revenue.monthly_one_time)} one-time`}
          icon={<DollarSign className="h-5 w-5" />}
          color="text-green-400"
          bg="bg-green-500/10"
        />
        <RevenueCard
          title="Annual Revenue"
          amount={revenue.annual}
          subtitle={`${fmtFull(revenue.annual_recurring)} recurring / ${fmtFull(revenue.annual_one_time)} one-time`}
          icon={<TrendingUp className="h-5 w-5" />}
          color="text-blue-400"
          bg="bg-blue-500/10"
        />
        <RevenueCard
          title="Recurring Revenue"
          amount={revenue.monthly_recurring}
          subtitle={`${revenue.recurring_client_count} recurring clients`}
          icon={<Repeat className="h-5 w-5" />}
          color="text-violet-400"
          bg="bg-violet-500/10"
          suffix="/mo"
        />
        <RevenueCard
          title="Projected Annual"
          amount={revenue.projected_annual}
          subtitle="if retention holds"
          icon={<Target className="h-5 w-5" />}
          color="text-amber-400"
          bg="bg-amber-500/10"
        />
      </div>

      {/* ═══ CHARTS: Revenue Trend + Lead Source Pie ═══ */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue Area Chart (Stripe-style) */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-400" />
              Monthly Revenue — Last 6 Months
            </h3>
            {data.monthly_chart.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.monthly_chart}>
                  <defs>
                    <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#revenueGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No revenue data yet</p>
            )}
          </CardContent>
        </Card>

        {/* Lead Source Pie Chart */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              Lead Sources
            </h3>
            {lead_sources.filter(s => s.leads > 0).length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={lead_sources.filter(s => s.leads > 0).slice(0, 8)}
                    dataKey="leads"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ source, leads }: { source: string; leads: number }) => `${SOURCE_LABELS[source] || source} (${leads})`}
                    labelLine={false}
                  >
                    {lead_sources.filter(s => s.leads > 0).slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [value, SOURCE_LABELS[name] || name]} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No lead data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ SECTION 2: Profit & Loss ═══ */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-400" />
            Profit & Loss — {month_name}
          </h3>
          <div className="space-y-3">
            <PnlRow label="Revenue" amount={pnl.revenue} color="text-green-400" />
            <PnlRow label={`Cleaner Pay (${pnl.cleaner_pay_pct}%)`} amount={-pnl.cleaner_pay} color="text-red-400" />
            <PnlRow label="Ad Spend" amount={-pnl.ad_spend} color="text-red-400" />
            {pnl.other_expenses > 0 && (
              <PnlRow label="Other Expenses" amount={-pnl.other_expenses} color="text-red-400" />
            )}
            <div className="border-t border-border pt-3 mt-3">
              <PnlRow
                label={`Profit (${pnl.margin_pct}% margin)`}
                amount={pnl.profit}
                color={pnl.profit >= 0 ? "text-green-400" : "text-red-400"}
                bold
              />
            </div>
          </div>
          {/* Visual bar */}
          {pnl.revenue > 0 && (
            <div className="mt-4 flex h-3 rounded-full overflow-hidden bg-muted">
              <div className="bg-green-500" style={{ width: `${Math.max(0, pnl.margin_pct)}%` }} title={`Profit: ${pnl.margin_pct}%`} />
              <div className="bg-red-500/60" style={{ width: `${Math.min(100, 100 - Math.max(0, pnl.margin_pct))}%` }} title="Costs" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 3: Lead Source Economics ═══ */}
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-400" />
            Lead Source Economics — Where&apos;s the money?
          </h3>
          {lead_sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lead data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 pr-4">Source</th>
                    <th className="text-right py-2 px-2">Leads</th>
                    <th className="text-right py-2 px-2">Booked</th>
                    <th className="text-right py-2 px-2">Conv %</th>
                    <th className="text-right py-2 px-2">Revenue</th>
                    <th className="text-right py-2 px-2">Cost</th>
                    <th className="text-right py-2 px-2">Profit</th>
                    <th className="text-right py-2 pl-2">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {lead_sources.map((s) => (
                    <tr key={s.source} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2.5 pr-4 font-medium">{SOURCE_LABELS[s.source] || s.source}</td>
                      <td className="text-right py-2.5 px-2 text-muted-foreground">{s.leads}</td>
                      <td className="text-right py-2.5 px-2 text-muted-foreground">{s.booked}</td>
                      <td className="text-right py-2.5 px-2 text-muted-foreground">{s.conversionRate}%</td>
                      <td className="text-right py-2.5 px-2 text-green-400 font-medium">{s.revenue > 0 ? fmtFull(s.revenue) : '-'}</td>
                      <td className="text-right py-2.5 px-2 text-red-400">{s.cost > 0 ? fmtFull(s.cost) : '-'}</td>
                      <td className={cn("text-right py-2.5 px-2 font-medium", s.profit >= 0 ? "text-green-400" : "text-red-400")}>
                        {s.cost > 0 || s.revenue > 0 ? (s.profit >= 0 ? '+' : '') + fmtFull(s.profit) : '-'}
                      </td>
                      <td className={cn("text-right py-2.5 pl-2 font-bold", s.roi !== null ? (s.roi >= 0 ? "text-green-400" : "text-red-400") : "text-muted-foreground")}>
                        {s.roi !== null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SECTION 4: AI Recommendations ═══ */}
      {recommendations.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400" />
              What Knobs to Turn
            </h3>
            <div className="space-y-2">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 py-2 px-3 rounded-lg bg-muted/30">
                  {rec.type === "up" && <ArrowUpRight className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />}
                  {rec.type === "down" && <ArrowDownRight className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />}
                  {rec.type === "info" && <Minus className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />}
                  <span className="text-sm">{rec.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RevenueCard({ title, amount, subtitle, icon, color, bg, suffix }: {
  title: string
  amount: number
  subtitle: string
  icon: React.ReactNode
  color: string
  bg: string
  suffix?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className={cn("p-2 rounded-lg", bg)}>
            <div className={color}>{icon}</div>
          </div>
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
        </div>
        <p className="text-2xl font-black">
          {fmtFull(amount)}{suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </CardContent>
    </Card>
  )
}

function PnlRow({ label, amount, color, bold }: { label: string; amount: number; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-sm", bold ? "font-semibold" : "text-muted-foreground")}>{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", color, bold && "text-base font-bold")}>
        {amount >= 0 ? '+' : ''}{fmtFull(amount)}
      </span>
    </div>
  )
}
