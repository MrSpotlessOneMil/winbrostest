"use client"

import { useEffect, useMemo, useState } from "react"
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import CubeLoader from "@/components/ui/cube-loader"
import { SOURCE_CONFIG, SOURCE_ICONS, getSourceConfig } from "@/lib/constants/lead-sources"

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
  const [loaded, setLoaded] = useState(false)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  useEffect(() => { setLoaded(true) }, [])

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

  const selectedConfig = selectedSource ? getSourceConfig(selectedSource) : null

  return (
    <Card className={`h-full flex flex-col overflow-hidden gap-2 ${loaded ? "stagger-3" : "opacity-0"}`}>
      {selectedSource && selectedConfig ? (
        <>
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedSource(null)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedConfig.color }} />
                {selectedConfig.label}
              </CardTitle>
            </div>
            <CardDescription>
              {filteredLeads.length} lead{filteredLeads.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
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
        </>
      ) : (
        <>
          <CardHeader className="pb-2">
            <CardTitle>Lead Sources</CardTitle>
            <CardDescription>
              {totalLeads} lead{totalLeads !== 1 ? "s" : ""} &middot; {totalJobs} job{totalJobs !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[200px]">
                <CubeLoader compact />
              </div>
            ) : chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No lead data yet</p>
            ) : (
              <div className="flex items-start gap-4 animate-fade-in">
                <ChartContainer config={chartConfig} className="flex-1 h-[200px] aspect-auto">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={100}
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

                {/* Legend */}
                <div className="grid grid-cols-1 gap-1.5 shrink-0 mr-8">
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
                          {source.value} &middot;{" "}
                          {totalLeads ? Math.round((source.value / totalLeads) * 100) : 0}%
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </>
      )}
    </Card>
  )
}
