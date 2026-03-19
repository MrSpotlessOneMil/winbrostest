"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
  Phone,
  DollarSign,
  Clock,
  Users,
  Pencil,
  Trash2,
  MessageSquare,
  Send,
  Wrench,
  Briefcase,
  Calendar,
  Search,
  MapPin,
  CheckCircle2,
  ArrowRight,
  Star,
  Timer,
  TrendingUp,
} from "lucide-react"
import { cn } from "@/lib/utils"
import CubeLoader from "@/components/ui/cube-loader"
import { MessageBubble } from "@/components/message-bubble"
import { Switch } from "@/components/ui/switch"
import type { ApiResponse } from "@/lib/types"

type EmployeeType = "technician" | "salesman"

type CleanerDetail = {
  id: string
  name: string
  phone: string
  telegram_id?: string
  role: string
  employee_type: EmployeeType
  is_active: boolean
  team_name?: string
  username?: string
  pin?: string
}

interface ChatMessage {
  id: string
  phone_number: string
  direction: string
  content: string
  timestamp: string
  status: string
}

type CleanerJob = {
  id: number
  address: string
  customer_name: string
  service_type: string
  scheduled_date: string
  scheduled_time: string
  status: string
  amount: number
}

type CleanerEarning = {
  cleaner_id: number
  name: string
  phone: string
  employee_type: string
  total: number
  job_count: number
}

type EarningsSummary = {
  grand_total: number
  total_jobs: number
  period: string
  start_date: string
  end_date: string
}

type EarningsPeriod = "week" | "month" | "custom"
type ActiveTab = "overview" | "jobs" | "messages" | "sms"

