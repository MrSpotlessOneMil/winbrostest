"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import {
  DollarSign,
  CheckCircle2,
  UserPlus,
  ArrowRightLeft,
  Users,
  TrendingUp,
  TrendingDown,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import CubeLoader from "@/components/ui/cube-loader"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevenueTrendPoint {
  week: string
  revenue: number
  jobs: number
}

interface CustomerTrendPoint {
  week: string
  count: number
}

interface CrewRow {
  teamId: string
  name: string
  revenue: number
  jobs: number
}

interface OverviewData {
  revenue: {
    total: number
    previous: number
    trend: RevenueTrendPoint[]
  }
  completion: {
    rate: number
    previousRate: number
    completed: number
    scheduled: number
  }
  customers: {
    new: number
    previousNew: number
    trend: CustomerTrendPoint[]
  }
  conversion: {
    rate: number
    previousRate: number
    quotes: number
    plans: number
  }
  crews: CrewRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeDelta(
  current: number,
  previous: number
): { percent: number; direction: "up" | "down" | "neutral" } {
  if (previous === 0) {
    return { percent: 0, direction: current > 0 ? "up" : "neutral" }
  }
  const change = ((current - previous) / Math.abs(previous)) * 100
  if (Math.abs(change) < 0.1) return { percent: 0, direction: "neutral" }
  return {
    percent: Math.abs(Math.round(change)),
    direction: change > 0 ? "up" : "down",
  }
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`
}

// ---------------------------------------------------------------------------
// Pure CSS Sparkline (SVG, no library)
// ---------------------------------------------------------------------------

function MiniSparkline({
  data,
  color = "#a78bfa",
  height = 40,
  width = 120,
}: {
  data: number[]
  color?: string
  height?: number
  width?: number
}) {
  if (data.length < 2) return null

  const padding = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return { x, y }
  })

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ")
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`
  const gradientId = `overview-spark-${color.replace("#", "")}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Pure CSS Bar Chart
// ---------------------------------------------------------------------------

function BarChart({
  data,
  color = "#a78bfa",
  labelKey,
  valueKey,
  formatLabel,
  formatValue,
}: {
  data: Record<string, unknown>[]
  color?: string
  labelKey: string
  valueKey: string
  formatLabel?: (v: string) => string
  formatValue?: (v: number) => string
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No data available
      </p>
    )
  }

  const maxVal = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1)
  const valFormatter = formatValue || ((v: number) => String(v))

  const barMaxHeight = 96 // px

  return (
    <div className="flex items-end gap-1.5" style={{ minHeight: barMaxHeight + 40 }}>
      {data.map((item, i) => {
        const val = Number(item[valueKey]) || 0
        const barHeight = Math.max((val / maxVal) * barMaxHeight, 2)
        const label = String(item[labelKey])
        const displayLabel = formatLabel ? formatLabel(label) : label

        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center gap-1 min-w-0"
          >
            <span className="text-[10px] text-muted-foreground tabular-nums truncate">
              {valFormatter(val)}
            </span>
            <div className="w-full flex justify-center">
              <div
                className="rounded-t transition-all duration-500 ease-out"
                style={{
                  width: "80%",
                  height: barHeight,
                  backgroundColor: color,
                  opacity: 0.85,
                }}
                title={`${displayLabel}: ${valFormatter(val)}`}
              />
            </div>
            <span className="text-[9px] text-muted-foreground truncate max-w-full">
              {displayLabel}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------

interface InsightMetricCardProps {
  label: string
  value: string
  delta: { percent: number; direction: "up" | "down" | "neutral" }
  icon: React.ElementType
  sparkData?: number[]
  sparkColor?: string
  subtitle?: string
}

function InsightMetricCard({
  label,
  value,
  delta,
  icon: Icon,
  sparkData,
  sparkColor = "#a78bfa",
  subtitle,
}: InsightMetricCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">
              {label}
            </p>
            <p className="text-2xl font-bold text-primary truncate">{value}</p>
            <div className="flex items-center gap-1.5">
              {delta.direction !== "neutral" && (
                <div className="flex items-center gap-0.5">
                  {delta.direction === "up" ? (
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span
                    className={cn(
                      "text-xs font-medium",
                      delta.direction === "up"
                        ? "text-emerald-500"
                        : "text-red-500"
                    )}
                  >
                    {delta.percent}%
                  </span>
                </div>
              )}
              {subtitle && (
                <span className="text-xs text-muted-foreground">{subtitle}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-4.5 w-4.5" />
            </div>
            {sparkData && sparkData.length >= 2 && (
              <MiniSparkline data={sparkData} color={sparkColor} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Horizontal crew bar
// ---------------------------------------------------------------------------

function CrewBar({
  name,
  revenue,
  jobs,
  maxRevenue,
  rank,
}: {
  name: string
  revenue: number
  jobs: number
  maxRevenue: number
  rank: number
}) {
  const widthPct = maxRevenue > 0 ? Math.max((revenue / maxRevenue) * 100, 3) : 3
  const rankColors: Record<number, string> = {
    1: "bg-amber-500/20 text-amber-500",
    2: "bg-zinc-400/20 text-zinc-400",
    3: "bg-orange-500/20 text-orange-500",
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold shrink-0",
          rankColors[rank] || "bg-muted text-muted-foreground"
        )}
      >
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate">{name}</span>
          <div className="flex items-center gap-3 shrink-0 text-sm">
            <span className="text-muted-foreground">{jobs} jobs</span>
            <span className="font-semibold tabular-nums">{formatCurrency(revenue)}</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
            style={{ width: `${widthPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Completion ring (pure CSS)
// ---------------------------------------------------------------------------

function CompletionRing({
  rate,
  completed,
  scheduled,
}: {
  rate: number
  completed: number
  scheduled: number
}) {
  const circumference = 2 * Math.PI * 42
  const dashOffset = circumference - (rate / 100) * circumference
  const ringColor = rate >= 80 ? "#4ade80" : rate >= 60 ? "#facc15" : "#f87171"

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="6"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={ringColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 50 50)"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold" style={{ color: ringColor }}>
            {rate}%
          </span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Job Completion</p>
        <p className="text-xs text-muted-foreground">
          {completed} of {scheduled} scheduled
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Conversion funnel mini
// ---------------------------------------------------------------------------

function ConversionFunnelMini({
  quotes,
  plans,
  rate,
}: {
  quotes: number
  plans: number
  rate: number
}) {
  const quotesWidth = 100
  const plansWidth = quotes > 0 ? Math.max((plans / quotes) * 100, 5) : 5

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Quotes</span>
          <span className="text-xs font-medium tabular-nums">{quotes}</span>
        </div>
        <div className="h-5 rounded bg-violet-500/20 overflow-hidden">
          <div
            className="h-full rounded bg-violet-500 transition-all duration-500"
            style={{ width: `${quotesWidth}%` }}
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">Service Plans</span>
          <span className="text-xs font-medium tabular-nums">{plans}</span>
        </div>
        <div className="h-5 rounded bg-emerald-500/20 overflow-hidden">
          <div
            className="h-full rounded bg-emerald-500 transition-all duration-500"
            style={{ width: `${plansWidth}%` }}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center">
        {rate}% conversion rate
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InsightsOverviewPage() {
  useAuth()
  const searchParams = useSearchParams()
  const [data, setData] = useState<OverviewData | null>(null)
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

    fetch(`/api/actions/insights/overview?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load overview data")
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
        <p className="text-muted-foreground">No data available for this period</p>
      </div>
    )
  }

  const revenueDelta = computeDelta(data.revenue.total, data.revenue.previous)
  const completionDelta = computeDelta(
    data.completion.rate,
    data.completion.previousRate
  )
  const customerDelta = computeDelta(
    data.customers.new,
    data.customers.previousNew
  )
  const conversionDelta = computeDelta(
    data.conversion.rate,
    data.conversion.previousRate
  )

  const revenueSparkData = data.revenue.trend.map((t) => t.revenue)
  const customerSparkData = data.customers.trend.map((t) => t.count)
  const maxCrewRevenue = Math.max(...data.crews.map((c) => c.revenue), 1)

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* Metric Cards — 2x2 on mobile, 4-col on desktop                    */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <InsightMetricCard
          label="Revenue"
          value={formatCurrency(data.revenue.total)}
          delta={revenueDelta}
          icon={DollarSign}
          sparkData={revenueSparkData}
          sparkColor="#5b8def"
          subtitle="vs prev period"
        />
        <InsightMetricCard
          label="Job Completion"
          value={`${data.completion.rate}%`}
          delta={completionDelta}
          icon={CheckCircle2}
          sparkColor="#4ade80"
          subtitle={`${data.completion.completed}/${data.completion.scheduled}`}
        />
        <InsightMetricCard
          label="New Customers"
          value={String(data.customers.new)}
          delta={customerDelta}
          icon={UserPlus}
          sparkData={customerSparkData}
          sparkColor="#a78bfa"
          subtitle="vs prev period"
        />
        <InsightMetricCard
          label="Quote Conversion"
          value={`${data.conversion.rate}%`}
          delta={conversionDelta}
          icon={ArrowRightLeft}
          sparkColor="#facc15"
          subtitle={`${data.conversion.plans}/${data.conversion.quotes} quotes`}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Charts row: Revenue Trend + Completion Ring                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Revenue Trend */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekly Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={data.revenue.trend}
              color="#5b8def"
              labelKey="week"
              valueKey="revenue"
              formatLabel={(w) => {
                const d = new Date(w + "T00:00:00")
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
              formatValue={(v) => formatCurrency(v)}
            />
          </CardContent>
        </Card>

        {/* Completion + Conversion */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <CompletionRing
              rate={data.completion.rate}
              completed={data.completion.completed}
              scheduled={data.completion.scheduled}
            />
            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">
                Quote to Service Plan
              </p>
              <ConversionFunnelMini
                quotes={data.conversion.quotes}
                plans={data.conversion.plans}
                rate={data.conversion.rate}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Bottom row: Customer Acquisition + Crew Productivity              */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer Acquisition */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              Customer Acquisition
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart
              data={data.customers.trend}
              color="#a78bfa"
              labelKey="week"
              valueKey="count"
              formatLabel={(w) => {
                const d = new Date(w + "T00:00:00")
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
            />
          </CardContent>
        </Card>

        {/* Crew Productivity */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Crew Productivity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.crews.length > 0 ? (
              <div className="space-y-3">
                {data.crews.map((crew, i) => (
                  <CrewBar
                    key={crew.teamId}
                    name={crew.name}
                    revenue={crew.revenue}
                    jobs={crew.jobs}
                    maxRevenue={maxCrewRevenue}
                    rank={i + 1}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                No crew data for this period
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
