'use client'

/**
 * Payroll Week View for WinBros
 *
 * Top half: Technicians/Team Leads (Name, Revenue, %, Hours, OT, Total)
 * Bottom half: Salesmen (Name, 1-time, Triannual, Quarterly, Total)
 * Right side: Employee name bank for drill-down
 *
 * CRITICAL: Pay rates are frozen per week. Changing current rates does NOT affect past weeks.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ArrowRight, DollarSign, Clock, Users } from 'lucide-react'

interface TechEntry {
  cleaner_id: number
  name: string
  role: 'technician' | 'team_lead'
  revenue_completed: number
  pay_percentage: number
  hours_worked: number
  overtime_hours: number
  hourly_rate: number
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
}

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function PayrollWeek({
  weekStart,
  weekEnd,
  technicians,
  salesmen,
  status,
  onWeekChange,
  onEmployeeClick,
}: PayrollWeekProps) {
  const techTotal = technicians.reduce((sum, t) => sum + t.total_pay, 0)
  const salesTotal = salesmen.reduce((sum, s) => sum + s.total_pay, 0)
  const grandTotal = techTotal + salesTotal

  return (
    <div className="space-y-4">
      {/* Week header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => onWeekChange(-1)} className="cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">
            {formatDate(weekStart)} — {formatDate(weekEnd)}
          </h2>
          <div className="flex items-center justify-center gap-3 mt-1">
            <Badge variant={status === 'finalized' ? 'default' : 'secondary'} className="text-xs">
              {status === 'finalized' ? 'Finalized' : 'Draft'}
            </Badge>
            <span className="text-sm text-green-400 font-semibold">
              Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onWeekChange(1)} className="cursor-pointer">
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Main tables */}
        <div className="lg:col-span-3 space-y-4">
          {/* Technicians / Team Leads */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-semibold text-zinc-300">Technicians / Team Leads</h3>
              <span className="text-xs text-green-400 ml-auto">${techTotal.toFixed(2)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                    <th className="text-left p-3">Name</th>
                    <th className="text-right p-3">Revenue</th>
                    <th className="text-right p-3">%</th>
                    <th className="text-right p-3">Hours</th>
                    <th className="text-right p-3">OT</th>
                    <th className="text-right p-3 font-semibold">Total Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {technicians.map(tech => (
                    <tr
                      key={tech.cleaner_id}
                      className="border-b border-zinc-900 hover:bg-zinc-900/50 cursor-pointer"
                      onClick={() => onEmployeeClick(tech.cleaner_id)}
                    >
                      <td className="p-3">
                        <span className="text-white">{tech.name}</span>
                        {tech.role === 'team_lead' && (
                          <Badge variant="outline" className="ml-2 text-[10px] border-blue-700 text-blue-400">
                            TL
                          </Badge>
                        )}
                      </td>
                      <td className="text-right p-3 text-zinc-300">${tech.revenue_completed.toFixed(2)}</td>
                      <td className="text-right p-3 text-zinc-400">{tech.pay_percentage}%</td>
                      <td className="text-right p-3 text-zinc-300">{tech.hours_worked.toFixed(1)}</td>
                      <td className="text-right p-3">
                        {tech.overtime_hours > 0 ? (
                          <span className="text-amber-400">{tech.overtime_hours.toFixed(1)}</span>
                        ) : (
                          <span className="text-zinc-600">0</span>
                        )}
                      </td>
                      <td className="text-right p-3 font-semibold text-white">${tech.total_pay.toFixed(2)}</td>
                    </tr>
                  ))}
                  {technicians.length === 0 && (
                    <tr><td colSpan={6} className="p-3 text-center text-zinc-500">No technician data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Salesmen */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-zinc-500" />
              <h3 className="text-sm font-semibold text-zinc-300">Salesmen</h3>
              <span className="text-xs text-green-400 ml-auto">${salesTotal.toFixed(2)}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                    <th className="text-left p-3">Name</th>
                    <th className="text-right p-3">1-Time</th>
                    <th className="text-right p-3">Triannual</th>
                    <th className="text-right p-3">Quarterly</th>
                    <th className="text-right p-3 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {salesmen.map(s => (
                    <tr
                      key={s.cleaner_id}
                      className="border-b border-zinc-900 hover:bg-zinc-900/50 cursor-pointer"
                      onClick={() => onEmployeeClick(s.cleaner_id)}
                    >
                      <td className="p-3 text-white">{s.name}</td>
                      <td className="text-right p-3 text-zinc-300">
                        ${(s.revenue_1time * s.commission_1time_pct / 100).toFixed(2)}
                        <span className="text-[10px] text-zinc-500 ml-1">({s.commission_1time_pct}%)</span>
                      </td>
                      <td className="text-right p-3 text-zinc-300">
                        ${(s.revenue_triannual * s.commission_triannual_pct / 100).toFixed(2)}
                        <span className="text-[10px] text-zinc-500 ml-1">({s.commission_triannual_pct}%)</span>
                      </td>
                      <td className="text-right p-3 text-zinc-300">
                        ${(s.revenue_quarterly * s.commission_quarterly_pct / 100).toFixed(2)}
                        <span className="text-[10px] text-zinc-500 ml-1">({s.commission_quarterly_pct}%)</span>
                      </td>
                      <td className="text-right p-3 font-semibold text-white">${s.total_pay.toFixed(2)}</td>
                    </tr>
                  ))}
                  {salesmen.length === 0 && (
                    <tr><td colSpan={5} className="p-3 text-center text-zinc-500">No salesman data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Employee bank (right sidebar) */}
        <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-3">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase mb-3">Employees</h3>
          <div className="space-y-1">
            {[...technicians.map(t => ({ id: t.cleaner_id, name: t.name, role: t.role })),
              ...salesmen.map(s => ({ id: s.cleaner_id, name: s.name, role: 'salesman' as const }))
            ].map(emp => (
              <button
                key={emp.id}
                onClick={() => onEmployeeClick(emp.id)}
                className="w-full text-left p-2 rounded hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <span className="text-sm text-white">{emp.name}</span>
                <Badge variant="outline" className="ml-2 text-[10px] border-zinc-700">
                  {emp.role}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
