"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  List,
  Plus,
  MapPin,
  Clock,
  DollarSign,
  User,
  Filter,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { Job as ApiJob, PaginatedResponse } from "@/lib/types"

type CalendarJob = {
  id: string
  time: string
  customer: string
  value: number
  team: string
  status: "completed" | "in-progress" | "scheduled" | "cancelled"
  date: string
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

function isoDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function mapJobForCalendar(row: ApiJob): CalendarJob {
  return {
    id: row.id,
    time: toTimeDisplay(row.scheduled_time),
    customer: row.customer_name || "Unknown",
    value: Number(row.estimated_value || 0),
    team: row.team_id ? String(row.team_id) : "—",
    status: row.status,
    date: row.scheduled_date,
  }
}

const statusColors = {
  completed: "bg-success",
  "in-progress": "bg-primary",
  scheduled: "bg-muted-foreground",
  cancelled: "bg-destructive",
}

export default function JobsPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedTeam, setSelectedTeam] = useState("all")
  const [jobs, setJobs] = useState<CalendarJob[]>([])
  const [loading, setLoading] = useState(false)

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDay = firstDay.getDay()
    return { daysInMonth, startingDay }
  }

  const { daysInMonth, startingDay } = getDaysInMonth(currentDate)

  const formatDateKey = (day: number) => isoDateKey(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))

  const navigateMonth = (direction: "prev" | "next") => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev)
      if (direction === "prev") {
        newDate.setMonth(newDate.getMonth() - 1)
      } else {
        newDate.setMonth(newDate.getMonth() + 1)
      }
      return newDate
    })
  }

  const isToday = (day: number) => {
    const today = new Date()
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    )
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // Pull a larger set and filter client-side for the month (avoids N requests/day).
        const res = await fetch(`/api/jobs?page=1&per_page=500`, { cache: "no-store" })
        const json = (await res.json()) as PaginatedResponse<ApiJob>
        const mapped = (json.data || []).map(mapJobForCalendar)

        // Filter to current month and optional team filter.
        const monthStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
        const monthEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
        const startKey = isoDateKey(monthStart)
        const endKey = isoDateKey(monthEnd)

        const filtered = mapped.filter((j) => j.date >= startKey && j.date <= endKey)
        const teamFiltered =
          selectedTeam === "all" ? filtered : filtered.filter((j) => String(j.team) === String(selectedTeam))

        if (!cancelled) setJobs(teamFiltered)
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
  }, [currentDate, selectedTeam])

  const jobsByDate = useMemo(() => {
    const map = new Map<string, CalendarJob[]>()
    for (const j of jobs) {
      const arr = map.get(j.date) || []
      arr.push(j)
      map.set(j.date, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.time.localeCompare(b.time))
    }
    return map
  }, [jobs])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Jobs Calendar</h1>
          <p className="text-sm text-muted-foreground">Schedule and manage all service appointments</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedTeam} onValueChange={setSelectedTeam}>
            <SelectTrigger className="w-40">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Teams</SelectItem>
              <SelectItem value="1">Team 1</SelectItem>
              <SelectItem value="2">Team 2</SelectItem>
              <SelectItem value="3">Team 3</SelectItem>
              <SelectItem value="4">Team 4</SelectItem>
            </SelectContent>
          </Select>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Job
          </Button>
        </div>
      </div>

      <Tabs defaultValue="calendar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="calendar" className="gap-2">
            <Calendar className="h-4 w-4" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-2">
            <List className="h-4 w-4" />
            List View
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => navigateMonth("prev")}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-semibold">
                  {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h2>
                <Button variant="outline" size="icon" onClick={() => navigateMonth("next")}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="outline" onClick={() => setCurrentDate(new Date())}>
                Today
              </Button>
            </CardHeader>
            <CardContent>
              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
                {/* Day headers */}
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <div
                    key={day}
                    className="bg-muted px-2 py-3 text-center text-xs font-medium text-muted-foreground"
                  >
                    {day}
                  </div>
                ))}

                {/* Empty cells for days before the first of the month */}
                {Array.from({ length: startingDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="min-h-32 bg-card p-2" />
                ))}

                {/* Days of the month */}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const dateKey = formatDateKey(day)
                  const dayJobs = jobsByDate.get(dateKey) || []
                  const totalRevenue = dayJobs.reduce((sum, job) => sum + Number(job.value || 0), 0)

                  return (
                    <div
                      key={day}
                      className={cn(
                        "min-h-32 bg-card p-2 transition-colors hover:bg-muted/50",
                        isToday(day) && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-sm",
                            isToday(day) && "bg-primary text-primary-foreground font-medium"
                          )}
                        >
                          {day}
                        </span>
                        {totalRevenue > 0 && (
                          <span className="text-xs font-medium text-success">${totalRevenue}</span>
                        )}
                      </div>

                      <div className="mt-2 space-y-1">
                        {dayJobs.slice(0, 3).map((job) => (
                          <div
                            key={job.id}
                            className="flex items-center gap-1 rounded bg-muted/50 px-1.5 py-1 text-xs"
                          >
                            <div className={cn("h-1.5 w-1.5 rounded-full", statusColors[job.status as keyof typeof statusColors])} />
                            <span className="truncate text-foreground">{job.time}</span>
                            <span className="truncate text-muted-foreground">- {job.customer}</span>
                          </div>
                        ))}
                        {dayJobs.length > 3 && (
                          <div className="text-xs text-muted-foreground">+{dayJobs.length - 3} more</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {loading && (
                <p className="mt-3 text-xs text-muted-foreground">Loading jobs…</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Jobs</CardTitle>
              <CardDescription>All scheduled jobs for the next 7 days</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {Array.from(jobsByDate.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, dayJobs]) => (
                  <div key={date}>
                    <div className="mb-3 flex items-center gap-2">
                      <div className="h-px flex-1 bg-border" />
                      <span className="text-sm font-medium text-muted-foreground">
                        {new Date(date).toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <div className="h-px flex-1 bg-border" />
                    </div>

                    <div className="space-y-2">
                      {dayJobs.map((job) => (
                        <div
                          key={job.id}
                          className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-4 transition-colors hover:bg-muted/50"
                        >
                          <div
                            className={cn(
                              "h-full w-1 self-stretch rounded-full",
                              statusColors[job.status as keyof typeof statusColors]
                            )}
                          />
                          <div className="flex flex-1 items-center justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">{job.customer}</span>
                                <Badge variant="outline" className="text-xs">
                                  {job.status}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Clock className="h-4 w-4" />
                                  {job.time}
                                </div>
                                <div className="flex items-center gap-1">
                                  <User className="h-4 w-4" />
                                  Team {job.team}
                                </div>
                                <div className="flex items-center gap-1">
                                  <DollarSign className="h-4 w-4" />
                                  ${Number(job.value || 0)}
                                </div>
                              </div>
                            </div>
                            <Button variant="ghost" size="sm">
                              View Details
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!loading && jobs.length === 0 && (
                  <p className="text-sm text-muted-foreground">No jobs found for this month.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
