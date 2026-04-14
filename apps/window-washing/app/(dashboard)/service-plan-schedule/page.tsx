"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, ChevronLeft, ChevronRight, Loader2, GripVertical, CalendarPlus, Check, X } from "lucide-react"

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

interface PlanJob {
  id: number
  customer_name: string
  address: string
  plan_type: string
  target_week: number
  status: string
}

export default function ServicePlanSchedulePage() {
  const { user } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [jobsByMonth, setJobsByMonth] = useState<Record<number, PlanJob[]>>({})
  const [schedulingId, setSchedulingId] = useState<number | null>(null)
  const [scheduleDate, setScheduleDate] = useState("")
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [scheduleMsg, setScheduleMsg] = useState<{ id: number; text: string; ok: boolean } | null>(null)

  useEffect(() => {
    async function loadJobs() {
      setLoading(true)
      try {
        const res = await fetch(`/api/actions/service-plan-jobs?year=${year}`)
        if (res.ok) {
          setJobsByMonth(await res.json())
        }
      } catch {
        setJobsByMonth({})
      }
      setLoading(false)
    }
    loadJobs()
  }, [year])

  async function reloadJobs() {
    try {
      const res = await fetch(`/api/actions/service-plan-jobs?year=${year}`)
      if (res.ok) {
        setJobsByMonth(await res.json())
      }
    } catch {
      // silent
    }
  }

  async function handleSchedule(jobId: number) {
    if (!scheduleDate) return
    setSubmittingId(jobId)
    setScheduleMsg(null)
    try {
      const res = await fetch("/api/actions/service-plan-jobs/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planJobId: jobId, targetDate: scheduleDate }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to schedule")
      }
      setScheduleMsg({ id: jobId, text: `Scheduled! Job #${data.job_id}`, ok: true })
      setSchedulingId(null)
      setScheduleDate("")
      setTimeout(() => setScheduleMsg(null), 3000)
      reloadJobs()
    } catch (err: unknown) {
      setScheduleMsg({
        id: jobId,
        text: err instanceof Error ? err.message : "Schedule failed",
        ok: false,
      })
      setTimeout(() => setScheduleMsg(null), 4000)
    } finally {
      setSubmittingId(null)
    }
  }

  const totalUnscheduled = Object.values(jobsByMonth).reduce(
    (sum, jobs) => sum + jobs.filter(j => j.status === "unscheduled").length, 0
  )

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Service Plan Scheduling
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            {totalUnscheduled} unscheduled jobs from service plans
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setYear(y => y - 1)} className="cursor-pointer">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-lg font-semibold text-white">{year}</span>
          <Button variant="ghost" size="sm" onClick={() => setYear(y => y + 1)} className="cursor-pointer">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MONTH_NAMES.map((name, i) => {
            const month = i + 1
            const jobs = jobsByMonth[month] || []
            const unscheduled = jobs.filter(j => j.status === "unscheduled")
            const scheduled = jobs.filter(j => j.status === "scheduled")

            return (
              <div key={month} className="border border-zinc-800 rounded-lg bg-zinc-950">
                <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{name}</span>
                  <div className="flex gap-1.5">
                    {unscheduled.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] bg-amber-900/30 text-amber-400">
                        {unscheduled.length} unscheduled
                      </Badge>
                    )}
                    {scheduled.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] bg-green-900/30 text-green-400">
                        {scheduled.length} scheduled
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="p-3 space-y-1.5 min-h-[80px]">
                  {jobs.length === 0 && (
                    <p className="text-xs text-zinc-600 text-center py-4">No plan jobs</p>
                  )}
                  {jobs.map(job => (
                    <div key={job.id} className="space-y-1">
                      <div
                        className={`flex items-center gap-2 p-2 rounded text-xs
                          ${job.status === "unscheduled"
                            ? "bg-amber-900/10 border border-amber-900/20"
                            : "bg-green-900/10 border border-green-900/20"
                          }`}
                      >
                        <GripVertical className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-white truncate">{job.customer_name}</div>
                          <div className="text-zinc-500 truncate">{job.address}</div>
                        </div>
                        <Badge variant="outline" className="text-[10px] border-zinc-700 flex-shrink-0">
                          Wk {job.target_week}
                        </Badge>
                        {job.status === "unscheduled" && schedulingId !== job.id && (
                          <button
                            onClick={() => {
                              setSchedulingId(job.id)
                              // Default to target week's Monday in this month
                              const targetDay = ((job.target_week - 1) * 7) + 1
                              const d = new Date(year, month - 1, Math.min(targetDay, 28))
                              setScheduleDate(d.toISOString().split("T")[0])
                            }}
                            className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-0.5 flex-shrink-0"
                            title="Schedule this job"
                          >
                            <CalendarPlus className="w-3 h-3" />
                            Schedule
                          </button>
                        )}
                        {job.status === "scheduled" && (
                          <span className="text-[10px] text-green-400 flex items-center gap-0.5 flex-shrink-0">
                            <Check className="w-3 h-3" />
                            Scheduled
                          </span>
                        )}
                      </div>

                      {/* Inline date picker */}
                      {schedulingId === job.id && (
                        <div className="flex items-center gap-1.5 pl-5">
                          <input
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zinc-500"
                          />
                          <button
                            onClick={() => handleSchedule(job.id)}
                            disabled={submittingId === job.id || !scheduleDate}
                            className="p-1 rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
                            title="Confirm schedule"
                          >
                            {submittingId === job.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                          </button>
                          <button
                            onClick={() => { setSchedulingId(null); setScheduleDate("") }}
                            className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 text-white"
                            title="Cancel"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Status message */}
                      {scheduleMsg?.id === job.id && (
                        <p className={`text-[10px] pl-5 ${scheduleMsg.ok ? "text-green-400" : "text-red-400"}`}>
                          {scheduleMsg.text}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
