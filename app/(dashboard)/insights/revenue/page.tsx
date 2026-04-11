"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  DollarSign,
  Repeat,
  Sparkles,
  TrendingUp,
  Briefcase,
  Crown,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import CubeLoader from "@/components/ui/cube-loader"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TopCustomer {
  customerId: string
  name: string
  revenue: number
  jobCount: number
}

interface RevenueInsights {
  totalRevenue: number
  recurringRevenue: number
  oneTimeRevenue: number
  mrr: number
  arr: number
  recurringJobCount: number
  oneTimeJobCount: number
  totalJobCount: number
  averageJobValue: number
  estimatedProfit: number
  profitMargin: number
  topCustomers: TopCustomer[]
  dailyBreakdown: {
    date: string
    recurring: number
    oneTime: number
  }[]
  monthlyTrend: {
    month: string
    label: string
    revenue: number
    recurring: number
    oneTime: number
  }[]
  month: string
}

interface ChartPoint {
  date: string
  recurring: number
  oneTime: number
  total: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const areaChartConfig = {
  recurring: { label: "Recurring", color: "#4ade80" },
  oneTime: { label: "One-Time", color: "#a78bfa" },
}

const barChartConfig = {
  recurring: { label: "Recurring", color: "#4ade80" },
  oneTime: { label: "One-Time", color: "#a78bfa" },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    })
    options.push({ value, label })
  }
  return options
}

