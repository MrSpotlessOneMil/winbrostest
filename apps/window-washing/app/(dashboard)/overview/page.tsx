"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import Link from "next/link"
import {
  DollarSign,
  CalendarCheck,
  CalendarDays,
  Repeat,
  Target,
  Users,
  Loader2,
  TrendingUp,
  MapPin,
  ArrowRight,
  Briefcase,
  BarChart3,
  Wallet,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface DashboardData {
  revenue: {
    today: number
    week: number
    month: number
  }
  jobs: {
    activeToday: number
    completedToday: number
    upcomingThisWeek: number
    totalToday: number
  }
  servicePlans: {
    activeCount: number
    totalARR: number
  }
  pipeline: {
    outstandingQuotes: number
    pipelineValue: number
  }
  teamUtilization: {
    crewsWorking: number
    totalCrews: number
  }
  schedulePreview: Array<{
    id: number
    customer: string
    address: string
    time: string
    price: number
    status: string
    service: string
    team_id: number | null
  }>
}

function formatCurrency(val: number): string {
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function formatTime(hhmm: string | null | undefined): string {
  const s = String(hhmm || "")
  if (!/^\d{2}:\d{2}/.test(s)) return ""
  const [hStr, mStr] = s.split(":")
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ""
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function serviceLabel(s: string): string {
  switch (s) {
    case "window_cleaning": return "Windows"
    case "pressure_washing": return "Pressure Wash"
    case "gutter_cleaning": return "Gutters"
    case "full_service": return "Full Service"
    default: return s.replace(/_/g, " ")
  }
}

const statusBadge: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Scheduled", cls: "bg-zinc-700/60 text-zinc-300" },
  confirmed: { label: "Confirmed", cls: "bg-blue-500/15 text-blue-400" },
  in_progress: { label: "In Progress", cls: "bg-teal-500/15 text-teal-400" },
  completed: { label: "Done", cls: "bg-emerald-500/15 text-emerald-400" },
}

export default function CommandCenterPage() {
  const { user } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const res = await fetch("/api/actions/dashboard", { cache: "no-store" })
      if (res.ok) {
        const json = await res.json()
        setData(json.data || null)
      }
    } catch {
      // API may not be deployed yet
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
    // Auto-refresh every 60s
    const iv = setInterval(() => fetchDashboard(true), 60000)
    return () => clearInterval(iv)
  }, [fetchDashboard])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  const d = data || {
    revenue: { today: 0, week: 0, month: 0 },
    jobs: { activeToday: 0, completedToday: 0, upcomingThisWeek: 0, totalToday: 0 },
    servicePlans: { activeCount: 0, totalARR: 0 },
    pipeline: { outstandingQuotes: 0, pipelineValue: 0 },
    teamUtilization: { crewsWorking: 0, totalCrews: 0 },
    schedulePreview: [],
  }

  const utilPct = d.teamUtilization.totalCrews > 0
    ? Math.round((d.teamUtilization.crewsWorking / d.teamUtilization.totalCrews) * 100)
    : 0

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-white truncate">
            Command Center
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <button
          onClick={() => fetchDashboard(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Revenue Row - 3 cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="Today's Revenue"
          value={formatCurrency(d.revenue.today)}
          icon={DollarSign}
          accent="text-emerald-400"
          accentBg="bg-emerald-500/10"
          sub={`${d.jobs.completedToday} jobs completed`}
        />
        <MetricCard
          label="This Week"
          value={formatCurrency(d.revenue.week)}
          icon={TrendingUp}
          accent="text-blue-400"
          accentBg="bg-blue-500/10"
          sub={`${d.jobs.upcomingThisWeek} upcoming`}
        />
        <MetricCard
          label="This Month"
          value={formatCurrency(d.revenue.month)}
          icon={BarChart3}
          accent="text-violet-400"
          accentBg="bg-violet-500/10"
          sub="total completed revenue"
        />
      </div>

      {/* Operational Row - 4 cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Active Jobs Today"
          value={String(d.jobs.activeToday)}
          icon={Briefcase}
          accent="text-teal-400"
          accentBg="bg-teal-500/10"
          sub={`${d.jobs.totalToday} total scheduled`}
        />
        <MetricCard
          label="Upcoming This Week"
          value={String(d.jobs.upcomingThisWeek)}
          icon={CalendarDays}
          accent="text-amber-400"
          accentBg="bg-amber-500/10"
          sub="scheduled jobs"
        />
        <MetricCard
          label="Service Plans"
          value={String(d.servicePlans.activeCount)}
          icon={Repeat}
          accent="text-purple-400"
          accentBg="bg-purple-500/10"
          sub={`${formatCurrency(d.servicePlans.totalARR)} ARR`}
        />
        <MetricCard
          label="Pipeline"
          value={String(d.pipeline.outstandingQuotes)}
          icon={Target}
          accent="text-orange-400"
          accentBg="bg-orange-500/10"
          sub={`${formatCurrency(d.pipeline.pipelineValue)} value`}
        />
      </div>

      {/* Middle: Schedule Preview + Team Status */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today's Schedule Preview */}
        <div className="lg:col-span-2 border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-teal-400" />
                Today's Schedule
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {d.jobs.totalToday} jobs | {d.jobs.completedToday} completed
              </p>
            </div>
            <Link
              href="/schedule"
              className="text-xs text-teal-400 hover:text-teal-300 font-medium flex items-center gap-1 transition-colors"
            >
              Full schedule
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {d.schedulePreview.length > 0 ? (
            <div className="divide-y divide-zinc-800/40">
              {d.schedulePreview.map((job) => {
                const badge = statusBadge[job.status] || statusBadge.scheduled
                return (
                  <div
                    key={job.id}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-zinc-800/30 transition-colors"
                  >
                    {/* Time */}
                    <div className="w-16 shrink-0 text-right">
                      <span className="text-sm font-mono text-zinc-300">
                        {formatTime(job.time) || "--:--"}
                      </span>
                    </div>

                    {/* Divider dot */}
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        job.status === "in_progress" ? "bg-teal-400 animate-pulse" : "bg-zinc-600"
                      )}
                    />

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-200 truncate">
                          {job.customer}
                        </span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", badge.cls)}>
                          {badge.label}
                        </span>
                      </div>
                      {job.address && (
                        <p className="text-xs text-zinc-500 truncate flex items-center gap-1 mt-0.5">
                          <MapPin className="h-2.5 w-2.5 shrink-0" />
                          {job.address}
                        </p>
                      )}
                    </div>

                    {/* Service + Price */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-zinc-200">
                        {formatCurrency(job.price)}
                      </p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">
                        {serviceLabel(job.service)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CalendarCheck className="h-8 w-8 text-zinc-700 mb-2" />
              <p className="text-sm text-zinc-500">No jobs scheduled today</p>
            </div>
          )}
        </div>

        {/* Team Status */}
        <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800/60">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Users className="h-4 w-4 text-teal-400" />
              Team Status
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">Crew utilization today</p>
          </div>
          <div className="p-5 space-y-5">
            {/* Utilization gauge */}
            <div className="text-center">
              <div className="relative inline-flex items-center justify-center w-28 h-28">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                  <circle
                    cx="56" cy="56" r="48"
                    fill="none" stroke="currentColor"
                    className="text-zinc-800"
                    strokeWidth="8"
                  />
                  <circle
                    cx="56" cy="56" r="48"
                    fill="none" stroke="currentColor"
                    className="text-teal-400"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(utilPct / 100) * 301.6} 301.6`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-white">{utilPct}%</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Util.</span>
                </div>
              </div>
            </div>

            {/* Crew counts */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-zinc-800/40 p-3 text-center">
                <p className="text-lg font-bold text-white">{d.teamUtilization.crewsWorking}</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">Working</p>
              </div>
              <div className="rounded-lg bg-zinc-800/40 p-3 text-center">
                <p className="text-lg font-bold text-white">{d.teamUtilization.totalCrews}</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">Total Crews</p>
              </div>
            </div>

            {/* Summary stats */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 flex items-center gap-1.5">
                  <Repeat className="h-3 w-3" />
                  Service Plans
                </span>
                <span className="text-zinc-200 font-medium">{d.servicePlans.activeCount} active</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 flex items-center gap-1.5">
                  <Wallet className="h-3 w-3" />
                  Plan ARR
                </span>
                <span className="text-zinc-200 font-medium">{formatCurrency(d.servicePlans.totalARR)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500 flex items-center gap-1.5">
                  <Target className="h-3 w-3" />
                  Quote Pipeline
                </span>
                <span className="text-zinc-200 font-medium">{d.pipeline.outstandingQuotes} quotes</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction href="/quotes" icon={Target} label="Pipeline" accent="text-orange-400" />
          <QuickAction href="/schedule" icon={CalendarDays} label="Schedule" accent="text-teal-400" />
          <QuickAction href="/payroll" icon={DollarSign} label="Payroll" accent="text-emerald-400" />
          <QuickAction href="/service-plan-hub" icon={Repeat} label="Service Plans" accent="text-purple-400" />
        </div>
      </div>
    </div>
  )
}

// ---- Sub-components ----

interface MetricCardProps {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  accentBg: string
  sub?: string
}

function MetricCard({ label, value, icon: Icon, accent, accentBg, sub }: MetricCardProps) {
  return (
    <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-4 hover:bg-zinc-900/80 transition-colors">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
          {sub && (
            <p className="text-xs text-zinc-500">{sub}</p>
          )}
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", accentBg)}>
          <Icon className={cn("h-[18px] w-[18px]", accent)} />
        </div>
      </div>
    </div>
  )
}

interface QuickActionProps {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  accent: string
}

function QuickAction({ href, icon: Icon, label, accent }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/70 p-3 transition-colors group"
    >
      <Icon className={cn("h-4 w-4", accent)} />
      <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">
        {label}
      </span>
      <ArrowRight className="h-3 w-3 text-zinc-600 group-hover:text-zinc-400 transition-colors ml-auto" />
    </Link>
  )
}
