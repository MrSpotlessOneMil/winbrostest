"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Truck, UserCheck, Clock, MessageSquare, Phone, Navigation, ChevronDown, ChevronUp } from "lucide-react"

interface JobRow {
  id: string
  status?: string
  customer_name?: string
  customer_phone?: string
  address?: string
  scheduled_date?: string
  scheduled_time?: string
  estimated_value?: number
  cleaner_name?: string
}

interface LeadRow {
  id: string
  name?: string
  phone?: string
  source?: string
  status?: string
  created_at?: string
}

type ExpandedSection = "in_progress" | "scheduled" | "pending" | "leads" | null

export function RightNow() {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [expanded, setExpanded] = useState<ExpandedSection>(null)

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
        setJobs(jobsJson?.data || [])
        setLeads(Array.isArray(leadsJson?.data) ? leadsJson.data : [])
      } catch {
        // silent
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const s = (j: JobRow) => String(j.status || "")
  const inProgress = jobs.filter((j) => s(j) === "in_progress" || s(j) === "in-progress")
  const scheduled = jobs.filter((j) => ["scheduled", "confirmed", "in_progress", "in-progress", "completed"].includes(s(j)))
  const pending = jobs.filter((j) => s(j) === "scheduled" || s(j) === "confirmed")

  const indicators: { key: ExpandedSection; icon: typeof Truck; label: string; value: number; color: string; pulse: boolean }[] = [
    { key: "in_progress", icon: Truck, label: "In Progress", value: inProgress.length, color: inProgress.length > 0 ? "text-green-400" : "text-zinc-500", pulse: inProgress.length > 0 },
    { key: "scheduled", icon: Clock, label: "Scheduled", value: scheduled.length, color: "text-blue-400", pulse: false },
    { key: "pending", icon: UserCheck, label: "Pending Assign", value: pending.length, color: pending.length > 0 ? "text-amber-400" : "text-zinc-500", pulse: pending.length > 0 },
    { key: "leads", icon: MessageSquare, label: "New Leads", value: leads.length, color: leads.length > 0 ? "text-purple-400" : "text-zinc-500", pulse: false },
  ]

  function toggle(key: ExpandedSection) {
    setExpanded(expanded === key ? null : key)
  }

  const expandedJobs: JobRow[] =
    expanded === "in_progress" ? inProgress :
    expanded === "scheduled" ? scheduled :
    expanded === "pending" ? pending : []

  const expandedLeads: LeadRow[] = expanded === "leads" ? leads : []

  function formatTime(j: JobRow) {
    if (!j.scheduled_time) return ""
    try {
      const [h, m] = j.scheduled_time.split(":")
      const hour = parseInt(h)
      const ampm = hour >= 12 ? "PM" : "AM"
      return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${ampm}`
    } catch { return j.scheduled_time }
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-zinc-300">
          <Activity className="h-4 w-4 text-green-400" />
          Right Now
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {indicators.map((ind) => (
            <button
              key={ind.label}
              onClick={() => ind.value > 0 ? toggle(ind.key) : undefined}
              className={`flex items-center gap-2.5 text-left rounded-lg px-2 py-1.5 transition-colors ${
                ind.value > 0 ? "hover:bg-zinc-800/60 cursor-pointer" : "cursor-default"
              } ${expanded === ind.key ? "bg-zinc-800/60" : ""}`}
            >
              <div className="relative">
                <ind.icon className={`h-4 w-4 ${ind.color}`} />
                {ind.pulse && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-lg font-bold ${ind.color}`}>{ind.value}</p>
                <p className="text-[10px] text-zinc-500 leading-tight">{ind.label}</p>
              </div>
              {ind.value > 0 && (
                expanded === ind.key
                  ? <ChevronUp className="h-3 w-3 text-zinc-500" />
                  : <ChevronDown className="h-3 w-3 text-zinc-500" />
              )}
            </button>
          ))}
        </div>

        {/* Expanded job list */}
        {expandedJobs.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-2 animate-fade-in">
            {expandedJobs.map((job) => (
              <div key={job.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200 truncate">{job.customer_name || "Unknown"}</span>
                    {job.cleaner_name && (
                      <Badge variant="outline" className="text-[10px] shrink-0">{job.cleaner_name}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {job.scheduled_time && (
                      <span className="text-xs text-zinc-500">{formatTime(job)}</span>
                    )}
                    {job.address && (
                      <span className="text-xs text-zinc-500 truncate">{job.address}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {job.estimated_value ? (
                    <span className="text-xs font-medium text-green-400">${Number(job.estimated_value).toLocaleString()}</span>
                  ) : null}
                  {job.customer_phone && (
                    <a
                      href={`tel:${job.customer_phone}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                      title="Call customer"
                    >
                      <Phone className="h-3 w-3" />
                    </a>
                  )}
                  {job.address && (
                    <a
                      href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                      title="Navigate"
                    >
                      <Navigation className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Expanded leads list */}
        {expandedLeads.length > 0 && (
          <div className="border-t border-zinc-800 pt-3 space-y-2 animate-fade-in">
            {expandedLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200 truncate">{lead.name || "Unknown"}</span>
                    {lead.source && (
                      <Badge variant="outline" className="text-[10px] shrink-0">{lead.source}</Badge>
                    )}
                  </div>
                  {lead.status && (
                    <span className="text-xs text-zinc-500">{lead.status}</span>
                  )}
                </div>
                {lead.phone && (
                  <a
                    href={`tel:${lead.phone}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors shrink-0"
                    title="Call lead"
                  >
                    <Phone className="h-3 w-3" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
