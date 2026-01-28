"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ApiResponse, DailyMetrics } from "@/lib/types"

type Point = { date: string; revenue: number; target: number }

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "#5b8def",
  },
  target: {
    label: "Target",
    color: "#6b7280",
  },
}

export function RevenueChart() {
  const [range, setRange] = useState<"week" | "month" | "quarter">("week")
  const [data, setData] = useState<Point[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // For now, "month" and "quarter" still use the weekly aggregate (keeps API simple).
        const apiRange = "week"
        const res = await fetch(`/api/metrics?range=${apiRange}`, { cache: "no-store" })
        const json = (await res.json()) as ApiResponse<DailyMetrics[]>
        const rows = (json as any).data as any[]
        const points: Point[] = Array.isArray(rows)
          ? rows.map((m: DailyMetrics) => {
              const d = new Date(`${m.date}T00:00:00Z`)
              const label = d.toLocaleDateString("en-US", { weekday: "short" })
              return {
                date: label,
                revenue: Number(m.total_revenue || 0),
                target: Number(m.target_revenue || 0),
              }
            })
          : []
        if (!cancelled) setData(points)
      } catch {
        if (!cancelled) setData([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [range])

  const description = useMemo(() => {
    if (range === "week") return "Daily revenue vs target"
    if (range === "month") return "Revenue vs target (rolling)"
    return "Revenue vs target (rolling)"
  }, [range])

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle>Revenue Overview</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="quarter">This Quarter</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b8def" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#5b8def" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
              tickFormatter={(value) => `$${value / 1000}k`}
            />
            <ChartTooltip 
              content={<ChartTooltipContent />} 
              formatter={(value) => [`$${Number(value).toLocaleString()}`, undefined]}
            />
            <Area
              type="monotone"
              dataKey="target"
              stroke="#6b7280"
              strokeWidth={2}
              strokeDasharray="5 5"
              fill="transparent"
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#5b8def"
              strokeWidth={2}
              fill="url(#revenueGradient)"
            />
          </AreaChart>
        </ChartContainer>
        {loading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
      </CardContent>
    </Card>
  )
}