function formatCurrency(value: number): string {
  if (value >= 10000) {
    return `$${(value / 1000).toFixed(1)}k`
  }
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatFullCurrency(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  title: string
  value: string
  subtitle?: string
  icon: React.ElementType
  accentColor?: string
  iconBgClass?: string
}

function KpiCard({ title, value, subtitle, icon: Icon, accentColor, iconBgClass }: KpiCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground truncate">
              {title}
            </p>
            <p
              className="text-2xl font-bold truncate"
              style={accentColor ? { color: accentColor } : undefined}
            >
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl shrink-0",
              iconBgClass || "bg-primary/10 text-primary"
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Revenue Page
// ---------------------------------------------------------------------------

export default function RevenueInsightsPage() {
  const monthOptions = useMemo(() => generateMonthOptions(), [])
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value)
  const [data, setData] = useState<RevenueInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read the insights layout date range picker params from URL (reacts to client nav)
  const searchParams = useSearchParams()
  const urlRange = searchParams.get("range")
  const urlFrom = searchParams.get("from")
  const urlTo = searchParams.get("to")

  // Build query string — use URL range params if set, otherwise fall back to month selector
  const queryString = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (urlRange === "custom" && urlFrom) {
      return `start=${urlFrom}&end=${urlTo || today}`
    }
    if (urlRange === "7d") {
      const d = new Date(); d.setDate(d.getDate() - 7)
      return `start=${d.toISOString().slice(0, 10)}&end=${today}`
    }
    if (urlRange === "30d") {
      const d = new Date(); d.setDate(d.getDate() - 30)
      return `start=${d.toISOString().slice(0, 10)}&end=${today}`
    }
    if (urlRange === "90d") {
      const d = new Date(); d.setDate(d.getDate() - 90)
      return `start=${d.toISOString().slice(0, 10)}&end=${today}`
    }
    if (urlRange === "ytd") {
      const year = new Date().getFullYear()
      return `start=${year}-01-01&end=${today}`
    }
    return `month=${selectedMonth}`
  }, [urlRange, urlFrom, urlTo, selectedMonth])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/insights/revenue?${queryString}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load revenue data")
        }
        return res.json()
      })
      .then((json) => {
        if (!cancelled && json.success && json.data) {
          setData(json.data as RevenueInsights)
        } else if (!cancelled) {
          setData(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [queryString])

  const chartPoints: ChartPoint[] = useMemo(() => {
    if (!data?.dailyBreakdown) return []
    return data.dailyBreakdown.map((d) => {
      const day = new Date(`${d.date}T00:00:00Z`)
      return {
        date: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        recurring: d.recurring,
        oneTime: d.oneTime,
        total: d.recurring + d.oneTime,
      }
    })
  }, [data])

  const selectedLabel =
    monthOptions.find((o) => o.value === selectedMonth)?.label || selectedMonth

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
  if (!data) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">No revenue data available</p>
      </div>
    )
  }

  const profitColor = data.estimatedProfit >= 0 ? "#4ade80" : "#f87171"

  return (
    <div className="space-y-6">
      {/* ----- Header + Optional Month Selector ----- */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Revenue Overview</h2>
          <p className="text-sm text-muted-foreground">
            {urlRange && urlRange !== "custom"
              ? `Last ${urlRange === "ytd" ? "year to date" : urlRange}`
              : urlRange === "custom" && urlFrom
                ? `${urlFrom} to ${urlTo || "today"}`
                : `Financial breakdown for ${selectedLabel}`}
          </p>
        </div>
        {/* Only show month dropdown when NOT using the date range picker */}
        {!urlRange && (
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ----- KPI Cards ----- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          title="Total Revenue"
          value={formatFullCurrency(data.totalRevenue)}
          subtitle={`${data.totalJobCount} jobs completed`}
          icon={DollarSign}
          accentColor="#5b8def"
          iconBgClass="bg-blue-500/10 text-blue-400"
        />
        <KpiCard
          title="Recurring Revenue (MRR)"
          value={formatFullCurrency(data.recurringRevenue)}
          subtitle={`${data.recurringJobCount} recurring jobs`}
          icon={Repeat}
          accentColor="#4ade80"
          iconBgClass="bg-green-500/10 text-green-400"
        />
        <KpiCard
          title="One-Time Revenue"
          value={formatFullCurrency(data.oneTimeRevenue)}
          subtitle={`${data.oneTimeJobCount} one-time jobs`}
          icon={Sparkles}
          accentColor="#a78bfa"
          iconBgClass="bg-purple-500/10 text-purple-400"
        />
        <KpiCard
          title="Est. Profit"
          value={formatFullCurrency(data.estimatedProfit)}
          subtitle={`${data.profitMargin}% margin`}
          icon={TrendingUp}
          accentColor={profitColor}
          iconBgClass={
            data.estimatedProfit >= 0
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }
        />
      </div>

      {/* ----- Recurring Badge ----- */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="border-green-700 text-green-400">
          {data.recurringJobCount} recurring jobs this month
        </Badge>
        {data.totalJobCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {Math.round((data.recurringJobCount / data.totalJobCount) * 100)}%
            of total revenue is recurring
          </span>
        )}
      </div>

      {/* ----- Stacked Area Chart ----- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily Revenue</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recurring vs one-time revenue by day
          </p>
        </CardHeader>
        <CardContent>
          {chartPoints.length > 0 ? (
            <ChartContainer config={areaChartConfig} className="h-[280px] w-full">
              <AreaChart
                data={chartPoints}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="revRecurringGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="revOneTimeGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  tickFormatter={(v) => formatCurrency(v as number)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => [
                        `$${Number(value).toLocaleString()}`,
                        undefined,
                      ]}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="oneTime"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#revOneTimeGrad)"
                  stackId="revenue"
                />
                <Area
                  type="monotone"
                  dataKey="recurring"
                  stroke="#4ade80"
                  strokeWidth={2}
                  fill="url(#revRecurringGrad)"
                  stackId="revenue"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-muted-foreground">
              No daily data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----- Breakdown + Top Customers ----- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Breakdown Stats */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Monthly Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <BreakdownRow
                label="Recurring customers"
                value={formatFullCurrency(data.recurringRevenue)}
                count={data.recurringJobCount}
                color="#4ade80"
              />
              <BreakdownRow
                label="One-time customers"
                value={formatFullCurrency(data.oneTimeRevenue)}
                count={data.oneTimeJobCount}
                color="#a78bfa"
              />
              <div className="border-t border-border pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Average job value
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {formatFullCurrency(data.averageJobValue)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Jobs completed
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {data.totalJobCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Projected ARR
                  </span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {formatFullCurrency(data.arr)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top Customers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Crown className="h-4 w-4 text-amber-400" />
              Top Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topCustomers.length > 0 ? (
              <div className="space-y-2.5">
                {data.topCustomers.map((customer, idx) => (
                  <div
                    key={customer.customerId}
                    className="flex items-center gap-3"
                  >
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0",
                        idx === 0
                          ? "bg-amber-500/20 text-amber-400"
                          : idx === 1
                            ? "bg-slate-400/20 text-slate-300"
                            : idx === 2
                              ? "bg-orange-500/20 text-orange-400"
                              : "bg-muted text-muted-foreground"
                      )}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {customer.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customer.jobCount} job{customer.jobCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatFullCurrency(customer.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No customer data this month
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ----- 12-Month Trend Bar Chart ----- */}
      {data.monthlyTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">12-Month Revenue Trend</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Total:{" "}
                  {formatFullCurrency(
                    data.monthlyTrend.reduce((sum, m) => sum + m.revenue, 0)
                  )}{" "}
                  over the last 12 months
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={barChartConfig} className="h-[240px] w-full">
              <BarChart
                data={data.monthlyTrend}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#374151"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#9ca3af", fontSize: 12 }}
                  tickFormatter={(v) => formatCurrency(v as number)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => [
                        `$${Number(value).toLocaleString()}`,
                        undefined,
                      ]}
                    />
                  }
                />
                <Bar
                  dataKey="recurring"
                  stackId="trend"
                  fill="#4ade80"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="oneTime"
                  stackId="trend"
                  fill="#a78bfa"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Breakdown Row sub-component
// ---------------------------------------------------------------------------

function BreakdownRow({
  label,
  value,
  count,
  color,
}: {
  label: string
  value: string
  count: number
  color: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm text-muted-foreground">{label}</span>
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 h-4 border-border"
        >
          {count}
        </Badge>
      </div>
      <span className="text-sm font-medium text-foreground tabular-nums">
        {value}
      </span>
    </div>
  )
}
