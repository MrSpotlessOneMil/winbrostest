"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
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
interface TimeOffEntry { id: number; date: string; reason: string | null }
interface WeeklyDay { available: boolean; start?: string; end?: string }
interface WeeklySchedule { [day: string]: WeeklyDay }
interface PortalData {
  cleaner: { id: number; name: string; phone: string; availability: { weekly?: WeeklySchedule } | null; employee_type?: string }
  tenant: { name: string; slug: string }
  todaysJobs: JobCard[]; upcomingJobs: JobCard[]; pendingJobs: JobCard[]; pastJobs: JobCard[]
  timeOff: TimeOffEntry[]
}

// Tenant color themes
const THEMES: Record<string, { gradient: string; accent: string; accentLight: string; avatarGradient: string; avatarText: string }> = {
  winbros: {
    gradient: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)",
    accent: "#14b8a6",
    accentLight: "#5eead4",
    avatarGradient: "linear-gradient(135deg, #99f6e4, #5eead4)",
    avatarText: "#0f766e",
  },
}
const DEFAULT_THEME = {
  gradient: "linear-gradient(135deg, #58cc02 0%, #2b9348 100%)",
  accent: "#58cc02",
  accentLight: "#89e219",
  avatarGradient: "linear-gradient(135deg, #d4fc79, #96e6a1)",
  avatarText: "#2b9348",
}

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const TIME_OPTIONS = [
  "06:00","07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00",
]

