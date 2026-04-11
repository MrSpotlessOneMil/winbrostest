"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { DollarSign, Star, Trophy } from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MetricCard } from "@/components/insights/metric-card"
import { ChartCard } from "@/components/insights/chart-card"
import { DetailTable, type Column } from "@/components/insights/detail-table"
import CubeLoader from "@/components/ui/cube-loader"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamRow {
  teamId: string
  teamName: string
  jobsCompleted: number
  previousJobs: number
  revenue: number
  previousRevenue: number
  avgRating: number
  reviewCount: number
  previousAvgRating: number
  previousReviewCount: number
  tipsTotal: number
  upsellRate: number
  upsellRevenue: number
  revenuePerHour: number
}

interface TrendPoint {
  date: string
  teamId: string
  teamName: string
  jobs: number
  revenue: number
}

interface CleanerRow {
  cleanerId: string
  cleanerName: string
  teamId: string
  acceptanceRate: number
  avgResponseMinutes: number
  jobsCompleted: number
  [key: string]: unknown
}

interface CrewsData {
  teams: TeamRow[]
  trends: TrendPoint[]
  cleanerDetails: CleanerRow[]
  sparklines: {
    totalRevenue: number[]
    totalJobs: number[]
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_COLORS = ["#a78bfa", "#4ade80", "#5b8def", "#f472b6", "#fb923c", "#facc15"]

type SortField = "revenue" | "jobsCompleted" | "avgRating" | "tipsTotal"

const SORT_OPTIONS: { label: string; value: SortField }[] = [
  { label: "Revenue", value: "revenue" },
  { label: "Jobs", value: "jobsCompleted" },
  { label: "Rating", value: "avgRating" },
  { label: "Tips", value: "tipsTotal" },
]

// ---------------------------------------------------------------------------
// Rank badge component
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  const colors: Record<number, string> = {
    1: "bg-amber-500/20 text-amber-600",
    2: "bg-gray-300/20 text-gray-500",
    3: "bg-orange-400/20 text-orange-600",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0",
        colors[rank] || "bg-muted text-muted-foreground"
      )}
    >
      {rank}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Delta badge
// ---------------------------------------------------------------------------

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  if (pct === 0) return null

