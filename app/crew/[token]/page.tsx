"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Loader2, AlertCircle, ChevronRight, MapPin, Clock, Calendar,
  Sparkles, Star, Zap, Trophy, PlusCircle, LogOut, CheckCircle2,
  AlertTriangle, Navigation, PartyPopper, Settings, Award,
  Flame, TrendingUp, MapPinned, ToggleLeft, ToggleRight,
  Briefcase, Car, ExternalLink,
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

// XP / Level system
function getLevel(jobCount: number) {
  if (jobCount >= 100) return { level: 10, title: "Legend", color: "#ffd700", next: Infinity }
  if (jobCount >= 75) return { level: 9, title: "Master", color: "#e879f9", next: 100 }
  if (jobCount >= 50) return { level: 8, title: "Expert", color: "#f97316", next: 75 }
  if (jobCount >= 35) return { level: 7, title: "Pro", color: "#ef4444", next: 50 }
  if (jobCount >= 25) return { level: 6, title: "Skilled", color: "#8b5cf6", next: 35 }
  if (jobCount >= 15) return { level: 5, title: "Solid", color: "#3b82f6", next: 25 }
  if (jobCount >= 10) return { level: 4, title: "Rising", color: "#06b6d4", next: 15 }
  if (jobCount >= 5) return { level: 3, title: "Starter", color: "#22c55e", next: 10 }
  if (jobCount >= 2) return { level: 2, title: "Rookie", color: "#84cc16", next: 5 }
  return { level: 1, title: "New", color: "#a3a3a3", next: 2 }
}

