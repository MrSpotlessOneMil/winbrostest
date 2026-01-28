"use client"

import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { Lead as ApiLead, PaginatedResponse } from "@/lib/types"

type Slice = { name: string; label: string; value: number; fill: string }

const chartConfig = {
  value: { label: "Leads" },
  phone: { label: "Phone Calls", color: "#5b8def" },
  meta: { label: "Meta Ads", color: "#4ade80" },
  website: { label: "Website", color: "#facc15" },
  sms: { label: "SMS", color: "#f472b6" },
}

export function LeadSourceChart() {
  const [leads, setLeads] = useState<ApiLead[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/leads?page=1&per_page=500`, { cache: "no-store" })
        const json = (await res.json()) as PaginatedResponse<ApiLead>
        if (!cancelled) setLeads(json.data || [])
      } catch {
        if (!cancelled) setLeads([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const leadSourceData: Slice[] = useMemo(() => {
    const counts = { phone: 0, meta: 0, website: 0, sms: 0 }
    for (const l of leads) {
      const s = (l.source || "phone") as any
      if (s === "meta") counts.meta++
      else if (s === "website") counts.website++
      else if (s === "sms") counts.sms++
      else counts.phone++
    }
    return [
      { name: "phone", label: "Phone Calls", value: counts.phone, fill: "#5b8def" },
      { name: "meta", label: "Meta Ads", value: counts.meta, fill: "#4ade80" },
      { name: "website", label: "Website", value: counts.website, fill: "#facc15" },
      { name: "sms", label: "SMS", value: counts.sms, fill: "#f472b6" },
    ]
  }, [leads])

  const total = leadSourceData.reduce((sum, item) => sum + item.value, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Lead Sources</CardTitle>
        <CardDescription>Lead distribution (latest)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="mx-auto h-[200px] w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
            <Pie
              data={leadSourceData}
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

        {/* Legend */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {leadSourceData.map((source) => (
            <div key={source.name} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: source.fill }}
              />
              <div className="flex flex-1 items-center justify-between">
                <span className="text-xs text-muted-foreground">{source.label}</span>
                <span className="text-xs font-medium text-foreground">
                  {total ? Math.round((source.value / total) * 100) : 0}%
                </span>
              </div>
            </div>
          ))}
        </div>
        {loading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
      </CardContent>
    </Card>
  )
}
