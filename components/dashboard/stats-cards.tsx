"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, DollarSign, CalendarCheck, Users, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState } from "react"
import type { ApiResponse, DailyMetrics, Team } from "@/lib/types"

function pct(n: number, d: number): number {
  if (!d) return 0
  return Math.round((n / d) * 100)
}

export function StatsCards() {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null)
  const [activeTeams, setActiveTeams] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const mRes = await fetch("/api/metrics?range=today", { cache: "no-store" })
        const mJson = (await mRes.json()) as ApiResponse<DailyMetrics>
        if (!cancelled) setMetrics((mJson as any).data || null)
      } catch {
        if (!cancelled) setMetrics(null)
      }
      try {
        const today = new Date().toISOString().slice(0, 10)
        const tRes = await fetch(`/api/teams?include_metrics=false&date=${today}`, { cache: "no-store" })
        const tJson = (await tRes.json()) as ApiResponse<Team[]>
        const teams = Array.isArray((tJson as any).data) ? ((tJson as any).data as Team[]) : []
        if (!cancelled) setActiveTeams(teams.filter((t) => t.is_active && t.status !== "off").length)
      } catch {
        if (!cancelled) setActiveTeams(0)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const revenue = Number(metrics?.total_revenue || 0)
    const targetRevenue = Number(metrics?.target_revenue || 0)
    const jobsCompleted = Number(metrics?.jobs_completed || 0)
    const jobsScheduled = Number(metrics?.jobs_scheduled || 0)
    const callsHandled = Number(metrics?.calls_handled || 0)

    return [
      {
        name: "Today's Revenue",
        value: `$${revenue.toLocaleString()}`,
        target: `$${targetRevenue.toLocaleString()}`,
        change: "—",
        trend: revenue >= targetRevenue && targetRevenue > 0 ? "up" : "neutral",
        icon: DollarSign,
        progress: pct(revenue, targetRevenue),
      },
      {
        name: "Jobs Completed",
        value: `${jobsCompleted}`,
        target: `${jobsScheduled || 0}`,
        change: "—",
        trend: jobsCompleted > 0 ? "up" : "neutral",
        icon: CalendarCheck,
        progress: pct(jobsCompleted, jobsScheduled || 0),
      },
      {
        name: "Active Crews",
        value: `${activeTeams}`,
        target: `${activeTeams}`,
        change: "—",
        trend: "neutral",
        icon: Users,
        progress: activeTeams ? 100 : 0,
      },
      {
        name: "Calls Handled",
        value: `${callsHandled}`,
        target: `${callsHandled}`,
        change: "—",
        trend: callsHandled > 0 ? "up" : "neutral",
        icon: Phone,
        progress: callsHandled ? 100 : 0,
      },
    ] as const
  }, [metrics, activeTeams])

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.name} className="relative overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{stat.name}</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-semibold text-foreground">{stat.value}</p>
                  <span className="text-sm text-muted-foreground">/ {stat.target}</span>
                </div>
                <div className="flex items-center gap-1">
                  {stat.trend === "up" && (
                    <TrendingUp className="h-4 w-4 text-success" />
                  )}
                  {stat.trend === "down" && (
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  )}
                  <span
                    className={cn(
                      "text-sm font-medium",
                      stat.trend === "up" && "text-success",
                      stat.trend === "down" && "text-destructive",
                      stat.trend === "neutral" && "text-muted-foreground"
                    )}
                  >
                    {stat.change}
                  </span>
                </div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <stat.icon className="h-6 w-6 text-primary" />
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="mt-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${stat.progress}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
