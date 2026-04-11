"use client"

import { useRouter } from "next/navigation"
import {
  Calendar,
  Clock,
  MapPin,
  ChevronRight,
  PlusCircle,
  LogOut,
  Sparkles,
  Briefcase,
} from "lucide-react"
import {
  DesignProps,
  JobCard,
  formatDate,
  formatTime,
  humanize,
  getJobStatusDisplay,
} from "../crew-types"

/* ─── Status glow mapping (glass-style) ─── */
function getGlassStatus(job: JobCard) {
  const base = getJobStatusDisplay(job)
  const glowMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
    Estimate: {
      bg: "rgba(168,85,247,0.12)",
      border: "rgba(168,85,247,0.3)",
      text: "#c084fc",
      glow: "0 0 8px rgba(168,85,247,0.4)",
    },
    "Needs Response": {
      bg: "rgba(245,158,11,0.12)",
      border: "rgba(245,158,11,0.3)",
      text: "#fbbf24",
      glow: "0 0 8px rgba(245,158,11,0.4)",
    },
    Done: {
      bg: "rgba(34,197,94,0.12)",
      border: "rgba(34,197,94,0.3)",
      text: "#4ade80",
      glow: "0 0 8px rgba(34,197,94,0.4)",
    },
    "At Location": {
      bg: "rgba(59,130,246,0.12)",
      border: "rgba(59,130,246,0.3)",
      text: "#60a5fa",
      glow: "0 0 8px rgba(59,130,246,0.4)",
    },
    "On My Way": {
      bg: "rgba(99,102,241,0.12)",
      border: "rgba(99,102,241,0.3)",
      text: "#818cf8",
      glow: "0 0 8px rgba(99,102,241,0.4)",
    },
    Upcoming: {
      bg: "rgba(148,163,184,0.1)",
      border: "rgba(148,163,184,0.2)",
      text: "#94a3b8",
      glow: "none",
    },
  }
  const style = glowMap[base.label] || glowMap["Upcoming"]
  return { ...base, ...style }
}

