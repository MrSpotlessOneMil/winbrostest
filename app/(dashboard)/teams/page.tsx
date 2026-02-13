"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  MapPin,
  Phone,
  DollarSign,
  Star,
  TrendingUp,
  Clock,
  Truck,
  Users,
  ChevronRight,
  Pencil,
  MessageSquare,
  MessageCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { VelocityFluidBackground } from "@/components/teams/velocity-fluid-background"
import { MessageBubble } from "@/components/message-bubble"
import type { ApiResponse, Team, TeamDailyMetrics } from "@/lib/types"

type UiTeam = Team & {
  daily_metrics?: TeamDailyMetrics
  currentJob?: {
    address: string
    customer: string
    service: string
    eta: string
  } | null
  leadName: string
  memberNames: string[]
  membersDetailed: Array<{
    id: string
    name: string
    phone: string
    telegram_id?: string
    role: "lead" | "technician"
    is_active: boolean
    last_location_lat?: number | null
    last_location_lng?: number | null
    last_location_accuracy_meters?: number | null
    last_location_updated_at?: string | null
  }>
}

interface ChatMessage {
  id: string
  phone_number: string
  direction: string
  body: string
  timestamp: string
  status: string
}

const statusConfig = {
  "on-job": { label: "On Job", className: "bg-success/10 text-success border-success/20", icon: Truck },
  traveling: { label: "Traveling", className: "bg-primary/10 text-primary border-primary/20", icon: MapPin },
  available: { label: "Available", className: "bg-warning/10 text-warning border-warning/20", icon: Clock },
  off: { label: "Off Today", className: "bg-muted text-muted-foreground border-border", icon: Users },
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<UiTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTeam, setSelectedTeam] = useState<UiTeam | null>(null)
  const [editingMember, setEditingMember] = useState<{
    id: string; name: string; phone: string; email: string; telegram_id: string; is_team_lead: boolean
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Chat panel state
  const [chatMember, setChatMember] = useState<{ id: string; name: string; phone: string } | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  async function loadTeams() {
    setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/teams?include_metrics=true&date=${today}`, { cache: "no-store" })
      const json = (await res.json()) as ApiResponse<any[]>
      const rows = Array.isArray(json.data) ? json.data : []
      const mapped: UiTeam[] = rows.map((t: any) => {
        const members = Array.isArray(t.members) ? t.members : []
        const lead = members.find((m: any) => m.role === "lead") || members[0]
        const leadName = String(lead?.name || t.name || "Team Lead")
        const memberNames = members.map((m: any) => String(m.name || "")).filter(Boolean)
        return {
          ...t,
          leadName,
          memberNames,
          membersDetailed: members.map((m: any) => ({
            id: String(m.id),
            name: String(m.name || "Cleaner"),
            phone: String(m.phone || ""),
            telegram_id: m.telegram_id || undefined,
            role: m.role === "lead" ? "lead" : "technician",
            is_active: Boolean(m.is_active),
            last_location_lat: m.last_location_lat ?? null,
            last_location_lng: m.last_location_lng ?? null,
            last_location_accuracy_meters: m.last_location_accuracy_meters ?? null,
            last_location_updated_at: m.last_location_updated_at ?? null,
          })),
          currentJob: t.current_job_id
            ? {
                address: "—",
                customer: "—",
                service: "—",
                eta: "—",
              }
            : null,
        }
      })
      setTeams(mapped)
    } catch {
      setTeams([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    loadTeams().then(() => { if (cancelled) setTeams([]) })
    return () => { cancelled = true }
  }, [])

  // Fetch messages when chatMember changes
  useEffect(() => {
    if (!chatMember?.phone) {
      setChatMessages([])
      return
    }
    let cancelled = false
    async function fetchMessages() {
      setChatLoading(true)
      try {
        const res = await fetch(`/api/teams/messages?phone=${encodeURIComponent(chatMember!.phone)}&limit=200`)
        const json = await res.json()
        if (!cancelled && json.success) setChatMessages(json.data || [])
      } catch {
        if (!cancelled) setChatMessages([])
      } finally {
        if (!cancelled) setChatLoading(false)
      }
    }
    fetchMessages()
    return () => { cancelled = true }
  }, [chatMember?.phone])

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatMessages.length > 0 && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages])

  async function handleSaveEdit() {
    if (!editingMember) return
    setEditSaving(true)
    try {
      await fetch("/api/manage-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_cleaner",
          cleaner_id: Number(editingMember.id),
          name: editingMember.name,
          phone: editingMember.phone,
          email: editingMember.email,
          telegram_id: editingMember.telegram_id,
          is_team_lead: editingMember.is_team_lead,
        }),
      })
      setEditingMember(null)
      await loadTeams()
    } catch {
      // silently fail
    } finally {
      setEditSaving(false)
    }
  }

  const activeTeams = useMemo(() => teams.filter((t) => t.status !== "off" && t.is_active), [teams])
  const totalRevenue = useMemo(
    () => activeTeams.reduce((sum, t) => sum + Number(t.daily_metrics?.revenue || 0), 0),
    [activeTeams]
  )
  const totalTarget = useMemo(
    () => activeTeams.reduce((sum, t) => sum + Number(t.daily_metrics?.target || t.daily_target || 0), 0),
    [activeTeams]
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">Real-time crew tracking and performance</p>
        </div>
        <Button asChild>
          <Link href="/teams/manage">
            <Users className="mr-2 h-4 w-4" />
            Manage Teams
          </Link>
        </Button>
      </div>

      {/* Two-column layout: teams left, chat right */}
      <div className="flex gap-6 h-[calc(100vh-12rem)]">
        {/* LEFT: Team content (scrollable) */}
        <div className="flex-1 min-w-0 overflow-y-auto space-y-6 pr-1">
          {/* Summary Stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                    <Users className="h-6 w-6 text-success" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Active Teams</p>
                    <p className="text-2xl font-semibold text-foreground">{activeTeams.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <DollarSign className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-semibold text-foreground">${totalRevenue.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-warning/10">
                    <TrendingUp className="h-6 w-6 text-warning" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Daily Target</p>
                    <p className="text-2xl font-semibold text-foreground">${totalTarget.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10">
                    <Star className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Rating</p>
                    <p className="text-2xl font-semibold text-foreground">—</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Team Cards */}
          <div className="grid gap-6 lg:grid-cols-2">
            {teams.map((team) => {
              const StatusIcon = statusConfig[team.status as keyof typeof statusConfig].icon
              const target = Number(team.daily_metrics?.target || team.daily_target || 0)
              const revenue = Number(team.daily_metrics?.revenue || 0)
              const jobsCompleted = Number(team.daily_metrics?.jobs_completed || 0)
              const jobsScheduled = Number(team.daily_metrics?.jobs_scheduled || 0)
              const revenuePercent = target > 0 ? (revenue / target) * 100 : 0

              return (
                <Card
                  key={team.id}
                  className={cn(team.status === "off" && "opacity-60")}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Users className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{team.name}</CardTitle>
                          <CardDescription>Lead: {team.leadName}</CardDescription>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={statusConfig[team.status as keyof typeof statusConfig].className}
                      >
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {statusConfig[team.status as keyof typeof statusConfig].label}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Members */}
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {team.memberNames.map((member) => (
                          <Avatar key={member} className="h-8 w-8 border-2 border-background">
                            <AvatarFallback className="text-xs bg-muted">
                              {member.split(" ").map((n) => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                      </div>
                      <span className="text-sm text-muted-foreground">{team.memberNames.length} members</span>
                    </div>

                    {/* Current Job */}
                    {team.currentJob && (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">{team.currentJob.customer}</p>
                            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3" />
                              {team.currentJob.address}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{team.currentJob.service}</p>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="mr-1 h-3 w-3" />
                            {team.currentJob.eta}
                          </Badge>
                        </div>
                      </div>
                    )}

                    {/* Stats */}
                    {team.status !== "off" && (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Daily Revenue</span>
                            <span className="font-medium text-foreground">
                              ${revenue.toLocaleString()} / ${target.toLocaleString()}
                            </span>
                          </div>
                          <Progress value={revenuePercent} className="h-2" />
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div className="rounded-lg bg-muted/50 p-2">
                            <p className="text-lg font-semibold text-foreground">
                              {jobsCompleted}/{jobsScheduled}
                            </p>
                            <p className="text-xs text-muted-foreground">Jobs</p>
                          </div>
                          <div className="rounded-lg bg-muted/50 p-2">
                            <p className="text-lg font-semibold text-foreground">—</p>
                            <p className="text-xs text-muted-foreground">Rating</p>
                          </div>
                          <div className="rounded-lg bg-success/10 p-2">
                            <p className="text-lg font-semibold text-success">$0</p>
                            <p className="text-xs text-muted-foreground">Tips</p>
                          </div>
                          <div className="rounded-lg bg-primary/10 p-2">
                            <p className="text-lg font-semibold text-primary">$0</p>
                            <p className="text-xs text-muted-foreground">Upsells</p>
                          </div>
                        </div>
                      </>
                    )}

                    <Button
                      variant="ghost"
                      className="w-full justify-between"
                      disabled={team.status === "off"}
                      onClick={() => setSelectedTeam(team)}
                    >
                      <span>View Full Details</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {loading && <p className="text-sm text-muted-foreground">Loading teams...</p>}
          {!loading && teams.length === 0 && <p className="text-sm text-muted-foreground">No teams found.</p>}
        </div>

        {/* RIGHT: Persistent chat panel */}
        <div className="relative w-96 shrink-0 rounded-xl overflow-hidden bg-black border border-purple-500/20" data-no-splat>
          <VelocityFluidBackground className="z-0" />

          <div className="relative z-10 flex flex-col h-full">
            {/* Chat Header */}
            <div className="p-4 backdrop-blur-md bg-black/40 border-b border-purple-500/10">
              {chatMember ? (
                <>
                  <h3 className="text-white font-semibold">{chatMember.name}</h3>
                  <div className="flex items-center gap-1 text-purple-300/70 text-sm">
                    <Phone className="h-3 w-3" />
                    {chatMember.phone}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-white font-semibold">Team Chat</h3>
                  <p className="text-purple-300/50 text-sm">Select a member to view messages</p>
                </>
              )}
            </div>

            {/* Chat Messages */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
              {!chatMember && (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <MessageSquare className="h-10 w-10 text-purple-500/30 mb-3" />
                  <p className="text-purple-300/50 text-sm">
                    Select a team member from any team card to view their SMS conversation history
                  </p>
                </div>
              )}
              {chatMember && chatLoading && (
                <p className="text-center text-sm text-purple-300/50 py-8">Loading messages...</p>
              )}
              {chatMember && !chatLoading && chatMessages.length === 0 && (
                <p className="text-center text-sm text-purple-300/50 py-8">No messages found.</p>
              )}
              {chatMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  role={msg.direction === "inbound" ? "client" : "assistant"}
                  content={msg.body}
                  timestamp={msg.timestamp}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Team Detail Dialog */}
      <Dialog open={!!selectedTeam} onOpenChange={(open) => !open && setSelectedTeam(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedTeam?.name || "Team"}</DialogTitle>
            <DialogDescription>
              Team members and latest known locations
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {(selectedTeam?.membersDetailed || []).map((m) => {
              const hasLoc = m.last_location_lat != null && m.last_location_lng != null
              return (
                <div
                  key={m.id}
                  className="flex items-start justify-between rounded-lg border border-border bg-muted/30 p-3"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{m.name}</span>
                      <Badge variant="outline">{m.role}</Badge>
                      {!m.is_active && (
                        <Badge variant="secondary">inactive</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4" />
                        <span>{m.phone || "—"}</span>
                      </div>
                      {m.telegram_id && (
                        <div className="flex items-center gap-1">
                          <MessageCircle className="h-4 w-4" />
                          <span className="font-mono text-xs">{m.telegram_id}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        <span>
                          {hasLoc
                            ? `${Number(m.last_location_lat).toFixed(5)}, ${Number(m.last_location_lng).toFixed(5)}`
                            : "No location yet"}
                        </span>
                      </div>
                    </div>
                    {m.last_location_updated_at && (
                      <p className="text-xs text-muted-foreground">
                        Updated: {new Date(m.last_location_updated_at).toLocaleString()}
                        {m.last_location_accuracy_meters != null ? ` (±${Math.round(Number(m.last_location_accuracy_meters))}m)` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditingMember({
                        id: m.id,
                        name: m.name,
                        phone: m.phone,
                        email: "",
                        telegram_id: m.telegram_id || "",
                        is_team_lead: m.role === "lead",
                      })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={!m.phone}
                      onClick={() => setChatMember({ id: m.id, name: m.name, phone: m.phone })}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
            {(selectedTeam?.membersDetailed || []).length === 0 && (
              <p className="text-sm text-muted-foreground">No team members yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Member Modal */}
      <Dialog open={!!editingMember} onOpenChange={(open) => !open && setEditingMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Team Member</DialogTitle>
            <DialogDescription>Update member details</DialogDescription>
          </DialogHeader>
          {editingMember && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Name</label>
                <Input
                  value={editingMember.name}
                  onChange={(e) => setEditingMember({ ...editingMember, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Phone</label>
                <Input
                  value={editingMember.phone}
                  onChange={(e) => setEditingMember({ ...editingMember, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <Input
                  value={editingMember.email}
                  onChange={(e) => setEditingMember({ ...editingMember, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Telegram Chat ID</label>
                <Input
                  value={editingMember.telegram_id}
                  onChange={(e) => setEditingMember({ ...editingMember, telegram_id: e.target.value })}
                  placeholder="e.g. 123456789"
                  className="font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_team_lead"
                  checked={editingMember.is_team_lead}
                  onChange={(e) => setEditingMember({ ...editingMember, is_team_lead: e.target.checked })}
                  className="rounded border-border"
                />
                <label htmlFor="is_team_lead" className="text-sm text-foreground">Team Lead</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setEditingMember(null)}>Cancel</Button>
                <Button onClick={handleSaveEdit} disabled={editSaving}>
                  {editSaving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
