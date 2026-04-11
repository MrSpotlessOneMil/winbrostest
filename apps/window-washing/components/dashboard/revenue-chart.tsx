"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import CubeLoader from "@/components/ui/cube-loader"

interface RevenueInsights {
  totalRevenue: number
  recurringRevenue: number
  oneTimeRevenue: number
  mrr: number
  arr: number
  recurringJobCount: number
  oneTimeJobCount: number
  totalJobCount: number
  dailyBreakdown: {
    date: string
    recurring: number
    oneTime: number
  }[]
  month: string
}

type ChartPoint = {
  date: string
  recurring: number
  oneTime: number
}

const chartConfig = {
  recurring: {
    label: "Recurring",
    color: "#4ade80",
  },
  oneTime: {
    label: "One-Time",
    color: "#a78bfa",
  },
}

function generateMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    options.push({ value, label })
  }
  return options
}

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`
  }
  return `$${value.toLocaleString()}`
}

function StatCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string
  value: string
  subtitle?: string
  color?: string
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
      <p className="text-xs text-gray-400 mb-1">{title}</p>
      <p className="text-xl font-bold" style={color ? { color } : undefined}>
        {value}
      </p>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

export function RevenueChart() {
  const monthOptions = useMemo(() => generateMonthOptions(), [])
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value)
  const [data, setData] = useState<RevenueInsights | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/insights/revenue?month=${selectedMonth}`, {
          cache: "no-store",
        })
        const json = await res.json()
        if (!cancelled && json.success && json.data) {
          setData(json.data as RevenueInsights)
        } else if (!cancelled) {
          setData(null)
        }
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selectedMonth])

  const chartPoints: ChartPoint[] = useMemo(() => {
    if (!data?.dailyBreakdown) return []
    return data.dailyBreakdown.map((d) => {
      const day = new Date(`${d.date}T00:00:00Z`)
      return {
        date: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        recurring: d.recurring,
        oneTime: d.oneTime,
      }
    })
  }, [data])

  const selectedLabel = monthOptions.find((o) => o.value === selectedMonth)?.label || selectedMonth

  return (
    <Card className={`h-full ${loaded ? "stagger-3" : "opacity-0"}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>Revenue Insights</CardTitle>
          <CardDescription>
            Recurring vs one-time revenue for {selectedLabel}
          </CardDescription>
        </div>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-44">
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
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[360px]">
            <CubeLoader compact />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Stat Cards Row */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                title="Total Revenue"
                value={`$${data.totalRevenue.toLocaleString()}`}
                subtitle={`${data.totalJobCount} jobs`}
              />
              <StatCard
                title="Recurring Revenue (MRR)"
                value={`$${data.recurringRevenue.toLocaleString()}`}
                subtitle={`${data.recurringJobCount} recurring jobs`}
                color="#4ade80"
              />
              <StatCard
                title="One-Time Revenue"
                value={`$${data.oneTimeRevenue.toLocaleString()}`}
                subtitle={`${data.oneTimeJobCount} jobs`}
                color="#a78bfa"
              />
              <StatCard
                title="Projected ARR"
                value={`$${data.arr.toLocaleString()}`}
                subtitle="MRR x 12"
              />
            </div>

            {/* Recurring Jobs Badge */}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-green-700 text-green-400">
                {data.recurringJobCount} recurring jobs this month
              </Badge>
              {data.totalJobCount > 0 && (
                <span className="text-xs text-gray-500">
                  {Math.round((data.recurringJobCount / data.totalJobCount) * 100)}% of total
                </span>
              )}
            </div>

            {/* Area Chart */}
            <ChartContainer config={chartConfig} className="h-[220px] w-full">
              <AreaChart
                data={chartPoints}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="recurringGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="oneTimeGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
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
                  tickFormatter={(value) => formatCurrency(value)}
                />
                <ChartTooltip
                  content={<ChartTooltipContent />}
                  formatter={(value) => [`$${Number(value).toLocaleString()}`, undefined]}
                />
                <Area
                  type="monotone"
                  dataKey="oneTime"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#oneTimeGradient)"
                  stackId="revenue"
                />
                <Area
                  type="monotone"
                  dataKey="recurring"
                  stroke="#4ade80"
                  strokeWidth={2}
                  fill="url(#recurringGradient)"
                  stackId="revenue"
                />
              </AreaChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="flex h-[360px] items-center justify-center text-gray-500">
            No revenue data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
