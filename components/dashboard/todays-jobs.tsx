"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MapPin, Clock, DollarSign, ChevronRight, User, CalendarCheck, Phone, Navigation } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { Job as ApiJob, PaginatedResponse } from "@/lib/types"

type UiJob = {
  id: string
  customer: string
  customerPhone: string | null
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
    customerPhone: row.customer_phone || null,
    address: row.address || "—",
    time: end ? `${start} - ${end}` : start,
    value: Number(row.estimated_value || 0),
    status: row.status,
    team: row.team_id ? String(row.team_id) : "—",
    service: String(row.service_type || "Service"),
    upsell: row.upsell_notes || null,
  }
}

const statusConfig: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-success/10 text-success border-success/20" },
  "in-progress": { label: "In Progress", className: "bg-primary/10 text-primary border-primary/20" },
  scheduled: { label: "Scheduled", className: "bg-muted text-muted-foreground border-border" },
  confirmed: { label: "Confirmed", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  quoted: { label: "Quoted", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  rescheduled: { label: "Rescheduled", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
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
        <Link href="/jobs">
          <Button variant="outline" size="sm">
            View All
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="skeleton-line w-32" />
                    <div className="skeleton-line w-16" />
                  </div>
                  <div className="flex gap-4">
                    <div className="skeleton-line w-40" />
                    <div className="skeleton-line w-20" />
                    <div className="skeleton-line w-16" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && jobs.map((job) => (
            <div
              key={job.id}
              className="flex items-center gap-4 glass-list-item p-4"
            >
              {/* Status indicator */}
              <div
                className={cn(
                  "h-full w-1 self-stretch rounded-full",
                  job.status === "completed" && "bg-success",
                  job.status === "in-progress" && "bg-primary status-dot-pulse",
                  job.status === "scheduled" && "bg-zinc-600"
                )}
              />

              {/* Main content */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{job.customer}</span>
                    <Badge variant="outline" className={(statusConfig[job.status] || statusConfig.scheduled).className}>
                      {(statusConfig[job.status] || statusConfig.scheduled).label}
                    </Badge>
                  </div>
                  <span className="text-xs font-mono text-zinc-600">{job.id}</span>
                </div>

                <div className="flex flex-wrap items-center gap-3 md:gap-4 text-xs md:text-sm text-zinc-500">
                  <div className="flex items-center gap-1 min-w-0">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate max-w-[180px] sm:max-w-none">{job.address}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{job.time}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    <span className="text-zinc-300 font-medium">${job.value}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <User className="h-3.5 w-3.5" />
                    <span>Team {job.team}</span>
                  </div>
                </div>

                {job.upsell && (
                  <div className="text-xs text-success font-medium">
                    + {job.upsell}
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex flex-col gap-1.5 shrink-0">
                {job.customerPhone && (
                  <a
                    href={`tel:${job.customerPhone}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                    title="Call customer"
                  >
                    <Phone className="h-3.5 w-3.5" />
                  </a>
                )}
                {job.address && job.address !== "—" && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    title="Navigate"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          ))}
          {!loading && jobs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800/60">
                <CalendarCheck className="h-6 w-6 text-zinc-500" />
              </div>
              <p className="mt-3 font-medium text-zinc-300">No jobs today</p>
              <p className="text-sm text-zinc-500">Jobs will appear here when scheduled</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
