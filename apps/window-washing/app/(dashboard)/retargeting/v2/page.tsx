"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Play, RotateCcw, Trophy, Flame, TrendingUp, CheckCircle, X } from "lucide-react"
import CubeLoader from "@/components/ui/cube-loader"
import { useRetargeting } from "../use-retargeting"
import {
  PIPELINE_STAGES,
  getCustomerStatus,
  timeAgo,
  type StageKey,
  type PipelineCustomer,
} from "../constants"

interface FeedItem {
  id: string
  type: "enrolled" | "active" | "completed" | "converted" | "stopped"
  customer: PipelineCustomer & { stage: StageKey }
  timestamp: string
  message: string
}

export default function RetargetingV2() {
  const {
    pipeline,
    pipelineLoading,
    customers,
    customersLoading,
    fetchPipeline,
    fetchStageCustomers,
    enrollSegment,
    enrolling,
    error,
    clearError,
  } = useRetargeting()

  const [enrollResults, setEnrollResults] = useState<Record<string, number>>({})

  // Fetch all stage customers on load
  useEffect(() => {
    if (!pipelineLoading) {
      PIPELINE_STAGES.forEach(s => {
        if (pipeline[s.key]) fetchStageCustomers(s.key)
      })
    }
  }, [pipelineLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build all customers list
  const allCustomers: (PipelineCustomer & { stage: StageKey })[] = useMemo(() => {
    const result: (PipelineCustomer & { stage: StageKey })[] = []
    for (const s of PIPELINE_STAGES) {
      for (const c of customers[s.key] || []) {
        result.push({ ...c, stage: s.key })
      }
    }
    return result
  }, [customers])

  // Compute scoreboard stats
  const stats = useMemo(() => {
    let reengaged = 0
    let responded = 0
    let totalInSequence = 0
    let converted = 0

    for (const c of allCustomers) {
      const status = getCustomerStatus(c)
      if (status === "active") {
        totalInSequence++
        if ((c.retargeting_step || 0) > 1) responded++
      }
      if (status === "converted") converted++
      if (status === "active" || status === "completed" || status === "converted") reengaged++
    }

    const responseRate = totalInSequence > 0 ? Math.round((responded / totalInSequence) * 100) : 0

    return { reengaged, responseRate, converted, totalInSequence }
  }, [allCustomers])

  // Build activity feed from customer data
  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = []
    for (const c of allCustomers) {
      const status = getCustomerStatus(c)
      const name = `${c.first_name || ""} ${c.last_name || ""}`.trim()
      const stageDef = PIPELINE_STAGES.find(s => s.key === c.stage)

      if (status === "converted") {
        items.push({
          id: `${c.id}-converted`,
          type: "converted",
          customer: c,
          timestamp: c.retargeting_completed_at || c.updated_at,
          message: `${name} CONVERTED - booked!`,
        })
      } else if (status === "completed") {
        items.push({
          id: `${c.id}-completed`,
          type: "completed",
          customer: c,
          timestamp: c.retargeting_completed_at || c.updated_at,
          message: `${name} - sequence done (no reply)`,
        })
      } else if (status === "active") {
        items.push({
          id: `${c.id}-active`,
          type: "active",
          customer: c,
          timestamp: c.retargeting_enrolled_at || c.updated_at,
          message: `Step ${c.retargeting_step || 1} sent to ${name} (${stageDef?.label || c.stage})`,
        })
      }
    }
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    return items
  }, [allCustomers])

  // Action queue: counts of eligible customers per stage
  const actionQueue = useMemo(() => {
    const counts: { key: StageKey; label: string; count: number; color: string }[] = []
    for (const s of PIPELINE_STAGES) {
      if (s.key === "lost") continue
      const eligible = (customers[s.key] || []).filter(c => getCustomerStatus(c) === "eligible").length
      if (eligible > 0) {
        counts.push({ key: s.key, label: s.label, count: eligible, color: s.color })
      }
    }
    return counts
  }, [customers])

  // Milestones
  const milestones = useMemo(() => {
    const total = allCustomers.length
    const reengaged = allCustomers.filter(c => getCustomerStatus(c) !== "eligible").length
    return [
      { label: "First re-engagement", done: reengaged >= 1 },
      { label: "10 enrolled", done: reengaged >= 10 },
      { label: "50% response rate", done: stats.responseRate >= 50 },
      { label: "100 processed", done: total >= 100 },
    ]
  }, [allCustomers, stats.responseRate])

  // Progress ring percentage
  const progressPct = useMemo(() => {
    const total = allCustomers.length
    if (total === 0) return 0
    const processed = allCustomers.filter(c => getCustomerStatus(c) !== "eligible").length
    return Math.round((processed / total) * 100)
  }, [allCustomers])

  // Streak (days with activity)
  const streak = useMemo(() => {
    const activityDays = new Set<string>()
    for (const c of allCustomers) {
      if (c.retargeting_enrolled_at) {
        activityDays.add(new Date(c.retargeting_enrolled_at).toDateString())
      }
    }
    let count = 0
    const today = new Date()
    for (let i = 0; i < 30; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      if (activityDays.has(d.toDateString())) {
        count++
      } else if (i > 0) break
    }
    return count
  }, [allCustomers])

  async function handleStartAll(segment: StageKey) {
    const result = await enrollSegment(segment)
    if (result) {
      setEnrollResults(prev => ({ ...prev, [segment]: result.enrolled }))
      setTimeout(() => setEnrollResults(prev => {
        const next = { ...prev }
        delete next[segment]
        return next
      }), 3000)
    }
  }

  const anyLoading = Object.values(customersLoading).some(Boolean)

  if (pipelineLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <CubeLoader />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-2 rounded-md flex items-center justify-between text-sm">
          {error}
          <button onClick={clearError}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Scoreboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-green-400">{stats.reengaged}</div>
            <div className="text-xs text-muted-foreground mt-1">Re-engaged</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-blue-400">{stats.responseRate}%</div>
            <div className="text-xs text-muted-foreground mt-1">Response Rate</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{stats.converted}</div>
            <div className="text-xs text-muted-foreground mt-1">Converted</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-4 pb-4 text-center">
            <div className="flex items-center justify-center gap-1">
              <Flame className={`h-5 w-5 ${streak > 0 ? "text-orange-400" : "text-zinc-600"}`} />
              <span className="text-3xl font-bold">{streak}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Day Streak</div>
          </CardContent>
        </Card>
      </div>

      {/* Main content: Feed + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Activity Feed (3/5) */}
        <div className="lg:col-span-3 space-y-1">
          <h2 className="text-lg font-semibold mb-3">Activity Feed</h2>

          {feed.length === 0 && !anyLoading && (
            <div className="text-center py-12 text-muted-foreground">
              No activity yet. Start a sequence to see updates here.
            </div>
          )}

          {anyLoading && feed.length === 0 && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          <div className="space-y-1">
            {feed.map(item => {
              const dotColor =
                item.type === "converted" ? "bg-green-500" :
                item.type === "completed" ? "bg-zinc-500" :
                item.type === "active" ? "bg-blue-500" :
                "bg-zinc-600"

              return (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3 rounded-lg hover:bg-zinc-900/50 transition-colors">
                  {/* Timeline dot */}
                  <div className="mt-1.5 flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{timeAgo(item.timestamp)}</span>
                      {item.type === "converted" && (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          <Trophy className="h-3 w-3 mr-1" />
                          Win
                        </Badge>
                      )}
                    </div>
                    <p className={`text-sm mt-0.5 ${
                      item.type === "converted" ? "text-green-400 font-medium" :
                      item.type === "completed" ? "text-zinc-500" :
                      ""
                    }`}>
                      {item.message}
                    </p>

                    {/* Inline action for completed items */}
                    {item.type === "completed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs mt-1 text-zinc-400"
                        onClick={() => enrollSegment(item.customer.stage, [item.customer.id])}
                        disabled={!!enrolling}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restart
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right sidebar (2/5) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Action Queue */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ready to Enroll</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {actionQueue.length === 0 && (
                <p className="text-sm text-muted-foreground">All caught up - no one to enroll.</p>
              )}
              {actionQueue.map(q => (
                <div key={q.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${q.color}`}>{q.count}</span>
                    <span className="text-sm">{q.label}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleStartAll(q.key)}
                    disabled={!!enrolling}
                  >
                    {enrolling === q.key ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : enrollResults[q.key] !== undefined ? (
                      <span className="text-green-400">+{enrollResults[q.key]}</span>
                    ) : (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        Start All
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Milestones */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {milestones.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {m.done ? (
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <div className="h-4 w-4 rounded border border-zinc-600 shrink-0" />
                  )}
                  <span className={m.done ? "text-zinc-300" : "text-zinc-500"}>{m.label}</span>
                </div>
              ))}

              {/* Progress ring */}
              <div className="flex items-center justify-center pt-4">
                <div className="relative w-24 h-24">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(39 39 42)" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="42"
                      fill="none"
                      stroke="rgb(34 197 94)"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${progressPct * 2.64} ${264 - progressPct * 2.64}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold">{progressPct}%</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">Pipeline processed</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
