"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
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
  TrendingUp,
  Clock,
  Truck,
  Users,
  Pencil,
  Trash2,
  MessageSquare,
  MessageCircle,
  Send,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { VelocityFluidBackground } from "@/components/teams/velocity-fluid-background"
import { MessageBubble } from "@/components/message-bubble"
import type { ApiResponse, Team, TeamDailyMetrics } from "@/lib/types"

type MemberDetail = {
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
}

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
  membersDetailed: MemberDetail[]
}

interface ChatMessage {
  id: string
  phone_number: string
  direction: string
  content: string
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
  const [unassignedCleaners, setUnassignedCleaners] = useState<MemberDetail[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<{
    id: string; name: string; phone: string; email: string; telegram_id: string; is_team_lead: boolean
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)

  // Chat panel state — persist selected member across reloads
  const [chatMember, setChatMember] = useState<{ id: string; name: string; phone: string; telegram_id?: string } | null>(() => {
    if (typeof window === "undefined") return null
    try {
      const saved = localStorage.getItem("teams-chat-member")
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [sendText, setSendText] = useState("")
  const [sending, setSending] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  async function loadTeams() {
    setLoading(true)
    setLoadError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/teams?include_metrics=true&date=${today}`, { cache: "no-store" })
      const json = (await res.json()) as ApiResponse<any[]> & { unassigned_cleaners?: any[] }
      if (!json.success && json.error) {
        setLoadError(json.error)
        setTeams([])
        setUnassignedCleaners([])
        return
      }
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
            ? { address: "—", customer: "—", service: "—", eta: "—" }
            : null,
        }
      })
      setTeams(mapped)
      // Unassigned cleaners (not in any team)
      const unassigned = Array.isArray(json.unassigned_cleaners) ? json.unassigned_cleaners : []
      setUnassignedCleaners(unassigned.map((c: any) => ({
        id: String(c.id),
        name: String(c.name || "Cleaner"),
        phone: String(c.phone || ""),
        telegram_id: c.telegram_id || undefined,
        role: c.role === "lead" ? "lead" : "technician",
        is_active: Boolean(c.is_active),
        last_location_lat: c.last_location_lat ?? null,
        last_location_lng: c.last_location_lng ?? null,
        last_location_accuracy_meters: c.last_location_accuracy_meters ?? null,
        last_location_updated_at: c.last_location_updated_at ?? null,
      })))
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

  // Persist selected chat member to localStorage
  useEffect(() => {
    if (chatMember) localStorage.setItem("teams-chat-member", JSON.stringify(chatMember))
    else localStorage.removeItem("teams-chat-member")
  }, [chatMember])

  // Fetch messages when chatMember changes
  useEffect(() => {
    if (!chatMember?.phone && !chatMember?.telegram_id) {
      setChatMessages([])
      return
    }
    let cancelled = false
    async function fetchMessages() {
      setChatLoading(true)
      try {
        const params = new URLSearchParams()
        if (chatMember!.phone) params.set('phone', chatMember!.phone)
        if (chatMember!.telegram_id) params.set('telegram_id', chatMember!.telegram_id)
        params.set('limit', '200')
        const res = await fetch(`/api/teams/messages?${params.toString()}`)
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
  }, [chatMember?.phone, chatMember?.telegram_id])

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

  async function handleDeleteCleaner(cleanerId: string, cleanerName: string) {
    if (!confirm(`Delete ${cleanerName}? This will deactivate them and remove them from their team.`)) return
    try {
      await fetch("/api/manage-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_cleaner", cleaner_id: Number(cleanerId) }),
      })
      // If the deleted cleaner is the current chat target, clear it
      if (chatMember?.id === cleanerId) setChatMember(null)
      await loadTeams()
    } catch {
      // silently fail
    }
  }

  async function handleSendTelegram() {
    if (!chatMember?.telegram_id || !sendText.trim() || sending) return
    const messageText = sendText.trim()
    setSending(true)
    try {
      const res = await fetch("/api/teams/send-telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegram_id: chatMember.telegram_id, message: messageText, phone: chatMember.phone }),
      })
      const json = await res.json()
      if (json.success) {
        setSendText("")
        // Optimistically add the sent message to the chat
        setChatMessages((prev) => [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            phone_number: chatMember.phone,
            direction: "outbound",
            content: messageText,
            timestamp: new Date().toISOString(),
            status: "sent",
          },
        ])
      }
    } catch {
      // silently fail
    } finally {
      setSending(false)
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
    <div className="flex flex-col h-full gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
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

      {/* Summary Stats - compact row */}
      <div className="grid gap-3 grid-cols-3 shrink-0">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 shrink-0">
              <Users className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-xl font-semibold text-foreground">{activeTeams.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Revenue</p>
              <p className="text-xl font-semibold text-foreground">${totalRevenue.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10 shrink-0">
              <TrendingUp className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Target</p>
              <p className="text-xl font-semibold text-foreground">${totalTarget.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout: teams left, chat right */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* LEFT: Team list with inline members */}
        <div className="flex-1 min-w-0 overflow-y-auto space-y-4 pr-1">
          {teams.map((team) => {
            const StatusIcon = statusConfig[team.status as keyof typeof statusConfig].icon
            const target = Number(team.daily_metrics?.target || team.daily_target || 0)
            const revenue = Number(team.daily_metrics?.revenue || 0)
            const revenuePercent = target > 0 ? (revenue / target) * 100 : 0

            return (
              <Card key={team.id} className={cn(team.status === "off" && "opacity-60")}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{team.name}</CardTitle>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] px-1.5 py-0", statusConfig[team.status as keyof typeof statusConfig].className)}
                      >
                        <StatusIcon className="mr-0.5 h-2.5 w-2.5" />
                        {statusConfig[team.status as keyof typeof statusConfig].label}
                      </Badge>
                    </div>
                    {team.status !== "off" && (
                      <span className="text-xs text-muted-foreground">
                        ${revenue.toLocaleString()} / ${target.toLocaleString()}
                      </span>
                    )}
                  </div>
                  {team.status !== "off" && (
                    <Progress value={revenuePercent} className="h-1 mt-1" />
                  )}
                </CardHeader>
                <CardContent className="px-4 pb-3 pt-1">
                  {/* Inline member list */}
                  <div className="space-y-1">
                    {team.membersDetailed.map((m) => {
                      const isSelected = chatMember?.id === m.id
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "flex items-center justify-between rounded-md px-2.5 py-1.5 transition-colors cursor-pointer",
                            isSelected
                              ? "bg-purple-500/10 border border-purple-500/30"
                              : "hover:bg-muted/50"
                          )}
                          onClick={() => setChatMember({ id: m.id, name: m.name, phone: m.phone, telegram_id: m.telegram_id })}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={cn(
                              "text-sm font-medium truncate",
                              isSelected ? "text-purple-300" : "text-foreground"
                            )}>
                              {m.name}
                            </span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                              {m.role === "lead" ? "lead" : "tech"}
                            </Badge>
                            {m.telegram_id && (
                              <MessageCircle className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                            {!m.is_active && (
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">off</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 ml-2 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingMember({
                                  id: m.id,
                                  name: m.name,
                                  phone: m.phone,
                                  email: "",
                                  telegram_id: m.telegram_id || "",
                                  is_team_lead: m.role === "lead",
                                })
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteCleaner(m.id, m.name)
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                    {team.membersDetailed.length === 0 && (
                      <p className="text-xs text-muted-foreground py-1 px-2.5">No members</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {/* Unassigned cleaners (not in any team) */}
          {unassignedCleaners.length > 0 && (
            <Card className="border-dashed">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Unassigned</CardTitle>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {unassignedCleaners.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-1">
                <div className="space-y-1">
                  {unassignedCleaners.map((m) => {
                    const isSelected = chatMember?.id === m.id
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "flex items-center justify-between rounded-md px-2.5 py-1.5 transition-colors cursor-pointer",
                          isSelected
                            ? "bg-purple-500/10 border border-purple-500/30"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setChatMember({ id: m.id, name: m.name, phone: m.phone, telegram_id: m.telegram_id })}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className={cn(
                            "text-sm font-medium truncate",
                            isSelected ? "text-purple-300" : "text-foreground"
                          )}>
                            {m.name}
                          </span>
                          {m.telegram_id && (
                            <MessageCircle className="h-3 w-3 text-muted-foreground shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 ml-2 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingMember({
                                id: m.id,
                                name: m.name,
                                phone: m.phone,
                                email: "",
                                telegram_id: m.telegram_id || "",
                                is_team_lead: m.role === "lead",
                              })
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteCleaner(m.id, m.name)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {loading && <p className="text-sm text-muted-foreground">Loading teams...</p>}
          {!loading && loadError && (
            <Card className="border-destructive/50">
              <CardContent className="p-4 text-sm text-destructive">{loadError}</CardContent>
            </Card>
          )}
          {!loading && !loadError && teams.length === 0 && unassignedCleaners.length === 0 && <p className="text-sm text-muted-foreground">No teams or cleaners found.</p>}
        </div>

        {/* RIGHT: Persistent chat panel with fluid background */}
        <div className="relative w-[420px] shrink-0 rounded-xl overflow-hidden bg-black border border-purple-500/20" data-no-splat>
          <VelocityFluidBackground className="z-0" />

          <div className="relative z-10 flex flex-col h-full">
            {/* Chat Header */}
            <div className="p-4 backdrop-blur-md bg-black/50 border-b border-purple-500/10">
              {chatMember ? (
                <>
                  <h3 className="text-white font-semibold text-sm">{chatMember.name}</h3>
                  <div className="flex items-center gap-1 text-purple-300/70 text-xs">
                    <Phone className="h-3 w-3" />
                    {chatMember.phone}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-white font-semibold text-sm">Team Chat</h3>
                  <p className="text-purple-300/50 text-xs">Select a member to view messages</p>
                </>
              )}
            </div>

            {/* Chat Messages */}
            <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
              {!chatMember && (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                  <MessageSquare className="h-10 w-10 text-purple-500/30 mb-3" />
                  <p className="text-purple-300/50 text-sm">
                    Click the chat icon next to any team member to view their SMS conversation
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
                  content={msg.content}
                  timestamp={msg.timestamp}
                />
              ))}
            </div>

            {/* Telegram Send Bar */}
            {chatMember && (
              <div className="p-3 backdrop-blur-md bg-black/50 border-t border-purple-500/10">
                {chatMember.telegram_id ? (
                  <div className="flex gap-2">
                    <Input
                      value={sendText}
                      onChange={(e) => setSendText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendTelegram() } }}
                      placeholder="Send Telegram message..."
                      className="flex-1 bg-zinc-900/80 border-purple-500/20 text-white placeholder:text-purple-300/30 text-sm"
                      disabled={sending}
                    />
                    <Button
                      size="icon"
                      className="shrink-0 bg-purple-600 hover:bg-purple-500 h-9 w-9"
                      onClick={handleSendTelegram}
                      disabled={!sendText.trim() || sending}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-purple-300/40 text-center">No Telegram ID configured for this member</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
