"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Users, ChevronDown, ChevronRight, UserPlus, X, Shield, Wrench, Megaphone, Loader2 } from "lucide-react"

type Cleaner = {
  id: number
  name: string
  phone: string
  is_team_lead: boolean
  employee_type: string | null
  role: string | null
  active: boolean
}

type TeamLead = Cleaner & { members: Cleaner[] }

export default function CrewAssignmentPage() {
  const { tenant } = useAuth()
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [assigning, setAssigning] = useState<number | null>(null) // team lead id being assigned to

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/actions/cleaners")
        const json = await res.json()
        setCleaners((json.data || json.cleaners || json || []).filter((c: Cleaner) => c.active))
      } catch {
        setCleaners([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Separate team leads, technicians, salesmen
  const teamLeads = cleaners.filter(c => c.is_team_lead)
  const technicians = cleaners.filter(c => !c.is_team_lead && c.employee_type === 'technician')
  const salesmen = cleaners.filter(c => c.employee_type === 'salesman' && !c.is_team_lead)

  // For now, group technicians round-robin under team leads (until we have a crew_assignments table)
  // This gives Max a visual of the crew structure
  const teams: TeamLead[] = teamLeads.map((lead, i) => ({
    ...lead,
    members: technicians.filter((_, idx) => idx % teamLeads.length === i),
  }))

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Crew Assignment</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {teamLeads.length} team leads &middot; {technicians.length} technicians &middot; {salesmen.length} salesmen
          </p>
        </div>
      </div>

      {/* Team Lead Crews */}
      <div className="space-y-3">
        {teams.map(team => {
          const isOpen = expanded.has(team.id)
          const crewRevenue = 0 // TODO: pull from daily schedule

          return (
            <div key={team.id} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Team Lead Header — clickable dropdown */}
              <button
                onClick={() => toggle(team.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/15 text-teal-400">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-foreground">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.members.length} technician{team.members.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="text-sm text-foreground">{team.phone || '—'}</p>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Expanded: show team members */}
              {isOpen && (
                <div className="border-t border-border">
                  {team.members.length === 0 ? (
                    <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                      No technicians assigned to this crew yet
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {team.members.map(member => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between px-5 py-3 hover:bg-muted/20 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                              <Wrench className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{member.name}</p>
                              <p className="text-xs text-muted-foreground">{member.phone || '—'}</p>
                            </div>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Technician
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Salesmen Section */}
      {salesmen.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Salesmen
          </h2>
          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {salesmen.map(s => (
              <div
                key={s.id}
                className="flex items-center justify-between px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                    <Megaphone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.phone || '—'}</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Salesman
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
