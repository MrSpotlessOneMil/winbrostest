"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { DollarSign, TrendingUp, Sparkles } from "lucide-react"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { MetricCard } from "@/components/insights/metric-card"
import { ChartCard } from "@/components/insights/chart-card"
import { DetailTable, type Column } from "@/components/insights/detail-table"
import CubeLoader from "@/components/ui/cube-loader"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PricingData {
  avgJobPrice: { current: number; previous: number; min: number; max: number }
  revenuePerHour: { current: number; previous: number }
  priceTrends: Array<{ date: string; avgPrice: number; jobCount: number }>
  addOnAttachRates: Array<{
    addonKey: string
    label: string
    timesAttached: number
    revenue: number
    attachRate: number
  }>
  tierUtilization: Array<{
    serviceType: string
    bedrooms: number
    bathrooms: number
    tierPrice: number
    avgActualPrice: number
    jobCount: number
  }>
  belowMinimum: Array<{
    jobId: string
    price: number
    tierMinimum: number
    customer: string
    date: string
  }>
  sparklines: { avgPrice: number[]; revenuePerHour: number[] }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PricingPage() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<PricingData | null>(null)
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

    fetch(`/api/actions/insights/pricing?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load pricing data")
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
        <p className="text-muted-foreground">No pricing data available</p>
      </div>
    )
  }

  const topAddon =
    data.addOnAttachRates.length > 0 ? data.addOnAttachRates[0] : null

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* 1. Metric cards                                                   */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Avg Job Price"
          value={data.avgJobPrice.current}
          previousValue={data.avgJobPrice.previous}
          prefix="$"
          format="currency"
          icon={DollarSign}
          sparklineData={data.sparklines.avgPrice}
          sparklineColor="#a78bfa"
        />
        <MetricCard
          label="Revenue Per Hour"
          value={data.revenuePerHour.current}
          previousValue={data.revenuePerHour.previous}
          prefix="$"
          format="currency"
          icon={TrendingUp}
          sparklineData={data.sparklines.revenuePerHour}
          sparklineColor="#4ade80"
        />
        {/* Top add-on card */}
        <Card className="relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground truncate">
                  Top Add-On
                </p>
                <p className="text-2xl font-bold text-primary truncate">
                  {topAddon ? topAddon.label : "None"}
                </p>
                {topAddon && (
                  <p className="text-xs text-muted-foreground">
                    {topAddon.attachRate}% attach rate &middot; $
                    {topAddon.revenue.toLocaleString()} revenue
                  </p>
                )}
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* 2. Price Trend chart                                              */}
      {/* ----------------------------------------------------------------- */}
      {data.priceTrends.length > 0 && (
        <ChartCard title="Price Trend" subtitle="Average job price over time">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.priceTrends}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => {
                    const d = new Date(v + "T00:00:00")
                    return d.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v}`}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => {
                    if (name === "avgPrice") return [`$${value.toFixed(2)}`, "Avg Price"]
                    return [value, name]
                  }}
                  labelFormatter={(label: string) => {
                    const d = new Date(label + "T00:00:00")
                    return d.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="avgPrice"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  fill="url(#priceGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#a78bfa" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* 3. Add-on Performance                                             */}
      {/* ----------------------------------------------------------------- */}
      {data.addOnAttachRates.length > 0 && (
        <ChartCard title="Add-on Performance" subtitle="Attach rate by add-on type">
          <div
            className="w-full"
            style={{ height: Math.max(200, data.addOnAttachRates.length * 48) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.addOnAttachRates}
                layout="vertical"
                margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                  domain={[0, "auto"]}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={130}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: number, _name: string, props: any) => {
                    const item = props?.payload as PricingData["addOnAttachRates"][number] | undefined
                    if (!item) return [`${value}%`, "Attach Rate"]
                    return [
                      `${value}% attach rate | $${item.revenue.toLocaleString()} revenue | ${item.timesAttached} times`,
                      item.label,
                    ]
                  }}
                />
                <Bar dataKey="attachRate" radius={[0, 4, 4, 0]} barSize={24}>
                  {data.addOnAttachRates.map((_, i) => (
                    <Cell key={i} fill="#a78bfa" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* 4. Tier Utilization                                               */}
      {/* ----------------------------------------------------------------- */}
      {data.tierUtilization.length > 0 && (
        <TierUtilizationTable tiers={data.tierUtilization} />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* 5. Below Minimum                                                  */}
      {/* ----------------------------------------------------------------- */}
      {data.belowMinimum.length > 0 && (
        <BelowMinimumTable jobs={data.belowMinimum} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tier Utilization Table
// ---------------------------------------------------------------------------

function TierUtilizationTable({
  tiers,
}: {
  tiers: PricingData["tierUtilization"]
}) {
  type Row = PricingData["tierUtilization"][number] & {
    variance: number
    [key: string]: unknown
  }

  const rows: Row[] = tiers.map((t) => ({
    ...t,
    variance: Math.round((t.avgActualPrice - t.tierPrice) * 100) / 100,
  }))

  const columns: Column<Row>[] = [
    { key: "serviceType", label: "Service Type" },
    { key: "bedrooms", label: "Beds", align: "center" },
    { key: "bathrooms", label: "Baths", align: "center" },
    {
      key: "tierPrice",
      label: "Tier Price",
      align: "right",
      render: (row) => `$${row.tierPrice.toLocaleString()}`,
    },
    {
      key: "avgActualPrice",
      label: "Avg Actual",
      align: "right",
      render: (row) => `$${row.avgActualPrice.toLocaleString()}`,
    },
    { key: "jobCount", label: "Jobs", align: "center" },
    {
      key: "variance",
      label: "Variance",
      align: "right",
      render: (row) => (
        <span
          className={cn(
            "font-medium",
            row.variance > 0
              ? "text-green-500"
              : row.variance < 0
                ? "text-red-500"
                : "text-muted-foreground"
          )}
        >
          {row.variance > 0 ? "+" : ""}${row.variance.toFixed(2)}
        </span>
      ),
    },
  ]

  return (
    <DetailTable<Row>
      title={`Tier Utilization (${tiers.length} tiers)`}
      columns={columns}
      data={rows}
      defaultExpanded
    />
  )
}

// ---------------------------------------------------------------------------
// Below Minimum Table
// ---------------------------------------------------------------------------

function BelowMinimumTable({
  jobs,
}: {
  jobs: PricingData["belowMinimum"]
}) {
  type Row = PricingData["belowMinimum"][number] & {
    difference: number
    [key: string]: unknown
  }

  const rows: Row[] = jobs.map((j) => ({
    ...j,
    difference: Math.round((j.price - j.tierMinimum) * 100) / 100,
  }))

  const columns: Column<Row>[] = [
    { key: "customer", label: "Customer" },
    {
      key: "price",
      label: "Job Price",
      align: "right",
      render: (row) => (
        <span className="text-red-500 font-medium">
          ${row.price.toLocaleString()}
        </span>
      ),
    },
    {
      key: "tierMinimum",
      label: "Tier Minimum",
      align: "right",
      render: (row) => `$${row.tierMinimum.toLocaleString()}`,
    },
    {
      key: "difference",
      label: "Difference",
      align: "right",
      render: (row) => (
        <span className="text-red-500 font-medium">
          -${Math.abs(row.difference).toFixed(2)}
        </span>
      ),
    },
    { key: "date", label: "Date" },
  ]

  return (
    <DetailTable<Row>
      title={`Below Minimum (${jobs.length} jobs)`}
      columns={columns}
      data={rows}
    />
  )
}
