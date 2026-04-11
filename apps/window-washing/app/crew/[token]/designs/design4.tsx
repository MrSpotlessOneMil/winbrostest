"use client"

import { useRouter } from "next/navigation"
import {
  Calendar,
  Clock,
  MapPin,
  ChevronRight,
  PlusCircle,
  LogOut,
  Zap,
} from "lucide-react"
import {
  DesignProps,
  JobCard,
  formatDate,
  formatTime,
  humanize,
  getJobStatusDisplay,
} from "../crew-types"

/* ─── Neon color palette ─── */
const NEON = {
  cyan: { hex: "#22d3ee", rgb: "34,211,238" },
  green: { hex: "#4ade80", rgb: "74,222,128" },
  magenta: { hex: "#e879f9", rgb: "232,121,249" },
  amber: { hex: "#fbbf24", rgb: "251,191,36" },
  violet: { hex: "#a78bfa", rgb: "167,139,250" },
} as const

type SectionKind = "pending" | "today" | "upcoming" | "completed"

function getSectionNeon(kind: SectionKind) {
  switch (kind) {
    case "pending":
      return { color: NEON.amber.hex, rgb: NEON.amber.rgb, label: "PENDING" }
    case "today":
      return { color: NEON.cyan.hex, rgb: NEON.cyan.rgb, label: "TODAY" }
    case "upcoming":
      return { color: NEON.violet.hex, rgb: NEON.violet.rgb, label: "UPCOMING" }
    case "completed":
      return { color: NEON.green.hex, rgb: NEON.green.rgb, label: "COMPLETED" }
  }
}

/* ─── Neon status text color (no background, just glowing text) ─── */
function getNeonStatusColor(job: JobCard): string {
  const base = getJobStatusDisplay(job)
  const map: Record<string, string> = {
    Estimate: NEON.violet.hex,
    "Needs Response": NEON.amber.hex,
    Done: NEON.green.hex,
    "At Location": NEON.cyan.hex,
    "On My Way": "#818cf8",
    Upcoming: "#94a3b8",
  }
  return map[base.label] || "#94a3b8"
}

/* ─── Neon Job Card ─── */
function NeonJobCard({
  job,
  token,
  sectionKind,
  animIndex,
}: {
  job: JobCard
  token: string
  sectionKind: SectionKind
  animIndex: number
}) {
  const router = useRouter()
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`
  const statusDisplay = getJobStatusDisplay(job)
  const statusColor = getNeonStatusColor(job)
  const { color: neonColor, rgb: neonRgb } = getSectionNeon(sectionKind)
  const isPending = job.assignment_status === "pending"

  return (
    <button
      onClick={() => router.push(href)}
      className="group w-full text-left rounded-xl transition-all duration-200 overflow-hidden"
      style={{
        background: "#0a0a0a",
        border: "1px solid #27272a",
        animation: `neonSlideIn 0.4s ease-out ${animIndex * 0.06}s both`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = neonColor
        e.currentTarget.style.boxShadow = `0 0 10px rgba(${neonRgb},0.15), 0 0 30px rgba(${neonRgb},0.05)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#27272a"
        e.currentTarget.style.boxShadow = "none"
      }}
    >
      <div className="flex">
        {/* Left neon stripe */}
        <div
          className="w-[3px] shrink-0"
          style={{
            background: neonColor,
            boxShadow: isPending ? `0 0 8px rgba(${neonRgb},0.6)` : "none",
            animation: isPending ? "neonPulse 2s ease-in-out infinite" : "none",
          }}
        />

        <div className="flex items-center gap-3 p-4 flex-1 min-w-0">
          {/* Left content */}
          <div className="flex-1 min-w-0">
            {/* Status label */}
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: statusColor }}
              >
                {statusDisplay.label}
              </span>
              {job.service_type && (
                <span className="text-[10px] text-zinc-600">
                  {humanize(job.service_type)}
                </span>
              )}
            </div>

            {/* Date & Time */}
            <div className="flex items-center gap-4 text-sm mb-1">
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Calendar className="size-3.5 text-zinc-600" />
                {formatDate(job.date)}
              </span>
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Clock className="size-3.5 text-zinc-600" />
                {formatTime(job.scheduled_at)}
              </span>
            </div>

            {/* Address */}
            {job.address && (
              <p className="text-sm text-zinc-500 flex items-start gap-1.5 truncate">
                <MapPin className="size-3.5 mt-0.5 shrink-0 text-zinc-600" />
                <span className="truncate">{job.address}</span>
              </p>
            )}

            {/* Customer */}
            {job.customer_first_name && (
              <p className="mt-1 text-xs text-zinc-400">
                {job.customer_first_name}
              </p>
            )}

            {/* Pay (completed jobs) */}
            {job.status === "completed" && job.payment_method && (
              <p
                className="mt-1 text-xs font-bold"
                style={{
                  color: NEON.green.hex,
                  textShadow: `0 0 8px rgba(${NEON.green.rgb},0.3)`,
                }}
              >
                Paid via {humanize(job.payment_method)}
              </p>
            )}
          </div>

          {/* Right arrow */}
          <ChevronRight
            className="size-5 text-zinc-600 shrink-0 transition-colors duration-200"
            style={{}}
            onMouseEnter={() => {}}
          />
        </div>
      </div>
    </button>
  )
}

