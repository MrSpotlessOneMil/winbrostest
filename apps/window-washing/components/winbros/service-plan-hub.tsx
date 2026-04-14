'use client'

/**
 * Service Plan Hub — Blake's Financial Dashboard Layout
 *
 * Top row: 3 summary boxes (Sold ARR, Service Revenue, Pricing Hub)
 * Middle: ARR Booked horizontal bar chart (monthly)
 * Bottom right: Breakdown by plan type with trend line
 */

import { Badge } from '@/components/ui/badge'
import { DollarSign, TrendingUp, BookOpen, ArrowUpRight } from 'lucide-react'

interface PlanTypeARR {
  type: string
  label: string
  total_arr: number
  plan_count: number
  color: string
}

interface MonthlyARR {
  month: number
  month_name: string
  booked: number
  target: number
}

interface ServicePlanHubProps {
  year: number
  planTypes: PlanTypeARR[]
  monthlyArr: MonthlyARR[]
  totalArr: number
  totalPlans: number
  revenueThisYear?: number
  statusCounts: {
    active: number
    cancelled: number
    pending: number
  }
}

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString()}`
  }
  return `$${value}`
}

function formatCompact(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}k`
  }
  return `$${value}`
}

/** Simple inline SVG sparkline for the breakdown box */
function TrendSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const width = 120
  const height = 32
  const padding = 2

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2)
      const y = height - padding - ((val - min) / range) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="mt-1">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
}

