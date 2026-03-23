"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Flame,
  Loader2,
  AlertCircle,
  ChevronRight,
  MapPin,
  Clock,
  Calendar,
  Sparkles,
  Star,
  Zap,
  Trophy,
  PlusCircle,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Navigation,
  PartyPopper,
} from "lucide-react"

interface JobCard {
  id: number; date: string; scheduled_at: string | null; address: string | null
  service_type: string | null; status: string; job_type: string | null
  assignment_status: string; assignment_id: string; customer_first_name: string | null
  cleaner_omw_at: string | null; cleaner_arrived_at: string | null; payment_method: string | null
}
interface PortalData {
  cleaner: { id: number; name: string; phone: string; availability: any; employee_type?: string }
  tenant: { name: string; slug: string }
  todaysJobs: JobCard[]; upcomingJobs: JobCard[]; pendingJobs: JobCard[]; pastJobs: JobCard[]
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function formatTime(t: string | null) {
  if (!t) return "TBD"
  try { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` } catch { return t }
}
function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/crew/${token}`)
      .then(r => { if (!r.ok) throw new Error("Invalid portal link"); return r.json() })
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { fetch(`/api/crew/${token}/auto-session`, { method: "POST" }).catch(() => {}) }, [token])

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.push("/login")
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f5f0" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="size-12 rounded-2xl flex items-center justify-center animate-pulse" style={{ background: "linear-gradient(135deg, #58cc02, #89e219)" }}>
          <Sparkles className="size-6 text-white" />
        </div>
        <Loader2 className="size-5 animate-spin text-emerald-500" />
      </div>
    </div>
  )

