"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Calendar,
  Clock,
  MapPin,
  ChevronRight,
  Loader2,
  CheckCircle,
  AlertCircle,
  Briefcase,
  History,
} from "lucide-react"

interface JobCard {
  id: number
  date: string
  scheduled_at: string | null
  address: string | null
  service_type: string | null
  status: string
  assignment_status: string
  assignment_id: string
  customer_first_name: string | null
  cleaner_omw_at: string | null
  cleaner_arrived_at: string | null
  payment_method: string | null
}

interface PortalData {
  cleaner: { id: number; name: string; phone: string; availability: any }
  tenant: { name: string; slug: string }
  todaysJobs: JobCard[]
  upcomingJobs: JobCard[]
  pendingJobs: JobCard[]
  pastJobs: JobCard[]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatTime(timeStr: string | null): string {
  if (!timeStr) return "TBD"
  try {
    const [h, m] = timeStr.split(":").map(Number)
    const ampm = h >= 12 ? "PM" : "AM"
    const hour12 = h % 12 || 12
    return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`
  } catch {
    return timeStr
  }
}

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getJobStatusDisplay(job: JobCard): { label: string; color: string } {
  if (job.assignment_status === "pending") return { label: "Needs Response", color: "bg-amber-100 text-amber-800" }
  if (job.status === "completed") return { label: "Done", color: "bg-green-100 text-green-800" }
  if (job.cleaner_arrived_at) return { label: "At Location", color: "bg-blue-100 text-blue-800" }
  if (job.cleaner_omw_at) return { label: "On My Way", color: "bg-indigo-100 text-indigo-800" }
  return { label: "Upcoming", color: "bg-slate-100 text-slate-700" }
}

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/crew/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("Invalid portal link")
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-slate-800">Invalid Link</h1>
          <p className="text-slate-500 mt-1">This portal link is not valid or has expired.</p>
        </div>
      </div>
    )
  }

  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 py-5">
        <p className="text-blue-200 text-sm">{tenant.name}</p>
        <h1 className="text-xl font-bold mt-0.5">Hey, {cleaner.name}!</h1>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-6">
        {/* Pending assignments (needs response) */}
        {pendingJobs.length > 0 && (
          <Section
            title="Needs Your Response"
            icon={<AlertCircle className="size-5 text-amber-500" />}
            count={pendingJobs.length}
          >
            {pendingJobs.map((job) => (
              <JobCardComponent key={job.id} job={job} token={token} />
            ))}
          </Section>
        )}

        {/* Today's Jobs */}
        <Section
          title="Today's Jobs"
          icon={<Briefcase className="size-5 text-blue-500" />}
          count={todaysJobs.length}
          emptyText="No jobs scheduled for today"
        >
          {todaysJobs.map((job) => (
            <JobCardComponent key={job.id} job={job} token={token} />
          ))}
        </Section>

        {/* Upcoming */}
        {upcomingJobs.length > 0 && (
          <Section
            title="Upcoming (Next 7 Days)"
            icon={<Calendar className="size-5 text-indigo-500" />}
            count={upcomingJobs.length}
          >
            {upcomingJobs.map((job) => (
              <JobCardComponent key={job.id} job={job} token={token} />
            ))}
          </Section>
        )}

        {/* Past Jobs */}
        {pastJobs.length > 0 && (
          <Section
            title="Completed"
            icon={<History className="size-5 text-slate-400" />}
            count={pastJobs.length}
          >
            {pastJobs.map((job) => (
              <JobCardComponent key={job.id} job={job} token={token} compact />
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  count,
  emptyText,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  emptyText?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="font-semibold text-slate-800">{title}</h2>
        <span className="text-sm text-slate-400 ml-auto">{count}</span>
      </div>
      {count === 0 && emptyText ? (
        <p className="text-sm text-slate-400 bg-white rounded-lg p-4 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function JobCardComponent({
  job,
  token,
  compact,
}: {
  job: JobCard
  token: string
  compact?: boolean
}) {
  const router = useRouter()
  const statusDisplay = getJobStatusDisplay(job)

  return (
    <button
      onClick={() => router.push(`/crew/${token}/job/${job.id}`)}
      className="w-full text-left bg-white rounded-lg border border-slate-200 p-3 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusDisplay.color}`}>
              {statusDisplay.label}
            </span>
            {job.service_type && (
              <span className="text-xs text-slate-400">{humanize(job.service_type)}</span>
            )}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-600">
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              {formatDate(job.date)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {formatTime(job.scheduled_at)}
            </span>
          </div>
          {!compact && job.address && (
            <p className="mt-1 text-sm text-slate-500 flex items-start gap-1 truncate">
              <MapPin className="size-3.5 mt-0.5 shrink-0" />
              <span className="truncate">{job.address}</span>
            </p>
          )}
          {job.customer_first_name && (
            <p className="mt-0.5 text-xs text-slate-400">
              Customer: {job.customer_first_name}
            </p>
          )}
        </div>
        <ChevronRight className="size-5 text-slate-300 shrink-0 mt-1" />
      </div>
    </button>
  )
}
