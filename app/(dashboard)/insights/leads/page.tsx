"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { BarChart3, TrendingUp, DollarSign, Clock } from "lucide-react"
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from "recharts"
import { MetricCard } from "@/components/insights/metric-card"
import { ChartCard } from "@/components/insights/chart-card"
import { DetailTable, type Column } from "@/components/insights/detail-table"
import CubeLoader from "@/components/ui/cube-loader"
import { getSourceConfig, SOURCE_CONFIG } from "@/lib/constants/lead-sources"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceRow {
  source: string
  leads: number
  previousLeads: number
  conversions: number
  previousConversions: number
  revenue: number
  previousRevenue: number
  conversionRate: number
  avgResponseMinutes: number
  untouched: number
}

interface TrendRow {
  date: string
  source: string
  leads: number
  conversions: number
}

interface RevenueTimelineEntry {
  date: string
  revenue: number
  profit: number
  bySource: Record<string, { revenue: number; profit: number }>
}

interface InsightsData {
  bySource: SourceRow[]
  trends: TrendRow[]
  totals: {
    leads: number
    previousLeads: number
    conversions: number
    previousConversions: number
    revenue: number
    previousRevenue: number
    profit?: number
    avgResponseMinutes: number
    previousAvgResponseMinutes: number
  }
  sparklines: {
    leads: number[]
    conversions: number[]
    revenue: number[]
  }
  revenueTimeline?: RevenueTimelineEntry[]
  revenueSources?: string[]
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeadSourcesPage() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<string>("revenue")
  const [revenueSourceFilter, setRevenueSourceFilter] = useState<string>("all")

  // Build the query string from search params
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    const range = searchParams.get("range") || "30d"
    params.set("range", range)
    if (range === "custom") {
      const from = searchParams.get("from")
      const to = searchParams.get("to")
      if (from) params.set("from", from)
      if (to) params.set("to", to)
    }
    return params.toString()
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/actions/insights/leads?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load insights")
        }
        return res.json()
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [queryString])

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <CubeLoader />
      </div>
    )
  }

  // Error
  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  // Empty
  if (!data || data.bySource.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">No lead data for this period</p>
      </div>
    )
  }

  const { bySource, totals, sparklines } = data

  const conversionRate =
    totals.leads > 0
      ? Math.round((totals.conversions / totals.leads) * 1000) / 10
      : 0
  const prevConversionRate =
    totals.previousLeads > 0
      ? Math.round((totals.previousConversions / totals.previousLeads) * 1000) / 10
      : 0

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* Metric cards                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Leads"
          value={totals.leads}
          previousValue={totals.previousLeads}
          icon={BarChart3}
          sparklineData={sparklines.leads}
          sparklineColor="#a78bfa"
        />
        <MetricCard
          label="Conversion Rate"
          value={conversionRate}
          previousValue={prevConversionRate}
          format="percent"
          suffix="%"
          icon={TrendingUp}
          sparklineData={sparklines.conversions}
          sparklineColor="#4ade80"
        />
        <MetricCard
          label="Revenue"
          value={totals.revenue}
          previousValue={totals.previousRevenue}
          format="currency"
          prefix="$"
          icon={DollarSign}
          sparklineData={sparklines.revenue}
          sparklineColor="#3b82f6"
        />
        <MetricCard
          label="Avg Response Time"
          value={totals.avgResponseMinutes}
          previousValue={totals.previousAvgResponseMinutes}
          suffix="m"
          icon={Clock}
          sparklineColor="#a78bfa"
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Charts row                                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Line chart — Revenue + Profit */}
        <div className="lg:col-span-3">
          <ChartCard title="Revenue & Profit">
            <div className="mb-3 flex items-center gap-2">
              <select
                value={revenueSourceFilter}
                onChange={(e) => setRevenueSourceFilter(e.target.value)}
                className="text-xs bg-muted border border-border rounded-md px-2 py-1 text-foreground"
              >
                <option value="all">All Sources</option>
                {(data.revenueSources ?? []).map((src) => (
                  <option key={src} value={src}>
                    {getSourceConfig(src).label}
                  </option>
                ))}
              </select>
            </div>
            <RevenueLineChart
              data={data.revenueTimeline ?? []}
              sourceFilter={revenueSourceFilter}
            />
          </ChartCard>
        </div>

        {/* Donut — Lead Distribution */}
        <div className="lg:col-span-2">
          <ChartCard title="Lead Distribution">
            <DonutSection data={bySource} totalLeads={totals.leads} />
          </ChartCard>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Source breakdown table                                              */}
      {/* ----------------------------------------------------------------- */}
      <SourceTable data={bySource} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bar chart sub-component
