"use client"

import { useEffect, useState, useCallback } from "react"
import CubeLoader from "@/components/ui/cube-loader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  DollarSign, TrendingUp, Repeat, Users, Target,
  RefreshCcw, ArrowUpRight, ArrowDownRight, Minus,
  ChevronDown, ChevronUp, MapPin,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts"

type ChartRange = "week" | "month" | "year"

interface JobDetail {
  id: number
  price: number
  service_type: string | null
  phone_number: string | null
  address: string | null
}

interface ChartPoint {
  date: string
  label: string
  revenue: number
  jobs: number
  job_details: JobDetail[]
}

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
  chart: ChartPoint[]
  chart_range: string
  retargeting: {
    active_sequences: number
    converted: number
    completed: number
    total_retargeted: number
    conversion_rate: number
  }
  month_name: string
}

const SOURCE_LABELS: Record<string, string> = {
  phone: "Phone", meta: "Meta Ads", website: "Website", vapi: "VAPI (AI)",
  sms: "SMS", google: "Google", google_lsa: "Google LSA", thumbtack: "Thumbtack",
  angi: "Angi", sam: "SAM", ghl: "GoHighLevel", housecall_pro: "HCP",
  manual: "Manual", email: "Email", retargeting: "Retargeting", unknown: "Unknown",
}
const PIE_COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"]

