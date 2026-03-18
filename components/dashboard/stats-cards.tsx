"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, DollarSign, CalendarCheck, Users, Phone } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEffect, useMemo, useState } from "react"
import type { ApiResponse, DailyMetrics } from "@/lib/types"
import { SlidingNumber } from "@/components/ui/sliding-number"

function pct(n: number, d: number): number {
  if (!d) return 0
  return Math.round((n / d) * 100)
}

function computeChange(today: number, yesterday: number): { change: string; trend: "up" | "down" | "neutral" } {
  if (yesterday === 0 && today === 0) return { change: "No change", trend: "neutral" }
  if (yesterday === 0) return { change: "New", trend: "up" }
  const pctChange = Math.round(((today - yesterday) / yesterday) * 100)
  if (pctChange === 0) return { change: "0% vs yesterday", trend: "neutral" }
  if (pctChange > 0) return { change: `+${pctChange}% vs yesterday`, trend: "up" }
  return { change: `${pctChange}% vs yesterday`, trend: "down" }
}

export function StatsCards() {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null)
  const [prevMetrics, setPrevMetrics] = useState<DailyMetrics | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayISO = yesterday.toISOString().split("T")[0]

        const [mRes, pRes] = await Promise.all([
          fetch("/api/metrics?range=today", { cache: "no-store" }),
          fetch(`/api/metrics?date=${yesterdayISO}&range=specific`, { cache: "no-store" }),
        ])

        const mJson = (await mRes.json()) as ApiResponse<DailyMetrics>
        const pJson = (await pRes.json()) as ApiResponse<DailyMetrics>

        if (!cancelled) {
          setMetrics((mJson as any).data || null)
          setPrevMetrics((pJson as any).data || null)
        }
      } catch {
        if (!cancelled) {
          setMetrics(null)
          setPrevMetrics(null)
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  type StatTrend = "up" | "down" | "neutral"
  type StatItem = {
    name: string
    numericValue: number
    numericTarget: number
    prefix?: string
    suffix?: string
    useCommas?: boolean
    change: string
    trend: StatTrend
    icon: typeof DollarSign
    progress: number
  }

  const stats = useMemo((): StatItem[] => {
    const revenue = Number(metrics?.total_revenue || 0)
    const targetRevenue = Number(metrics?.target_revenue || 0)
    const jobsCompleted = Number(metrics?.jobs_completed || 0)
    const jobsScheduled = Number(metrics?.jobs_scheduled || 0)
    const callsHandled = Number(metrics?.calls_handled || 0)
    const leadsIn = Number(metrics?.leads_in || 0)

    const prevRevenue = Number(prevMetrics?.total_revenue || 0)
    const prevJobsCompleted = Number(prevMetrics?.jobs_completed || 0)
    const prevCallsHandled = Number(prevMetrics?.calls_handled || 0)
    const prevLeadsIn = Number(prevMetrics?.leads_in || 0)

    const revenueChange = computeChange(revenue, prevRevenue)
    const jobsChange = computeChange(jobsCompleted, prevJobsCompleted)
    const leadsChange = computeChange(leadsIn, prevLeadsIn)
    const callsChange = computeChange(callsHandled, prevCallsHandled)

    return [
      {
        name: "Today's Revenue",
        numericValue: revenue,
        numericTarget: targetRevenue,
        prefix: "$",
        useCommas: true,
        change: revenueChange.change,
        trend: revenueChange.trend,
        icon: DollarSign,
        progress: pct(revenue, targetRevenue),
      },
      {
        name: "Jobs Completed",
        numericValue: jobsCompleted,
        numericTarget: jobsScheduled || 0,
        change: jobsChange.change,
        trend: jobsChange.trend,
        icon: CalendarCheck,
        progress: pct(jobsCompleted, jobsScheduled || 0),
      },
      {
        name: "New Leads",
        numericValue: leadsIn,
        numericTarget: prevLeadsIn || leadsIn,
        change: leadsChange.change,
        trend: leadsChange.trend,
        icon: Users,
        progress: prevLeadsIn > 0 ? pct(leadsIn, prevLeadsIn) : (leadsIn > 0 ? 100 : 0),
      },
      {
        name: "Calls Handled",
        numericValue: callsHandled,
        numericTarget: callsHandled,
        change: callsChange.change,
        trend: callsChange.trend,
        icon: Phone,
        progress: callsHandled ? 100 : 0,
      },
    ]
  }, [metrics, prevMetrics])

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat, i) => (
        <Card key={stat.name} className={`relative overflow-hidden stat-card-border hover-glow-border stagger-${i + 1}`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-400">{stat.name}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-violet-300 flex items-center">
                    {stat.prefix}<SlidingNumber value={stat.numericValue} useCommas={stat.useCommas} />{stat.suffix}
                  </span>
                  <span className="text-sm text-zinc-500 flex items-center">
                    / {stat.prefix}<SlidingNumber value={stat.numericTarget} useCommas={stat.useCommas} />{stat.suffix}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
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
                      stat.trend === "neutral" && "text-zinc-500"
                    )}
                  >
                    {stat.change}
                  </span>
                </div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 icon-glow text-primary">
                <stat.icon className="h-5 w-5" />
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/60">
                <div
                  className="h-full rounded-full progress-bar-glow transition-all duration-700 ease-out"
                  style={{ width: `${Math.min(stat.progress, 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
