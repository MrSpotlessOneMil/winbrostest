"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/lib/auth-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar, ChevronLeft, ChevronRight, Loader2, GripVertical } from "lucide-react"

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
                    <div
                      key={job.id}
                      className={`flex items-center gap-2 p-2 rounded text-xs cursor-grab
                        ${job.status === "unscheduled"
                          ? "bg-amber-900/10 border border-amber-900/20"
                          : "bg-zinc-900 border border-zinc-800"
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
