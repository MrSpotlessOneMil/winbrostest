'use client'

/**
 * Payroll Week View for WinBros
 *
 * Blake's spec: Unified payroll table with per-employee breakdown.
 * - Week selector at top (< Week of Apr 14 >)
 * - Technicians section: Name | Role | Revenue (Upsell) | Pay Rate | Hours | Reviews | Total Pay
 * - Salesmen section: Name | Role | Revenue (1-Time) | Revenue (Triannual) | Revenue (Quarterly) | Commission | Total Pay
 * - Salesman commission on ORIGINAL QUOTE revenue only
 * - Tech pay on completed revenue + upsells
 * - Weekly totals at bottom
 *
 * CRITICAL: Pay rates are frozen per week. Changing current rates does NOT affect past weeks.
 */

import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type PayMode = 'hourly' | 'percentage'

interface TechEntry {
  cleaner_id: number
  name: string
  role: 'technician' | 'team_lead'
  revenue_completed: number
  revenue_sold: number
  revenue_upsell: number
  pay_mode: PayMode
  pay_percentage: number
  hours_worked: number
  overtime_hours: number
  hourly_rate: number
  review_count: number
  total_pay: number
}

interface SalesmanEntry {
  cleaner_id: number
  name: string
  revenue_1time: number
  revenue_triannual: number
  revenue_quarterly: number
  commission_1time_pct: number
  commission_triannual_pct: number
  commission_quarterly_pct: number
  /** Phase F (2026-04-27): 12.5% of appointment quoted price, frozen weekly. */
  commission_appointment_pct?: number
  /** Phase F: sum of earned-and-settled appointment credits this week. */
  commission_appointment_amount?: number
  /** Phase F: sum of appointment quoted prices behind the earned credits (audit). */
  revenue_appointments_set?: number
  /** Phase F: live-overlay sum of pending credits not yet earned (next-week view). */
  appointment_pending_amount?: number
  /** Phase F: count of pending credits (e.g. "3 in flight"). */
  appointment_pending_count?: number
  total_pay: number
}

interface PayrollWeekProps {
  weekStart: string
  weekEnd: string
  technicians: TechEntry[]
  salesmen: SalesmanEntry[]
  status: 'draft' | 'finalized'
  onWeekChange: (direction: -1 | 1) => void
  onEmployeeClick: (cleanerId: number) => void
  onReviewCountChange?: (cleanerId: number, count: number) => void
  onPayRateChange?: (cleanerId: number, field: 'hourly_rate' | 'pay_percentage', value: number) => void
  onPayModeChange?: (cleanerId: number, mode: PayMode) => void
  onSalesCommissionChange?: (cleanerId: number, field: 'commission_1time_pct' | 'commission_triannual_pct' | 'commission_quarterly_pct', value: number) => void
}