type Tab = "today" | "upcoming" | "history"

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("today")
  const [available, setAvailable] = useState(true)
  const [togglingAvail, setTogglingAvail] = useState(false)

  useEffect(() => {
    fetch(`/api/crew/${token}`)
      .then(r => { if (!r.ok) throw new Error("Invalid portal link"); return r.json() })
      .then(d => {
        setData(d)
        // Read availability from cleaner data
        const avail = d.cleaner?.availability
        if (avail && typeof avail === "object" && avail.active === false) setAvailable(false)
      })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { fetch(`/api/crew/${token}/auto-session`, { method: "POST" }).catch(() => {}) }, [token])

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.push("/login")
  }

  async function toggleAvailability() {
    const newVal = !available
    setTogglingAvail(true)
    setAvailable(newVal)
    try {
      await fetch(`/api/crew/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: { active: newVal } }),
      })
    } catch { setAvailable(!newVal) }
    finally { setTogglingAvail(false) }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f5f0" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="size-14 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #58cc02, #89e219)" }}>
          <Sparkles className="size-6 text-white animate-pulse" />
        </div>
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
  const initial = firstName.charAt(0).toUpperCase()

  // Stats
  const totalJobs = pastJobs.length + todaysJobs.filter(j => j.status === "completed").length
  const todayCompleted = todaysJobs.filter(j => j.status === "completed").length
  const todayTotal = todaysJobs.length
  const lvl = getLevel(totalJobs)
  const xpProgress = lvl.next === Infinity ? 100 : Math.round((totalJobs / lvl.next) * 100)

  // Tab content
  const tabJobs = tab === "today" ? todaysJobs : tab === "upcoming" ? upcomingJobs : pastJobs

  // Upcoming job addresses for map links
  const jobsWithAddress = [...todaysJobs, ...upcomingJobs].filter(j => j.address)

  return (
    <div className="min-h-screen pb-6" style={{ background: "#f7f5f0", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        @keyframes popIn { 0% { opacity:0; transform: scale(0.85) translateY(8px); } 60% { transform: scale(1.02); } 100% { opacity:1; transform: scale(1); } }
        @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
        @keyframes glow { 0%,100% { box-shadow: 0 0 0 0 rgba(88,204,2,0.3); } 50% { box-shadow: 0 0 0 6px rgba(88,204,2,0); } }
        .pop-in { animation: popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both; }
        .slide-up { animation: slideUp 0.4s ease-out both; }
      `}</style>

      {/* ═══ TOP BAR ═══ */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className="text-sm font-black uppercase tracking-wider text-slate-800">{tenant.name}</span>
        <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1">
          <LogOut className="size-3.5" />
        </button>
      </div>

      {/* ═══ PROFILE SECTION (Instagram-style) ═══ */}
      <div className="px-5 pt-2 pb-4">
        <div className="flex items-center gap-5">
          {/* Avatar with level ring */}
          <div className="relative shrink-0">
            <div className="size-20 rounded-full p-[3px]" style={{ background: `conic-gradient(${lvl.color} ${xpProgress}%, #e2ddd5 ${xpProgress}%)` }}>
              <div className="size-full rounded-full flex items-center justify-center text-2xl font-black" style={{ background: "#f7f5f0", color: lvl.color }}>
                {initial}
              </div>
            </div>
            {/* Level badge */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-black text-white" style={{ background: lvl.color, boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
              LV.{lvl.level}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex-1 grid grid-cols-3 text-center gap-1">
            <div>
              <p className="text-lg font-black text-slate-800">{totalJobs}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Jobs</p>
            </div>
            <div>
              <p className="text-lg font-black text-slate-800">{upcomingJobs.length}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Upcoming</p>
            </div>
            <div>
              <p className="text-lg font-black" style={{ color: lvl.color }}>{lvl.title}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase">Rank</p>
            </div>
          </div>
        </div>

        {/* Name + availability */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-black text-slate-800">{cleaner.name}</h1>
            <p className="text-xs text-slate-400">{cleaner.employee_type === "salesman" ? "Sales" : "Cleaning Pro"} · {cleaner.phone}</p>
          </div>
        </div>

        {/* XP bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full" style={{ background: "#e2ddd5" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${xpProgress}%`, background: lvl.color }} />
          </div>
          <span className="text-[10px] font-bold text-slate-400">{totalJobs}/{lvl.next === Infinity ? "MAX" : lvl.next} XP</span>
        </div>
      </div>

      {/* ═══ ACTION BUTTONS ROW ═══ */}
      <div className="px-4 pb-4 flex gap-2">
        {/* Availability toggle */}
        <button
          onClick={toggleAvailability}
          disabled={togglingAvail}
          className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all"
          style={{
            background: available ? "#dcfce7" : "#fee2e2",
            color: available ? "#16a34a" : "#dc2626",
            border: `1.5px solid ${available ? "#86efac" : "#fca5a5"}`,
          }}
        >
          {available ? <ToggleRight className="size-4" /> : <ToggleLeft className="size-4" />}
          {available ? "Available" : "Unavailable"}
        </button>

        {/* Map link */}
        {jobsWithAddress.length > 0 && (
          <a
            href={`https://www.google.com/maps/dir/${jobsWithAddress.map(j => encodeURIComponent(j.address!)).join("/")}`}
            target="_blank" rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all"
            style={{ background: "#eff6ff", color: "#2563eb", border: "1.5px solid #93c5fd" }}
          >
            <MapPinned className="size-4" /> Map Route
          </a>
        )}

        {/* New Quote (salesmen) */}
        {cleaner.employee_type === "salesman" && (
          <button
            onClick={() => router.push(`/crew/${token}/new-quote`)}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.97] transition-all"
            style={{ background: "#f3e8ff", color: "#7c3aed", border: "1.5px solid #c4b5fd" }}
          >
            <PlusCircle className="size-4" /> New Quote
          </button>
        )}
      </div>

      {/* ═══ PENDING ALERT ═══ */}
      {pendingJobs.length > 0 && (
        <div className="px-4 mb-4">
          <div className="rounded-2xl p-4 pop-in" style={{ background: "linear-gradient(135deg, #ff4b4b, #ff6b6b)", boxShadow: "0 4px 15px rgba(255,75,75,0.25)" }}>
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-white/20 flex items-center justify-center">
                <AlertTriangle className="size-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-black text-white text-sm">{pendingJobs.length} job{pendingJobs.length > 1 ? "s" : ""} need your response</p>
                <p className="text-white/70 text-xs">Tap to accept or decline</p>
              </div>
              <ChevronRight className="size-5 text-white/50" />
            </div>
            <div className="mt-3 space-y-2">
              {pendingJobs.map(job => (
                <button
                  key={job.id}
                  onClick={() => {
                    const href = job.job_type === "estimate" ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`
                    router.push(href)
                  }}
                  className="w-full bg-white/15 rounded-xl p-3 flex items-center gap-3 text-left active:scale-[0.98] transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold truncate">{job.service_type ? humanize(job.service_type) : "Job"}</p>
                    <p className="text-white/60 text-xs">{formatDate(job.date)} · {formatTime(job.scheduled_at)}</p>
                  </div>
                  <ChevronRight className="size-4 text-white/40" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ TODAY'S PROGRESS ═══ */}
      {todayTotal > 0 && (
        <div className="px-4 mb-4">
          <div className="bg-white rounded-2xl p-4 flex items-center gap-4 pop-in" style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
            <div className="relative size-14 shrink-0">
              <svg viewBox="0 0 64 64" className="size-14 -rotate-90">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#e8e5de" strokeWidth="5" />
                <circle cx="32" cy="32" r="26" fill="none"
                  stroke={todayCompleted === todayTotal ? "#58cc02" : "#ff9600"}
                  strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 26}`}
                  strokeDashoffset={`${2 * Math.PI * 26 * (1 - todayCompleted / todayTotal)}`}
                  style={{ transition: "stroke-dashoffset 1s ease-out" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                {todayCompleted === todayTotal
                  ? <Trophy className="size-5 text-amber-500" />
                  : <span className="text-xs font-black text-amber-500">{todayCompleted}/{todayTotal}</span>
                }
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">
                {todayCompleted === todayTotal ? "All done today!" : `${todayTotal - todayCompleted} job${todayTotal - todayCompleted > 1 ? "s" : ""} remaining`}
              </p>
              <p className="text-xs text-slate-400">{todayCompleted === todayTotal ? "You crushed it" : "Keep going, you got this!"}</p>
            </div>
            {todayCompleted === todayTotal && <PartyPopper className="size-7 text-amber-400 ml-auto" />}
          </div>
        </div>
      )}

      {/* ═══ TAB BAR (Instagram-style) ═══ */}
      <div className="flex border-b" style={{ borderColor: "#e2ddd5" }}>
        {([
          { key: "today" as Tab, label: "Today", icon: <Zap className="size-4" />, count: todaysJobs.length },
          { key: "upcoming" as Tab, label: "Upcoming", icon: <Calendar className="size-4" />, count: upcomingJobs.length },
          { key: "history" as Tab, label: "History", icon: <Award className="size-4" />, count: pastJobs.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex-1 py-3 flex flex-col items-center gap-1 transition-all relative"
            style={{ color: tab === t.key ? "#58cc02" : "#a8a29e" }}
          >
            {t.icon}
            <span className="text-[10px] font-bold uppercase tracking-wider">{t.label}</span>
            {t.count > 0 && tab !== t.key && (
              <span className="absolute top-2 right-1/4 size-2 rounded-full bg-red-400" />
            )}
            {tab === t.key && (
              <div className="absolute bottom-0 left-1/4 right-1/4 h-[3px] rounded-full" style={{ background: "#58cc02" }} />
            )}
          </button>
        ))}
      </div>

      {/* ═══ JOB FEED ═══ */}
      <div className="px-4 pt-4 space-y-3 max-w-lg mx-auto">
        {tabJobs.length === 0 ? (
          <div className="text-center py-16">
            <Star className="size-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-400">
              {tab === "today" ? "No jobs today — rest up!" : tab === "upcoming" ? "Nothing scheduled yet" : "No completed jobs yet"}
            </p>
          </div>
        ) : (
          tabJobs.map((job, i) => (
            <JobCard key={job.id} job={job} token={token} index={i} isHistory={tab === "history"} />
          ))
        )}
      </div>

      {/* ═══ JOB LOCATIONS (mini map section) ═══ */}
      {tab === "today" && jobsWithAddress.length > 0 && (
        <div className="px-4 mt-6 max-w-lg mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <MapPinned className="size-4 text-slate-400" />
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Job Locations</p>
          </div>
          <div className="space-y-2">
            {jobsWithAddress.map(job => (
              <a
                key={job.id}
                href={`https://maps.google.com/?q=${encodeURIComponent(job.address!)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 bg-white rounded-xl p-3 active:scale-[0.98] transition-all"
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
              >
                <div className="size-9 rounded-lg flex items-center justify-center" style={{ background: "#eff6ff" }}>
                  <MapPin className="size-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{job.address}</p>
                  <p className="text-xs text-slate-400">{job.service_type ? humanize(job.service_type) : "Job"} · {formatTime(job.scheduled_at)}</p>
                </div>
                <ExternalLink className="size-3.5 text-slate-300" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Job Card ──
function JobCard({ job, token, index, isHistory }: { job: JobCard; token: string; index: number; isHistory?: boolean }) {
  const router = useRouter()
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`

  let statusColor: string; let statusText: string; let statusIcon: React.ReactNode
  if (job.assignment_status === "pending") {
    statusColor = "#ff4b4b"; statusText = "Respond"; statusIcon = <AlertTriangle className="size-3.5" />
  } else if (job.status === "completed") {
    statusColor = "#58cc02"; statusText = "Done"; statusIcon = <CheckCircle2 className="size-3.5" />
  } else if (job.cleaner_arrived_at) {
    statusColor = "#1cb0f6"; statusText = "At Location"; statusIcon = <Navigation className="size-3.5" />
  } else if (job.cleaner_omw_at) {
    statusColor = "#ff9600"; statusText = "On My Way"; statusIcon = <Car className="size-3.5" />
  } else {
    statusColor = "#a8a29e"; statusText = "Scheduled"; statusIcon = <Clock className="size-3.5" />
  }

  return (
    <button
      onClick={() => router.push(href)}
      className="group w-full text-left bg-white rounded-2xl overflow-hidden active:scale-[0.98] transition-all pop-in"
      style={{
        boxShadow: job.assignment_status === "pending"
          ? "0 0 0 2px #ff4b4b, 0 4px 12px rgba(255,75,75,0.12)"
          : "0 1px 6px rgba(0,0,0,0.05)",
        animationDelay: `${index * 0.06}s`,
        opacity: isHistory ? 0.7 : 1,
      }}
    >
      <div className="flex items-center p-4 gap-3">
        <div className="size-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${statusColor}15`, border: `2px solid ${statusColor}25` }}>
          <span style={{ color: statusColor }}>{statusIcon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-bold text-slate-800 truncate">{job.service_type ? humanize(job.service_type) : "Job"}</p>
            {isEstimate && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-600">EST</span>}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{formatDate(job.date)}</span><span>·</span><span>{formatTime(job.scheduled_at)}</span>
          </div>
          {job.address && <p className="text-xs text-slate-400 mt-0.5 truncate">{job.address}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white" style={{ background: statusColor }}>{statusText}</span>
          <ChevronRight className="size-4 text-slate-300" />
        </div>
      </div>
    </button>
  )
}
