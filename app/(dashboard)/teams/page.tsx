"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  MapPin,
  Phone,
  DollarSign,
  Star,
  TrendingUp,
  Clock,
  Truck,
  Users,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApiResponse, Team, TeamDailyMetrics } from "@/lib/types"

type UiTeam = Team & {
  daily_metrics?: TeamDailyMetrics
  currentJob?: {
    address: string
    customer: string
    service: string
    eta: string
  } | null
  leadName: string
  memberNames: string[]
  membersDetailed: Array<{
    id: string
    name: string
    phone: string
    role: "lead" | "technician"
    is_active: boolean
    last_location_lat?: number | null
    last_location_lng?: number | null
    last_location_accuracy_meters?: number | null
    last_location_updated_at?: string | null
  }>
}

const statusConfig = {
  "on-job": { label: "On Job", className: "bg-success/10 text-success border-success/20", icon: Truck },
  traveling: { label: "Traveling", className: "bg-primary/10 text-primary border-primary/20", icon: MapPin },
  available: { label: "Available", className: "bg-warning/10 text-warning border-warning/20", icon: Clock },
  off: { label: "Off Today", className: "bg-muted text-muted-foreground border-border", icon: Users },
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<UiTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<UiTeam | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const today = new Date().toISOString().slice(0, 10)
        const res = await fetch(`/api/teams?include_metrics=true&date=${today}`, { cache: "no-store" })
        const json = (await res.json()) as ApiResponse<any[]>
        const rows = Array.isArray(json.data) ? json.data : []
        const mapped: UiTeam[] = rows.map((t: any) => {
          const members = Array.isArray(t.members) ? t.members : []
          const lead = members.find((m: any) => m.role === "lead") || members[0]
          const leadName = String(lead?.name || t.name || "Team Lead")
          const memberNames = members.map((m: any) => String(m.name || "")).filter(Boolean)
          return {
            ...t,
            leadName,
            memberNames,
            membersDetailed: members.map((m: any) => ({
              id: String(m.id),
              name: String(m.name || "Cleaner"),
              phone: String(m.phone || ""),
              role: m.role === "lead" ? "lead" : "technician",
              is_active: Boolean(m.is_active),
              last_location_lat: m.last_location_lat ?? null,
              last_location_lng: m.last_location_lng ?? null,
              last_location_accuracy_meters: m.last_location_accuracy_meters ?? null,
              last_location_updated_at: m.last_location_updated_at ?? null,
            })),
            currentJob: t.current_job_id
              ? {
                  address: "—",
                  customer: "—",
                  service: "—",
                  eta: "—",
                }
              : null,
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

  const activeTeams = useMemo(() => teams.filter((t) => t.status !== "off" && t.is_active), [teams])
  const totalRevenue = useMemo(
    () => activeTeams.reduce((sum, t) => sum + Number(t.daily_metrics?.revenue || 0), 0),
    [activeTeams]
  )
  const totalTarget = useMemo(
    () => activeTeams.reduce((sum, t) => sum + Number(t.daily_metrics?.target || t.daily_target || 0), 0),
    [activeTeams]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">Real-time crew tracking and performance</p>
        </div>
        <Button asChild>
          <Link href="/teams/manage">
            <Users className="mr-2 h-4 w-4" />
            Manage Teams
          </Link>
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                <Users className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Teams</p>
                <p className="text-2xl font-semibold text-foreground">{activeTeams.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Revenue</p>
                <p className="text-2xl font-semibold text-foreground">${totalRevenue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/10">
                <TrendingUp className="h-6 w-6 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Daily Target</p>
                <p className="text-2xl font-semibold text-foreground">${totalTarget.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                <Star className="h-6 w-6 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Rating</p>
                <p className="text-2xl font-semibold text-foreground">—</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team Cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {teams.map((team) => {
          const StatusIcon = statusConfig[team.status as keyof typeof statusConfig].icon
          const target = Number(team.daily_metrics?.target || team.daily_target || 0)
          const revenue = Number(team.daily_metrics?.revenue || 0)
          const jobsCompleted = Number(team.daily_metrics?.jobs_completed || 0)
          const jobsScheduled = Number(team.daily_metrics?.jobs_scheduled || 0)
          const revenuePercent = target > 0 ? (revenue / target) * 100 : 0

          return (
            <Card
              key={team.id}
              className={cn(team.status === "off" && "opacity-60")}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{team.name}</CardTitle>
                      <CardDescription>Lead: {team.leadName}</CardDescription>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={statusConfig[team.status as keyof typeof statusConfig].className}
                  >
                    <StatusIcon className="mr-1 h-3 w-3" />
                    {statusConfig[team.status as keyof typeof statusConfig].label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Members */}
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {team.memberNames.map((member) => (
                      <Avatar key={member} className="h-8 w-8 border-2 border-background">
                        <AvatarFallback className="text-xs bg-muted">
                          {member.split(" ").map((n) => n[0]).join("")}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  <span className="text-sm text-muted-foreground">{team.memberNames.length} members</span>
                </div>

                {/* Current Job */}
                {team.currentJob && (
                  <div className="rounded-lg bg-muted/50 p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">{team.currentJob.customer}</p>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {team.currentJob.address}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{team.currentJob.service}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        <Clock className="mr-1 h-3 w-3" />
                        {team.currentJob.eta}
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Stats */}
                {team.status !== "off" && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Daily Revenue</span>
                        <span className="font-medium text-foreground">
                          ${revenue.toLocaleString()} / ${target.toLocaleString()}
                        </span>
                      </div>
                      <Progress value={revenuePercent} className="h-2" />
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-lg font-semibold text-foreground">
                          {jobsCompleted}/{jobsScheduled}
                        </p>
                        <p className="text-xs text-muted-foreground">Jobs</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-lg font-semibold text-foreground">—</p>
                        <p className="text-xs text-muted-foreground">Rating</p>
                      </div>
                      <div className="rounded-lg bg-success/10 p-2">
                        <p className="text-lg font-semibold text-success">$0</p>
                        <p className="text-xs text-muted-foreground">Tips</p>
                      </div>
                      <div className="rounded-lg bg-primary/10 p-2">
                        <p className="text-lg font-semibold text-primary">$0</p>
                        <p className="text-xs text-muted-foreground">Upsells</p>
                      </div>
                    </div>
                  </>
                )}

                <Button variant="ghost" className="w-full justify-between" disabled={team.status === "off"}>
                  <span
                    className="w-full text-left"
                    onClick={() => setSelectedTeam(team)}
                  >
                    View Full Details
                  </span>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading teams…</p>}
      {!loading && teams.length === 0 && <p className="text-sm text-muted-foreground">No teams found.</p>}

      <Dialog open={!!selectedTeam} onOpenChange={(open) => !open && setSelectedTeam(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTeam?.name || "Team"}</DialogTitle>
            <DialogDescription>
              Team members and latest known locations
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(selectedTeam?.membersDetailed || []).map((m) => {
              const hasLoc = m.last_location_lat != null && m.last_location_lng != null
              return (
                <div
                  key={m.id}
                  className="flex items-start justify-between rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{m.name}</span>
                      <Badge variant="outline">{m.role}</Badge>
                      {!m.is_active && (
                        <Badge variant="secondary">inactive</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        <span>{m.phone || "—"}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        <span>
                          {hasLoc
                            ? `${Number(m.last_location_lat).toFixed(5)}, ${Number(m.last_location_lng).toFixed(5)}`
                            : "No location yet"}
                        </span>
                      </div>
                    </div>
                    {m.last_location_updated_at && (
                      <p className="text-xs text-muted-foreground">
                        Updated: {new Date(m.last_location_updated_at).toLocaleString()}
                        {m.last_location_accuracy_meters != null ? ` (±${Math.round(Number(m.last_location_accuracy_meters))}m)` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
            {(selectedTeam?.membersDetailed || []).length === 0 && (
              <p className="text-sm text-muted-foreground">No team members yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
