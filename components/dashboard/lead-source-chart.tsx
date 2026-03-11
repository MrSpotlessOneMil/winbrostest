"use client"

import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Phone, Instagram, Globe, MessageSquare, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"

type SourceData = { source: string; leads: number; jobs: number }
type LeadData = {
  id: string
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  email: string | null
  source: string | null
  status: string | null
  created_at: string | null
  converted_to_job_id: string | null
}
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

const SOURCE_ICONS: Record<string, typeof Phone | null> = {
  phone: Phone,
  vapi: Phone,
  meta: Instagram,
  website: Globe,
  sms: MessageSquare,
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400",
  contacted: "bg-yellow-500/20 text-yellow-400",
  qualified: "bg-emerald-500/20 text-emerald-400",
  booked: "bg-green-500/20 text-green-400",
  assigned: "bg-purple-500/20 text-purple-400",
  lost: "bg-zinc-500/20 text-zinc-400",
  duplicate: "bg-zinc-500/20 text-zinc-400",
}

const chartConfig = {
  value: { label: "Leads" },
  ...Object.fromEntries(
    Object.entries(SOURCE_CONFIG).map(([key, val]) => [key, { label: val.label, color: val.color }])
  ),
}

function SourceBadge({ source }: { source: string }) {
  const config = getSourceConfig(source)
  const Icon = SOURCE_ICONS[source] || null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: config.color + "25", color: config.color }}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {config.label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", STATUS_COLORS[status] || "bg-zinc-500/20 text-zinc-400")}>
      {status}
    </span>
  )
}

export function LeadSourceChart() {
  const [sources, setSources] = useState<SourceData[]>([])
  const [leads, setLeads] = useState<LeadData[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/overview/lead-sources`, { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) {
          setSources(json.data || [])
          setLeads(json.leads || [])
        }
      } catch {
        if (!cancelled) {
          setSources([])
          setLeads([])
        }
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

  const filteredLeads = useMemo(() => {
    if (!selectedSource) return []
    return leads
      .filter((l) => (l.source || "unknown") === selectedSource)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
  }, [leads, selectedSource])

  const totalLeads = chartData.reduce((sum, item) => sum + item.value, 0)
  const totalJobs = chartData.reduce((sum, item) => sum + item.jobs, 0)

  const handleSliceClick = (entry: Slice) => {
    setSelectedSource(entry.name === selectedSource ? null : entry.name)
  }

  // Drilldown view
  if (selectedSource) {
    const config = getSourceConfig(selectedSource)
    return (
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setSelectedSource(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to all sources
          </button>
          <CardTitle className="flex items-center gap-2 mt-1">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: config.color }} />
            {config.label}
          </CardTitle>
          <CardDescription>
            {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[240px] overflow-y-auto space-y-2 pr-1">
            {filteredLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {lead.phone_number || lead.email || "No contact"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {lead.status && <StatusBadge status={lead.status} />}
                  <SourceBadge source={lead.source || "unknown"} />
                </div>
              </div>
            ))}
            {filteredLeads.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">No leads from this source</p>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

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
          <ChartContainer config={chartConfig} className="mx-auto h-[140px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={35}
                outerRadius={58}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                className="cursor-pointer"
                onClick={(_: unknown, index: number) => handleSliceClick(chartData[index])}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} stroke="transparent" />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}

        {/* Legend */}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {chartData.map((source) => (
            <button
              key={source.name}
              onClick={() => handleSliceClick(source)}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 hover:bg-zinc-800/50 transition-colors text-left"
            >
              <div
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: source.fill }}
              />
              <div className="flex flex-1 items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate">{source.label}</span>
                <span className="text-xs font-medium text-foreground whitespace-nowrap shrink-0">
                  {source.value} lead{source.value !== 1 ? "s" : ""} &middot;{" "}
                  {totalLeads ? Math.round((source.value / totalLeads) * 100) : 0}%
                </span>
              </div>
            </button>
          ))}
        </div>
        {loading && <p className="mt-2 text-xs text-muted-foreground">Loading&hellip;</p>}
      </CardContent>
    </Card>
  )
}
