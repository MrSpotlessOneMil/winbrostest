"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MapPin, Clock, DollarSign, ChevronRight, User } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Job as ApiJob, PaginatedResponse } from "@/lib/types"

type UiJob = {
  id: string
  customer: string
  address: string
  time: string
  value: number
  status: ApiJob["status"]
  team: string
  service: string
  upsell: string | null
}

function toTimeDisplay(hhmm: string | null | undefined): string {
  const s = String(hhmm || "")
  if (!/^\d{2}:\d{2}$/.test(s)) return "—"
  const [hStr, mStr] = s.split(":")
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "—"
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function mapJob(row: ApiJob): UiJob {
  const start = toTimeDisplay(row.scheduled_time)
  const durationMin = Number(row.duration_minutes || 0)
  const end =
    durationMin > 0
      ? (() => {
          const now = new Date()
          const t = String(row.scheduled_time || "")
          if (!/^\d{2}:\d{2}$/.test(t)) return ""
          const [hStr, mStr] = t.split(":")
          const d = new Date(now)
          d.setHours(Number(hStr), Number(mStr), 0, 0)
          d.setMinutes(d.getMinutes() + durationMin)
          return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        })()
      : ""

  return {
    id: `JOB-${row.id}`,
    customer: row.customer_name || "Unknown",
    address: row.address || "—",
    time: end ? `${start} - ${end}` : start,
    value: Number(row.estimated_value || 0),
    status: row.status,
    team: row.team_id ? String(row.team_id) : "—",
    service: String(row.service_type || "Service"),
    upsell: row.upsell_notes || null,
  }
}

const statusConfig = {
  completed: { label: "Completed", className: "bg-success/10 text-success border-success/20" },
  "in-progress": { label: "In Progress", className: "bg-primary/10 text-primary border-primary/20" },
  scheduled: { label: "Scheduled", className: "bg-muted text-muted-foreground border-border" },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive border-destructive/20" },
}

export function TodaysJobs() {
  const [jobs, setJobs] = useState<UiJob[]>([])
  const [loading, setLoading] = useState(false)

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/jobs?date=${today}&page=1&per_page=50`, { cache: "no-store" })
        const json = (await res.json()) as PaginatedResponse<ApiJob>
        const rows = (json.data || []).map(mapJob)
        if (!cancelled) setJobs(rows)
      } catch {
        if (!cancelled) setJobs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [today])

  const projectedRevenue = jobs.reduce((sum, j) => sum + Number(j.value || 0), 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Today's Jobs</CardTitle>
          <CardDescription>
            {jobs.length} jobs scheduled • ${projectedRevenue.toLocaleString()} projected revenue
          </CardDescription>
        </div>
        <Button variant="outline" size="sm">
          View All
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
            >
              {/* Status indicator */}
              <div
                className={cn(
                  "h-full w-1 self-stretch rounded-full",
                  job.status === "completed" && "bg-success",
                  job.status === "in-progress" && "bg-primary",
                  job.status === "scheduled" && "bg-muted-foreground"
                )}
              />

              {/* Main content */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{job.customer}</span>
                    <Badge variant="outline" className={statusConfig[job.status as keyof typeof statusConfig].className}>
                      {statusConfig[job.status as keyof typeof statusConfig].label}
                    </Badge>
                  </div>
                  <span className="text-sm font-mono text-muted-foreground">{job.id}</span>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" />
                    <span>{job.address}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    <span>{job.time}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    <span>${job.value}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="h-4 w-4" />
                    <span>Team {job.team}</span>
                  </div>
                </div>

                {job.upsell && (
                  <div className="text-xs text-success">
                    + {job.upsell}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">No jobs scheduled for today.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
