"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import {
  Heart,
  Repeat,
  AlertTriangle,
  Target,
  UserX,
  FileQuestion,
  UserCheck,
  TimerOff,
  Lightbulb,
  ArrowRight,
} from "lucide-react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricCard } from "@/components/insights/metric-card"
import { ChartCard } from "@/components/insights/chart-card"
import { DetailTable, type Column } from "@/components/insights/detail-table"
import CubeLoader from "@/components/ui/cube-loader"
import { cn } from "@/lib/utils"
import Link from "next/link"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RetentionData {
  lifecycleDistribution: Record<string, { count: number }>
  retargeting: {
    stages: Record<
      string,
      { total: number; in_sequence: number; completed_sequence: number; converted: number }
    >
    totals: {
      totalEligible: number
      inSequence: number
      completedSequence: number
      converted: number
      notEnrolled: number
    }
    conversionRate: number
  }
  repeatRate: { current: number }
  healthScore: number
  atRiskCustomers: Array<{
    id: string
    name: string
    daysSinceLastJob: number
    lifecycleStage: string
  }>
  satisfaction: { positive: number; negative: number; noResponse: number }
  recommendations: Array<{
    priority: "high" | "medium" | "low"
    title: string
    description: string
    action?: string
    link?: string
  }>
  sparklines: { healthScore: number[] }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIFECYCLE_COLORS: Record<string, string> = {
  active: "#4ade80",
  repeat: "#22c55e",
  one_time: "#facc15",
  lapsed: "#a78bfa",
  quoted_not_booked: "#fb923c",
  new_lead: "#5b8def",
  lost: "#6b7280",
  unresponsive: "#ef4444",
  unknown: "#9ca3af",
}

const LIFECYCLE_LABELS: Record<string, string> = {
  active: "Active",
  repeat: "Repeat",
  one_time: "One-Time",
  lapsed: "Lapsed",
  quoted_not_booked: "Quoted, Not Booked",
  new_lead: "New Lead",
  lost: "Lost",
  unresponsive: "Unresponsive",
  unknown: "Unknown",
}

const STAGE_META = {
  unresponsive: { label: "Unresponsive", icon: UserX, color: "text-red-400" },
  quoted_not_booked: { label: "Quoted, Not Booked", icon: FileQuestion, color: "text-orange-400" },
  one_time: { label: "One-Time", icon: UserCheck, color: "text-yellow-400" },
  lapsed: { label: "Lapsed", icon: TimerOff, color: "text-purple-400" },
} as const

const PRIORITY_STYLES = {
  high: { border: "border-l-red-500", bg: "bg-red-500/10", text: "text-red-400" },
  medium: { border: "border-l-amber-500", bg: "bg-amber-500/10", text: "text-amber-400" },
  low: { border: "border-l-green-500", bg: "bg-green-500/10", text: "text-green-400" },
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RetentionPage() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<RetentionData | null>(null)
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

    fetch(`/api/actions/insights/retention?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load retention data")
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
        <p className="text-muted-foreground">No retention data available</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* 1. Metric cards                                                   */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Customer Health Score"
          value={data.healthScore}
          suffix="%"
          format="percent"
          icon={Heart}
          sparklineData={data.sparklines.healthScore}
          sparklineColor={data.healthScore > 50 ? "#4ade80" : "#f87171"}
        />
        <MetricCard
          label="Repeat Rate"
          value={data.repeatRate.current}
          suffix="%"
          format="percent"
          icon={Repeat}
          sparklineColor="#4ade80"
        />
        <MetricCard
          label="At-Risk Customers"
          value={data.atRiskCustomers.length}
          icon={AlertTriangle}
          sparklineColor="#fbbf24"
        />
        <MetricCard
          label="Retargeting Conversion"
          value={data.retargeting.conversionRate}
          suffix="%"
          format="percent"
          icon={Target}
          sparklineColor="#a78bfa"
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 2. Lifecycle Distribution + 3. Retargeting Performance            */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <ChartCard title="Lifecycle Distribution">
            <LifecycleDonut distribution={data.lifecycleDistribution} />
          </ChartCard>
        </div>
        <div className="lg:col-span-2">
          <RetargetingPerformance totals={data.retargeting.totals} conversionRate={data.retargeting.conversionRate} />
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 4. Retargeting by Stage                                           */}
      {/* ----------------------------------------------------------------- */}
      <RetargetingByStage stages={data.retargeting.stages} />

      {/* ----------------------------------------------------------------- */}
      {/* 5. At-Risk Customers                                              */}
      {/* ----------------------------------------------------------------- */}
      <AtRiskTable customers={data.atRiskCustomers} />

      {/* ----------------------------------------------------------------- */}
      {/* 6. Recommendations                                                */}
      {/* ----------------------------------------------------------------- */}
      {data.recommendations.length > 0 && (
        <RecommendationsCard recommendations={data.recommendations} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lifecycle Donut
// ---------------------------------------------------------------------------

function LifecycleDonut({
  distribution,
}: {
  distribution: Record<string, { count: number }>
}) {
  const chartData = Object.entries(distribution)
    .filter(([, v]) => v.count > 0)
    .map(([stage, v]) => ({
      name: LIFECYCLE_LABELS[stage] || stage,
      value: v.count,
      color: LIFECYCLE_COLORS[stage] || "#9ca3af",
    }))
    .sort((a, b) => b.value - a.value)

  const total = chartData.reduce((s, d) => s + d.value, 0)

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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0">
        {chartData.map((entry) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
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
// Retargeting Performance (2x2 stat boxes + conversion bar)
// ---------------------------------------------------------------------------

function RetargetingPerformance({
  totals,
  conversionRate,
}: {
  totals: RetentionData["retargeting"]["totals"]
  conversionRate: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retargeting Performance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="In Sequence" value={totals.inSequence} color="text-blue-400" bgColor="bg-blue-500/10" />
          <StatBox label="Converted" value={totals.converted} color="text-green-400" bgColor="bg-green-500/10" />
          <StatBox label="Completed" value={totals.completedSequence} color="text-muted-foreground" bgColor="bg-muted" />
          <StatBox label="Not Enrolled" value={totals.notEnrolled} color="text-amber-400" bgColor="bg-amber-500/10" />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Conversion Rate</span>
            <span className="font-medium text-foreground">{conversionRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.min(conversionRate, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function StatBox({
  label,
  value,
  color,
  bgColor,
}: {
  label: string
  value: number
  color: string
  bgColor: string
}) {
  return (
    <div className={cn("rounded-lg p-3 text-center", bgColor)}>
      <p className={cn("text-2xl font-bold", color)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Retargeting by Stage
// ---------------------------------------------------------------------------

function RetargetingByStage({
  stages,
}: {
  stages: Record<
    string,
    { total: number; in_sequence: number; completed_sequence: number; converted: number }
  >
}) {
  const stageKeys = Object.keys(STAGE_META) as Array<keyof typeof STAGE_META>

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Retargeting by Stage</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {stageKeys.map((key) => {
            const meta = STAGE_META[key]
            const Icon = meta.icon
            const s = stages[key] || { total: 0, in_sequence: 0, completed_sequence: 0, converted: 0 }
            const enrolled = s.in_sequence + s.completed_sequence + s.converted
            const notEnrolled = Math.max(0, s.total - enrolled)
            const stageConvRate =
              enrolled > 0 ? Math.round((s.converted / enrolled) * 100) : 0

            return (
              <div key={key} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", meta.color)} />
                    <span className="text-sm font-medium">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">({s.total})</span>
                  </div>
                  {enrolled > 0 && (
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-full",
                        stageConvRate >= 20
                          ? "bg-green-500/10 text-green-400"
                          : stageConvRate >= 10
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      {stageConvRate}% conv.
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <MiniStat label="Not Enrolled" value={notEnrolled} color="text-amber-400" />
                  <MiniStat label="In Sequence" value={s.in_sequence} color="text-blue-400" />
                  <MiniStat label="Completed" value={s.completed_sequence} color="text-muted-foreground" />
                  <MiniStat label="Converted" value={s.converted} color="text-green-400" />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="text-center">
      <p className={cn("text-lg font-semibold", color)}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// At-Risk Table
// ---------------------------------------------------------------------------

function AtRiskTable({
  customers,
}: {
  customers: RetentionData["atRiskCustomers"]
}) {
  type Row = RetentionData["atRiskCustomers"][number] & Record<string, unknown>

  const columns: Column<Row>[] = [
    { key: "name", label: "Name" },
    {
      key: "daysSinceLastJob",
      label: "Days Since Last Job",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "font-medium",
            row.daysSinceLastJob >= 80
              ? "text-destructive"
              : row.daysSinceLastJob >= 70
                ? "text-amber-500"
                : "text-foreground"
          )}
        >
          {row.daysSinceLastJob}d
        </span>
      ),
    },
    {
      key: "lifecycleStage",
      label: "Lifecycle Stage",
      render: (row) => (
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: LIFECYCLE_COLORS[row.lifecycleStage] || "#9ca3af" }}
          />
          <span>{LIFECYCLE_LABELS[row.lifecycleStage] || row.lifecycleStage}</span>
        </div>
      ),
    },
  ]

  return (
    <DetailTable<Row>
      title={`At-Risk Customers (${customers.length})`}
      columns={columns}
      data={customers as Row[]}
    />
  )
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function RecommendationsCard({
  recommendations,
}: {
  recommendations: RetentionData["recommendations"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" />
          Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {recommendations.map((rec, i) => {
            const styles = PRIORITY_STYLES[rec.priority]
            return (
              <div
                key={i}
                className={cn(
                  "rounded-lg border border-border p-4 border-l-4",
                  styles.border
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "text-xs font-medium px-1.5 py-0.5 rounded",
                          styles.bg,
                          styles.text
                        )}
                      >
                        {rec.priority}
                      </span>
                      <h4 className="text-sm font-medium text-foreground">{rec.title}</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">{rec.description}</p>
                  </div>
                  {rec.action && rec.link && (
                    <Link
                      href={rec.link}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 whitespace-nowrap shrink-0 mt-1"
                    >
                      {rec.action}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
