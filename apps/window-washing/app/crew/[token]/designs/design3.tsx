"use client"

import { useRouter } from "next/navigation"
import { Clock, MapPin } from "lucide-react"
import {
  type DesignProps,
  type JobCard,
  formatDate,
  formatTime,
  humanize,
  getJobStatusDisplay,
} from "../crew-types"

export default function Design3({ data, token, onLogout }: DesignProps) {
  const router = useRouter()
  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  return (
    <div className="min-h-screen bg-white font-[Inter,system-ui,sans-serif]">
      {/* Signature gradient line */}
      <div className="h-[2px] w-full bg-gradient-to-r from-indigo-500 to-purple-500" />

      {/* Header */}
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {tenant.name}
            </p>
            <h1 className="text-3xl font-light text-slate-900 mt-2">
              {cleaner.name}
            </h1>
            <p className="text-sm text-slate-400 mt-1">{today}</p>
          </div>
          <button
            onClick={onLogout}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors duration-150 mt-1"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6">
        {/* New Quote CTA -- salesmen only */}
        {cleaner.employee_type === "salesman" && (
          <div className="py-8">
            <button
              onClick={() => router.push(`/crew/${token}/new-quote`)}
              className="w-full border border-slate-200 rounded-lg py-3 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150"
            >
              New Quote
            </button>
          </div>
        )}

        {/* Needs Response */}
        {pendingJobs.length > 0 && (
          <MonoSection title="Needs Response" count={pendingJobs.length}>
            {pendingJobs.map((job) => (
              <PendingJobRow key={job.id} job={job} token={token} />
            ))}
          </MonoSection>
        )}

        {/* Today */}
        <MonoSection
          title="Today"
          count={todaysJobs.length}
          emptyText="Nothing scheduled"
        >
          {todaysJobs.map((job) => (
            <JobRow key={job.id} job={job} token={token} />
          ))}
        </MonoSection>

        {/* Upcoming */}
        {upcomingJobs.length > 0 && (
          <MonoSection title="Upcoming" count={upcomingJobs.length}>
            {upcomingJobs.map((job) => (
              <JobRow key={job.id} job={job} token={token} />
            ))}
          </MonoSection>
        )}

        {/* Completed */}
        {pastJobs.length > 0 && (
          <MonoSection title="Completed" count={pastJobs.length}>
            {pastJobs.map((job) => (
              <JobRow key={job.id} job={job} token={token} />
            ))}
          </MonoSection>
        )}
      </div>
    </div>
  )
}

function MonoSection({
  title,
  count,
  emptyText,
  children,
}: {
  title: string
  count: number
  emptyText?: string
  children: React.ReactNode
}) {
  return (
    <div className="py-8">
      <div className="flex items-baseline justify-between border-b border-slate-100 pb-2 mb-0">
        <span className="text-xs font-medium uppercase tracking-[0.15em] text-slate-400">
          {title}
        </span>
        <span className="text-xs text-slate-300">{count}</span>
      </div>
      {count === 0 && emptyText ? (
        <p className="text-sm text-slate-300 text-center py-12">{emptyText}</p>
      ) : (
        <div>{children}</div>
      )}
    </div>
  )
}

function JobRow({ job, token }: { job: JobCard; token: string }) {
  const router = useRouter()
  const status = getJobStatusDisplay(job)
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate
    ? `/crew/${token}/estimate/${job.id}`
    : `/crew/${token}/job/${job.id}`

  return (
    <button
      onClick={() => router.push(href)}
      className="w-full text-left group border-b border-slate-100 py-3.5 flex items-center gap-3 hover:bg-slate-50 transition-colors duration-150 px-1 -mx-1"
    >
      {/* Status dot */}
      <span
        className="size-1.5 rounded-full shrink-0"
        style={{ backgroundColor: status.dotColor }}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="font-medium text-slate-800">
            {job.service_type ? humanize(job.service_type) : status.label}
          </span>
          <span className="text-sm text-slate-500">{formatDate(job.date)}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-sm text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatTime(job.scheduled_at)}
          </span>
          {job.address && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.address}</span>
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <span className="text-slate-300 shrink-0 text-sm">&rarr;</span>
    </button>
  )
}

function PendingJobRow({ job, token }: { job: JobCard; token: string }) {
  const router = useRouter()
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate
    ? `/crew/${token}/estimate/${job.id}`
    : `/crew/${token}/job/${job.id}`

  return (
    <button
      onClick={() => router.push(href)}
      className="w-full text-left group border-b border-slate-100 border-l-2 border-l-amber-400 py-3.5 pl-3 pr-1 flex items-center gap-3 hover:bg-slate-50 transition-colors duration-150"
    >
      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="font-medium text-slate-800">
            {job.service_type ? humanize(job.service_type) : "Job"}
          </span>
          <span className="text-sm text-slate-500">{formatDate(job.date)}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-sm text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatTime(job.scheduled_at)}
          </span>
          {job.address && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{job.address}</span>
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <span className="text-slate-300 shrink-0 text-sm">&rarr;</span>
    </button>
  )
}