function formatWeekLabel(start: string): string {
  const d = new Date(start + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00')
  const e = new Date(end + 'T12:00:00')
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' })
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' })
  const sDay = s.getDate()
  const eDay = e.getDate()
  if (sMonth === eMonth) {
    return `${sMonth} ${sDay} - ${eDay}`
  }
  return `${sMonth} ${sDay} - ${eMonth} ${eDay}`
}

function $(n: number): string {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PayrollWeek({
  weekStart,
  weekEnd,
  technicians,
  salesmen,
  status,
  onWeekChange,
  onEmployeeClick,
  onReviewCountChange,
  onPayRateChange,
  onPayModeChange,
  onSalesCommissionChange,
}: PayrollWeekProps) {
  const REVIEW_BONUS = 10

  const techTotalPay = technicians.reduce((s, t) => s + t.total_pay + (t.review_count || 0) * REVIEW_BONUS, 0)
  const techTotalUpsell = technicians.reduce((s, t) => s + t.revenue_upsell, 0)
  const techTotalReviews = technicians.reduce((s, t) => s + (t.review_count || 0), 0)
  const salesTotalPay = salesmen.reduce((s, e) => s + e.total_pay, 0)
  const salesTotalRevenue = salesmen.reduce((s, e) => s + e.revenue_1time + e.revenue_triannual + e.revenue_quarterly, 0)
  const grandTotalPay = techTotalPay + salesTotalPay
  const grandTotalRevenue = techTotalUpsell + salesTotalRevenue

  return (
    <div className="space-y-6">
      {/* Week selector header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onWeekChange(-1)}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Week of {formatWeekLabel(weekStart)}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">{formatDateRange(weekStart, weekEnd)}</p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <Badge
              variant={status === 'finalized' ? 'default' : 'secondary'}
              className={
                status === 'finalized'
                  ? 'bg-green-900/40 text-green-400 border border-green-800 text-xs'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700 text-xs'
              }
            >
              {status === 'finalized' ? 'Finalized' : 'Draft'}
            </Badge>
          </div>
        </div>

        <button
          onClick={() => onWeekChange(1)}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-white cursor-pointer"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total Revenue</p>
          <p className="text-lg font-bold text-white mt-1">{$(grandTotalRevenue)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Total Payroll</p>
          <p className="text-lg font-bold text-green-400 mt-1">{$(grandTotalPay)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Margin</p>
          <p className="text-lg font-bold text-white mt-1">
            {grandTotalRevenue > 0
              ? `${((1 - grandTotalPay / grandTotalRevenue) * 100).toFixed(1)}%`
              : '--'}
          </p>
        </div>
      </div>

      {/* Technicians / Team Leads table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Technicians / Team Leads</h2>
          <span className="text-sm font-semibold text-green-400">{$(techTotalPay)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Role</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Revenue (Upsell)</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Pay Rate</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Hours</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Reviews</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide font-semibold">Total Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {technicians.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-600 text-sm">
                    No technician data for this week
                  </td>
                </tr>
              ) : (
                <>
                  {technicians.map(tech => {
                    const mode: PayMode = tech.pay_mode || 'hourly'
                    const isHourly = mode === 'hourly'
                    const reviewBonus = (tech.review_count || 0) * REVIEW_BONUS

                    return (
                      <tr
                        key={tech.cleaner_id}
                        className="hover:bg-zinc-900/60 transition-colors cursor-pointer"
                        onClick={() => onEmployeeClick(tech.cleaner_id)}
                      >
                        <td className="px-4 py-3 text-white font-medium">{tech.name}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={
                              tech.role === 'team_lead'
                                ? 'border-blue-700 text-blue-400 text-[10px]'
                                : 'border-zinc-700 text-zinc-400 text-[10px]'
                            }
                          >
                            {tech.role === 'team_lead' ? 'TL' : 'Tech'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {tech.revenue_upsell > 0 ? (
                            <span className="text-emerald-400">{$(tech.revenue_upsell)}</span>
                          ) : (
                            <span className="text-zinc-600">$0.00</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            {/* Mode toggle — hourly XOR percentage */}
                            <div className="inline-flex rounded-md bg-zinc-800 border border-zinc-700 p-0.5" role="group">
                              <button
                                type="button"
                                onClick={() => onPayModeChange?.(tech.cleaner_id, 'hourly')}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${isHourly ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                Hourly
                              </button>
                              <button
                                type="button"
                                onClick={() => onPayModeChange?.(tech.cleaner_id, 'percentage')}
                                className={`px-2 py-0.5 text-[10px] font-medium rounded cursor-pointer transition-colors ${!isHourly ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                              >
                                %
                              </button>
                            </div>

                            {/* Active field only (greyed other) */}
                            {isHourly ? (
                              <div className="flex items-center gap-0.5">
                                <span className="text-[10px] text-zinc-500">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.50"
                                  value={tech.hourly_rate || 0}
                                  onChange={e => onPayRateChange?.(tech.cleaner_id, 'hourly_rate', Math.max(0, parseFloat(e.target.value) || 0))}
                                  className="w-14 text-right bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-sm text-white focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-[10px] text-zinc-500">/hr</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={tech.pay_percentage || 0}
                                  onChange={e => onPayRateChange?.(tech.cleaner_id, 'pay_percentage', Math.max(0, parseFloat(e.target.value) || 0))}
                                  className="w-12 text-right bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-sm text-white focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <span className="text-[10px] text-zinc-500">%</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          {isHourly && tech.hours_worked > 0 ? (
                            <span>
                              {tech.hours_worked.toFixed(1)}h
                              {tech.overtime_hours > 0 && (
                                <span className="text-amber-400 ml-1 text-xs">+{tech.overtime_hours.toFixed(1)} OT</span>
                              )}
                            </span>
                          ) : isHourly ? (
                            <span className="text-zinc-600">0h</span>
                          ) : (
                            <span className="text-zinc-600">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min={0}
                              value={tech.review_count || 0}
                              onChange={e => onReviewCountChange?.(tech.cleaner_id, Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-12 text-right bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-sm text-white focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            {(tech.review_count || 0) > 0 && (
                              <span className="text-emerald-400 text-xs whitespace-nowrap">+{$(reviewBonus)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-white">{$(tech.total_pay + reviewBonus)}</td>
                      </tr>
                    )
                  })}
                  {/* Technician subtotal row */}
                  <tr className="bg-zinc-900/40 border-t border-zinc-800">
                    <td className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase" colSpan={2}>Subtotal</td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-emerald-400">{$(techTotalUpsell)}</td>
                    <td className="px-4 py-2.5" colSpan={2}></td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-300">{techTotalReviews} reviews</td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-green-400">{$(techTotalPay)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Salesmen table */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <div className="bg-zinc-900 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Salesmen</h2>
          <span className="text-sm font-semibold text-green-400">{$(salesTotalPay)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-950 border-b border-zinc-800">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Role</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">1-Time Revenue</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Triannual Revenue</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Quarterly Revenue</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide">Commission</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide" title="Earned appointment-set commission this week (12.5% of appt quoted price). Pending credits show below in italics until they convert.">
                  Appt&nbsp;$
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-500 uppercase tracking-wide font-semibold">Total Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {salesmen.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-zinc-600 text-sm">
                    No salesman data for this week
                  </td>
                </tr>
              ) : (
                <>
                  {salesmen.map(s => {
                    const comm1 = s.revenue_1time * s.commission_1time_pct / 100
                    const commTri = s.revenue_triannual * s.commission_triannual_pct / 100
                    const commQ = s.revenue_quarterly * s.commission_quarterly_pct / 100
                    const totalComm = comm1 + commTri + commQ

                    return (
                      <tr
                        key={s.cleaner_id}
                        className="hover:bg-zinc-900/60 transition-colors cursor-pointer"
                        onClick={() => onEmployeeClick(s.cleaner_id)}
                      >
                        <td className="px-4 py-3 text-white font-medium">{s.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="border-amber-700 text-amber-400 text-[10px]">
                            Sales
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-300" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <span>{$(s.revenue_1time)}</span>
                            <div className="flex items-center gap-0.5 ml-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={s.commission_1time_pct || 0}
                                onChange={e => onSalesCommissionChange?.(s.cleaner_id, 'commission_1time_pct', Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-10 text-right bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-400 focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-zinc-600">%</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-300" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <span>{$(s.revenue_triannual)}</span>
                            <div className="flex items-center gap-0.5 ml-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={s.commission_triannual_pct || 0}
                                onChange={e => onSalesCommissionChange?.(s.cleaner_id, 'commission_triannual_pct', Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-10 text-right bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-400 focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-zinc-600">%</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-300" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <span>{$(s.revenue_quarterly)}</span>
                            <div className="flex items-center gap-0.5 ml-1">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={s.commission_quarterly_pct || 0}
                                onChange={e => onSalesCommissionChange?.(s.cleaner_id, 'commission_quarterly_pct', Math.max(0, parseFloat(e.target.value) || 0))}
                                className="w-10 text-right bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-400 focus:border-zinc-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-zinc-600">%</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          {$(totalComm)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(s.commission_appointment_amount ?? 0) > 0 ? (
                            <span className="text-emerald-400 font-medium">
                              {$(s.commission_appointment_amount ?? 0)}
                            </span>
                          ) : (
                            <span className="text-zinc-600">--</span>
                          )}
                          {(s.appointment_pending_amount ?? 0) > 0 && (
                            <div
                              className="text-[10px] italic text-amber-400/80 mt-0.5"
                              title={`${s.appointment_pending_count ?? 0} appointment credit(s) pending — earn on quote-conversion`}
                            >
                              +{$(s.appointment_pending_amount ?? 0)} pending
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-white">{$(s.total_pay)}</td>
                      </tr>
                    )
                  })}
                  {/* Salesman subtotal row */}
                  <tr className="bg-zinc-900/40 border-t border-zinc-800">
                    <td className="px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase" colSpan={2}>Subtotal</td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-300">
                      {$(salesmen.reduce((s, e) => s + e.revenue_1time, 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-300">
                      {$(salesmen.reduce((s, e) => s + e.revenue_triannual, 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-zinc-300">
                      {$(salesmen.reduce((s, e) => s + e.revenue_quarterly, 0))}
                    </td>
                    <td className="px-4 py-2.5"></td>
                    <td className="px-4 py-2.5 text-right text-xs font-semibold text-emerald-400">
                      {$(salesmen.reduce((s, e) => s + (e.commission_appointment_amount ?? 0), 0))}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-bold text-green-400">{$(salesTotalPay)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grand total bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide">Weekly Total Payroll</p>
          <p className="text-sm text-zinc-400 mt-0.5">
            {technicians.length + salesmen.length} employees
          </p>
        </div>
        <p className="text-2xl font-bold text-green-400">{$(grandTotalPay)}</p>
      </div>
    </div>
  )
}
