"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  Send,
  Wrench,
  Briefcase,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Calendar,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MessageBubble } from "@/components/message-bubble"
import type { ApiResponse, Team, TeamDailyMetrics } from "@/lib/types"

type EmployeeType = "technician" | "salesman"

type MemberDetail = {
  id: string
  name: string
  phone: string
  telegram_id?: string
  role: "lead" | "technician" | "salesman"
  employee_type?: EmployeeType
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
    id: string; name: string; phone: string; email: string; is_team_lead: boolean; employee_type: EmployeeType
  } | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [employeeTypeFilter, setEmployeeTypeFilter] = useState<EmployeeType>(() => {
    if (typeof window === "undefined") return "technician"
    try {
      const saved = localStorage.getItem("teams-employee-type-filter")
      return saved === "salesman" ? "salesman" : "technician"
    } catch { return "technician" }
  })

  // Chat panel state — persist selected member across reloads
  const [chatMember, setChatMember] = useState<{ id: string; name: string; phone: string } | null>(() => {
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

  // Earnings state
  type EarningsPeriod = "week" | "month" | "custom"
  type CleanerEarning = {
    cleaner_id: number
    name: string
    phone: string
    employee_type: string
    total: number
    job_count: number
  }
  type EarningsSummary = { grand_total: number; total_jobs: number; period: string; start_date: string; end_date: string }

  const [earningsOpen, setEarningsOpen] = useState(false)
  const [earningsPeriod, setEarningsPeriod] = useState<EarningsPeriod>("week")
  const [earningsCustomStart, setEarningsCustomStart] = useState("")
  const [earningsCustomEnd, setEarningsCustomEnd] = useState("")
  const [earningsData, setEarningsData] = useState<CleanerEarning[]>([])
  const [earningsSummary, setEarningsSummary] = useState<EarningsSummary | null>(null)
  const [earningsLoading, setEarningsLoading] = useState(false)

  const loadEarnings = useCallback(async (period: EarningsPeriod, start?: string, end?: string) => {
    setEarningsLoading(true)
    try {
      const params = new URLSearchParams({ period })
      if (period === "custom" && start) params.set("start", start)
      if (period === "custom" && end) params.set("end", end)
      const res = await fetch(`/api/teams/earnings?${params.toString()}`)
      const json = await res.json()
      if (json.success) {
        setEarningsData(json.data.cleaners || [])
        setEarningsSummary(json.data.summary || null)
      }
    } catch {
      setEarningsData([])
      setEarningsSummary(null)
    } finally {
      setEarningsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (earningsOpen) {
      loadEarnings(earningsPeriod, earningsCustomStart, earningsCustomEnd)
    }
  }, [earningsOpen, earningsPeriod, earningsCustomStart, earningsCustomEnd, loadEarnings])

  // Drag and drop state
  const [draggingMemberId, setDraggingMemberId] = useState<string | null>(null)
  const [dragOverTeamId, setDragOverTeamId] = useState<string | null>(null) // "unassigned" for the unassigned zone

  async function handleMoveMember(cleanerId: string, targetTeamId: string | null) {
    try {
      await fetch("/api/manage-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "move_cleaner", cleaner_id: Number(cleanerId), team_id: targetTeamId ? Number(targetTeamId) : null }),
      })
      await loadTeams()
    } catch {
      // silently fail
    }
  }

  async function loadTeams() {
    setLoading(true)
    setLoadError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/teams?include_metrics=true&date=${today}&employee_type=${employeeTypeFilter}`, { cache: "no-store" })
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
  }, [employeeTypeFilter])

  // Persist employee type filter to localStorage
  useEffect(() => {
    localStorage.setItem("teams-employee-type-filter", employeeTypeFilter)
  }, [employeeTypeFilter])

  // Persist selected chat member to localStorage
  useEffect(() => {
    if (chatMember) localStorage.setItem("teams-chat-member", JSON.stringify(chatMember))
    else localStorage.removeItem("teams-chat-member")
  }, [chatMember])

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
        const params = new URLSearchParams()
        if (chatMember!.phone) params.set('phone', chatMember!.phone)
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
          is_team_lead: editingMember.is_team_lead,
          employee_type: editingMember.employee_type,
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

  async function confirmDeleteCleaner() {
    if (!deleteTarget) return
    try {
      const res = await fetch("/api/manage-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_cleaner", cleaner_id: Number(deleteTarget.id) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) {
        setLoadError(json?.error || `Delete failed (${res.status})`)
      } else {
        // If the deleted cleaner is the current chat target, clear it
        if (chatMember?.id === deleteTarget.id) setChatMember(null)
        await loadTeams()
      }
    } catch (err: any) {
      setLoadError(err?.message || "Delete failed")
    } finally {
      setDeleteTarget(null)
    }
  }

  async function handleSendSMS() {
    if (!chatMember?.phone || !sendText.trim() || sending) return
    const messageText = sendText.trim()
    setSending(true)
    try {
      const res = await fetch("/api/teams/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: chatMember.phone, message: messageText }),
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
    <div className="flex flex-col h-full gap-4 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 stagger-1">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Teams</h1>
          <p className="text-sm text-muted-foreground">Real-time crew tracking and performance</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Employee type toggle */}
          <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              onClick={() => setEmployeeTypeFilter("technician")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                employeeTypeFilter === "technician"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Technicians
            </button>
            <button
              onClick={() => setEmployeeTypeFilter("salesman")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                employeeTypeFilter === "salesman"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Salesmen
            </button>
          </div>
          <Button asChild>
            <Link href="/teams/manage">
              <Users className="mr-2 h-4 w-4" />
              Manage Teams
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Stats - compact row */}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 shrink-0">
        <Card className="stagger-2">
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
        <Card className="stagger-3">
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
        <Card className="stagger-4">
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

      {/* Earnings Section — collapsible */}
      <Card className="shrink-0 stagger-5">
        <button
          onClick={() => setEarningsOpen(!earningsOpen)}
          className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-500" />
            <span className="text-base font-semibold text-foreground">Cleaner Earnings</span>
            {earningsSummary && (
              <Badge variant="outline" className="text-xs ml-1">
                ${earningsSummary.grand_total.toLocaleString()} from {earningsSummary.total_jobs} jobs
              </Badge>
            )}
          </div>
          {earningsOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>
        {earningsOpen && (
          <CardContent className="pt-0 pb-4 px-4">
            {/* Period toggles + date filter */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
                {(["week", "month", "custom"] as EarningsPeriod[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setEarningsPeriod(p)}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-colors capitalize",
                      earningsPeriod === p
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p === "week" ? "This Week" : p === "month" ? "This Month" : "Custom"}
                  </button>
                ))}
              </div>
              {earningsPeriod === "custom" && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="date"
                      value={earningsCustomStart}
                      onChange={(e) => setEarningsCustomStart(e.target.value)}
                      className="h-8 w-36 text-xs"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={earningsCustomEnd}
                    onChange={(e) => setEarningsCustomEnd(e.target.value)}
                    className="h-8 w-36 text-xs"
                  />
                </div>
              )}
              {earningsSummary && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {earningsSummary.start_date} — {earningsSummary.end_date}
                </span>
              )}
            </div>

            {earningsLoading ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Loading earnings...</p>
            ) : earningsData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No earnings data for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Cleaner</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Jobs</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">Earnings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {earningsData.filter((c) => c.total > 0 || c.job_count > 0).map((c) => (
                      <tr key={c.cleaner_id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-2">
                          <span className="font-medium text-foreground">{c.name}</span>
                        </td>
                        <td className="text-right py-2 px-2 text-muted-foreground">{c.job_count}</td>
                        <td className="text-right py-2 px-2 font-semibold text-green-500">${c.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border">
                      <td className="py-2 px-2 font-semibold text-foreground">Total</td>
                      <td className="text-right py-2 px-2 font-semibold text-foreground">
                        {earningsSummary?.total_jobs || 0}
                      </td>
                      <td className="text-right py-2 px-2 font-bold text-green-500">
                        ${earningsSummary?.grand_total.toLocaleString() || "0"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {earningsData.filter((c) => c.total === 0 && c.job_count === 0).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {earningsData.filter((c) => c.total === 0).length} cleaners with no completed jobs in this period
                  </p>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Two-column layout: teams left, chat right */}
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 flex-1 min-h-0 stagger-6">
        {/* LEFT: Team list with inline members */}
        <div className="flex-1 min-w-0 overflow-y-auto space-y-4 pr-1">
          {teams.map((team) => {
            const StatusIcon = statusConfig[team.status as keyof typeof statusConfig].icon
            const target = Number(team.daily_metrics?.target || team.daily_target || 0)
            const revenue = Number(team.daily_metrics?.revenue || 0)
            const revenuePercent = target > 0 ? (revenue / target) * 100 : 0

            return (
              <Card
                key={team.id}
                className={cn(
                  team.status === "off" && "opacity-60",
                  draggingMemberId && "transition-all duration-150",
                  dragOverTeamId === String(team.id) && "ring-2 ring-purple-500/50 bg-purple-500/5"
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOverTeamId(String(team.id)) }}
                onDragLeave={() => setDragOverTeamId(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOverTeamId(null)
                  const memberId = e.dataTransfer.getData("text/plain")
                  if (memberId) handleMoveMember(memberId, String(team.id))
                }}
              >
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
                              : "hover:bg-muted/50",
                            draggingMemberId === m.id && "opacity-40"
                          )}
                          onClick={() => setChatMember({ id: m.id, name: m.name, phone: m.phone })}
                        >
                          <div
                            className="flex items-center gap-2 min-w-0 flex-1"
                            draggable
                            onDragStart={(e) => { e.dataTransfer.setData("text/plain", m.id); e.dataTransfer.effectAllowed = "move"; setDraggingMemberId(m.id) }}
                            onDragEnd={() => { setDraggingMemberId(null); setDragOverTeamId(null) }}
                          >
                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing" />
                            <span className={cn(
                              "text-sm font-medium truncate",
                              isSelected ? "text-purple-300" : "text-foreground"
                            )}>
                              {m.name}
                            </span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">
                              {m.role === "lead" ? "lead" : "tech"}
                            </Badge>
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
                                  is_team_lead: m.role === "lead",
                                  employee_type: m.employee_type || "technician",
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
                                setDeleteTarget({ id: m.id, name: m.name })
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

          {/* Unassigned cleaners — always visible as drop target when dragging */}
          {(unassignedCleaners.length > 0 || draggingMemberId) && (
            <Card
              className={cn(
                "border-dashed",
                draggingMemberId && "transition-all duration-150",
                dragOverTeamId === "unassigned" && "ring-2 ring-orange-500/50 bg-orange-500/5"
              )}
              onDragOver={(e) => { e.preventDefault(); setDragOverTeamId("unassigned") }}
              onDragLeave={() => setDragOverTeamId(null)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOverTeamId(null)
                const memberId = e.dataTransfer.getData("text/plain")
                if (memberId) handleMoveMember(memberId, null)
              }}
            >
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
                            : "hover:bg-muted/50",
                          draggingMemberId === m.id && "opacity-40"
                        )}
                        onClick={() => setChatMember({ id: m.id, name: m.name, phone: m.phone })}
                      >
                        <div
                          className="flex items-center gap-2 min-w-0 flex-1"
                          draggable
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", m.id); e.dataTransfer.effectAllowed = "move"; setDraggingMemberId(m.id) }}
                          onDragEnd={() => { setDraggingMemberId(null); setDragOverTeamId(null) }}
                        >
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 cursor-grab active:cursor-grabbing" />
                          <span className={cn(
                            "text-sm font-medium truncate",
                            isSelected ? "text-purple-300" : "text-foreground"
                          )}>
                            {m.name}
                          </span>
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
                                is_team_lead: m.role === "lead",
                                employee_type: m.employee_type || "technician",
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
                              setDeleteTarget({ id: m.id, name: m.name })
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                  {unassignedCleaners.length === 0 && draggingMemberId && (
                    <p className="text-xs text-muted-foreground py-3 px-2.5 text-center">Drop here to unassign</p>
                  )}
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

        {/* RIGHT: Persistent chat panel */}
        <Card className="w-full md:w-[520px] shrink-0 min-h-[300px] md:min-h-0 flex flex-col">
          {/* Chat Header */}
          <div className="p-4 border-b">
            {chatMember ? (
              <>
                <h3 className="font-semibold text-sm">{chatMember.name}</h3>
                <div className="flex items-center gap-1 text-muted-foreground text-xs">
                  <Phone className="h-3 w-3" />
                  {chatMember.phone}
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-sm">Team Chat</h3>
                <p className="text-muted-foreground text-xs">Select a member to view messages</p>
              </>
            )}
          </div>

          {/* Chat Messages */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-1" style={{ background: "rgba(39, 39, 42, 0.5)" }}>
            {!chatMember && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground text-sm">
                  Click the chat icon next to any team member to view their SMS conversation
                </p>
              </div>
            )}
            {chatMember && chatLoading && (
              <p className="text-center text-sm text-muted-foreground py-8">Loading messages...</p>
            )}
            {chatMember && !chatLoading && chatMessages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">No messages found.</p>
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

          {/* SMS Send Bar */}
          {chatMember && (
            <div className="p-3 border-t">
              {chatMember.phone ? (
                <div className="flex gap-2">
                  <Input
                    value={sendText}
                    onChange={(e) => setSendText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendSMS() } }}
                    placeholder="Send SMS..."
                    className="flex-1 text-sm"
                    disabled={sending}
                  />
                  <Button
                    size="icon"
                    className="shrink-0 h-9 w-9"
                    onClick={handleSendSMS}
                    disabled={!sendText.trim() || sending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center">No phone number configured for this member</p>
              )}
            </div>
          )}
        </Card>
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
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Role</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingMember({ ...editingMember, employee_type: "technician" })}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-2 transition-all",
                      editingMember.employee_type === "technician"
                        ? "border-blue-500 bg-blue-500/15 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                        : "border-border/50 bg-card/50 text-muted-foreground hover:border-border hover:bg-card"
                    )}
                  >
                    <div className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-full",
                      editingMember.employee_type === "technician" ? "bg-blue-500/20" : "bg-muted/50"
                    )}>
                      <Wrench className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium">Technician</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingMember({ ...editingMember, employee_type: "salesman" })}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-2 transition-all",
                      editingMember.employee_type === "salesman"
                        ? "border-amber-500 bg-amber-500/15 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                        : "border-border/50 bg-card/50 text-muted-foreground hover:border-border hover:bg-card"
                    )}
                  >
                    <div className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-full",
                      editingMember.employee_type === "salesman" ? "bg-amber-500/20" : "bg-muted/50"
                    )}>
                      <Briefcase className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-medium">Salesman</span>
                  </button>
                </div>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team member?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; will be deactivated and removed from their team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCleaner} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
