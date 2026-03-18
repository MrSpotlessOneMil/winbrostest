"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, Truck, UserCheck, Clock, MessageSquare } from "lucide-react"

interface RightNowData {
  activeJobs: number
  pendingAssignments: number
  todayScheduled: number
  newLeadsToday: number
}

export function RightNow() {
  const [data, setData] = useState<RightNowData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [jobsRes, leadsRes] = await Promise.all([
          fetch("/api/jobs?page=1&per_page=200&date=today", { cache: "no-store" }),
          fetch("/api/leads?page=1&per_page=100&range=today", { cache: "no-store" }),
        ])
        const [jobsJson, leadsJson] = await Promise.all([
          jobsRes.json(),
          leadsRes.json(),
        ])

        if (cancelled) return

        const jobs: Array<{ status?: string }> = jobsJson?.data || []
        const leads = leadsJson?.data || []

        const s = (j: { status?: string }) => String(j.status || "")
        const activeJobs = jobs.filter((j) =>
          s(j) === "in_progress" || s(j) === "in-progress"
        ).length
        const pendingAssignments = jobs.filter((j) =>
          s(j) === "scheduled" || s(j) === "confirmed"
        ).length
        const todayScheduled = jobs.filter((j) =>
          ["scheduled", "confirmed", "in_progress", "in-progress", "completed"].includes(s(j))
        ).length
        const newLeadsToday = Array.isArray(leads) ? leads.length : 0

        setData({ activeJobs, pendingAssignments, todayScheduled, newLeadsToday })
      } catch {
        // silent
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (!data) return null

  const indicators = [
    { icon: Truck, label: "In Progress", value: data.activeJobs, color: data.activeJobs > 0 ? "text-green-400" : "text-zinc-500", pulse: data.activeJobs > 0 },
    { icon: Clock, label: "Scheduled", value: data.todayScheduled, color: "text-blue-400", pulse: false },
    { icon: UserCheck, label: "Pending Assign", value: data.pendingAssignments, color: data.pendingAssignments > 0 ? "text-amber-400" : "text-zinc-500", pulse: data.pendingAssignments > 0 },
    { icon: MessageSquare, label: "New Leads", value: data.newLeadsToday, color: data.newLeadsToday > 0 ? "text-purple-400" : "text-zinc-500", pulse: false },
  ]

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-zinc-300">
          <Activity className="h-4 w-4 text-green-400" />
          Right Now
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {indicators.map((ind) => (
            <div key={ind.label} className="flex items-center gap-2.5">
              <div className="relative">
                <ind.icon className={`h-4 w-4 ${ind.color}`} />
                {ind.pulse && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                )}
              </div>
              <div>
                <p className={`text-lg font-bold ${ind.color}`}>{ind.value}</p>
                <p className="text-[10px] text-zinc-500 leading-tight">{ind.label}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