function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function formatTime(t: string | null) {
  if (!t) return "TBD"
  try { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}` } catch { return t }
}
function formatHour(t: string) {
  const [h] = t.split(":").map(Number)
  return `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`
}
function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }

const DEFAULT_WEEKLY: WeeklySchedule = Object.fromEntries(
  DAYS_OF_WEEK.map(d => [d, { available: true, start: "08:00", end: "18:00" }])
)

export default function CrewPortalPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() } })
  const [offDays, setOffDays] = useState<Set<string>>(new Set())
  const [togglingDate, setTogglingDate] = useState<string | null>(null)
  const [weekly, setWeekly] = useState<WeeklySchedule>(DEFAULT_WEEKLY)
  const [savingWeekly, setSavingWeekly] = useState(false)
  const [weeklyDirty, setWeeklyDirty] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)

  useEffect(() => {
    fetch(`/api/crew/${token}`)
      .then(r => { if (!r.ok) throw new Error("Invalid portal link"); return r.json() })
      .then(d => {
        setData(d)
        setOffDays(new Set((d.timeOff || []).map((t: TimeOffEntry) => t.date)))
        if (d.cleaner.availability?.weekly) {
          setWeekly({ ...DEFAULT_WEEKLY, ...d.cleaner.availability.weekly })
        }
      })
      .catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [token])

  useEffect(() => { fetch(`/api/crew/${token}/auto-session`, { method: "POST" }).catch(() => {}) }, [token])

  const toggleDay = useCallback(async (dateStr: string) => {
    if (togglingDate) return
    setTogglingDate(dateStr)
    try {
      const res = await fetch(`/api/crew/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggleTimeOff: { date: dateStr } }),
      })
      const result = await res.json()
      if (result.success) {
        setOffDays(prev => {
          const next = new Set(prev)
          if (result.action === "added") next.add(dateStr)
          else next.delete(dateStr)
          return next
        })
      }
    } catch {}
    setTogglingDate(null)
  }, [token, togglingDate])

  const updateWeeklyDay = (day: string, updates: Partial<WeeklyDay>) => {
    setWeekly(prev => ({ ...prev, [day]: { ...prev[day], ...updates } }))
    setWeeklyDirty(true)
  }

  const saveWeekly = async () => {
    setSavingWeekly(true)
    try {
      await fetch(`/api/crew/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: { ...(data?.cleaner.availability || {}), weekly } }),
      })
      setWeeklyDirty(false)
    } catch {}
    setSavingWeekly(false)
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
    router.push("/login")
  }

  const theme = data?.tenant?.slug ? (THEMES[data.tenant.slug] || DEFAULT_THEME) : DEFAULT_THEME

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#f7f5f0" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="size-12 rounded-2xl flex items-center justify-center animate-pulse" style={{ background: theme.gradient }}>
          <Sparkles className="size-6 text-white" />
        </div>
        <Loader2 className="size-5 animate-spin" style={{ color: theme.accent }} />
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

  const todayCompleted = todaysJobs.filter(j => j.status === "completed").length
  const todayTotal = todaysJobs.length
  const allDone = todayTotal > 0 && todayCompleted === todayTotal
  const progressPct = todayTotal > 0 ? Math.round((todayCompleted / todayTotal) * 100) : 0

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  // Calendar helpers — use local date, not UTC
  const todayStr = localToday()
  const calDate = new Date(calMonth.year, calMonth.month, 1)
  const monthName = calDate.toLocaleString("en-US", { month: "long", year: "numeric" })
  const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate()
  const firstDow = calDate.getDay()
  const calDays: (number | null)[] = []
  for (let i = 0; i < firstDow; i++) calDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calDays.push(d)

  const prevMonth = () => setCalMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 })
  const nextMonth = () => setCalMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 })

  // Check if a day is a recurring off day
  const isRecurringOff = (dayNum: number) => {
    const d = new Date(calMonth.year, calMonth.month, dayNum)
    const dayName = DAYS_OF_WEEK[d.getDay()]
    return weekly[dayName]?.available === false
  }

  return (
    <div className="min-h-screen pb-8" style={{ background: "#f7f5f0", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{`
        @keyframes popIn { 0% { opacity:0; transform: scale(0.8) translateY(10px); } 60% { transform: scale(1.03) translateY(-2px); } 100% { opacity:1; transform: scale(1) translateY(0); } }
        @keyframes slideUp { from { opacity:0; transform: translateY(16px); } to { opacity:1; transform: translateY(0); } }
        @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .pop-in { animation: popIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
        .slide-up { animation: slideUp 0.4s ease-out both; }
      `}</style>

      {/* ═══ HEADER ═══ */}
      <div className="relative overflow-hidden px-5 pt-6 pb-8" style={{ background: theme.gradient }}>
        <div className="absolute -top-8 -right-8 size-32 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
        <div className="absolute bottom-2 -left-6 size-20 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-5">
            <span className="text-xs font-semibold text-white/70 uppercase tracking-wider">{tenant.name}</span>
            <button onClick={handleLogout} className="text-xs text-white/50 hover:text-white/80 transition-colors flex items-center gap-1">
              <LogOut className="size-3" /> Log out
            </button>
          </div>

          <div className="flex items-center gap-4">
            <div className="size-14 rounded-2xl flex items-center justify-center text-xl font-black shadow-lg" style={{ background: theme.avatarGradient, color: theme.avatarText }}>
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
        <div className="rounded-2xl p-4 pop-in flex items-center gap-4" style={{ background: "#ffffff", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}>
          <div className="relative size-16 shrink-0">
            <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
              <circle cx="32" cy="32" r="26" fill="none" stroke="#e8e5de" strokeWidth="5" />
              <circle
                cx="32" cy="32" r="26" fill="none"
                stroke={allDone ? theme.accent : "#ff9600"}
                strokeWidth="5" strokeLinecap="round"
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

        {/* ═══ MY AVAILABILITY ═══ */}
        <div className="slide-up" style={{ animationDelay: "0.05s" }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${theme.accent}20`, color: theme.accent }}>
              <Calendar className="size-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-800 flex-1">My Availability</h2>
            <button
              onClick={() => setShowSchedule(!showSchedule)}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors"
              style={{ background: showSchedule ? `${theme.accent}15` : "#f1f0eb", color: showSchedule ? theme.accent : "#64748b" }}
            >
              {showSchedule ? "Calendar" : "Weekly Hours"}
            </button>
          </div>

          {showSchedule ? (
            /* ── Weekly Schedule ── */
            <div className="rounded-2xl p-4 space-y-2" style={{ background: "#ffffff", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}>
              <p className="text-[11px] text-slate-400 mb-2">Set your regular weekly hours. Admin sees this when scheduling.</p>
              {DAYS_OF_WEEK.map((day, i) => {
                const info = weekly[day] || { available: true, start: "08:00", end: "18:00" }
                return (
                  <div key={day} className="flex items-center gap-2 py-1.5" style={{ borderBottom: i < 6 ? "1px solid #f1f0eb" : "none" }}>
                    {/* Toggle */}
                    <button
                      onClick={() => updateWeeklyDay(day, { available: !info.available })}
                      className="size-7 rounded-lg text-[10px] font-bold flex items-center justify-center shrink-0 transition-all"
                      style={{
                        background: info.available ? `${theme.accent}15` : "#fee2e2",
                        color: info.available ? theme.accent : "#ef4444",
                        border: `2px solid ${info.available ? `${theme.accent}40` : "#fca5a540"}`,
                      }}
                    >
                      {DAY_LABELS[i]}
                    </button>

                    {info.available ? (
                      <div className="flex items-center gap-1.5 flex-1">
                        <select
                          value={info.start || "08:00"}
                          onChange={e => updateWeeklyDay(day, { start: e.target.value })}
                          className="text-xs bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 cursor-pointer"
                        >
                          {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatHour(t)}</option>)}
                        </select>
                        <span className="text-[10px] text-slate-400">to</span>
                        <select
                          value={info.end || "18:00"}
                          onChange={e => updateWeeklyDay(day, { end: e.target.value })}
                          className="text-xs bg-slate-50 border border-slate-200 rounded-md px-1.5 py-1 text-slate-600 cursor-pointer"
                        >
                          {TIME_OPTIONS.map(t => <option key={t} value={t}>{formatHour(t)}</option>)}
                        </select>
                      </div>
                    ) : (
                      <span className="text-xs text-red-400 font-medium">Off</span>
                    )}
                  </div>
                )
              })}
              {weeklyDirty && (
                <button
                  onClick={saveWeekly}
                  disabled={savingWeekly}
                  className="w-full mt-2 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity"
                  style={{ background: theme.accent, opacity: savingWeekly ? 0.6 : 1 }}
                >
                  {savingWeekly ? <><Loader2 className="size-4 animate-spin" /> Saving...</> : "Save Schedule"}
                </button>
              )}
            </div>
          ) : (
            /* ── Month Calendar ── */
            <div className="rounded-2xl p-4" style={{ background: "#ffffff", boxShadow: "0 2px 10px rgba(0,0,0,0.06)" }}>
              {/* Month nav */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={prevMonth} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
                  <ChevronLeft className="size-4 text-slate-500" />
                </button>
                <span className="text-sm font-bold text-slate-700">{monthName}</span>
                <button onClick={nextMonth} className="size-8 rounded-lg flex items-center justify-center hover:bg-slate-100 transition-colors">
                  <ChevronRight className="size-4 text-slate-500" />
                </button>
              </div>
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {DAY_LABELS.map((d, i) => (
                  <div key={i} className="text-center text-[10px] font-bold text-slate-400 py-1">{d}</div>
                ))}
              </div>
              {/* Day cells */}
              <div className="grid grid-cols-7 gap-1">
                {calDays.map((day, i) => {
                  if (day === null) return <div key={`e${i}`} />
                  const dateStr = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
                  const isOff = offDays.has(dateStr)
                  const isRecOff = isRecurringOff(day)
                  const isToday = dateStr === todayStr
                  const isPast = dateStr < todayStr
                  const isToggling = togglingDate === dateStr
                  const dayOff = isOff || isRecOff
                  return (
                    <button
                      key={dateStr}
                      onClick={() => !isPast && toggleDay(dateStr)}
                      disabled={isPast || isToggling}
                      className="relative size-9 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center justify-center"
                      style={{
                        background: isOff ? "#ef444420" : isRecOff ? "#ef444410" : isToday ? `${theme.accent}15` : "transparent",
                        color: isPast ? "#cbd5e1" : dayOff ? "#ef4444" : isToday ? theme.accent : "#475569",
                        border: isToday ? `2px solid ${theme.accent}` : dayOff ? "2px solid #ef444440" : "2px solid transparent",
                        opacity: isToggling ? 0.5 : 1,
                        cursor: isPast ? "default" : "pointer",
                      }}
                    >
                      {day}
                      {isOff && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-400" />}
                      {isRecOff && !isOff && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-2 h-0.5 rounded-full bg-red-300" />}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 mt-3 justify-center">
                <div className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-red-400" />
                  <span className="text-[10px] text-slate-400">Day off</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-0.5 rounded-full bg-red-300" />
                  <span className="text-[10px] text-slate-400">Weekly off</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 text-center">Tap a day to request off. Use &ldquo;Weekly Hours&rdquo; for recurring days.</p>
            </div>
          )}
        </div>

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
              <QuestCard key={job.id} job={job} token={token} index={i} theme={theme} urgent />
            ))}
          </Section>
        )}

        {/* ═══ TODAY'S HOUSES ═══ */}
        <Section title="Today's Houses" icon={<Zap className="size-4" />} color={theme.accent} count={todaysJobs.length} empty={todaysJobs.length === 0 ? "No houses today — rest up!" : undefined}>
          {todaysJobs.map((job, i) => (
            <QuestCard key={job.id} job={job} token={token} index={i} theme={theme} />
          ))}
        </Section>

        {/* ═══ COMING UP ═══ */}
        {upcomingJobs.length > 0 && (
          <Section title="Coming Up" icon={<Calendar className="size-4" />} color="#1cb0f6" count={upcomingJobs.length}>
            {upcomingJobs.map((job, i) => (
              <QuestCard key={job.id} job={job} token={token} index={i} theme={theme} />
            ))}
          </Section>
        )}

        {/* ═══ COMPLETED ═══ */}
        {pastJobs.length > 0 && (
          <Section title="Completed" icon={<CheckCircle2 className="size-4" />} color="#afafaf" count={pastJobs.length}>
            {pastJobs.map((job, i) => (
              <QuestCard key={job.id} job={job} token={token} index={i} theme={theme} completed />
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
function QuestCard({ job, token, index, theme, urgent, completed }: {
  job: JobCard; token: string; index: number; theme: typeof DEFAULT_THEME; urgent?: boolean; completed?: boolean
}) {
  const router = useRouter()
  const isEstimate = job.job_type === "estimate"
  const href = isEstimate ? `/crew/${token}/estimate/${job.id}` : `/crew/${token}/job/${job.id}`

  let statusIcon: React.ReactNode
  let statusText: string
  let statusColor: string
  if (job.assignment_status === "pending") {
    statusIcon = <AlertTriangle className="size-3.5" />; statusText = "Respond"; statusColor = "#ff4b4b"
  } else if (job.status === "completed") {
    statusIcon = <CheckCircle2 className="size-3.5" />; statusText = "Done"; statusColor = theme.accent
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
        <div
          className="size-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${statusColor}15`, border: `2px solid ${statusColor}30` }}
        >
          <span style={{ color: statusColor }}>{statusIcon}</span>
        </div>

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

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white" style={{ background: statusColor }}>
            {statusText}
          </span>
          <ChevronRight className="size-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
        </div>
      </div>
    </button>
  )
}