// ---------------------------------------------------------------------------

function RevenueLineChart({ data, sourceFilter }: { data: RevenueTimelineEntry[]; sourceFilter: string }) {
  const chartData = data.map((d) => {
    if (sourceFilter === "all") {
      return { date: d.date.slice(5), revenue: d.revenue, profit: d.profit }
    }
    const src = d.bySource[sourceFilter]
    return { date: d.date.slice(5), revenue: Math.round(src?.revenue ?? 0), profit: Math.round(src?.profit ?? 0) }
  })

  if (chartData.length === 0) {
    return <p className="text-muted-foreground text-sm py-12 text-center">No revenue data for this period</p>
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          className="fill-muted-foreground"
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          className="fill-muted-foreground"
          tickFormatter={(v: number) => `$${v.toLocaleString()}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            fontSize: 12,
          }}
          formatter={(value: number, name: string) => [
            `$${value.toLocaleString()}`,
            name === "revenue" ? "Revenue" : "Profit",
          ]}
        />
        <Legend
          verticalAlign="top"
          height={28}
          formatter={(value: string) => (value === "revenue" ? "Revenue" : "Profit")}
        />
        <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ---------------------------------------------------------------------------
// Donut chart sub-component
// ---------------------------------------------------------------------------

function DonutSection({ data, totalLeads }: { data: SourceRow[]; totalLeads: number }) {
  const chartData = data
    .filter((r) => r.leads > 0)
    .map((r) => ({
      name: getSourceConfig(r.source).label,
      value: r.leads,
      color: getSourceConfig(r.source).color,
    }))

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <ResponsiveContainer width={200} height={200}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              outerRadius={90}
              strokeWidth={0}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{totalLeads}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-1.5 min-w-0">
        {chartData.map((entry) => {
          const pct = totalLeads > 0 ? Math.round((entry.value / totalLeads) * 100) : 0
          return (
            <div key={entry.name} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground truncate">{entry.name}</span>
              <span className="ml-auto font-medium text-foreground tabular-nums">
                {entry.value}
              </span>
              <span className="text-muted-foreground text-xs tabular-nums w-8 text-right">
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Source breakdown table
// ---------------------------------------------------------------------------

function SourceTable({ data }: { data: SourceRow[] }) {
  type Row = SourceRow & Record<string, unknown>

  const columns: Column<Row>[] = [
    {
      key: "source",
      label: "Source",
      render: (row) => {
        const cfg = getSourceConfig(row.source)
        return (
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cfg.color }}
            />
            <span className="font-medium">{cfg.label}</span>
          </div>
        )
      },
    },
    { key: "leads", label: "Leads", align: "right" },
    { key: "conversions", label: "Converted", align: "right" },
    {
      key: "conversionRate",
      label: "Conv %",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "font-medium",
            row.conversionRate >= 35
              ? "text-success"
              : row.conversionRate >= 20
                ? "text-amber-500"
                : "text-destructive"
          )}
        >
          {row.conversionRate}%
        </span>
      ),
    },
    {
      key: "revenue",
      label: "Revenue",
      align: "right",
      render: (row) => (
        <span>${row.revenue.toLocaleString()}</span>
      ),
    },
    {
      key: "avgResponseMinutes",
      label: "Avg Response",
      align: "right",
      render: (row) => (
        <span>{row.avgResponseMinutes > 0 ? `${row.avgResponseMinutes}m` : "-"}</span>
      ),
    },
    {
      key: "untouched",
      label: "Untouched",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            row.untouched >= 3
              ? "text-destructive font-medium"
              : row.untouched >= 1
                ? "text-amber-500 font-medium"
                : ""
          )}
        >
          {row.untouched}
        </span>
      ),
    },
  ]

  return (
    <DetailTable<Row>
      title="Source Breakdown"
      columns={columns}
      data={data as Row[]}
      defaultExpanded
    />
  )
}
