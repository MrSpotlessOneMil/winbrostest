"use client"

import { useRouter } from "next/navigation"
import { Clock, MapPin, Sun, Moon, Sunset, Coffee, User, DollarSign } from "lucide-react"
import {
  type DesignProps,
  type JobCard,
  formatDate,
  formatTime,
  humanize,
} from "../crew-types"

function getGreeting(): { text: string; icon: React.ReactNode } {
  const hour = new Date().getHours()
  if (hour < 12) return { text: "Good morning", icon: <Sun className="size-5 text-amber-300" /> }
  if (hour < 17) return { text: "Good afternoon", icon: <Sunset className="size-5 text-orange-300" /> }
  return { text: "Good evening", icon: <Moon className="size-5 text-amber-200" /> }
}

function getWarmStatus(job: JobCard): { label: string; color: string; dotColor: string } {
  if (job.job_type === "estimate")
    return { label: "Estimate", color: "bg-purple-50 text-purple-700", dotColor: "#9333ea" }
  if (job.assignment_status === "pending")
    return { label: "Needs Response", color: "bg-amber-50 text-amber-700", dotColor: "#d97706" }
  if (job.status === "completed")
    return { label: "Done", color: "bg-emerald-50 text-emerald-700", dotColor: "#059669" }
  if (job.cleaner_arrived_at)
    return { label: "At Location", color: "bg-sky-50 text-sky-700", dotColor: "#0284c7" }
  if (job.cleaner_omw_at)
    return { label: "On My Way", color: "bg-violet-50 text-violet-700", dotColor: "#7c3aed" }
  return { label: "Upcoming", color: "bg-stone-100 text-stone-600", dotColor: "#a8a29e" }
}

export default function Design5({ data, token, onLogout }: DesignProps) {
  const router = useRouter()
  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data
  const greeting = getGreeting()

  return (
    <div
      className="min-h-screen font-[Inter,system-ui,sans-serif]"
      style={{ backgroundColor: "#faf8f5" }}
    >
      {/* Header — warm gradient */}
      <div
        className="rounded-b-3xl px-6 pt-10 pb-8"
        style={{
          background: "linear-gradient(135deg, rgba(146,64,14,0.9) 0%, rgba(124,45,18,0.8) 100%)",
        }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-white/60 tracking-wide">{tenant.name}</p>
              <div className="flex items-center gap-2.5 mt-3">
                {greeting.icon}
                <h1 className="text-2xl font-semibold text-white">
                  {greeting.text}, {cleaner.name.split(" ")[0]}
                </h1>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="text-xs text-white/40 hover:text-white/70 transition-colors duration-200 px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 mt-1"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 pt-6 pb-12">
        {/* New Quote CTA — salesmen only */}
        {cleaner.employee_type === "salesman" && (
          <div className="pt-2 pb-6">
            <button
              onClick={() => router.push(`/crew/${token}/new-quote`)}
              className="w-full py-3.5 rounded-2xl text-sm font-medium text-white transition-all duration-200 hover:shadow-lg"
              style={{
                background: "linear-gradient(to right, #b45309, #c2410c)",
                boxShadow: "0 4px 14px rgba(180,83,9,0.25)",
              }}
            >
              New Quote
            </button>
          </div>
        )}

        {/* Needs Response */}
        {pendingJobs.length > 0 && (
          <WarmSection title="Needs Response" count={pendingJobs.length}>
            {pendingJobs.map((job) => (
              <WarmJobCard key={job.id} job={job} token={token} pending />
            ))}
          </WarmSection>
        )}

        {/* Today */}
        <WarmSection
          title="Today"
          count={todaysJobs.length}
          emptyText="Enjoy your day off"
          emptyIcon={<Coffee className="size-8 text-stone-300 mx-auto mb-3" />}
        >
          {todaysJobs.map((job) => (
            <WarmJobCard key={job.id} job={job} token={token} />
          ))}
        </WarmSection>

        {/* Upcoming */}
        {upcomingJobs.length > 0 && (
          <WarmSection title="Upcoming" count={upcomingJobs.length}>
            {upcomingJobs.map((job) => (
              <WarmJobCard key={job.id} job={job} token={token} />
            ))}
          </WarmSection>
        )}

        {/* Completed */}
        {pastJobs.length > 0 && (
          <WarmSection title="Completed" count={pastJobs.length}>
            {pastJobs.map((job) => (
              <WarmJobCard key={job.id} job={job} token={token} />
            ))}
          </WarmSection>
        )}
      </div>
    </div>
  )
}

function WarmSection({
  title,
  count,
  emptyText,
  emptyIcon,
  children,
}: {
  title: string
  count: number
  emptyText?: string
  emptyIcon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="py-5">
      <div className="mb-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-amber-900">{title}</h2>
          <span className="text-xs text-stone-400">{count}</span>
        </div>
        <div className="w-8 h-1 rounded-full bg-amber-700/30 mt-1.5" />
      </div>

      {count === 0 && emptyText ? (
        <div className="text-center py-14">
          {emptyIcon}
          <p className="text-sm text-stone-400">{emptyText}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">{children}</div>
      )}
    </div>
  )
}

function WarmJobCard({
  job,
  token,
  pending,
}: {
  job: JobCard
  token: string
  pending?: boolean
}) {
  const router = useRouter()
  const status = getWarmStatus(job)
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate
    ? `/crew/${token}/estimate/${job.id}`
    : `/crew/${token}/job/${job.id}`

  const initial = job.customer_first_name
    ? job.customer_first_name.charAt(0).toUpperCase()
    : "?"

  return (
    <button
      onClick={() => router.push(href)}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 group ${
        pending ? "border-l-[3px] border-l-amber-200 border-orange-100/50" : "border-orange-100/50"
      }`}
      style={{
        backgroundColor: "#ffffff",
        boxShadow: "0 2px 15px rgba(120,53,15,0.06)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 20px rgba(120,53,15,0.12)"
        e.currentTarget.style.backgroundColor = "rgba(255,247,237,0.3)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 15px rgba(120,53,15,0.06)"
        e.currentTarget.style.backgroundColor = "#ffffff"
      }}
    >
      <div className="flex items-start gap-3">
        {/* Customer avatar */}
        <div className="size-9 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5">
          {initial}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-stone-800">
                {job.service_type ? humanize(job.service_type) : status.label}
              </p>
              {job.customer_first_name && (
                <p className="text-xs text-stone-400 mt-0.5">{job.customer_first_name}</p>
              )}
            </div>

            {/* Status indicator — small rounded square */}
            <div
              className="size-2 rounded-sm shrink-0 mt-1.5"
              style={{ backgroundColor: status.dotColor }}
              title={status.label}
            />
          </div>

          {/* Date / time */}
          <div className="flex items-center gap-3 mt-2 text-sm text-stone-500">
            <span className="flex items-center gap-1">
              <Clock className="size-3.5 text-stone-400" />
              {formatDate(job.date)}
            </span>
            <span className="text-stone-300">·</span>
            <span>{formatTime(job.scheduled_at)}</span>
          </div>

          {/* Address */}
          {job.address && (
            <div className="flex items-center gap-1.5 mt-1.5 text-sm text-stone-400">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{job.address}</span>
            </div>
          )}

          {/* Pay pill */}
          {job.payment_method && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">
                <DollarSign className="size-3" />
                {humanize(job.payment_method)}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