export default function TeamsPage() {
  const [cleaners, setCleaners] = useState<CleanerDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [editingMember, setEditingMember] = useState<{
    id: string; name: string; phone: string; email: string; is_team_lead: boolean; employee_type: EmployeeType;
    username: string; pin: string
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

  // Selected cleaner state
  const [selectedCleaner, setSelectedCleaner] = useState<CleanerDetail | null>(() => {
    if (typeof window === "undefined") return null
    try {
      const saved = localStorage.getItem("teams-selected-cleaner")
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })
  const [activeTab, setActiveTab] = useState<ActiveTab>("sms")

  // Credential sending state
  const [sendingCredentials, setSendingCredentials] = useState(false)
  const [credentialsSent, setCredentialsSent] = useState(false)

  // Overview tab state
  const [earningsPeriod, setEarningsPeriod] = useState<EarningsPeriod>("week")
  const [earningsCustomStart, setEarningsCustomStart] = useState("")
  const [earningsCustomEnd, setEarningsCustomEnd] = useState("")
  const [cleanerEarnings, setCleanerEarnings] = useState<CleanerEarning | null>(null)
  const [earningsSummary, setEarningsSummary] = useState<EarningsSummary | null>(null)
  const [earningsLoading, setEarningsLoading] = useState(false)

  // Jobs tab state
  const [cleanerJobs, setCleanerJobs] = useState<{ today: CleanerJob[]; upcoming: CleanerJob[]; recent: CleanerJob[] }>({ today: [], upcoming: [], recent: [] })
  const [jobsLoading, setJobsLoading] = useState(false)

  // Messages tab state
  const [portalMessages, setPortalMessages] = useState<ChatMessage[]>([])
  const [portalMessagesLoading, setPortalMessagesLoading] = useState(false)

  // SMS tab state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [sendText, setSendText] = useState("")
  const [sending, setSending] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Load cleaners from teams API
  async function loadTeams() {
    setLoading(true)
    setLoadError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/teams?include_metrics=false&date=${today}&employee_type=${employeeTypeFilter}`, { cache: "no-store" })
      const json = (await res.json()) as ApiResponse<any[]> & { unassigned_cleaners?: any[] }
      if (!json.success && json.error) {
        setLoadError(json.error)
        setCleaners([])
        return
      }

      // Flatten all team members + unassigned into a single roster
      const roster: CleanerDetail[] = []
      const seenIds = new Set<string>()

      const teams = Array.isArray(json.data) ? json.data : []
      for (const team of teams) {
        const members = Array.isArray(team.members) ? team.members : []
        for (const m of members) {
          const id = String(m.id)
          if (seenIds.has(id)) continue
          seenIds.add(id)
          roster.push({
            id,
            name: String(m.name || "Cleaner"),
            phone: String(m.phone || ""),
            telegram_id: m.telegram_id || undefined,
            role: m.role || "technician",
            employee_type: (m.employee_type || "technician") as EmployeeType,
            is_active: Boolean(m.is_active),
            team_name: String(team.name || ""),
            username: m.username || undefined,
            pin: m.pin || undefined,
          })
        }
      }

      const unassigned = Array.isArray(json.unassigned_cleaners) ? json.unassigned_cleaners : []
      for (const c of unassigned) {
        const id = String(c.id)
        if (seenIds.has(id)) continue
        seenIds.add(id)
        roster.push({
          id,
          name: String(c.name || "Cleaner"),
          phone: String(c.phone || ""),
          telegram_id: c.telegram_id || undefined,
          role: c.role || "technician",
          employee_type: (c.employee_type || "technician") as EmployeeType,
          is_active: Boolean(c.is_active),
          username: (c as any).username || undefined,
          pin: (c as any).pin || undefined,
        })
      }

      roster.sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      setCleaners(roster)
    } catch {
      setCleaners([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeams()
  }, [employeeTypeFilter])

  // Persist filters
  useEffect(() => {
    localStorage.setItem("teams-employee-type-filter", employeeTypeFilter)
  }, [employeeTypeFilter])

  useEffect(() => {
    if (selectedCleaner) localStorage.setItem("teams-selected-cleaner", JSON.stringify(selectedCleaner))
    else localStorage.removeItem("teams-selected-cleaner")
  }, [selectedCleaner])

  // Load cleaner detail data when selection or tab changes
  const loadCleanerEarnings = useCallback(async (cleanerId: string, period: EarningsPeriod, start?: string, end?: string) => {
    setEarningsLoading(true)
    try {
      const params = new URLSearchParams({ period, cleaner_id: cleanerId })
      if (period === "custom" && start) params.set("start", start)
      if (period === "custom" && end) params.set("end", end)
      const res = await fetch(`/api/teams/earnings?${params.toString()}`)
      const json = await res.json()
      if (json.success) {
        const cleaners = json.data.cleaners || []
        setCleanerEarnings(cleaners[0] || null)
        setEarningsSummary(json.data.summary || null)
      }
    } catch {
      setCleanerEarnings(null)
      setEarningsSummary(null)
    } finally {
      setEarningsLoading(false)
    }
  }, [])

  const loadCleanerJobs = useCallback(async (cleanerId: string) => {
    setJobsLoading(true)
    try {
      const res = await fetch(`/api/teams/cleaner-jobs?cleaner_id=${cleanerId}`)
      const json = await res.json()
      if (json.success) {
        setCleanerJobs(json.data)
      }
    } catch {
      setCleanerJobs({ today: [], upcoming: [], recent: [] })
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const loadPortalMessages = useCallback(async (cleanerId: string) => {
    setPortalMessagesLoading(true)
    try {
      const res = await fetch(`/api/teams/messages?cleaner_id=${cleanerId}&limit=200`)
      const json = await res.json()
      if (json.success) setPortalMessages(json.data || [])
    } catch {
      setPortalMessages([])
    } finally {
      setPortalMessagesLoading(false)
    }
  }, [])

  const loadSmsMessages = useCallback(async (phone: string) => {
    setChatLoading(true)
    try {
      const params = new URLSearchParams({ phone, limit: "200" })
      const res = await fetch(`/api/teams/messages?${params.toString()}`)
      const json = await res.json()
      if (json.success) setChatMessages(json.data || [])
    } catch {
      setChatMessages([])
    } finally {
      setChatLoading(false)
    }
  }, [])

  // Fetch data when cleaner or tab changes
  useEffect(() => {
    if (!selectedCleaner) return
    if (activeTab === "overview") {
      loadCleanerEarnings(selectedCleaner.id, earningsPeriod, earningsCustomStart, earningsCustomEnd)
    }
  }, [selectedCleaner?.id, activeTab, earningsPeriod, earningsCustomStart, earningsCustomEnd, loadCleanerEarnings])

  useEffect(() => {
    if (!selectedCleaner) return
    if (activeTab === "jobs") loadCleanerJobs(selectedCleaner.id)
  }, [selectedCleaner?.id, activeTab, loadCleanerJobs])

  useEffect(() => {
    if (!selectedCleaner) return
    if (activeTab === "messages") loadPortalMessages(selectedCleaner.id)
  }, [selectedCleaner?.id, activeTab, loadPortalMessages])

  useEffect(() => {
    if (!selectedCleaner?.phone) return
    if (activeTab === "sms") loadSmsMessages(selectedCleaner.phone)
  }, [selectedCleaner?.id, activeTab, loadSmsMessages])

  // Auto-scroll SMS
  useEffect(() => {
    if (chatMessages.length > 0 && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages])

  // Edit / Delete / Send handlers
  async function handleSaveEdit() {
    if (!editingMember) return
    setEditSaving(true)
    try {
      const res = await fetch("/api/manage-teams", {
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
          username: editingMember.username,
          pin: editingMember.pin,
        }),
      })
      const json = await res.json()
      // If credentials were changed, the API auto-sends them
      if (json.credentials_sent) {
        setCredentialsSent(true)
      }
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
        if (selectedCleaner?.id === deleteTarget.id) setSelectedCleaner(null)
        await loadTeams()
      }
    } catch (err: any) {
      setLoadError(err?.message || "Delete failed")
    } finally {
      setDeleteTarget(null)
    }
  }

  async function handleSendCredentials() {
    if (!selectedCleaner || sendingCredentials) return
    setSendingCredentials(true)
    setCredentialsSent(false)
    try {
      const res = await fetch("/api/actions/send-employee-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleaner_id: Number(selectedCleaner.id) }),
      })
      const json = await res.json()
      if (json.success) {
        setCredentialsSent(true)
      } else {
        setLoadError(json.error || "Failed to send credentials")
      }
    } catch {
      setLoadError("Failed to send credentials")
    } finally {
      setSendingCredentials(false)
    }
  }

  async function handleSendSMS() {
    if (!selectedCleaner?.phone || !sendText.trim() || sending) return
    const messageText = sendText.trim()
    setSending(true)
    try {
      const res = await fetch("/api/actions/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: selectedCleaner.phone, message: messageText }),
      })
      const json = await res.json()
      if (json.success) {
        setSendText("")
        setChatMessages((prev) => [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            phone_number: selectedCleaner.phone,
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

  // Filter cleaners by search
  const filteredCleaners = useMemo(() => {
    if (!searchQuery.trim()) return cleaners
    const q = searchQuery.toLowerCase()
    return cleaners.filter((c) =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q)
    )
  }, [cleaners, searchQuery])

  function selectCleaner(c: CleanerDetail) {
    setSelectedCleaner(c)
    setActiveTab("sms")
    setCredentialsSent(false)
  }

  async function toggleCleanerActive(cleanerId: string, active: boolean) {
    // Optimistic update
    setCleaners((prev) =>
      prev.map((c) => (c.id === cleanerId ? { ...c, is_active: active } : c))
    )
    if (selectedCleaner?.id === cleanerId) {
      setSelectedCleaner((prev) => prev ? { ...prev, is_active: active } : prev)
    }
    try {
      const res = await fetch("/api/manage-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_active", cleaner_id: Number(cleanerId), active }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error || "Toggle failed")
      }
    } catch {
      // Revert on failure
      setCleaners((prev) =>
        prev.map((c) => (c.id === cleanerId ? { ...c, is_active: !active } : c))
      )
      if (selectedCleaner?.id === cleanerId) {
        setSelectedCleaner((prev) => prev ? { ...prev, is_active: !active } : prev)
      }
    }
  }

  const statusColors: Record<string, string> = {
    scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    in_progress: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    pending: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  }

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0 stagger-1">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground">Manage your cleaners and track performance</p>
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
              Manage / Create Teams
            </Link>
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      {loading ? <CubeLoader /> : (
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 stagger-2">
        {/* LEFT: Cleaner roster */}
        <div className="w-full md:w-[320px] shrink-0 flex flex-col min-h-0">
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cleaners..."
              className="pl-9 text-sm"
            />
          </div>

          {/* Roster list */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
            {loadError && (
              <Card className="border-destructive/50">
                <CardContent className="p-3 text-sm text-destructive">{loadError}</CardContent>
              </Card>
            )}
            {!loadError && filteredCleaners.length === 0 && (
              <p className="text-sm text-muted-foreground p-3">No cleaners found.</p>
            )}
            {filteredCleaners.map((c) => {
              const isSelected = selectedCleaner?.id === c.id
              return (
                <div
                  key={c.id}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors cursor-pointer group",
                    isSelected
                      ? "bg-purple-500/10 border border-purple-500/30"
                      : "hover:bg-muted/50 border border-transparent",
                    !c.is_active && "opacity-50"
                  )}
                  onClick={() => selectCleaner(c)}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      c.is_active ? "bg-green-500" : "bg-zinc-500"
                    )} />
                    <div className="min-w-0">
                      <span className={cn(
                        "text-sm font-medium truncate block",
                        isSelected ? "text-purple-300" : "text-foreground"
                      )}>
                        {c.name}
                      </span>
                      {c.team_name && (
                        <span className="text-[10px] text-muted-foreground truncate block">{c.team_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingMember({
                            id: c.id, name: c.name, phone: c.phone, email: "",
                            is_team_lead: c.role === "lead",
                            employee_type: c.employee_type || "technician",
                            username: (c as any).username || c.name,
                            pin: (c as any).pin || "",
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
                          setDeleteTarget({ id: c.id, name: c.name })
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Switch
                      checked={c.is_active}
                      onCheckedChange={(checked) => {
                        toggleCleanerActive(c.id, checked)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Toggle ${c.name} active`}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-[10px] text-muted-foreground pt-2 text-center">
            {filteredCleaners.length} cleaner{filteredCleaners.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* RIGHT: Cleaner detail panel */}
        <Card className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {selectedCleaner ? (
            <>
              {/* Detail header */}
              <div className="p-4 border-b shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{selectedCleaner.name}</h2>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {selectedCleaner.phone || "No phone"}
                      </span>
                      {selectedCleaner.team_name && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {selectedCleaner.team_name}
                        </span>
                      )}
                      <Badge variant="outline" className={cn("text-[10px]", selectedCleaner.is_active ? "text-green-400 border-green-500/30" : "text-zinc-400")}>
                        {selectedCleaner.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingMember({
                        id: selectedCleaner.id, name: selectedCleaner.name,
                        phone: selectedCleaner.phone, email: "",
                        is_team_lead: selectedCleaner.role === "lead",
                        employee_type: selectedCleaner.employee_type || "technician",
                        username: (selectedCleaner as any).username || selectedCleaner.name,
                        pin: (selectedCleaner as any).pin || "",
                      })}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget({ id: selectedCleaner.id, name: selectedCleaner.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                    </Button>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-1 mt-3">
                  {([
                    { key: "overview", label: "Overview", icon: TrendingUp },
                    { key: "jobs", label: "Jobs", icon: Calendar },
                    { key: "messages", label: "Messages", icon: MessageSquare },
                    { key: "sms", label: "Direct SMS", icon: Send },
                  ] as const).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                        activeTab === key
                          ? "bg-background text-foreground shadow-sm border border-border"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === "overview" && (
                  <div className="p-4 space-y-4">
                    {/* Earnings card */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <DollarSign className="h-4 w-4 text-green-500" />
                          Earnings
                        </h3>
                        <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
                          {(["week", "month", "custom"] as EarningsPeriod[]).map((p) => (
                            <button
                              key={p}
                              onClick={() => setEarningsPeriod(p)}
                              className={cn(
                                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors capitalize",
                                earningsPeriod === p
                                  ? "bg-background text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              {p === "week" ? "Week" : p === "month" ? "Month" : "Custom"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {earningsPeriod === "custom" && (
                        <div className="flex items-center gap-2 mb-3">
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

                      {earningsLoading ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Loading earnings...</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          <Card>
                            <CardContent className="p-4 text-center">
                              <p className="text-xs text-muted-foreground mb-1">Total Earned</p>
                              <p className="text-2xl font-bold text-green-500">
                                ${cleanerEarnings?.total?.toLocaleString() || "0"}
                              </p>
                            </CardContent>
                          </Card>
                          <Card>
                            <CardContent className="p-4 text-center">
                              <p className="text-xs text-muted-foreground mb-1">Jobs Completed</p>
                              <p className="text-2xl font-bold text-foreground">
                                {cleanerEarnings?.job_count || 0}
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      {earningsSummary && (
                        <p className="text-[10px] text-muted-foreground mt-2">
                          {earningsSummary.start_date} — {earningsSummary.end_date}
                        </p>
                      )}
                    </div>

                    {/* Engagement placeholders */}
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <Star className="h-4 w-4 text-amber-500" />
                        Engagement
                      </h3>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: "On-Time Rate", icon: Timer, color: "text-blue-400" },
                          { label: "Acceptance Rate", icon: CheckCircle2, color: "text-green-400" },
                          { label: "Revenue Generated", icon: TrendingUp, color: "text-purple-400" },
                        ].map(({ label, icon: Icon, color }) => (
                          <Card key={label} className="opacity-60">
                            <CardContent className="p-4 text-center">
                              <Icon className={cn("h-5 w-5 mx-auto mb-2", color)} />
                              <p className="text-xs text-muted-foreground mb-1">{label}</p>
                              <p className="text-sm font-medium text-muted-foreground">Coming Soon</p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>

                    {/* Portal Login Credentials */}
                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                        <Phone className="h-4 w-4 text-emerald-500" />
                        Portal Login
                      </h3>
                      <Card>
                        <CardContent className="p-4 space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Text this employee their portal login credentials (username &amp; PIN) so they can access their portal at theosirisai.com.
                          </p>
                          <Button
                            onClick={handleSendCredentials}
                            disabled={sendingCredentials || !selectedCleaner?.phone}
                            className="w-full"
                            variant={credentialsSent ? "outline" : "default"}
                          >
                            {sendingCredentials ? (
                              "Sending..."
                            ) : credentialsSent ? (
                              <span className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                Sent a text containing the login username and password
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <Send className="h-4 w-4" />
                                Send Login Instructions as Text
                              </span>
                            )}
                          </Button>
                          {!selectedCleaner?.phone && (
                            <p className="text-xs text-amber-500">No phone number on file — add one to send credentials.</p>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}

                {activeTab === "jobs" && (
                  <div className="p-4 space-y-4">
                    {jobsLoading ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">Loading jobs...</p>
                    ) : (
                      <>
                        {/* Today's jobs */}
                        <div>
                          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-blue-400" />
                            Today ({cleanerJobs.today.length})
                          </h3>
                          {cleanerJobs.today.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No jobs today</p>
                          ) : (
                            <div className="space-y-2">
                              {cleanerJobs.today.map((j) => (
                                <JobCard key={j.id} job={j} statusColors={statusColors} />
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Upcoming */}
                        <div>
                          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                            <ArrowRight className="h-4 w-4 text-amber-400" />
                            Upcoming ({cleanerJobs.upcoming.length})
                          </h3>
                          {cleanerJobs.upcoming.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No upcoming jobs</p>
                          ) : (
                            <div className="space-y-2">
                              {cleanerJobs.upcoming.map((j) => (
                                <JobCard key={j.id} job={j} statusColors={statusColors} />
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Recent completed */}
                        <div>
                          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                            Recent Completed ({cleanerJobs.recent.length})
                          </h3>
                          {cleanerJobs.recent.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No recent completed jobs</p>
                          ) : (
                            <div className="space-y-2">
                              {cleanerJobs.recent.map((j) => (
                                <JobCard key={j.id} job={j} statusColors={statusColors} />
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "messages" && (
                  <div className="p-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1.5">
                      <MessageSquare className="h-4 w-4 text-blue-400" />
                      Client Messages
                    </h3>
                    {portalMessagesLoading ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">Loading messages...</p>
                    ) : portalMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-3" />
                        <p className="text-sm text-muted-foreground">No messages found for this cleaner</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {portalMessages.map((msg) => (
                          <MessageBubble
                            key={msg.id}
                            role={msg.direction === "inbound" ? "client" : "assistant"}
                            content={msg.content}
                            timestamp={msg.timestamp}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "sms" && (
                  <div className="flex flex-col h-full">
                    {/* SMS messages */}
                    <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-1" style={{ background: "rgba(39, 39, 42, 0.5)" }}>
                      {chatLoading && (
                        <p className="text-center text-sm text-muted-foreground py-8">Loading messages...</p>
                      )}
                      {!chatLoading && chatMessages.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 text-center">
                          <Send className="h-10 w-10 text-muted-foreground/30 mb-3" />
                          <p className="text-sm text-muted-foreground">No SMS history. Send a message below.</p>
                        </div>
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

                    {/* SMS send bar */}
                    <div className="p-3 border-t shrink-0">
                      {selectedCleaner.phone ? (
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
                        <p className="text-xs text-muted-foreground text-center">No phone number configured for this cleaner</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Users className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="text-muted-foreground text-sm">
                Select a cleaner from the roster to view their details
              </p>
            </div>
          )}
        </Card>
      </div>
      )}

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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Portal Username</label>
                  <Input
                    value={editingMember.username}
                    onChange={(e) => setEditingMember({ ...editingMember, username: e.target.value })}
                    placeholder="Full name"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Portal PIN</label>
                  <div className="flex gap-1.5">
                    <Input
                      value={editingMember.pin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 4)
                        setEditingMember({ ...editingMember, pin: val })
                      }}
                      placeholder="4 digits"
                      maxLength={4}
                      inputMode="numeric"
                      className="font-mono tracking-widest"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={() => {
                        const newPin = String(Math.floor(Math.random() * 10000)).padStart(4, "0")
                        setEditingMember({ ...editingMember, pin: newPin })
                      }}
                    >
                      New
                    </Button>
                  </div>
                </div>
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

// Job card sub-component
function JobCard({ job, statusColors }: { job: { id: number; address: string; customer_name: string; service_type: string; scheduled_date: string; scheduled_time: string; status: string; amount: number }; statusColors: Record<string, string> }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">{job.customer_name}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{job.address || "No address"}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              {job.service_type && (
                <span className="text-xs text-muted-foreground">{job.service_type}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {job.scheduled_date}{job.scheduled_time ? ` at ${job.scheduled_time}` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
            <Badge variant="outline" className={cn("text-[10px]", statusColors[job.status] || "")}>
              {job.status.replace("_", " ")}
            </Badge>
            {job.amount > 0 && (
              <span className="text-sm font-semibold text-green-500">${job.amount}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
