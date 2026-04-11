"use client"

import { useRouter } from "next/navigation"
import {
  Calendar,
  Clock,
  MapPin,
  User,
  ChevronRight,
  LogOut,
  ClipboardList,
  Inbox,
  CheckCircle2,
  CalendarClock,
  PlusCircle,
  Sparkles,
} from "lucide-react"
import {
  DesignProps,
  JobCard,
  formatDate,
  formatTime,
  getJobStatusDisplay,
} from "../crew-types"

function getAccentColor(section: "pending" | "today" | "upcoming" | "completed"): string {
  switch (section) {
    case "pending": return "bg-amber-400"
    case "today": return "bg-blue-500"
    case "upcoming": return "bg-indigo-400"
    case "completed": return "bg-green-400"
  }
}

function getStatusPill(job: JobCard): { label: string; bg: string; text: string } {
  if (job.job_type === "estimate") return { label: "Estimate", bg: "bg-purple-50", text: "text-purple-600" }
  if (job.assignment_status === "pending") return { label: "Needs Response", bg: "bg-amber-50", text: "text-amber-600" }
  if (job.status === "completed") return { label: "Done", bg: "bg-emerald-50", text: "text-emerald-600" }
  if (job.cleaner_arrived_at) return { label: "At Location", bg: "bg-sky-50", text: "text-sky-600" }
  if (job.cleaner_omw_at) return { label: "On My Way", bg: "bg-violet-50", text: "text-violet-600" }
  return { label: "Upcoming", bg: "bg-slate-50", text: "text-slate-500" }
}

function SectionHeader({
  title,
  count,
  dotColor,
}: {
  title: string
  count: number
  dotColor: string
}) {
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <div className="flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full inline-block"
          style={{ backgroundColor: dotColor }}
        />
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      </div>
      <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
        {count}
      </span>
    </div>
  )
}

function JobCardItem({
  job,
  section,
  token,
  index,
}: {
  job: JobCard
  section: "pending" | "today" | "upcoming" | "completed"
  token: string
  index: number
}) {
  const router = useRouter()
  const status = getStatusPill(job)
  const accent = getAccentColor(section)

  return (
    <div
      onClick={() => {
        const isEstimate = job.job_type === "estimate"
        const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`
        router.push(href)
      }}
      className="group relative bg-white rounded-2xl shadow-sm hover:shadow-md cursor-pointer overflow-hidden transition-all duration-200"
      style={{
        animation: `auroraSlideUp 0.4s ease-out ${index * 0.06}s both`,
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.transform = "translateY(0)"
      }}
    >
      <div className="flex">
        {/* Left accent bar */}
        <div className={`w-1 ${accent} rounded-l-2xl flex-shrink-0`} />

        <div className="flex-1 p-4 pl-4">
          {/* Top row: status pill + arrow */}
          <div className="flex items-center justify-between mb-2.5">
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.bg} ${status.text}`}
            >
              {status.label}
            </span>
            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
          </div>

          {/* Date and time */}
          <div className="flex items-center gap-4 mb-1.5">
            <span className="flex items-center gap-1.5 text-sm text-slate-600">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {formatDate(job.date)}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-slate-500">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              {formatTime(job.scheduled_at)}
            </span>
          </div>

          {/* Address */}
          {job.address && (
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-sm text-slate-500 truncate">{job.address}</span>
            </div>
          )}

          {/* Customer name */}
          {job.customer_first_name && (
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-sm text-slate-600 font-medium">
                {job.customer_first_name}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 opacity-60">
      <Inbox className="w-10 h-10 text-slate-300 mb-3" />
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  )
}

export default function Design2({ data, token, onLogout }: DesignProps) {
  const router = useRouter()

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })

  const firstName = data.cleaner.name?.split(" ")[0] || "Crew"

  return (
    <>
      <style>{`
        @keyframes auroraSlideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <div
        className="min-h-screen font-sans"
        style={{ backgroundColor: "#fafafa", fontFamily: "Inter, sans-serif" }}
      >
        {/* ===== Hero Header ===== */}
        <div
          className="relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #9333ea 0%, #3b82f6 50%, #2dd4bf 100%)",
            borderRadius: "0 0 2rem 2rem",
            minHeight: "160px",
          }}
        >
          {/* Decorative circles */}
          <div
            className="absolute -top-10 -right-10 w-40 h-40 rounded-full opacity-10"
            style={{ backgroundColor: "white" }}
          />
          <div
            className="absolute bottom-4 -left-6 w-24 h-24 rounded-full opacity-10"
            style={{ backgroundColor: "white" }}
          />

          <div className="relative px-5 pt-6 pb-7">
            {/* Top bar: tenant + logout */}
            <div className="flex items-center justify-between mb-5">
              <span className="text-sm font-medium text-white/70">
                {data.tenant.name}
              </span>
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 text-xs font-medium text-white/80 bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-full hover:bg-white/30 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
            </div>

            {/* Greeting */}
            <h1 className="text-2xl font-bold text-white mb-1">
              Hey, {firstName}!
            </h1>
            <p className="text-sm text-white/70">{today}</p>
          </div>
        </div>

        {/* ===== Content ===== */}
        <div className="px-4 -mt-4 pb-8 space-y-6">
          {/* New Quote CTA — salesmen only */}
          {data.cleaner.employee_type === "salesman" && (
          <button
            onClick={() => router.push(`/crew/${token}/new-quote`)}
            className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3.5 rounded-2xl shadow-lg hover:shadow-xl active:scale-[0.98] transition-all duration-200"
            style={{
              background: "linear-gradient(135deg, #9333ea 0%, #3b82f6 50%, #2dd4bf 100%)",
            }}
          >
            <PlusCircle className="w-4.5 h-4.5" />
            New Quote
          </button>
          )}

          {/* ===== Pending / Needs Response ===== */}
          {data.pendingJobs.length > 0 && (
            <section>
              <SectionHeader title="Needs Response" count={data.pendingJobs.length} dotColor="#f59e0b" />
              <div className="space-y-3">
                {data.pendingJobs.map((job, i) => (
                  <JobCardItem key={job.id} job={job} section="pending" token={token} index={i} />
                ))}
              </div>
            </section>
          )}

          {/* ===== Today's Jobs ===== */}
          <section>
            <SectionHeader title="Today" count={data.todaysJobs.length} dotColor="#3b82f6" />
            {data.todaysJobs.length > 0 ? (
              <div className="space-y-3">
                {data.todaysJobs.map((job, i) => (
                  <JobCardItem key={job.id} job={job} section="today" token={token} index={i} />
                ))}
              </div>
            ) : (
              <EmptyState message="No jobs scheduled for today" />
            )}
          </section>

          {/* ===== Upcoming ===== */}
          <section>
            <SectionHeader title="Upcoming" count={data.upcomingJobs.length} dotColor="#818cf8" />
            {data.upcomingJobs.length > 0 ? (
              <div className="space-y-3">
                {data.upcomingJobs.map((job, i) => (
                  <JobCardItem key={job.id} job={job} section="upcoming" token={token} index={i} />
                ))}
              </div>
            ) : (
              <EmptyState message="No upcoming jobs" />
            )}
          </section>

          {/* ===== Completed ===== */}
          {data.pastJobs.length > 0 && (
            <section>
              <SectionHeader title="Completed" count={data.pastJobs.length} dotColor="#4ade80" />
              <div className="space-y-3">
                {data.pastJobs.map((job, i) => (
                  <JobCardItem key={job.id} job={job} section="completed" token={token} index={i} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
