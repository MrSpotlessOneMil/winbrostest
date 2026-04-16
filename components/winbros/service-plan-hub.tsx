'use client'

/**
 * Service Plan Hub — ARR Dashboard for WinBros
 *
 * Tracks Annual Recurring Revenue visually:
 * - Sold section: total ARR by plan type
 * - Monthly ARR booked: Jan-Dec with dollar amounts
 * - Year totals with bar chart
 * - See which months are down → schedule heavier
 */

import { Badge } from '@/components/ui/badge'
import { DollarSign, TrendingUp, Calendar, BarChart3 } from 'lucide-react'

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
  statusCounts: {
    active: number
    cancelled: number
    pending: number
  }
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function ServicePlanHub({
  year,
  planTypes,
  monthlyArr,
  totalArr,
  totalPlans,
  statusCounts,
}: ServicePlanHubProps) {
  const maxMonthlyArr = Math.max(...monthlyArr.map(m => m.booked), 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Service Plan Hub</h2>
          <p className="text-sm text-zinc-400">ARR tracking for {year}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">
            ${totalArr.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-400">Total ARR</div>
        </div>
      </div>

      {/* Status counts */}
      <div className="flex gap-3">
        <Badge variant="secondary" className="text-xs bg-green-900/30 text-green-400">
          {statusCounts.active} Active
        </Badge>
        <Badge variant="secondary" className="text-xs bg-zinc-800 text-zinc-400">
          {statusCounts.pending} Pending
        </Badge>
        <Badge variant="secondary" className="text-xs bg-red-900/30 text-red-400">
          {statusCounts.cancelled} Cancelled
        </Badge>
        <Badge variant="secondary" className="text-xs bg-zinc-800 text-zinc-300">
          {totalPlans} Total Plans
        </Badge>
      </div>

      {/* ARR by Plan Type */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {planTypes.map(pt => (
          <div
            key={pt.type}
            className="border border-zinc-800 rounded-lg bg-zinc-950 p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pt.color }} />
              <span className="text-xs font-medium text-zinc-400">{pt.label}</span>
            </div>
            <div className="text-lg font-bold text-white">
              ${pt.total_arr.toLocaleString()}
            </div>
            <div className="text-xs text-zinc-500">{pt.plan_count} plans</div>
          </div>
        ))}
      </div>

      {/* Monthly ARR Chart */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-semibold text-zinc-300">Monthly ARR Booked</h3>
        </div>

        <div className="grid grid-cols-12 gap-1.5 h-40">
          {monthlyArr.map(m => {
            const heightPct = maxMonthlyArr > 0 ? (m.booked / maxMonthlyArr) * 100 : 0
            const isLow = m.booked < (totalArr / 12) * 0.7 // Below 70% of average
            return (
              <div key={m.month} className="flex flex-col items-center justify-end h-full">
                <div className="text-[10px] text-zinc-400 mb-1">
                  ${(m.booked / 1000).toFixed(1)}k
                </div>
                <div
                  className={`w-full rounded-t transition-all ${
                    isLow ? 'bg-red-600/60' : 'bg-blue-600/60'
                  }`}
                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                />
                <div className="text-[10px] text-zinc-500 mt-1">
                  {MONTH_NAMES[m.month - 1]}
                </div>
              </div>
            )
          })}
        </div>

        {/* Low months warning */}
        {monthlyArr.some(m => m.booked < (totalArr / 12) * 0.7 && m.booked > 0) && (
          <div className="mt-3 p-2 bg-red-900/20 border border-red-900/30 rounded text-xs text-red-400">
            <TrendingUp className="w-3 h-3 inline mr-1" />
            Some months are below target. Consider scheduling heavier in red months.
          </div>
        )}
      </div>

      {/* Monthly Detail Table */}
      <div className="border border-zinc-800 rounded-lg bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="text-left p-3">Month</th>
                <th className="text-right p-3">Booked</th>
                <th className="text-right p-3">Target</th>
                <th className="text-right p-3">Variance</th>
              </tr>
            </thead>
            <tbody>
              {monthlyArr.map(m => {
                const variance = m.booked - m.target
                return (
                  <tr key={m.month} className="border-b border-zinc-900">
                    <td className="p-3 text-white">{m.month_name}</td>
                    <td className="text-right p-3 text-zinc-300">${m.booked.toLocaleString()}</td>
                    <td className="text-right p-3 text-zinc-500">${m.target.toLocaleString()}</td>
                    <td className={`text-right p-3 font-medium ${variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {variance >= 0 ? '+' : ''}{variance.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
