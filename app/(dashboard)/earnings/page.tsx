"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { DollarSign, TrendingUp, Gift, Sparkles, ArrowUpRight } from "lucide-react"

const chartConfig = {
  tips: { label: "Tips", color: "#4ade80" },
  upsells: { label: "Upsells", color: "#5b8def" },
}

export default function EarningsPage() {
  const [range, setRange] = useState<"today" | "week" | "month">("week")
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<{
    totalTips: number
    totalUpsells: number
    teamBreakdown: Array<{ team: string; tips: number; upsells: number; jobs: number }>
    recentTips: any[]
    recentUpsells: any[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/earnings?range=${range}`, { cache: "no-store" })
        const json = await res.json()
        if (!cancelled) setData(json.data || null)
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
  }, [range])

  const totalTips = Number(data?.totalTips || 0)
  const totalUpsells = Number(data?.totalUpsells || 0)
  const teamBreakdown = (data?.teamBreakdown || []) as Array<{ team: string; tips: number; upsells: number; jobs: number }>

  const tipsData = useMemo(() => {
    // simple placeholder series: shows totals as one bar if you don't have daily bucketing yet
    return [{ date: range, tips: totalTips, upsells: totalUpsells }]
  }, [range, totalTips, totalUpsells])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Tips & Upsells</h1>
          <p className="text-sm text-muted-foreground">Track additional revenue from field operations</p>
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as any)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                <Gift className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tips</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-semibold text-foreground">${totalTips}</p>
                  <span className="flex items-center text-xs text-success">
                    <ArrowUpRight className="h-3 w-3" />
                    —
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Upsells</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-semibold text-foreground">${totalUpsells}</p>
                  <span className="flex items-center text-xs text-success">
                    <ArrowUpRight className="h-3 w-3" />
                    —
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/10">
                <DollarSign className="h-6 w-6 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Tip/Job</p>
                <p className="text-2xl font-semibold text-foreground">—</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                <TrendingUp className="h-6 w-6 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Upsell Rate</p>
                <p className="text-2xl font-semibold text-foreground">—</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Breakdown</CardTitle>
          <CardDescription>Tips and upsells over the past week</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tipsData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                  tickFormatter={(value) => `$${value}`}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="tips" fill="#4ade80" radius={[4, 4, 0, 0]} />
                <Bar dataKey="upsells" fill="#5b8def" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Team Breakdown & Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Team Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Team Breakdown</CardTitle>
            <CardDescription>Performance by team this week</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {teamBreakdown.map((team) => (
                <div
                  key={team.team}
                  className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4"
                >
                  <div>
                    <p className="font-medium text-foreground">Team {team.team}</p>
                    <p className="text-sm text-muted-foreground">{team.jobs} jobs completed</p>
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <p className="text-lg font-semibold text-success">${team.tips}</p>
                      <p className="text-xs text-muted-foreground">Tips</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-primary">${team.upsells}</p>
                      <p className="text-xs text-muted-foreground">Upsells</p>
                    </div>
                  </div>
                </div>
              ))}
              {!loading && (!teamBreakdown || teamBreakdown.length === 0) && (
                <p className="text-sm text-muted-foreground">No tips/upsells yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest tips and upsells</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="tips">
              <TabsList className="mb-4">
                <TabsTrigger value="tips">Tips</TabsTrigger>
                <TabsTrigger value="upsells">Upsells</TabsTrigger>
              </TabsList>

              <TabsContent value="tips" className="space-y-3">
                {(data?.recentTips || []).map((tip: any) => (
                  <div
                    key={tip.id}
                    className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">Tip</span>
                        <Badge variant="outline" className="text-xs">
                          Team {tip.team_id ?? "—"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Job {tip.job_id ?? "—"} - {new Date(tip.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-lg font-semibold text-success">+${Number(tip.amount || 0)}</span>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="upsells" className="space-y-3">
                {(data?.recentUpsells || []).map((upsell: any) => (
                  <div
                    key={upsell.id}
                    className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{upsell.upsell_type || "Upsell"}</span>
                        <Badge variant="outline" className="text-xs">
                          Team {upsell.team_id ?? "—"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Job {upsell.job_id ?? "—"} - {new Date(upsell.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="text-lg font-semibold text-primary">+${Number(upsell.value || 0)}</span>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
    </div>
  )
}