export function ServicePlanHub({
  year,
  planTypes,
  monthlyArr,
  totalArr,
  totalPlans,
  revenueThisYear,
  statusCounts,
}: ServicePlanHubProps) {
  const ytdRevenue = revenueThisYear ?? monthlyArr.reduce((sum, m) => sum + m.booked, 0)
  const maxMonthlyBooked = Math.max(...monthlyArr.map(m => m.booked), 1)
  const yearTotal = monthlyArr.reduce((sum, m) => sum + m.booked, 0)

  // Build cumulative monthly data for the sparkline
  const cumulativeMonthly: number[] = []
  let running = 0
  for (const m of monthlyArr) {
    running += m.booked
    cumulativeMonthly.push(running)
  }

  // Derive breakdown values from planTypes
  const quarterlyArr = planTypes.find(p => p.type === 'quarterly')?.total_arr ?? 0
  const biannualArr = planTypes.find(p =>
    p.type === 'biannual' || p.type === 'triannual' || p.type === 'triannual_exterior'
  )?.total_arr ?? 0
  // Sum remaining types not already counted
  const knownTypes = new Set(['quarterly', 'biannual', 'triannual', 'triannual_exterior'])
  const referredArr = planTypes
    .filter(p => !knownTypes.has(p.type))
    .reduce((sum, p) => sum + p.total_arr, 0)

  return (
    <div className="space-y-6">
      {/* Header row with admin badge */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Service Plan Hub</h1>
          <p className="text-sm text-zinc-500">{year} Financial Overview</p>
        </div>
        <Badge variant="secondary" className="text-xs bg-zinc-800 text-zinc-400 border border-zinc-700">
          Admin view
        </Badge>
      </div>

      {/* ========== TOP ROW — 3 summary boxes ========== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* BOX 1: Sold */}
        <div className="relative overflow-hidden rounded-xl border border-teal-800/50 bg-gradient-to-br from-teal-950/60 to-zinc-950 p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-900/50">
              <DollarSign className="w-4 h-4 text-teal-400" />
            </div>
            <span className="text-sm font-semibold text-teal-400 uppercase tracking-wider">Sold</span>
          </div>
          <div className="text-3xl font-bold text-white">
            {formatCurrency(totalArr)}
          </div>
          <div className="text-sm text-teal-400/70 mt-1">ARR</div>
          <div className="flex items-center gap-1 mt-2">
            <Badge variant="secondary" className="text-[10px] bg-teal-900/30 text-teal-300 border-0">
              {statusCounts.active} active
            </Badge>
            <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-400 border-0">
              {totalPlans} total
            </Badge>
          </div>
        </div>

        {/* BOX 2: Service */}
        <div className="relative overflow-hidden rounded-xl border border-blue-800/50 bg-gradient-to-br from-blue-950/60 to-zinc-950 p-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-900/50">
              <TrendingUp className="w-4 h-4 text-blue-400" />
            </div>
            <span className="text-sm font-semibold text-blue-400 uppercase tracking-wider">Service</span>
          </div>
          <div className="text-3xl font-bold text-white">
            {formatCurrency(ytdRevenue)}
          </div>
          <div className="text-sm text-blue-400/70 mt-1">ARR</div>
          <div className="flex items-center gap-1 mt-2">
            <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-400 border-0">
              {statusCounts.pending} pending
            </Badge>
            <Badge variant="secondary" className="text-[10px] bg-red-900/30 text-red-400 border-0">
              {statusCounts.cancelled} cancelled
            </Badge>
          </div>
        </div>

        {/* BOX 3: Pricing Hub */}
        <div className="relative overflow-hidden rounded-xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 group cursor-pointer hover:border-zinc-600 transition-colors">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-800">
              <BookOpen className="w-4 h-4 text-zinc-400" />
            </div>
            <span className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Pricing Hub</span>
          </div>
          <div className="text-lg font-medium text-zinc-300 mt-1">
            Price Book
          </div>
          <div className="text-sm text-zinc-500 mt-1">View & manage pricing</div>
          <ArrowUpRight className="absolute top-4 right-4 w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
        </div>
      </div>

      {/* ========== MIDDLE + BOTTOM — Chart & Breakdown ========== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ARR Booked — Horizontal Bar Chart (spans 2 cols) */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-white">ARR Booked</h2>
              <p className="text-xs text-zinc-500">Monthly revenue booked in {year}</p>
            </div>
            <div className="text-right">
              <div className="text-sm text-zinc-400">Year totals</div>
              <div className="text-lg font-bold text-teal-400">{formatCurrency(yearTotal)}</div>
            </div>
          </div>

          {/* Horizontal bars */}
          <div className="space-y-2.5">
            {monthlyArr.map(m => {
              const pct = maxMonthlyBooked > 0 ? (m.booked / maxMonthlyBooked) * 100 : 0
              const hasValue = m.booked > 0
              return (
                <div key={m.month} className="flex items-center gap-3">
                  {/* Month label — fixed width */}
                  <div className="w-10 text-xs text-zinc-500 text-right font-medium shrink-0">
                    {m.month_name.slice(0, 3)}
                  </div>

                  {/* Bar track */}
                  <div className="flex-1 h-7 bg-zinc-900 rounded-md overflow-hidden relative">
                    {/* Filled bar */}
                    <div
                      className="h-full rounded-md transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.max(pct, hasValue ? 2 : 0)}%`,
                        background: hasValue
                          ? 'linear-gradient(90deg, #0d9488, #14b8a6)'
                          : 'transparent',
                      }}
                    />
                  </div>

                  {/* Dollar label */}
                  <div className="w-16 text-right text-xs font-medium text-zinc-300 shrink-0">
                    {hasValue ? formatCompact(m.booked) : '--'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Bottom Right — Breakdown Box */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
              Breakdown
            </h3>

            {/* Total */}
            <div className="mb-4 pb-4 border-b border-zinc-800">
              <div className="text-xs text-zinc-500">Total ARR</div>
              <div className="text-2xl font-bold text-white">{formatCurrency(totalArr)}</div>
            </div>

            {/* Plan type breakdown */}
            <div className="space-y-3">
              {planTypes.map(pt => {
                const pct = totalArr > 0 ? ((pt.total_arr / totalArr) * 100).toFixed(0) : '0'
                return (
                  <div key={pt.type} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: pt.color }}
                      />
                      <span className="text-sm text-zinc-300">{pt.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-semibold text-white">
                        {formatCurrency(pt.total_arr)}
                      </span>
                      <span className="text-xs text-zinc-500 ml-2">{pct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Referred / Other if any */}
            {referredArr > 0 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="text-sm text-zinc-300">Referred</span>
                </div>
                <span className="text-sm font-semibold text-white">
                  {formatCurrency(referredArr)}
                </span>
              </div>
            )}
          </div>

          {/* Trend sparkline */}
          <div className="mt-6 pt-4 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">YoY Trend</span>
              <TrendingUp className="w-3 h-3 text-teal-500" />
            </div>
            <TrendSparkline data={cumulativeMonthly} color="#14b8a6" />
          </div>
        </div>
      </div>
    </div>
  )
}
