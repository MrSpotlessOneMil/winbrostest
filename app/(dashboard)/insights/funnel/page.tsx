"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { TrendingUp, Clock, AlertTriangle } from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { MetricCard } from "@/components/insights/metric-card"
import { ChartCard } from "@/components/insights/chart-card"
import { DetailTable, type Column } from "@/components/insights/detail-table"
import CubeLoader from "@/components/ui/cube-loader"
import { getSourceConfig } from "@/lib/constants/lead-sources"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FunnelStage {
  name: string
  count: number
  previousCount: number
  dropOffPercent: number
}

interface StaleLead {
  id: string
  name: string
  source: string
  daysSinceContact: number
  [key: string]: unknown
}

interface ConversionTrendPoint {
  date: string
  leadsIn: number
  booked: number
  rate: number
}

interface FunnelData {
  stages: FunnelStage[]
  staleLeads: { count: number; leads: StaleLead[] }
  avgTimeToContact: number
  previousAvgTimeToContact: number
  avgTimeToBook: number
  bottleneck: string
  conversionTrend: ConversionTrendPoint[]
  sparklines: {
    conversionRate: number[]
    leadsIn: number[]
  }
}

// ---------------------------------------------------------------------------
// Funnel Visualization Component
// ---------------------------------------------------------------------------

const STAGE_COLORS = [
  "bg-violet-500",
  "bg-purple-500",
  "bg-indigo-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-green-500",
]

const STAGE_BG_COLORS = [
  "bg-violet-500/20",
  "bg-purple-500/20",
  "bg-indigo-500/20",
  "bg-blue-500/20",
  "bg-emerald-500/20",
  "bg-green-500/20",
]

function FunnelVisualization({ stages }: { stages: FunnelStage[] }) {
  const maxCount = stages[0]?.count || 1

  return (
    <div className="rounded-lg border border-border p-4 space-y-1">
      <h3 className="text-base font-semibold mb-4">Lead Funnel</h3>
      {stages.map((stage, i) => {
        const widthPct = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, 4) : 4

        return (
          <div key={stage.name}>
            {/* Drop-off label between stages */}
            {i > 0 && stage.dropOffPercent > 0 && (
              <div className="flex items-center gap-2 py-1 pl-2">
                <span className="text-xs text-muted-foreground">
                  ↓ {stage.dropOffPercent}% drop-off
                </span>
              </div>
            )}

            {/* Bar row */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground w-24 shrink-0 text-right">
                {stage.name}
              </span>
              <div className="flex-1 relative">
                <div
                  className={`h-9 rounded-md ${STAGE_BG_COLORS[i] || "bg-primary/20"} relative overflow-hidden`}
                  style={{ width: "100%" }}
                >
                  <div
                    className={`h-full rounded-md ${STAGE_COLORS[i] || "bg-primary"} transition-all duration-700 ease-out flex items-center justify-end pr-3`}
                    style={{ width: `${widthPct}%` }}
                  >
                    <span className="text-xs font-semibold text-white drop-shadow-sm">
                      {stage.count}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FunnelPage() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<FunnelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

    fetch(`/api/actions/insights/funnel?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load funnel data")
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <CubeLoader />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-destructive">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">No funnel data for this period</p>
      </div>
    )
  }

  const { stages, staleLeads, avgTimeToContact, previousAvgTimeToContact, avgTimeToBook, bottleneck, conversionTrend, sparklines } = data

  // Overall conversion rate: completed / total leads
  const totalLeads = stages[0]?.count || 0
  const completedCount = stages.find((s) => s.name === "Completed")?.count || 0
  const prevTotalLeads = stages[0]?.previousCount || 0
  const prevCompletedCount = stages.find((s) => s.name === "Completed")?.previousCount || 0

  const conversionRate = totalLeads > 0 ? Math.round((completedCount / totalLeads) * 1000) / 10 : 0
  const prevConversionRate = prevTotalLeads > 0 ? Math.round((prevCompletedCount / prevTotalLeads) * 1000) / 10 : 0

  // -----------------------------------------------------------------------
  // Stale leads table columns
  // -----------------------------------------------------------------------
  const staleColumns: Column<StaleLead>[] = [
    {
      key: "name",
      label: "Name",
      render: (row) => <span className="font-medium">{row.name}</span>,
    },
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
            <span>{cfg.label}</span>
          </div>
        )
      },
    },
    {
      key: "daysSinceContact",
      label: "Days Since Contact",
      align: "right",
      render: (row) => (
        <span className={row.daysSinceContact >= 7 ? "text-destructive font-medium" : row.daysSinceContact >= 3 ? "text-amber-500 font-medium" : ""}>
          {row.daysSinceContact}d
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* Metric cards                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Overall Conversion Rate"
          value={conversionRate}
          previousValue={prevConversionRate}
          format="percent"
          suffix="%"
          icon={TrendingUp}
          sparklineData={sparklines.conversionRate}
          sparklineColor="#4ade80"
        />
        <MetricCard
          label="Avg Time to First Contact"
          value={avgTimeToContact}
          previousValue={previousAvgTimeToContact}
          suffix="m"
          icon={Clock}
          sparklineColor="#a78bfa"
        />
        <Card className="relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground truncate">Bottleneck Stage</p>
                <p className="text-2xl font-bold text-primary truncate">{bottleneck}</p>
                <p className="text-xs text-muted-foreground">
                  Highest drop-off point
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <AlertTriangle className="h-4.5 w-4.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Funnel Visualization                                               */}
      {/* ----------------------------------------------------------------- */}
      <FunnelVisualization stages={stages} />

      {/* ----------------------------------------------------------------- */}
      {/* Conversion Trend                                                    */}
      {/* ----------------------------------------------------------------- */}
      <ChartCard title="Conversion Trend" subtitle="Daily lead-to-booked conversion rate">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={conversionTrend} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="conversionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground"
              tickFormatter={(v: string) => {
                const d = new Date(v + "T00:00:00")
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground"
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                if (name === "rate") return [`${value}%`, "Conversion Rate"]
                return [value, name === "leadsIn" ? "Leads In" : "Booked"]
              }}
              labelFormatter={(label: string) => {
                const d = new Date(label + "T00:00:00")
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }}
            />
            <Area
              type="monotone"
              dataKey="rate"
              stroke="hsl(var(--success))"
              fill="url(#conversionGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ----------------------------------------------------------------- */}
      {/* Stale Leads                                                        */}
      {/* ----------------------------------------------------------------- */}
      <DetailTable<StaleLead>
        title={`Stale Leads (${staleLeads.count})`}
        columns={staleColumns}
        data={staleLeads.leads}
        defaultExpanded={false}
      />
    </div>
  )
}
