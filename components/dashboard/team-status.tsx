"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { MapPin, DollarSign } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApiResponse, Team, TeamDailyMetrics } from "@/lib/types"

type UiTeam = {
  name: string
  lead: string
  status: Team["status"]
  currentJob: string | null
  revenue: number
  target: number
  jobsCompleted: number
  jobsTotal: number
}

const statusConfig = {
  "on-job": { label: "On Job", className: "bg-success/10 text-success border-success/20" },
  traveling: { label: "Traveling", className: "bg-primary/10 text-primary border-primary/20" },
  available: { label: "Available", className: "bg-warning/10 text-warning border-warning/20" },
  off: { label: "Off Today", className: "bg-muted text-muted-foreground border-border" },
}

export function TeamStatus() {
  const [teams, setTeams] = useState<UiTeam[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const today = new Date().toISOString().slice(0, 10)
        const res = await fetch(`/api/teams?include_metrics=true&date=${today}`, { cache: "no-store" })
        const json = (await res.json()) as ApiResponse<any[]>
        const rows = Array.isArray((json as any).data) ? ((json as any).data as any[]) : []
        const mapped: UiTeam[] = rows.map((t) => {
          const members = Array.isArray(t.members) ? t.members : []
          const lead = members.find((m: any) => m.role === "lead") || members[0]
          const dm: TeamDailyMetrics | undefined = t.daily_metrics
          const revenue = Number(dm?.revenue || 0)
          const target = Number(dm?.target || t.daily_target || 0)
          const jobsCompleted = Number(dm?.jobs_completed || 0)
          const jobsTotal = Number(dm?.jobs_scheduled || 0)
          return {
            name: String(t.name || "Team"),
            lead: String(lead?.name || "Lead"),
            status: t.status as Team["status"],
            currentJob: t.current_job_id ? `Job ${t.current_job_id}` : null,
            revenue,
            target,
            jobsCompleted,
            jobsTotal,
          }
        })
        if (!cancelled) setTeams(mapped)
      } catch {
        if (!cancelled) setTeams([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Status</CardTitle>
        <CardDescription>Real-time crew tracking</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {teams.map((team) => (
          <div
            key={team.name}
            className={cn(
              "rounded-lg border border-border p-4 transition-colors",
              team.status === "off" ? "opacity-50" : "bg-muted/30 hover:bg-muted/50"
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{team.name}</span>
                  <Badge
                    variant="outline"
                    className={statusConfig[team.status as keyof typeof statusConfig].className}
                  >
                    {statusConfig[team.status as keyof typeof statusConfig].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{team.lead}</p>
              </div>
            </div>

            {team.status !== "off" && (
              <>
                <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  <span>{team.currentJob}</span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" />
                      <span>
                        ${team.revenue} / ${team.target}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {team.jobsCompleted}/{team.jobsTotal} jobs
                    </span>
                  </div>
                  <Progress value={team.target ? (team.revenue / team.target) * 100 : 0} className="h-1.5" />
                </div>
              </>
            )}
          </div>
        ))}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && teams.length === 0 && <p className="text-sm text-muted-foreground">No teams found.</p>}
      </CardContent>
    </Card>
  )
}