  if (error || !data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "#f7f5f0" }}>
      <div className="text-center">
        <AlertCircle className="size-12 text-red-400 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-slate-800">Invalid Link</h1>
        <p className="text-slate-500 mt-1 text-sm">This portal link is not valid or has expired.</p>
      </div>
    </div>
  )

  const { cleaner, tenant, todaysJobs, upcomingJobs, pendingJobs, pastJobs } = data
  const firstName = cleaner.name?.split(" ")[0] || "Crew"

  // Stats
  const todayCompleted = todaysJobs.filter(j => j.status === "completed").length
  const todayTotal = todaysJobs.length
  const allDone = todayTotal > 0 && todayCompleted === todayTotal
  const progressPct = todayTotal > 0 ? Math.round((todayCompleted / todayTotal) * 100) : 0

  // Time-based greeting
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  return (
    <div className="min-h-screen pb-8" style={{ background: "#f7f5f0", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        @keyframes popIn { 0% { opacity:0; transform: scale(0.8) translateY(10px); } 60% { transform: scale(1.03) translateY(-2px); } 100% { opacity:1; transform: scale(1) translateY(0); } }
        @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .pop-in { animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .slide-up { animation: slideUp 0.4s ease-out both; }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div
        className="relative overflow-hidden px-5 pt-6 pb-8"
        style={{ background: "linear-gradient(135deg, #58cc02 0%, #2b9348 100%)" }}
      >
        {/* Decorative circles */}
        <div className="absolute -top-8 -right-8 size-32 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
        <div className="absolute bottom-2 -left-6 size-20 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />

        <div className="relative z-10">
          {/* Top row */}
          <div className="flex items-center justify-between mb-5">
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{tenant.name}</span>
            <button onClick={handleLogout} className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
              <LogOut className="size-3" /> Log out
            </button>
          </div>

          {/* Avatar + Greeting */}
          <div className="flex items-center gap-4">
            <div className="size-14 rounded-2xl flex items-center justify-center text-xl font-black text-emerald-700 shadow-lg" style={{ background: "linear-gradient(135deg, #d4fc79, #96e6a1)" }}>
              {firstName.charAt(0)}
            </div>
            <div>
              <p className="text-white/70 text-sm">{greeting}</p>
              <h1 className="text-2xl font-black text-white">{firstName}</h1>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ DAILY PROGRESS CARD ═══ */}
      <div className="px-4 -mt-5 mb-6">
        <div
          className="rounded-2xl p-4 pop-in flex items-center gap-4"
          style={{
            background: "#ffffff",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          }}
        >
          {/* Progress Ring */}
          <div className="relative size-16 shrink-0">
            <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#e8e5de" strokeWidth="5" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                stroke={allDone ? "#58cc02" : "#ff9600"}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 26}`}
                strokeDashoffset={`${2 * Math.PI * 26 * (1 - progressPct / 100)}`}
                style={{ transition: "stroke-dashoffset 1s ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              {allDone
                ? <Trophy className="size-6 text-amber-500" />
                : <span className="text-sm font-black" style={{ color: "#ff9600" }}>{progressPct}%</span>
              }
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">
              {allDone ? "All jobs done!" : todayTotal === 0 ? "No jobs today" : `${todayCompleted}/${todayTotal} completed`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {allDone ? "You crushed it today" : todayTotal === 0 ? "Enjoy your free day" : "Keep going, you got this!"}
            </p>
          </div>
          {allDone && <PartyPopper className="size-8 text-amber-400 ml-auto" style={{ animation: "bounce 1s ease-in-out infinite" }} />}
        </div>
      </div>

      <div className="px-4 space-y-6 max-w-lg mx-auto">
        {/* ═══ NEW QUOTE CTA ═══ */}
        {cleaner.employee_type === "salesman" && (
          <button
            onClick={() => router.push(`/crew/${token}/new-quote`)}
            className="w-full rounded-2xl p-4 flex items-center gap-3 active:scale-[0.97] transition-transform slide-up"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", boxShadow: "0 4px 15px rgba(124,58,237,0.3)" }}
          >
            <div className="size-10 rounded-xl bg-white/20 flex items-center justify-center">
              <PlusCircle className="size-5 text-white" />
            </div>
            <div className="text-left flex-1">
              <p className="font-bold text-white text-sm">New Quote</p>
              <p className="text-purple-200 text-xs">Create a quote for a customer</p>
            </div>
            <ChevronRight className="size-5 text-purple-200" />
          </button>
        )}

        {/* ═══ ACTION REQUIRED ═══ */}
        {pendingJobs.length > 0 && (
          <Section title="Action Required" icon={<AlertTriangle className="size-4" />} color="#ff4b4b" count={pendingJobs.length} badge>
            {pendingJobs.map((job, i) => (
              <QuestCard key={job.id} job={job} token={token} index={i} urgent />
            ))}
          </Section>
        )}

        {/* ═══ TODAY'S MISSIONS ═══ */}
        <Section title="Today's Missions" icon={<Zap className="size-4" />} color="#58cc02" count={todaysJobs.length} empty={todaysJobs.length === 0 ? "No missions today — rest up!" : undefined}>
          {todaysJobs.map((job, i) => (
            <QuestCard key={job.id} job={job} token={token} index={i} />
          ))}
        </Section>

        {/* ═══ COMING UP ═══ */}
        {upcomingJobs.length > 0 && (
          <Section title="Coming Up" icon={<Calendar className="size-4" />} color="#1cb0f6" count={upcomingJobs.length}>
            {upcomingJobs.map((job, i) => (
              <QuestCard key={job.id} job={job} token={token} index={i} />
            ))}
          </Section>
        )}

        {/* ═══ COMPLETED ═══ */}
        {pastJobs.length > 0 && (
          <Section title="Completed" icon={<CheckCircle2 className="size-4" />} color="#afafaf" count={pastJobs.length}>
            {pastJobs.map((job, i) => (
              <QuestCard key={job.id} job={job} token={token} index={i} completed />
            ))}
          </Section>
        )}
      </div>
    </div>
  )
}

// ── Section ──
function Section({ title, icon, color, count, badge, empty, children }: {
  title: string; icon: React.ReactNode; color: string; count: number; badge?: boolean; empty?: string; children?: React.ReactNode
}) {
  return (
    <div className="slide-up" style={{ animationDelay: "0.1s" }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${color}20`, color }}>
          {icon}
        </div>
        <h2 className="text-sm font-bold text-slate-800 flex-1">{title}</h2>
        {badge ? (
          <span className="text-xs font-bold text-white px-2.5 py-1 rounded-full animate-pulse" style={{ background: color }}>
            {count}
          </span>
        ) : (
          <span className="text-xs font-semibold text-slate-400">{count}</span>
        )}
      </div>
      {empty ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: "#ffffff", border: "2px dashed #e2ddd5" }}>
          <Star className="size-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">{empty}</p>
        </div>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </div>
  )
}

// ── Quest Card (Job) ──
function QuestCard({ job, token, index, urgent, completed }: {
  job: JobCard; token: string; index: number; urgent?: boolean; completed?: boolean
}) {
  const router = useRouter()
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`

  // Status config
  let statusIcon: React.ReactNode
  let statusText: string
  let statusColor: string
  if (job.assignment_status === "pending") {
    statusIcon = <AlertTriangle className="size-3.5" />; statusText = "Respond"; statusColor = "#ff4b4b"
  } else if (job.status === "completed") {
    statusIcon = <CheckCircle2 className="size-3.5" />; statusText = "Done"; statusColor = "#58cc02"
  } else if (job.cleaner_arrived_at) {
    statusIcon = <Navigation className="size-3.5" />; statusText = "At Location"; statusColor = "#1cb0f6"
  } else if (job.cleaner_omw_at) {
    statusIcon = <Navigation className="size-3.5" />; statusText = "On My Way"; statusColor = "#ff9600"
  } else {
    statusIcon = <Clock className="size-3.5" />; statusText = "Scheduled"; statusColor = "#afafaf"
  }

  return (
    <button
      onClick={() => router.push(href)}
      className="group w-full text-left rounded-2xl overflow-hidden active:scale-[0.98] transition-all duration-200 pop-in"
      style={{
        background: "#ffffff",
        boxShadow: urgent
          ? "0 0 0 2px #ff4b4b, 0 4px 15px rgba(255,75,75,0.15)"
          : completed
            ? "0 1px 4px rgba(0,0,0,0.04)"
            : "0 2px 10px rgba(0,0,0,0.06)",
        animationDelay: `${index * 0.07}s`,
        opacity: completed ? 0.65 : 1,
      }}
    >
      <div className="flex items-center p-4 gap-3">
        {/* Left: Icon circle */}
        <div
          className="size-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `${statusColor}15`,
            border: `2px solid ${statusColor}30`,
          }}
        >
          <span style={{ color: statusColor }}>{statusIcon}</span>
        </div>

        {/* Middle: Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-bold text-slate-800 truncate">
              {job.service_type ? humanize(job.service_type) : "Job"}
            </p>
            {isEstimate && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">EST</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Calendar className="size-3" /> {formatDate(job.date)}
            </span>
            <span>·</span>
            <span>{formatTime(job.scheduled_at)}</span>
          </div>
          {job.address && (
            <p className="text-xs text-slate-400 mt-1 truncate flex items-center gap-1">
              <MapPin className="size-3 shrink-0" /> {job.address}
            </p>
          )}
        </div>

        {/* Right: Status pill + arrow */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className="text-[10px] font-bold px-2 py-1 rounded-full text-white"
            style={{ background: statusColor }}
          >
            {statusText}
          </span>
          <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
        </div>
      </div>
    </button>
  )
}