/* ─── Glass Job Card ─── */
function GlassJobCard({
  job,
  token,
  isPending,
  staggerClass,
}: {
  job: JobCard
  token: string
  isPending?: boolean
  staggerClass?: string
}) {
  const router = useRouter()
  const status = getGlassStatus(job)
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`

  return (
    <button
      onClick={() => router.push(href)}
      className={`group w-full text-left rounded-2xl p-[1px] transition-all duration-300 hover:scale-[1.01] ${staggerClass || ""}`}
      style={{
        background: isPending
          ? "linear-gradient(135deg, rgba(245,158,11,0.3), rgba(245,158,11,0.08))"
          : "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
      }}
    >
      <div
        className="relative rounded-2xl p-4 backdrop-blur-xl overflow-hidden transition-all duration-300"
        style={{
          background: "rgba(255,255,255,0.03)",
          borderLeft: "none",
        }}
      >
        {/* Vertical accent bar */}
        <div
          className="absolute left-0 top-3 bottom-3 w-[2px] rounded-full"
          style={{
            background: "linear-gradient(180deg, #8b5cf6, #06b6d4)",
          }}
        />

        <div className="flex items-center gap-3 ml-3">
          {/* Left content */}
          <div className="flex-1 min-w-0">
            {/* Status badge */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: status.dotColor,
                    boxShadow: status.glow,
                  }}
                />
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: status.bg,
                    color: status.text,
                    border: `1px solid ${status.border}`,
                  }}
                >
                  {status.label}
                </span>
              </div>
              {job.service_type && (
                <span className="text-xs text-white/30">{humanize(job.service_type)}</span>
              )}
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-white/60">
                <Calendar className="size-3.5 text-white/30" />
                {formatDate(job.date)}
              </span>
              <span className="flex items-center gap-1.5 text-white/60">
                <Clock className="size-3.5 text-white/30" />
                {formatTime(job.scheduled_at)}
              </span>
            </div>

            {/* Address */}
            {job.address && (
              <p className="mt-1.5 text-sm text-white/40 flex items-start gap-1.5 truncate">
                <MapPin className="size-3.5 mt-0.5 shrink-0 text-white/25" />
                <span className="truncate">{job.address}</span>
              </p>
            )}

            {/* Customer */}
            {job.customer_first_name && (
              <p className="mt-1 text-xs text-white/25">
                {job.customer_first_name}
              </p>
            )}

            {/* Pay (for completed jobs) */}
            {job.status === "completed" && job.payment_method && (
              <p
                className="mt-1 text-xs font-semibold"
                style={{
                  background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Paid via {humanize(job.payment_method)}
              </p>
            )}
          </div>

          {/* Right arrow */}
          <ChevronRight className="size-5 text-white/15 group-hover:text-white/30 transition-colors shrink-0" />
        </div>
      </div>
    </button>
  )
}

/* ─── Section Component ─── */
function GlassSection({
  title,
  count,
  emptyText,
  children,
  staggerClass,
}: {
  title: string
  count: number
  emptyText?: string
  children: React.ReactNode
  staggerClass?: string
}) {
  return (
    <div className={staggerClass || ""}>
      {/* Section header */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/40">
            {title}
          </h2>
          <span className="text-xs text-white/20">{count}</span>
        </div>
        <div
          className="h-[1px] w-full"
          style={{
            background: "linear-gradient(90deg, rgba(139,92,246,0.3), rgba(6,182,212,0.15), transparent)",
          }}
        />
      </div>

      {/* Content */}
      {count === 0 && emptyText ? (
        <div
          className="rounded-2xl p-8 text-center backdrop-blur-xl"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <Sparkles className="size-8 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-white/25">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

/* ─── Main Design Component ─── */
export default function Design1({ data, token, onLogout }: DesignProps) {
  const router = useRouter()
  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data

  let staggerIndex = 1
  const nextStagger = () => {
    const cls = `stagger-${Math.min(staggerIndex, 9)}`
    staggerIndex++
    return cls
  }

  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: "#0a0a0f" }}>
      {/* ─── Ambient gradient orbs ─── */}
      <div
        className="fixed pointer-events-none"
        style={{
          width: "500px",
          height: "500px",
          borderRadius: "50%",
          background: "rgba(139,92,246,0.15)",
          filter: "blur(120px)",
          top: "-10%",
          right: "-15%",
          zIndex: 0,
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          width: "400px",
          height: "400px",
          borderRadius: "50%",
          background: "rgba(6,182,212,0.1)",
          filter: "blur(100px)",
          bottom: "5%",
          left: "-10%",
          zIndex: 0,
        }}
      />
      <div
        className="fixed pointer-events-none"
        style={{
          width: "300px",
          height: "300px",
          borderRadius: "50%",
          background: "rgba(139,92,246,0.08)",
          filter: "blur(80px)",
          top: "50%",
          left: "30%",
          zIndex: 0,
        }}
      />

      {/* ─── Scrollable content ─── */}
      <div className="relative z-10 min-h-screen overflow-y-auto">
        <div className="max-w-lg mx-auto px-5 pb-12">
          {/* ─── Header ─── */}
          <div className={`pt-8 pb-6 ${nextStagger()}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.15em] text-white/30 mb-1">
                  {tenant.name}
                </p>
                <p className="text-sm text-white/40 mb-1">Welcome back</p>
                <h1
                  className="text-3xl font-bold"
                  style={{
                    background: "linear-gradient(135deg, #ffffff 0%, #a78bfa 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {cleaner.name}
                </h1>
              </div>

              {/* Logout pill */}
              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white/40 hover:text-white/70 transition-all duration-200 backdrop-blur-xl mt-2"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <LogOut className="size-3" />
                Log out
              </button>
            </div>
          </div>

          <div className="space-y-8">
            {/* ─── New Quote CTA (salesmen) ─── */}
            {cleaner.employee_type === "salesman" && (
              <div className={nextStagger()}>
                <button
                  onClick={() => router.push(`/crew/${token}/new-quote`)}
                  className="group relative w-full rounded-2xl p-[1px] transition-all duration-300 hover:scale-[1.01]"
                  style={{
                    background: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
                  }}
                >
                  {/* Glow pulse behind */}
                  <div
                    className="absolute -inset-1 rounded-2xl opacity-40 animate-pulse"
                    style={{
                      background: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
                      filter: "blur(16px)",
                      zIndex: -1,
                    }}
                  />
                  <div
                    className="relative rounded-2xl p-4 flex items-center gap-3 backdrop-blur-xl"
                    style={{ background: "rgba(10,10,15,0.85)" }}
                  >
                    <div
                      className="size-11 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(6,182,212,0.2))",
                        border: "1px solid rgba(139,92,246,0.2)",
                      }}
                    >
                      <PlusCircle className="size-5 text-purple-400" />
                    </div>
                    <div className="text-left flex-1">
                      <h3
                        className="font-bold text-base"
                        style={{
                          background: "linear-gradient(90deg, #c4b5fd, #67e8f9)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                        }}
                      >
                        New Quote
                      </h3>
                      <p className="text-white/30 text-xs">Create a quote for a new customer</p>
                    </div>
                    <ChevronRight className="size-5 text-white/20 group-hover:text-white/40 transition-colors" />
                  </div>
                </button>
              </div>
            )}

            {/* ─── Pending Jobs ─── */}
            {pendingJobs.length > 0 && (
              <GlassSection
                title="Needs Your Response"
                count={pendingJobs.length}
                staggerClass={nextStagger()}
              >
                {pendingJobs.map((job, i) => (
                  <GlassJobCard
                    key={job.id}
                    job={job}
                    token={token}
                    isPending
                    staggerClass={nextStagger()}
                  />
                ))}
              </GlassSection>
            )}

            {/* ─── Today's Jobs ─── */}
            <GlassSection
              title="Today's Jobs"
              count={todaysJobs.length}
              emptyText="No jobs today — enjoy the downtime"
              staggerClass={nextStagger()}
            >
              {todaysJobs.map((job) => (
                <GlassJobCard
                  key={job.id}
                  job={job}
                  token={token}
                  staggerClass={nextStagger()}
                />
              ))}
            </GlassSection>

            {/* ─── Upcoming Jobs ─── */}
            {upcomingJobs.length > 0 && (
              <GlassSection
                title="Upcoming"
                count={upcomingJobs.length}
                staggerClass={nextStagger()}
              >
                {upcomingJobs.map((job) => (
                  <GlassJobCard
                    key={job.id}
                    job={job}
                    token={token}
                    staggerClass={nextStagger()}
                  />
                ))}
              </GlassSection>
            )}

            {/* ─── Completed Jobs ─── */}
            {pastJobs.length > 0 && (
              <GlassSection
                title="Completed"
                count={pastJobs.length}
                staggerClass={nextStagger()}
              >
                {pastJobs.map((job) => (
                  <GlassJobCard
                    key={job.id}
                    job={job}
                    token={token}
                    staggerClass={nextStagger()}
                  />
                ))}
              </GlassSection>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
