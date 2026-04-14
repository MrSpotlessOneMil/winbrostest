"use client"

import { useState, useEffect, useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import {
  BarChart3,
  Loader2,
  Users,
  Target,
  Crown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

/* ── Types ────────────────────────────────────────────────────────────────── */

type Period = "day" | "week" | "month"

interface TeamLeadRow {
  id: number
  name: string
  revenue: number
  jobs_completed: number
  upsells: number
  days_worked: number
  reviews: number
}

interface AdminTeamRow {
  id: number
  name: string
  area: string
  one_time_revenue: number
  plan_revenue: number
  days_worked: number
}

interface SalesRow {
  id: number
  name: string
  arr_sold: number
  one_time_sales: number
  plan_sales: number
  plans_sold: number
}

interface PerformanceData {
  period: string
  start: string
  end: string
  team_leads: TeamLeadRow[]
  admin_team: AdminTeamRow[]
  sales: SalesRow[]
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatCurrency(val: number): string {
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function shiftDate(date: string, period: Period, dir: -1 | 1): string {
  const d = new Date(date + "T12:00:00")
  if (period === "day") d.setDate(d.getDate() + dir)
  else if (period === "week") d.setDate(d.getDate() + dir * 7)
  else d.setMonth(d.getMonth() + dir)
  return fmtDate(d)
}

function periodLabel(period: Period, start: string, end: string): string {
  const s = new Date(start + "T12:00:00")
  const e = new Date(end + "T12:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  if (period === "day") {
    return s.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  }
  if (period === "month") {
    return s.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function PerformancePage() {
  const { user, isAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>("week")
  const [anchor, setAnchor] = useState(fmtDate(new Date()))
  const [data, setData] = useState<PerformanceData | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/actions/performance?period=${period}&date=${anchor}`)
      const json = await res.json()
      if (json.success) {
        setData(json)
      } else {
        setError(json.error ?? "Failed to load performance data")
      }
    } catch {
      setError("Failed to load performance data")
    } finally {
      setLoading(false)
    }
  }, [period, anchor])

  useEffect(() => {
    load()
  }, [load])

  const handlePrev = () => setAnchor((a) => shiftDate(a, period, -1))
  const handleNext = () => setAnchor((a) => shiftDate(a, period, 1))

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-5">
      {/* Header + Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Team Performance
          </h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data ? periodLabel(period, data.start, data.end) : "Loading..."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Period toggle */}
          <div className="flex rounded-lg border border-zinc-700 overflow-hidden text-xs">
            {(["day", "week", "month"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                  period === p
                    ? "bg-teal-600 text-white"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Prev / Next */}
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrev}
              className="p-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setAnchor(fmtDate(new Date()))}
              className="px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-900 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Today
            </button>
            <button
              onClick={handleNext}
              className="p-1.5 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm py-4">{error}</p>
      )}

      {/* Three sections — filtered for non-admin users */}
      {!loading && !error && data && (() => {
        // For field users, match by display_name or username to find their row
        const userName = user?.display_name || user?.username || ""
        const nameMatch = (rowName: string) =>
          userName.length > 0 && rowName.toLowerCase().includes(userName.toLowerCase())

        // Determine which sections to show for non-admin users
        const myTeamLeadRow = data.team_leads.find((r) => nameMatch(r.name))
        const mySalesRow = data.sales.find((r) => nameMatch(r.name))

        // Filter data for non-admin users
        const visibleTeamLeads = isAdmin
          ? data.team_leads
          : myTeamLeadRow
            ? [myTeamLeadRow]
            : []
        const visibleSales = isAdmin
          ? data.sales
          : mySalesRow
            ? [mySalesRow]
            : []

        // Non-admin: show team leads section if they are a team lead or technician
        // Show sales section if they are a salesman
        // Never show admin team section for non-admin users
        const showTeamLeads = isAdmin || visibleTeamLeads.length > 0 || (!mySalesRow)
        const showAdminTeam = isAdmin
        const showSales = isAdmin || visibleSales.length > 0

        return (
        <div className={`grid grid-cols-1 ${isAdmin ? "lg:grid-cols-3" : showTeamLeads && showSales ? "lg:grid-cols-2" : ""} gap-5`}>
          {/* Section 1: Team Leads */}
          {showTeamLeads && (
          <SectionCard
            icon={<Crown className="w-4 h-4 text-amber-400" />}
            title={isAdmin ? "Team Leads" : "Your Performance"}
          >
            {visibleTeamLeads.length === 0 ? (
              <EmptyState text="No team lead data for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left py-2 pr-2 font-medium">Name</th>
                      <th className="text-right py-2 px-1 font-medium">Revenue</th>
                      <th className="text-right py-2 px-1 font-medium">Jobs</th>
                      <th className="text-right py-2 px-1 font-medium">Upsells</th>
                      <th className="text-right py-2 px-1 font-medium">Days</th>
                      <th className="text-right py-2 pl-1 font-medium">Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeamLeads.map((row, i) => (
                      <tr
                        key={row.id}
                        className={`border-b border-zinc-800/40 ${
                          i % 2 === 1 ? "bg-zinc-900/40" : ""
                        }`}
                      >
                        <td className="py-2 pr-2 text-white font-medium whitespace-nowrap">
                          {row.name}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-200">
                          {formatCurrency(row.revenue)}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-300">
                          {row.jobs_completed}
                        </td>
                        <td className="py-2 px-1 text-right text-teal-400">
                          {formatCurrency(row.upsells)}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-300">
                          {row.days_worked}
                        </td>
                        <td className="py-2 pl-1 text-right">
                          <PerformanceBadge value={row.reviews} threshold={2} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          )}

          {/* Section 2: Admin Team Performance — admin only */}
          {showAdminTeam && (
          <SectionCard
            icon={<Users className="w-4 h-4 text-blue-400" />}
            title="Admin Team Performance"
          >
            {data.admin_team.length === 0 ? (
              <EmptyState text="No employee data for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left py-2 pr-2 font-medium">Name</th>
                      <th className="text-left py-2 px-1 font-medium">Area</th>
                      <th className="text-right py-2 px-1 font-medium">1-Time</th>
                      <th className="text-right py-2 px-1 font-medium">Plan $</th>
                      <th className="text-right py-2 pl-1 font-medium">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.admin_team.map((row, i) => (
                      <tr
                        key={row.id}
                        className={`border-b border-zinc-800/40 ${
                          i % 2 === 1 ? "bg-zinc-900/40" : ""
                        }`}
                      >
                        <td className="py-2 pr-2 text-white font-medium whitespace-nowrap">
                          {row.name}
                        </td>
                        <td className="py-2 px-1 text-zinc-400 whitespace-nowrap truncate max-w-[80px]">
                          {row.area || "-"}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-200">
                          {formatCurrency(row.one_time_revenue)}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-200">
                          {formatCurrency(row.plan_revenue)}
                        </td>
                        <td className="py-2 pl-1 text-right text-zinc-300">
                          {row.days_worked}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          )}

          {/* Section 3: Sales Performance */}
          {showSales && (
          <SectionCard
            icon={<Target className="w-4 h-4 text-emerald-400" />}
            title={isAdmin ? "Sales Performance" : "Your Sales"}
          >
            {visibleSales.length === 0 ? (
              <EmptyState text="No sales data for this period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-500 border-b border-zinc-800">
                      <th className="text-left py-2 pr-2 font-medium">Name</th>
                      <th className="text-right py-2 px-1 font-medium">ARR</th>
                      <th className="text-right py-2 px-1 font-medium">1-Time</th>
                      <th className="text-right py-2 px-1 font-medium">Plan $</th>
                      <th className="text-right py-2 pl-1 font-medium">Plans</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSales.map((row, i) => (
                      <tr
                        key={row.id}
                        className={`border-b border-zinc-800/40 ${
                          i % 2 === 1 ? "bg-zinc-900/40" : ""
                        }`}
                      >
                        <td className="py-2 pr-2 text-white font-medium whitespace-nowrap">
                          {row.name}
                        </td>
                        <td className="py-2 px-1 text-right text-emerald-400 font-medium">
                          {formatCurrency(row.arr_sold)}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-200">
                          {row.one_time_sales}
                        </td>
                        <td className="py-2 px-1 text-right text-zinc-200">
                          {formatCurrency(row.plan_sales)}
                        </td>
                        <td className="py-2 pl-1 text-right">
                          <PerformanceBadge value={row.plans_sold} threshold={3} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
          )}
        </div>
        )
      })()}
    </div>
  )
}

/* ── Sub-components ───────────────────────────────────────────────────────── */

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
      <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2 mb-4">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-xs text-zinc-500 py-4 text-center">{text}</p>
}

function PerformanceBadge({
  value,
  threshold,
}: {
  value: number
  threshold: number
}) {
  if (value === 0) {
    return <span className="text-zinc-500">0</span>
  }
  const isGood = value >= threshold
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
        isGood
          ? "bg-emerald-500/20 text-emerald-400"
          : "bg-amber-500/20 text-amber-400"
      }`}
    >
      {value}
    </span>
  )
}