function fmtFull(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [chartRange, setChartRange] = useState<ChartRange>("month")
  const [expandedCard, setExpandedCard] = useState<string | null>(null)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const load = useCallback(async (range?: ChartRange) => {
    setLoading(true)
    try {
      const r = range || chartRange
      const res = await fetch(`/api/actions/insights-v2?chart_range=${r}`, { cache: "no-store" })
      const json = await res.json()
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [chartRange])

  useEffect(() => { load() }, [])

  function switchRange(r: ChartRange) {
    setChartRange(r)
    setExpandedDay(null)
    load(r)
  }

  if (loading && !data) return <CubeLoader />
  if (!data) return <div className="p-6 text-muted-foreground">Failed to load insights</div>

  const { revenue, pnl, lead_sources, chart, month_name } = data
  const toggle = (key: string) => setExpandedCard(prev => prev === key ? null : key)

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

  // Chart period total
  const chartTotal = chart.reduce((s, d) => s + d.revenue, 0)
  const chartJobs = chart.reduce((s, d) => s + d.jobs, 0)

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Insights</h1>
          <p className="text-sm text-muted-foreground">{month_name} — Real numbers, no bullshit</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {/* ═══ AI RECOMMENDATIONS — hero position ═══ */}
      {recommendations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recommendations.map((rec, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium",
                rec.type === "up" && "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
                rec.type === "down" && "bg-red-500/10 text-red-400 border border-red-500/20",
                rec.type === "info" && "bg-blue-500/10 text-blue-400 border border-blue-500/20",
              )}
            >
              {rec.type === "up" && <ArrowUpRight className="h-4 w-4 shrink-0" />}
              {rec.type === "down" && <ArrowDownRight className="h-4 w-4 shrink-0" />}
              {rec.type === "info" && <Minus className="h-4 w-4 shrink-0" />}
              {rec.text}
            </div>
          ))}
        </div>
      )}

      {/* ═══ REVENUE CARDS (clickable to expand) ═══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <RevenueCard title="Monthly Revenue" amount={revenue.monthly} icon={<DollarSign className="h-5 w-5" />} color="text-green-400" bg="bg-green-500/10"
          expanded={expandedCard === "monthly"} onToggle={() => toggle("monthly")}
          detail={<><p className="text-xs text-muted-foreground">Recurring: {fmtFull(revenue.monthly_recurring)}</p><p className="text-xs text-muted-foreground">One-time: {fmtFull(revenue.monthly_one_time)}</p></>}
        />
        <RevenueCard title="Annual Revenue" amount={revenue.annual} icon={<TrendingUp className="h-5 w-5" />} color="text-blue-400" bg="bg-blue-500/10"
          expanded={expandedCard === "annual"} onToggle={() => toggle("annual")}
          detail={<><p className="text-xs text-muted-foreground">Recurring: {fmtFull(revenue.annual_recurring)}</p><p className="text-xs text-muted-foreground">One-time: {fmtFull(revenue.annual_one_time)}</p></>}
        />
        <RevenueCard title="Recurring Revenue" amount={revenue.monthly_recurring} suffix="/mo" icon={<Repeat className="h-5 w-5" />} color="text-violet-400" bg="bg-violet-500/10"
          expanded={expandedCard === "recurring"} onToggle={() => toggle("recurring")}
          detail={<p className="text-xs text-muted-foreground">{revenue.recurring_client_count} active recurring clients</p>}
        />
        <RevenueCard title="Projected Annual" amount={revenue.projected_annual} icon={<Target className="h-5 w-5" />} color="text-amber-400" bg="bg-amber-500/10"
          expanded={expandedCard === "projected"} onToggle={() => toggle("projected")}
          detail={<p className="text-xs text-muted-foreground">= (recurring/mo × 12) + one-time YTD</p>}
        />
      </div>

      {/* ═══ REVENUE CHART (Stripe-style daily spikes) ═══ */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                Revenue — {fmtFull(chartTotal)} from {chartJobs} jobs
              </h3>
            </div>
            {/* Week / Month / Year toggle */}
            <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
              {(["week", "month", "year"] as ChartRange[]).map(r => (
                <button key={r} onClick={() => switchRange(r)}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors",
                    chartRange === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}>
                  {r === "week" ? "7D" : r === "month" ? "30D" : "1Y"}
                </button>
              ))}
            </div>
          </div>
          {chart.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chart} onClick={(e: any) => {
                  if (e?.activePayload?.[0]?.payload?.date) {
                    setExpandedDay(prev => prev === e.activePayload[0].payload.date ? null : e.activePayload[0].payload.date)
                  }
                }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)"
                    interval={chartRange === "year" ? 29 : chartRange === "month" ? 4 : 0} />
                  <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" width={50}
                    tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`} />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${fmtFull(value)}`, "Revenue"]}
                    labelFormatter={(label: string) => label}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2} fill="url(#revGrad)" dot={false}
                    activeDot={{ r: 5, stroke: "#8b5cf6", strokeWidth: 2, fill: "var(--background)" }} />
                </AreaChart>
              </ResponsiveContainer>
              {/* Click-to-expand: show jobs for selected day */}
              {expandedDay && (() => {
                const dayData = chart.find(d => d.date === expandedDay)
                if (!dayData || dayData.job_details.length === 0) return null
                return (
                  <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 animate-in slide-in-from-top-2 duration-200">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">
                      {new Date(expandedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — {fmtFull(dayData.revenue)} from {dayData.jobs} job{dayData.jobs !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1">
                      {dayData.job_details.map(j => (
                        <div key={j.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-muted/50">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium">#{j.id}</span>
                            <span className="text-muted-foreground truncate">{j.service_type || 'Cleaning'}</span>
                            {j.address && <span className="text-muted-foreground truncate flex items-center gap-0.5"><MapPin className="h-3 w-3" />{j.address.split(',')[0]}</span>}
                          </div>
                          <span className="font-semibold text-green-400 shrink-0">{fmtFull(j.price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No revenue data yet</p>
          )}
        </CardContent>
      </Card>

      {/* ═══ P&L + Lead Source Pie (side by side) ═══ */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Profit & Loss */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              Profit & Loss — {month_name}
            </h3>
            <div className="space-y-3">
              <PnlRow label="Revenue" amount={pnl.revenue} color="text-green-400" />
              <PnlRow label={`Cleaner Pay (${pnl.cleaner_pay_pct}%)`} amount={-pnl.cleaner_pay} color="text-red-400" />
              <PnlRow label="Ad Spend" amount={-pnl.ad_spend} color="text-red-400" />
              {pnl.other_expenses > 0 && <PnlRow label="Other Expenses" amount={-pnl.other_expenses} color="text-red-400" />}
              <div className="border-t border-border pt-3 mt-3">
                <PnlRow label={`Profit (${pnl.margin_pct}% margin)`} amount={pnl.profit} color={pnl.profit >= 0 ? "text-green-400" : "text-red-400"} bold />
              </div>
            </div>
            {pnl.revenue > 0 && (
              <div className="mt-4 flex h-3 rounded-full overflow-hidden bg-muted">
                <div className="bg-green-500" style={{ width: `${Math.max(0, pnl.margin_pct)}%` }} />
                <div className="bg-red-500/60" style={{ width: `${Math.min(100, 100 - Math.max(0, pnl.margin_pct))}%` }} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Lead Source Pie */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-cyan-400" />
              Lead Sources
            </h3>
            {lead_sources.filter(s => s.leads > 0).length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={lead_sources.filter(s => s.leads > 0).slice(0, 8)} dataKey="leads" nameKey="source" cx="50%" cy="50%" outerRadius={75} innerRadius={40}
                    label={({ source, leads }: { source: string; leads: number }) => `${SOURCE_LABELS[source] || source} (${leads})`} labelLine={false}>
                    {lead_sources.filter(s => s.leads > 0).slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number, name: string) => [value, SOURCE_LABELS[name] || name]} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground">No lead data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ═══ LEAD SOURCE ECONOMICS TABLE ═══ */}
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

      {/* ═══ RETARGETING STATS ═══ */}
      {data.retargeting.total_retargeted > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
              <Repeat className="h-4 w-4 text-orange-400" />
              Retargeting (runs automatically)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-2xl font-bold">{data.retargeting.active_sequences}</p>
                <p className="text-[11px] text-muted-foreground">Active sequences</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-green-400">{data.retargeting.converted}</p>
                <p className="text-[11px] text-muted-foreground">Converted back</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.retargeting.completed}</p>
                <p className="text-[11px] text-muted-foreground">Sequences completed</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{data.retargeting.conversion_rate}%</p>
                <p className="text-[11px] text-muted-foreground">Conversion rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI recommendations moved to hero position above */}
    </div>
  )
}

function RevenueCard({ title, amount, icon, color, bg, suffix, expanded, onToggle, detail }: {
  title: string; amount: number; icon: React.ReactNode; color: string; bg: string
  suffix?: string; expanded: boolean; onToggle: () => void; detail: React.ReactNode
}) {
  return (
    <Card className="cursor-pointer transition-all hover:shadow-md" onClick={onToggle}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("p-2 rounded-lg", bg)}><div className={color}>{icon}</div></div>
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="text-2xl font-black">
          {fmtFull(amount)}{suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        </p>
        {expanded && <div className="mt-3 pt-3 border-t border-border">{detail}</div>}
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
