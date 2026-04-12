'use client'

/**
 * Day Schedule — Dropdown-style scheduling view for WinBros
 *
 * Replaces the FullCalendar. One dropdown per team lead showing:
 * 1. Team lead name
 * 2. Town of first job
 * 3. Daily revenue for that crew
 *
 * Expandable to show full job list for each crew.
 * Also tracks salesman appointments.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ChevronDown, ChevronRight, MapPin, DollarSign,
  Calendar, Users, Clock, ArrowLeft, ArrowRight
} from 'lucide-react'

interface Job {
  id: number
  customer_name: string
  address: string
  time: string | null
  services: string[]
  price: number
  status: string
}

interface CrewSchedule {
  team_lead_id: number
  team_lead_name: string
  first_job_town: string
  daily_revenue: number
  jobs: Job[]
  members: string[]
}

interface SalesmanAppointment {
  id: number
  salesman_name: string
  customer_name: string
  address: string
  time: string
  type: string // 'estimate', 'follow-up', 'check-in'
}

interface DayScheduleProps {
  date: string
  crews: CrewSchedule[]
  salesmanAppointments: SalesmanAppointment[]
  onDateChange: (date: string) => void
  onJobClick: (jobId: number) => void
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function DaySchedule({
  date,
  crews,
  salesmanAppointments,
  onDateChange,
  onJobClick,
}: DayScheduleProps) {
  const [expandedCrews, setExpandedCrews] = useState<Set<number>>(new Set())

  const toggleCrew = (teamLeadId: number) => {
    setExpandedCrews(prev => {
      const next = new Set(prev)
      if (next.has(teamLeadId)) {
        next.delete(teamLeadId)
      } else {
        next.add(teamLeadId)
      }
      return next
    })
  }

  const totalRevenue = crews.reduce((sum, c) => sum + c.daily_revenue, 0)
  const totalJobs = crews.reduce((sum, c) => sum + c.jobs.length, 0)

  return (
    <div className="space-y-4">
      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDateChange(addDays(date, -1))}
          className="cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">{formatDate(date)}</h2>
          <div className="flex items-center justify-center gap-4 text-xs text-zinc-400 mt-1">
            <span>{crews.length} crews</span>
            <span>{totalJobs} jobs</span>
            <span className="text-green-400">${totalRevenue.toLocaleString()}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDateChange(addDays(date, 1))}
          className="cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Crew dropdowns */}
      <div className="space-y-2">
        {crews.length === 0 && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No crews scheduled for this day
          </div>
        )}

        {crews.map(crew => {
          const isExpanded = expandedCrews.has(crew.team_lead_id)
          return (
            <div key={crew.team_lead_id} className="border border-zinc-800 rounded-lg bg-zinc-950">
              {/* Crew header — always visible */}
              <button
                onClick={() => toggleCrew(crew.team_lead_id)}
                className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/50 transition-colors rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500" />
                  )}
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">
                        {crew.team_lead_name}
                      </span>
                      <Badge variant="secondary" className="text-[10px] bg-zinc-800">
                        {crew.jobs.length} jobs
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="flex items-center gap-1 text-xs text-zinc-400">
                        <MapPin className="w-3 h-3" />
                        {crew.first_job_town || 'No jobs'}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-zinc-400">
                        <Users className="w-3 h-3" />
                        {crew.members.length} members
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-green-400 font-semibold">
                  <DollarSign className="w-4 h-4" />
                  <span>${crew.daily_revenue.toLocaleString()}</span>
                </div>
              </button>

              {/* Expanded: job list */}
              {isExpanded && (
                <div className="border-t border-zinc-800 px-4 pb-4">
                  <div className="text-xs text-zinc-500 py-2">
                    Crew: {crew.members.join(', ')}
                  </div>
                  <div className="space-y-2">
                    {crew.jobs.map(job => (
                      <button
                        key={job.id}
                        onClick={() => onJobClick(job.id)}
                        className="w-full flex items-center justify-between p-3 bg-zinc-900 rounded-lg hover:bg-zinc-800/70 transition-colors cursor-pointer"
                      >
                        <div className="text-left">
                          <div className="text-sm text-white">{job.customer_name}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-zinc-400">{job.address}</span>
                            {job.time && (
                              <span className="flex items-center gap-1 text-xs text-zinc-500">
                                <Clock className="w-3 h-3" />
                                {job.time}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1 mt-1">
                            {job.services.map((s, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] border-zinc-700">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-white">${job.price}</span>
                          <Badge
                            variant="secondary"
                            className={`block mt-1 text-[10px] ${
                              job.status === 'completed' ? 'bg-green-900/30 text-green-400' :
                              job.status === 'in_progress' ? 'bg-blue-900/30 text-blue-400' :
                              'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {job.status}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Salesman Appointments */}
      {salesmanAppointments.length > 0 && (
        <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
          <h3 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Salesman Appointments
          </h3>
          <div className="space-y-2">
            {salesmanAppointments.map(apt => (
              <div key={apt.id} className="flex items-center justify-between p-2 bg-zinc-900 rounded">
                <div>
                  <div className="text-sm text-white">{apt.salesman_name}</div>
                  <div className="text-xs text-zinc-400">
                    {apt.customer_name} — {apt.address}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-300">{apt.time}</div>
                  <Badge variant="outline" className="text-[10px] border-zinc-700">
                    {apt.type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