/* ─── Section Component ─── */
function NeonSection({
  kind,
  count,
  emptyText,
  children,
  animIndex,
}: {
  kind: SectionKind
  count: number
  emptyText?: string
  children: React.ReactNode
  animIndex: number
}) {
  const { color, label } = getSectionNeon(kind)

  return (
    <div
      style={{
        animation: `neonSlideIn 0.4s ease-out ${animIndex * 0.06}s both`,
      }}
    >
      {/* Section header */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className="size-2 rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        <h2
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color }}
        >
          {label}
        </h2>
        <span className="text-xs text-zinc-600 ml-auto">{count}</span>
      </div>

      {/* Content */}
      {count === 0 && emptyText ? (
        <div
          className="rounded-xl p-10 text-center"
          style={{
            background: "#0a0a0a",
            border: "1px solid #27272a",
          }}
        >
          <p className="text-zinc-600 uppercase tracking-widest text-sm font-bold">
            ALL CLEAR
          </p>
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

/* ─── Main Design Component ─── */
export default function Design4({ data, token, onLogout }: DesignProps) {
  const router = useRouter()
  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data

  let animIdx = 0
  const nextAnim = () => ++animIdx

  return (
    <div className="min-h-screen" style={{ background: "#000000", fontFamily: "Inter, sans-serif" }}>
      {/* Global keyframes */}
      <style>{`
        @keyframes neonSlideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes neonPulse {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 4px currentColor;
          }
          50% {
            opacity: 0.5;
            box-shadow: 0 0 12px currentColor;
          }
        }
      `}</style>

      <div className="max-w-lg mx-auto px-5 pb-12">
        {/* ─── Header ─── */}
        <div
          className="pt-8 pb-6"
          style={{ animation: `neonSlideIn 0.4s ease-out ${nextAnim() * 0.06}s both` }}
        >
          <div className="flex items-start justify-between">
            <div>
              <p
                className="text-xs uppercase tracking-wider mb-1"
                style={{ color: "#06b6d4" }}
              >
                {tenant.name}
              </p>
              <h1 className="text-2xl font-bold text-white">
                {cleaner.name}
              </h1>
            </div>

            {/* Logout */}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-200 mt-2"
            >
              <LogOut className="size-3" />
              Log out
            </button>
          </div>

          {/* Neon scanner line */}
          <div
            className="h-[2px] mt-4 rounded-full"
            style={{
              background: "linear-gradient(90deg, #06b6d4, #4ade80, #e879f9)",
            }}
          />
        </div>

        <div className="space-y-8">
          {/* ─── New Quote CTA (salesmen) ─── */}
          {cleaner.employee_type === "salesman" && (
            <div style={{ animation: `neonSlideIn 0.4s ease-out ${nextAnim() * 0.06}s both` }}>
              <button
                onClick={() => router.push(`/crew/${token}/new-quote`)}
                className="group w-full rounded-xl p-4 flex items-center gap-3 transition-all duration-200"
                style={{
                  background: "transparent",
                  border: `1px solid ${NEON.cyan.hex}`,
                  color: NEON.cyan.hex,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `rgba(${NEON.cyan.rgb},0.1)`
                  e.currentTarget.style.boxShadow = `0 0 15px rgba(${NEON.cyan.rgb},0.2), 0 0 30px rgba(${NEON.cyan.rgb},0.05)`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent"
                  e.currentTarget.style.boxShadow = "none"
                }}
              >
                <PlusCircle className="size-5 shrink-0" />
                <div className="text-left flex-1">
                  <h3 className="font-bold text-base">New Quote</h3>
                  <p className="text-zinc-500 text-xs">Create a quote for a new customer</p>
                </div>
                <ChevronRight className="size-5 text-zinc-600 group-hover:text-cyan-400 transition-colors duration-200" />
              </button>
            </div>
          )}

          {/* ─── Pending Jobs ─── */}
          {pendingJobs.length > 0 && (
            <NeonSection
              kind="pending"
              count={pendingJobs.length}
              animIndex={nextAnim()}
            >
              {pendingJobs.map((job) => (
                <NeonJobCard
                  key={job.id}
                  job={job}
                  token={token}
                  sectionKind="pending"
                  animIndex={nextAnim()}
                />
              ))}
            </NeonSection>
          )}

          {/* ─── Today's Jobs ─── */}
          <NeonSection
            kind="today"
            count={todaysJobs.length}
            emptyText="No jobs today"
            animIndex={nextAnim()}
          >
            {todaysJobs.map((job) => (
              <NeonJobCard
                key={job.id}
                job={job}
                token={token}
                sectionKind="today"
                animIndex={nextAnim()}
              />
            ))}
          </NeonSection>

          {/* ─── Upcoming Jobs ─── */}
          {upcomingJobs.length > 0 && (
            <NeonSection
              kind="upcoming"
              count={upcomingJobs.length}
              animIndex={nextAnim()}
            >
              {upcomingJobs.map((job) => (
                <NeonJobCard
                  key={job.id}
                  job={job}
                  token={token}
                  sectionKind="upcoming"
                  animIndex={nextAnim()}
                />
              ))}
            </NeonSection>
          )}

          {/* ─── Completed Jobs ─── */}
          {pastJobs.length > 0 && (
            <NeonSection
              kind="completed"
              count={pastJobs.length}
              animIndex={nextAnim()}
            >
              {pastJobs.map((job) => (
                <NeonJobCard
                  key={job.id}
                  job={job}
                  token={token}
                  sectionKind="completed"
                  animIndex={nextAnim()}
                />
              ))}
            </NeonSection>
          )}
        </div>
      </div>
    </div>
  )
}
