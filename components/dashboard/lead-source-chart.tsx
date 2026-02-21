"use client"

import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

type SourceData = { source: string; leads: number; jobs: number }
type Slice = { name: string; label: string; value: number; jobs: number; fill: string }

const SOURCE_CONFIG: Record<string, { label: string; color: string }> = {
  phone: { label: "Phone Calls", color: "#5b8def" },
  vapi: { label: "Phone (Vapi)", color: "#7ca3f0" },
  meta: { label: "Meta Ads", color: "#4ade80" },
  website: { label: "Website", color: "#facc15" },
  sms: { label: "SMS", color: "#f472b6" },
  housecall_pro: { label: "HousecallPro", color: "#a78bfa" },
  ghl: { label: "GoHighLevel", color: "#fb923c" },
  manual: { label: "Manual", color: "#94a3b8" },
}

const DEFAULT_COLOR = "#6b7280"

function getSourceConfig(source: string) {
  return SOURCE_CONFIG[source] || { label: source, color: DEFAULT_COLOR }
}

const chartConfig = {
  value: { label: "Leads" },
  ...Object.fromEntries(
    Object.entries(SOURCE_CONFIG).map(([key, val]) => [key, { label: val.label, color: val.color }])
  ),
}

export function LeadSourceChart() {
  const [sources, setSources] = useState<SourceData[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/overview/lead-sources`, { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) setSources(json.data || [])
      } catch {
        if (!cancelled) setSources([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const chartData: Slice[] = useMemo(() => {
    return sources
      .filter((s) => s.leads > 0)
      .map((s) => {
        const config = getSourceConfig(s.source)
        return {
          name: s.source,
          label: config.label,
          value: s.leads,
          jobs: s.jobs,
          fill: config.color,
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [sources])

  const totalLeads = chartData.reduce((sum, item) => sum + item.value, 0)
  const totalJobs = chartData.reduce((sum, item) => sum + item.jobs, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Lead Sources</CardTitle>
        <CardDescription>
          {totalLeads} lead{totalLeads !== 1 ? "s" : ""} &middot; {totalJobs} job{totalJobs !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 && !loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No lead data yet</p>
        ) : (
          <ChartContainer config={chartConfig} className="mx-auto h-[200px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
              />
            </PieChart>
          </ChartContainer>
        )}

        {/* Legend */}
        <div className="mt-4 grid grid-cols-1 gap-2">
          {chartData.map((source) => (
            <div key={source.name} className="flex items-center gap-2">
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: source.fill }}
              />
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{source.label}</span>
                <span className="text-xs font-medium text-foreground">
                  {source.jobs} job{source.jobs !== 1 ? "s" : ""} &middot;{" "}
                  {totalLeads ? Math.round((source.value / totalLeads) * 100) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
        {loading && <p className="mt-2 text-xs text-muted-foreground">Loading&hellip;</p>}
      </CardContent>
    </Card>
  )
}