  const isUp = pct > 0
  return (
    <span
      className={cn(
        "text-xs font-medium px-1.5 py-0.5 rounded",
        isUp ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"
      )}
    >
      {isUp ? "+" : ""}
      {pct}%
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CrewsPage() {
  const searchParams = useSearchParams()
  const [data, setData] = useState<CrewsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortField>("revenue")

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

    fetch(`/api/actions/insights/crews?${queryString}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || "Failed to load crews data")
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

  if (!data || data.teams.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-muted-foreground">No crew data for this period</p>
      </div>
    )
  }

  const { teams, trends, cleanerDetails, sparklines } = data

  // Computed aggregates
  const totalRevenue = teams.reduce((sum, t) => sum + t.revenue, 0)
  const previousTotalRevenue = teams.reduce((sum, t) => sum + t.previousRevenue, 0)

  const weightedRatingSum = teams.reduce((sum, t) => sum + t.avgRating * t.reviewCount, 0)
  const totalReviewCount = teams.reduce((sum, t) => sum + t.reviewCount, 0)
  const avgRating = totalReviewCount > 0 ? Math.round((weightedRatingSum / totalReviewCount) * 10) / 10 : 0

  const prevWeightedRatingSum = teams.reduce((sum, t) => sum + t.previousAvgRating * t.previousReviewCount, 0)
  const prevTotalReviewCount = teams.reduce((sum, t) => sum + t.previousReviewCount, 0)
  const previousAvgRating = prevTotalReviewCount > 0 ? Math.round((prevWeightedRatingSum / prevTotalReviewCount) * 10) / 10 : 0

  const bestTeam = [...teams].sort((a, b) => b.revenue - a.revenue)[0]

  // Sorted teams for leaderboard
  const sortedTeams = [...teams].sort((a, b) => {
    const aVal = a[sortBy]
    const bVal = b[sortBy]
    return (bVal as number) - (aVal as number)
  })

  // ---------------------------------------------------------------------------
  // Chart data: pivot trends so each date has a column per team
  // ---------------------------------------------------------------------------
  const teamColorMap = new Map<string, string>()
  teams.forEach((t, i) => {
    teamColorMap.set(t.teamId, TEAM_COLORS[i % TEAM_COLORS.length])
  })

  const chartDataMap: Record<string, Record<string, number>> = {}
  for (const t of trends) {
    if (!chartDataMap[t.date]) chartDataMap[t.date] = {}
    chartDataMap[t.date][t.teamId] = t.revenue
  }

  const chartDates = Object.keys(chartDataMap).sort()
  const chartData = chartDates.map((date) => {
    const row: Record<string, string | number> = { date }
    for (const team of teams) {
      row[team.teamId] = chartDataMap[date]?.[team.teamId] || 0
    }
    return row
  })

  // ---------------------------------------------------------------------------
  // Cleaner table columns
  // ---------------------------------------------------------------------------
  const cleanerColumns: Column<CleanerRow>[] = [
    {
      key: "cleanerName",
      label: "Cleaner",
      render: (row) => <span className="font-medium">{row.cleanerName}</span>,
    },
    {
      key: "teamId",
      label: "Team",
      render: (row) => {
        const team = teams.find((t) => t.teamId === row.teamId)
        return <span>{team?.teamName || "Unassigned"}</span>
      },
    },
    {
      key: "acceptanceRate",
      label: "Acceptance Rate",
      align: "right",
      render: (row) => <span>{row.acceptanceRate}%</span>,
    },
    {
      key: "avgResponseMinutes",
      label: "Avg Response",
      align: "right",
      render: (row) => <span>{row.avgResponseMinutes}m</span>,
    },
    {
      key: "jobsCompleted",
      label: "Jobs",
      align: "right",
    },
  ]

  return (
    <div className="space-y-6">
      {/* ----------------------------------------------------------------- */}
      {/* Metric cards                                                       */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Total Revenue"
          value={totalRevenue}
          previousValue={previousTotalRevenue}
          prefix="$"
          format="currency"
          icon={DollarSign}
          sparklineData={sparklines.totalRevenue}
          sparklineColor="#a78bfa"
        />
        <MetricCard
          label="Avg Rating"
          value={avgRating}
          previousValue={previousAvgRating}
          format="number"
          icon={Star}
          sparklineColor="#4ade80"
        />
        <Card className="relative overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground truncate">Best Team</p>
                <p className="text-2xl font-bold text-primary truncate">
                  {bestTeam?.teamName || "N/A"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {bestTeam ? `$${bestTeam.revenue.toLocaleString()} revenue` : "No data"}
                </p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Trophy className="h-4.5 w-4.5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Team Leaderboard                                                   */}
      {/* ----------------------------------------------------------------- */}
      <Card>
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h3 className="text-base font-semibold">Team Leaderboard</h3>
          <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
            {SORT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant="ghost"
                size="sm"
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  "h-6 px-2.5 text-xs font-medium rounded-full",
                  sortBy === opt.value
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            {sortedTeams.map((team, i) => (
              <div
                key={team.teamId}
                className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
              >
                <RankBadge rank={i + 1} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{team.teamName}</p>
                </div>
                <div className="flex items-center gap-4 text-sm shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Revenue</p>
                    <p className="font-medium">${team.revenue.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Jobs</p>
                    <p className="font-medium">{team.jobsCompleted}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Rating</p>
                    <p className="font-medium">
                      {team.reviewCount > 0 ? (
                        <>
                          <span className="text-amber-500">&#9733;</span> {team.avgRating}
                        </>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Tips</p>
                    <p className="font-medium">${team.tipsTotal.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Upsell</p>
                    <p className="font-medium">{team.upsellRate}%</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">$/hr</p>
                    <p className="font-medium">${team.revenuePerHour.toLocaleString()}</p>
                  </div>
                  <div className="w-14 text-right">
                    <DeltaBadge current={team.revenue} previous={team.previousRevenue} />
                  </div>
                </div>
              </div>
            ))}
            {sortedTeams.length === 0 && (
              <p className="text-center text-muted-foreground py-8">No teams found</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------------- */}
      {/* Team Revenue Trend                                                 */}
      {/* ----------------------------------------------------------------- */}
      <ChartCard title="Team Revenue Trend" subtitle="Daily revenue by team">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <defs>
              {teams.map((team, i) => {
                const color = TEAM_COLORS[i % TEAM_COLORS.length]
                return (
                  <linearGradient key={team.teamId} id={`crew-gradient-${team.teamId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                )
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground"
              tickFormatter={(v: string) => {
                const d = new Date(v + "T00:00:00")
                return `${d.getMonth() + 1}/${d.getDate()}`
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              className="fill-muted-foreground"
              tickFormatter={(v: number) => `$${v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                const team = teams.find((t) => t.teamId === name)
                return [`$${value.toLocaleString()}`, team?.teamName || name]
              }}
              labelFormatter={(label: string) => {
                const d = new Date(label + "T00:00:00")
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }}
            />
            <Legend
              formatter={(value: string) => {
                const team = teams.find((t) => t.teamId === value)
                return team?.teamName || value
              }}
            />
            {teams.map((team, i) => {
              const color = TEAM_COLORS[i % TEAM_COLORS.length]
              return (
                <Area
                  key={team.teamId}
                  type="monotone"
                  dataKey={team.teamId}
                  stroke={color}
                  fill={`url(#crew-gradient-${team.teamId})`}
                  strokeWidth={2}
                  dot={false}
                />
              )
            })}
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ----------------------------------------------------------------- */}
      {/* Cleaner Drill-down                                                 */}
      {/* ----------------------------------------------------------------- */}
      <DetailTable<CleanerRow>
        title={`Cleaner Details (${cleanerDetails.length})`}
        columns={cleanerColumns}
        data={cleanerDetails}
        defaultExpanded={false}
      />
    </div>
  )
}
