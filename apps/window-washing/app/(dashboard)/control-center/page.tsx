"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Sliders, MessageSquare, DollarSign, ClipboardList,
  Save, Plus, Trash2, Loader2, Check, AlertCircle, X,
  Briefcase, ChevronDown, ChevronRight, ToggleLeft, ToggleRight,
  Edit2, Banknote
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: number
  trigger_type: string
  message_template: string
  is_active: boolean
}

interface PricebookItem {
  id: number
  name: string
  price: number
  active: boolean
}

interface TagItem {
  id: number
  tag_type: string
  tag_value: string
  color: string | null
  is_active: boolean
}

interface ChecklistItem {
  id: number
  name: string
  items: string[]
  is_default: boolean
}

interface JobData {
  id: number | string
  title?: string
  customer_name?: string
  customers?: { name?: string; full_name?: string }
  status?: string
  price?: number
  estimated_value?: number
  payment_status?: string
  tip_amount?: number
  checklist_progress?: { completed: number; total: number }
  scheduled_at?: string
  scheduled_date?: string
  date?: string
  service_type?: string
  address?: string
  notes?: string
}

type ToastType = "success" | "error"

interface Toast {
  id: number
  type: ToastType
  message: string
}

const API = "/api/actions/control-center"

const MESSAGE_TRIGGERS = [
  { trigger: "on_my_way", label: "On My Way", icon: "car" },
  { trigger: "visit_started", label: "Visit Started", icon: "play" },
  { trigger: "receipt", label: "Receipt", icon: "receipt" },
  { trigger: "review_request", label: "Review Request", icon: "star" },
  { trigger: "thank_you_tip", label: "Thank You + Tip", icon: "heart" },
  { trigger: "quote_sent", label: "Quote Sent", icon: "send" },
  { trigger: "quote_approved", label: "Quote Approved", icon: "check" },
  { trigger: "service_plan_sent", label: "Service Plan Sent", icon: "calendar" },
  { trigger: "appointment_reminder", label: "Appointment Reminder", icon: "bell" },
  { trigger: "reschedule_notice", label: "Reschedule Notice", icon: "refresh" },
] as const

const TAG_TYPES = [
  "salesman",
  "technician",
  "team_lead",
  "service_plan",
  "service_months",
  "custom",
] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function getStatusColor(status?: string): string {
  switch (status?.toLowerCase()) {
    case "completed":
      return "bg-green-900/40 text-green-400 border-green-800"
    case "in_progress":
    case "in-progress":
      return "bg-blue-900/40 text-blue-400 border-blue-800"
    case "scheduled":
      return "bg-amber-900/40 text-amber-400 border-amber-800"
    case "cancelled":
      return "bg-red-900/40 text-red-400 border-red-800"
    default:
      return "bg-zinc-800 text-zinc-400 border-zinc-700"
  }
}

function formatCurrency(amount?: number): string {
  if (amount == null || !Number.isFinite(amount)) return "$0"
  return `$${amount.toFixed(2)}`
}

function getJobName(job: JobData): string {
  if (job.customer_name) return job.customer_name
  if (job.customers?.name) return job.customers.name
  if (job.customers?.full_name) return job.customers.full_name
  return job.title ?? `Job #${job.id}`
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ControlCenterPage() {
  const { user } = useAuth()

  // Toast state
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const showToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastId.current
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  // ── Jobs state ──
  const [jobs, setJobs] = useState<JobData[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)

  // ── Messages state ──
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [messagesSaving, setMessagesSaving] = useState(false)
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({})
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null)

  // ── Pricebook state ──
  const [pricebook, setPricebook] = useState<PricebookItem[]>([])
  const [pricebookLoading, setPricebookLoading] = useState(true)
  const [pricebookSaving, setPricebookSaving] = useState(false)
  const [pricebookDrafts, setPricebookDrafts] = useState<Record<number, { name: string; price: string }>>({})
  const [newService, setNewService] = useState<{ name: string; price: string } | null>(null)

  // ── Tags state ──
  const [tags, setTags] = useState<TagItem[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [tagsSaving, setTagsSaving] = useState(false)
  const [newTag, setNewTag] = useState<{ tag_type: string; tag_value: string; color: string } | null>(null)

  // ── Checklists state ──
  const [checklists, setChecklists] = useState<ChecklistItem[]>([])
  const [checklistsLoading, setChecklistsLoading] = useState(true)
  const [checklistsSaving, setChecklistsSaving] = useState(false)
  const [newChecklist, setNewChecklist] = useState<{ name: string; items: string; is_default: boolean } | null>(null)
  const [editingChecklist, setEditingChecklist] = useState<number | null>(null)
  const [checklistDrafts, setChecklistDrafts] = useState<Record<number, { name: string; items: string; is_default: boolean }>>({})

  // ── Panel toggles ──
  const [showPricebook, setShowPricebook] = useState(true)
  const [showTags, setShowTags] = useState(false)
  const [showChecklists, setShowChecklists] = useState(false)

  // ── Fetch helpers ──
  const fetchJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await fetch(`/api/jobs?start=${today}&end=${today}`)
      const json = await res.json()
      if (json.success !== false) {
        const jobList = Array.isArray(json) ? json : (json.data ?? json.jobs ?? [])
        setJobs(jobList)
      }
    } catch {
      // Silent fail for jobs — not critical
    } finally {
      setJobsLoading(false)
    }
  }, [])

  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true)
    try {
      const res = await fetch(`${API}?type=messages`)
      const json = await res.json()
      if (json.success) {
        setMessages(json.data)
        const drafts: Record<string, string> = {}
        for (const m of json.data as Message[]) {
          drafts[m.trigger_type] = m.message_template
        }
        setMessageDrafts(drafts)
      }
    } catch {
      showToast("error", "Failed to load messages")
    } finally {
      setMessagesLoading(false)
    }
  }, [showToast])

  const fetchPricebook = useCallback(async () => {
    setPricebookLoading(true)
    try {
      const res = await fetch(`${API}?type=pricebook`)
      const json = await res.json()
      if (json.success) {
        setPricebook(json.data)
        const drafts: Record<number, { name: string; price: string }> = {}
        for (const p of json.data as PricebookItem[]) {
          drafts[p.id] = { name: p.name, price: String(p.price) }
        }
        setPricebookDrafts(drafts)
      }
    } catch {
      showToast("error", "Failed to load price book")
    } finally {
      setPricebookLoading(false)
    }
  }, [showToast])

  const fetchTags = useCallback(async () => {
    setTagsLoading(true)
    try {
      const res = await fetch(`${API}?type=tags`)
      const json = await res.json()
      if (json.success) setTags(json.data)
    } catch {
      showToast("error", "Failed to load tags")
    } finally {
      setTagsLoading(false)
    }
  }, [showToast])

  const fetchChecklists = useCallback(async () => {
    setChecklistsLoading(true)
    try {
      const res = await fetch(`${API}?type=checklists`)
      const json = await res.json()
      if (json.success) {
        setChecklists(json.data)
        const drafts: Record<number, { name: string; items: string; is_default: boolean }> = {}
        for (const c of json.data as ChecklistItem[]) {
          drafts[c.id] = { name: c.name, items: c.items.join("\n"), is_default: c.is_default }
        }
        setChecklistDrafts(drafts)
      }
    } catch {
      showToast("error", "Failed to load checklists")
    } finally {
      setChecklistsLoading(false)
    }
  }, [showToast])

  // Fetch all on mount
  useEffect(() => {
    fetchJobs()
    fetchMessages()
    fetchPricebook()
    fetchTags()
    fetchChecklists()
  }, [fetchJobs, fetchMessages, fetchPricebook, fetchTags, fetchChecklists])

  // ── Messages handlers ──
  async function toggleMessageActive(msg: Message) {
    setMessagesSaving(true)
    try {
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "messages", id: msg.id, data: { is_active: !msg.is_active } }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", `${msg.trigger_type} ${msg.is_active ? "disabled" : "enabled"}`)
      await fetchMessages()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to toggle message")
    } finally {
      setMessagesSaving(false)
    }
  }

  async function saveMessageTemplate(trigger: string) {
    setMessagesSaving(true)
    try {
      const existingMsg = messages.find((m) => m.trigger_type === trigger)
      const draft = messageDrafts[trigger] ?? ""

      if (existingMsg) {
        if (draft !== existingMsg.message_template) {
          const res = await fetch(API, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "messages", id: existingMsg.id, data: { message_template: draft } }),
          })
          const json = await res.json()
          if (!json.success) throw new Error(json.error)
        }
      } else if (draft.trim()) {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "messages", data: { trigger_type: trigger, message_template: draft } }),
        })
        const json = await res.json()
        if (!json.success) throw new Error(json.error)
      }

      showToast("success", "Template saved")
      await fetchMessages()
      setExpandedMessage(null)
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save template")
    } finally {
      setMessagesSaving(false)
    }
  }

  // ── Pricebook handlers ──
  async function savePricebook() {
    setPricebookSaving(true)
    try {
      for (const item of pricebook) {
        const draft = pricebookDrafts[item.id]
        if (!draft) continue
        const newName = draft.name.trim()
        const newPrice = parseFloat(draft.price)
        if (newName !== item.name || newPrice !== item.price) {
          const res = await fetch(API, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "pricebook", id: item.id, data: { name: newName, price: newPrice } }),
          })
          const json = await res.json()
          if (!json.success) throw new Error(json.error)
        }
      }
      showToast("success", "Price book saved")
      await fetchPricebook()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save price book")
    } finally {
      setPricebookSaving(false)
    }
  }

  async function addPricebookItem() {
    if (!newService) return
    const name = newService.name.trim()
    const price = parseFloat(newService.price)
    if (!name || !Number.isFinite(price) || price < 0) {
      showToast("error", "Enter a valid service name and price")
      return
    }
    setPricebookSaving(true)
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pricebook", data: { name, price } }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Service added")
      setNewService(null)
      await fetchPricebook()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to add service")
    } finally {
      setPricebookSaving(false)
    }
  }

  async function deletePricebookItem(id: number) {
    setPricebookSaving(true)
    try {
      const res = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pricebook", id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Service removed")
      await fetchPricebook()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete service")
    } finally {
      setPricebookSaving(false)
    }
  }

  // ── Tags handlers ──
  async function addTag() {
    if (!newTag) return
    const tagType = newTag.tag_type.trim()
    const tagValue = newTag.tag_value.trim()
    if (!tagType || !tagValue) {
      showToast("error", "Tag type and value are required")
      return
    }
    setTagsSaving(true)
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tags",
          data: { tag_type: tagType, tag_value: tagValue, color: newTag.color || null },
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Tag added")
      setNewTag(null)
      await fetchTags()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to add tag")
    } finally {
      setTagsSaving(false)
    }
  }

  async function deleteTag(id: number) {
    setTagsSaving(true)
    try {
      const res = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "tags", id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Tag removed")
      await fetchTags()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete tag")
    } finally {
      setTagsSaving(false)
    }
  }

  // ── Checklists handlers ──
  async function addChecklist() {
    if (!newChecklist) return
    const name = newChecklist.name.trim()
    const items = newChecklist.items.split("\n").map((s) => s.trim()).filter(Boolean)
    if (!name) {
      showToast("error", "Checklist name is required")
      return
    }
    setChecklistsSaving(true)
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checklists", data: { name, items, is_default: newChecklist.is_default } }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Checklist created")
      setNewChecklist(null)
      await fetchChecklists()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to create checklist")
    } finally {
      setChecklistsSaving(false)
    }
  }

  async function saveChecklist(id: number) {
    const draft = checklistDrafts[id]
    if (!draft) return
    setChecklistsSaving(true)
    try {
      const items = draft.items.split("\n").map((s) => s.trim()).filter(Boolean)
      const res = await fetch(API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checklists", id, data: { name: draft.name.trim(), items, is_default: draft.is_default } }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Checklist updated")
      setEditingChecklist(null)
      await fetchChecklists()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to update checklist")
    } finally {
      setChecklistsSaving(false)
    }
  }

  async function deleteChecklist(id: number) {
    setChecklistsSaving(true)
    try {
      const res = await fetch(API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "checklists", id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      showToast("success", "Checklist deleted")
      await fetchChecklists()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to delete checklist")
    } finally {
      setChecklistsSaving(false)
    }
  }

  // ── Derived data ──
  const tagsByType = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
    if (!acc[tag.tag_type]) acc[tag.tag_type] = []
    acc[tag.tag_type].push(tag)
    return acc
  }, {})

  const activeJobs = jobs.filter(
    (j) => j.status !== "cancelled" && j.status !== "completed"
  )
  const completedJobs = jobs.filter((j) => j.status === "completed")

  const totalTips = jobs.reduce((sum, j) => sum + (j.tip_amount ?? 0), 0)
  const totalRevenue = jobs.reduce((sum, j) => sum + (j.price ?? j.estimated_value ?? 0), 0)
  const activeMessageCount = messages.filter((m) => m.is_active).length

  // ── Loading spinner ──
  function LoadingBlock() {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs">Loading...</span>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-right ${
              t.type === "success"
                ? "bg-green-900/90 text-green-200 border border-green-800"
                : "bg-red-900/90 text-red-200 border border-red-800"
            }`}
          >
            {t.type === "success" ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sliders className="w-5 h-5" />
            Control Center
          </h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            Operations dashboard — jobs, automations, pricing
          </p>
        </div>
        <div className="text-right hidden md:block">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Today</p>
          <p className="text-sm font-semibold text-zinc-300">
            {new Date().toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
            <Briefcase className="w-3 h-3" />
            Active Jobs
          </div>
          <p className="text-lg font-bold text-white">{activeJobs.length}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
            <DollarSign className="w-3 h-3" />
            Today Revenue
          </div>
          <p className="text-lg font-bold text-white">{formatCurrency(totalRevenue)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
            <Banknote className="w-3 h-3" />
            Tip Track
          </div>
          <p className="text-lg font-bold text-emerald-400">{formatCurrency(totalTips)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1">
            <MessageSquare className="w-3 h-3" />
            Active Rules
          </div>
          <p className="text-lg font-bold text-white">
            {activeMessageCount}
            <span className="text-xs text-zinc-500 font-normal ml-1">/ {MESSAGE_TRIGGERS.length}</span>
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ══════════ LEFT COLUMN — Operational Status ══════════ */}
        <div className="space-y-4">

          {/* Active Jobs */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <div className="flex items-center justify-between p-4 pb-3 border-b border-zinc-800/50">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-blue-400" />
                Active Jobs
              </h3>
              <Badge variant="secondary" className="text-[10px] bg-zinc-800">
                {activeJobs.length} active
              </Badge>
            </div>
            <div className="p-3">
              {jobsLoading ? (
                <LoadingBlock />
              ) : activeJobs.length === 0 ? (
                <p className="text-xs text-zinc-600 text-center py-6">No active jobs today</p>
              ) : (
                <div className="space-y-2">
                  {activeJobs.map((job) => {
                    const checkProgress = job.checklist_progress
                    const completedCount = checkProgress?.completed ?? 0
                    const totalCount = checkProgress?.total ?? 0
                    const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

                    return (
                      <div
                        key={job.id}
                        className="bg-zinc-900 rounded-lg p-3 border border-zinc-800/50 hover:border-zinc-700 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white truncate">
                              {getJobName(job)}
                            </p>
                            {job.address && (
                              <p className="text-[11px] text-zinc-500 truncate mt-0.5">{job.address}</p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ml-2 shrink-0 ${getStatusColor(job.status)}`}
                          >
                            {(job.status ?? "pending").replace(/_/g, " ")}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-zinc-400">
                          {/* Checklist progress */}
                          {totalCount > 0 && (
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <ClipboardList className="w-3 h-3 text-zinc-500 shrink-0" />
                              <div className="flex-1 bg-zinc-800 rounded-full h-1.5 min-w-[60px]">
                                <div
                                  className="bg-blue-500 h-1.5 rounded-full transition-all"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-zinc-500 shrink-0">
                                {completedCount}/{totalCount}
                              </span>
                            </div>
                          )}

                          {/* Price */}
                          <span className="flex items-center gap-1 shrink-0">
                            <DollarSign className="w-3 h-3" />
                            {formatCurrency(job.price ?? job.estimated_value)}
                          </span>

                          {/* Tip */}
                          {(job.tip_amount ?? 0) > 0 && (
                            <span className="flex items-center gap-1 text-emerald-400 shrink-0">
                              <Banknote className="w-3 h-3" />
                              +{formatCurrency(job.tip_amount)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Completed Jobs (today) */}
          {completedJobs.length > 0 && (
            <div className="border border-zinc-800 rounded-lg bg-zinc-950">
              <div className="flex items-center justify-between p-4 pb-3 border-b border-zinc-800/50">
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-400" />
                  Completed Today
                </h3>
                <Badge variant="secondary" className="text-[10px] bg-green-900/30 text-green-400">
                  {completedJobs.length} done
                </Badge>
              </div>
              <div className="p-3 space-y-1.5">
                {completedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded"
                  >
                    <span className="text-xs text-zinc-400">{getJobName(job)}</span>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-zinc-300">{formatCurrency(job.price ?? job.estimated_value)}</span>
                      {(job.tip_amount ?? 0) > 0 && (
                        <span className="text-emerald-400">+{formatCurrency(job.tip_amount)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Checklist Templates */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <button
              type="button"
              onClick={() => setShowChecklists(!showChecklists)}
              className="flex items-center justify-between w-full p-4 pb-3 text-left cursor-pointer"
            >
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-amber-400" />
                Checklist Templates
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-zinc-800">
                  {checklists.length}
                </Badge>
                {showChecklists ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                )}
              </div>
            </button>

            {showChecklists && (
              <div className="p-3 pt-0 border-t border-zinc-800/50">
                {checklistsLoading ? (
                  <LoadingBlock />
                ) : (
                  <>
                    <div className="flex justify-end mb-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer text-xs"
                        onClick={() => setNewChecklist(newChecklist ? null : { name: "", items: "", is_default: false })}
                      >
                        {newChecklist ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                        {newChecklist ? "Cancel" : "New Template"}
                      </Button>
                    </div>

                    {newChecklist && (
                      <div className="p-3 bg-zinc-800 rounded-lg mb-3 border border-dashed border-zinc-600 space-y-2">
                        <Input
                          value={newChecklist.name}
                          onChange={(e) => setNewChecklist({ ...newChecklist, name: e.target.value })}
                          className="text-sm"
                          placeholder="Checklist name..."
                          autoFocus
                        />
                        <Textarea
                          value={newChecklist.items}
                          onChange={(e) => setNewChecklist({ ...newChecklist, items: e.target.value })}
                          className="min-h-[80px] text-sm"
                          placeholder="One item per line..."
                        />
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newChecklist.is_default}
                              onChange={(e) => setNewChecklist({ ...newChecklist, is_default: e.target.checked })}
                              className="rounded"
                            />
                            Default
                          </label>
                          <Button size="sm" onClick={addChecklist} disabled={checklistsSaving} className="cursor-pointer text-xs">
                            {checklistsSaving ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Plus className="w-3 h-3 mr-1" />
                            )}
                            Create
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {checklists.length === 0 && !newChecklist && (
                        <p className="text-xs text-zinc-600 text-center py-4">No checklists yet</p>
                      )}
                      {checklists.map((cl) => (
                        <div key={cl.id} className="p-3 bg-zinc-900 rounded-lg">
                          {editingChecklist === cl.id ? (
                            <div className="space-y-2">
                              <Input
                                value={checklistDrafts[cl.id]?.name ?? cl.name}
                                onChange={(e) =>
                                  setChecklistDrafts((prev) => ({
                                    ...prev,
                                    [cl.id]: { ...prev[cl.id], name: e.target.value },
                                  }))
                                }
                                className="text-sm font-medium"
                              />
                              <Textarea
                                value={checklistDrafts[cl.id]?.items ?? cl.items.join("\n")}
                                onChange={(e) =>
                                  setChecklistDrafts((prev) => ({
                                    ...prev,
                                    [cl.id]: { ...prev[cl.id], items: e.target.value },
                                  }))
                                }
                                className="min-h-[80px] text-sm"
                                placeholder="One item per line..."
                              />
                              <div className="flex items-center gap-2">
                                <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={checklistDrafts[cl.id]?.is_default ?? cl.is_default}
                                    onChange={(e) =>
                                      setChecklistDrafts((prev) => ({
                                        ...prev,
                                        [cl.id]: { ...prev[cl.id], is_default: e.target.checked },
                                      }))
                                    }
                                    className="rounded"
                                  />
                                  Default
                                </label>
                                <Button size="sm" onClick={() => saveChecklist(cl.id)} disabled={checklistsSaving} className="cursor-pointer text-xs">
                                  {checklistsSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                  Save
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setEditingChecklist(null)} className="cursor-pointer text-xs text-zinc-500">
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-white">{cl.name}</span>
                                  {cl.is_default && (
                                    <Badge variant="secondary" className="text-[10px] bg-green-900/30 text-green-400">
                                      Default
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="text-zinc-500 hover:text-white p-1 cursor-pointer"
                                    onClick={() => setEditingChecklist(cl.id)}
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    className="text-zinc-500 hover:text-red-400 p-1 cursor-pointer"
                                    onClick={() => deleteChecklist(cl.id)}
                                    disabled={checklistsSaving}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {cl.items.map((item, i) => (
                                  <span key={i} className="text-[11px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                                    {item}
                                  </span>
                                ))}
                                {cl.items.length === 0 && (
                                  <span className="text-[11px] text-zinc-600 italic">No items</span>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ══════════ RIGHT COLUMN — Rules & Config ══════════ */}
        <div className="space-y-4">

          {/* Automated Message Rules */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <div className="flex items-center justify-between p-4 pb-3 border-b border-zinc-800/50">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                Message Rules
              </h3>
              <span className="text-[10px] text-zinc-500">
                {activeMessageCount} of {MESSAGE_TRIGGERS.length} active
              </span>
            </div>
            <div className="p-3">
              {messagesLoading ? (
                <LoadingBlock />
              ) : (
                <div className="space-y-1">
                  {MESSAGE_TRIGGERS.map((t) => {
                    const msg = messages.find((m) => m.trigger_type === t.trigger)
                    const isActive = msg?.is_active ?? false
                    const hasTemplate = !!(msg?.message_template || messageDrafts[t.trigger]?.trim())
                    const isExpanded = expandedMessage === t.trigger

                    return (
                      <div key={t.trigger}>
                        <div
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                            isExpanded ? "bg-zinc-800" : "hover:bg-zinc-900"
                          }`}
                        >
                          {/* Toggle */}
                          <button
                            type="button"
                            onClick={() => {
                              if (msg) {
                                toggleMessageActive(msg)
                              }
                            }}
                            disabled={messagesSaving || !msg}
                            className="cursor-pointer shrink-0"
                            title={msg ? (isActive ? "Disable" : "Enable") : "Save a template first"}
                          >
                            {isActive ? (
                              <ToggleRight className="w-5 h-5 text-green-400" />
                            ) : (
                              <ToggleLeft className="w-5 h-5 text-zinc-600" />
                            )}
                          </button>

                          {/* Label */}
                          <button
                            type="button"
                            onClick={() => setExpandedMessage(isExpanded ? null : t.trigger)}
                            className="flex-1 text-left cursor-pointer"
                          >
                            <span className={`text-sm ${isActive ? "text-zinc-200" : "text-zinc-500"}`}>
                              {t.label}
                            </span>
                          </button>

                          {/* Status indicator */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasTemplate ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Template set" />
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" title="No template" />
                            )}
                            {isExpanded ? (
                              <ChevronDown className="w-3 h-3 text-zinc-500" />
                            ) : (
                              <ChevronRight className="w-3 h-3 text-zinc-500" />
                            )}
                          </div>
                        </div>

                        {/* Expanded template editor */}
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1">
                            <div className="bg-zinc-900 rounded-lg p-3 space-y-2">
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Template</p>
                              <Textarea
                                value={messageDrafts[t.trigger] ?? ""}
                                onChange={(e) =>
                                  setMessageDrafts((prev) => ({ ...prev, [t.trigger]: e.target.value }))
                                }
                                className="min-h-[60px] text-sm"
                                placeholder={`Template for ${t.label.toLowerCase()}...`}
                              />
                              <p className="text-[10px] text-zinc-600">
                                Variables: {"{{customer_name}}"} {"{{services}}"} {"{{total}}"} {"{{payment_method}}"} {"{{review_link}}"}
                              </p>
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => saveMessageTemplate(t.trigger)}
                                  disabled={messagesSaving}
                                  className="cursor-pointer text-xs"
                                >
                                  {messagesSaving ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  ) : (
                                    <Save className="w-3 h-3 mr-1" />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Pricing Rules */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <button
              type="button"
              onClick={() => setShowPricebook(!showPricebook)}
              className="flex items-center justify-between w-full p-4 pb-3 text-left cursor-pointer"
            >
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400" />
                Pricing Rules
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-zinc-800">
                  {pricebook.length} services
                </Badge>
                {showPricebook ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                )}
              </div>
            </button>

            {showPricebook && (
              <div className="p-3 pt-0 border-t border-zinc-800/50">
                {pricebookLoading ? (
                  <LoadingBlock />
                ) : (
                  <>
                    <div className="flex justify-end mb-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer text-xs"
                        onClick={() => setNewService(newService ? null : { name: "", price: "" })}
                      >
                        {newService ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                        {newService ? "Cancel" : "Add Service"}
                      </Button>
                    </div>

                    {newService && (
                      <div className="flex items-center gap-2 p-2 bg-zinc-800 rounded-lg mb-3 border border-dashed border-zinc-600">
                        <Input
                          value={newService.name}
                          onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                          className="text-sm flex-1"
                          placeholder="Service name..."
                          autoFocus
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-500 text-sm">$</span>
                          <Input
                            value={newService.price}
                            onChange={(e) => setNewService({ ...newService, price: e.target.value })}
                            className="text-sm w-20"
                            type="number"
                            placeholder="0"
                          />
                        </div>
                        <Button
                          size="sm"
                          onClick={addPricebookItem}
                          disabled={pricebookSaving}
                          className="cursor-pointer"
                        >
                          {pricebookSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        </Button>
                      </div>
                    )}

                    {/* Price table */}
                    {pricebook.length === 0 && !newService ? (
                      <p className="text-xs text-zinc-600 text-center py-4">No services yet</p>
                    ) : (
                      <div className="bg-zinc-900 rounded-lg overflow-hidden">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-zinc-800">
                              <th className="text-left text-[10px] text-zinc-500 uppercase px-3 py-2">Service</th>
                              <th className="text-right text-[10px] text-zinc-500 uppercase px-3 py-2 w-24">Price</th>
                              <th className="w-10" />
                            </tr>
                          </thead>
                          <tbody>
                            {pricebook.map((svc) => (
                              <tr key={svc.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                                <td className="px-3 py-2">
                                  <Input
                                    value={pricebookDrafts[svc.id]?.name ?? svc.name}
                                    onChange={(e) =>
                                      setPricebookDrafts((prev) => ({
                                        ...prev,
                                        [svc.id]: { ...prev[svc.id], name: e.target.value },
                                      }))
                                    }
                                    className="text-sm border-none bg-transparent p-0 h-auto focus-visible:ring-0"
                                  />
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-zinc-500 text-xs">$</span>
                                    <Input
                                      value={pricebookDrafts[svc.id]?.price ?? String(svc.price)}
                                      onChange={(e) =>
                                        setPricebookDrafts((prev) => ({
                                          ...prev,
                                          [svc.id]: { ...prev[svc.id], price: e.target.value },
                                        }))
                                      }
                                      className="text-sm border-none bg-transparent p-0 h-auto w-16 text-right focus-visible:ring-0"
                                      type="number"
                                    />
                                  </div>
                                </td>
                                <td className="px-1 py-2">
                                  <button
                                    type="button"
                                    className="text-zinc-600 hover:text-red-400 p-1 cursor-pointer"
                                    onClick={() => deletePricebookItem(svc.id)}
                                    disabled={pricebookSaving}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {pricebook.length > 0 && (
                      <div className="flex justify-end mt-3">
                        <Button size="sm" onClick={savePricebook} disabled={pricebookSaving} className="cursor-pointer text-xs">
                          {pricebookSaving ? (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3 mr-1" />
                          )}
                          Save Pricing
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Tag Bank */}
          <div className="border border-zinc-800 rounded-lg bg-zinc-950">
            <button
              type="button"
              onClick={() => setShowTags(!showTags)}
              className="flex items-center justify-between w-full p-4 pb-3 text-left cursor-pointer"
            >
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <span className="text-orange-400 text-base">#</span>
                Tag Bank
              </h3>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] bg-zinc-800">
                  {tags.length}
                </Badge>
                {showTags ? (
                  <ChevronDown className="w-4 h-4 text-zinc-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-zinc-500" />
                )}
              </div>
            </button>

            {showTags && (
              <div className="p-3 pt-0 border-t border-zinc-800/50">
                {tagsLoading ? (
                  <LoadingBlock />
                ) : (
                  <>
                    <div className="flex justify-end mb-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="cursor-pointer text-xs"
                        onClick={() => setNewTag(newTag ? null : { tag_type: TAG_TYPES[0], tag_value: "", color: "" })}
                      >
                        {newTag ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                        {newTag ? "Cancel" : "Add Tag"}
                      </Button>
                    </div>

                    {newTag && (
                      <div className="flex items-center gap-2 p-3 bg-zinc-800 rounded-lg mb-3 border border-dashed border-zinc-600">
                        <select
                          value={newTag.tag_type}
                          onChange={(e) => setNewTag({ ...newTag, tag_type: e.target.value })}
                          className="text-xs bg-zinc-900 text-zinc-300 border border-zinc-700 rounded px-2 py-1.5"
                        >
                          {TAG_TYPES.map((tt) => (
                            <option key={tt} value={tt}>
                              {tt.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <Input
                          value={newTag.tag_value}
                          onChange={(e) => setNewTag({ ...newTag, tag_value: e.target.value })}
                          className="text-sm flex-1"
                          placeholder="Tag value..."
                          autoFocus
                        />
                        <Input
                          value={newTag.color}
                          onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                          className="text-sm w-20"
                          placeholder="#hex"
                        />
                        <Button
                          size="sm"
                          onClick={addTag}
                          disabled={tagsSaving}
                          className="cursor-pointer"
                        >
                          {tagsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        </Button>
                      </div>
                    )}

                    <div className="space-y-3">
                      {Object.keys(tagsByType).length === 0 && !newTag && (
                        <p className="text-xs text-zinc-600 text-center py-4">No tags yet</p>
                      )}
                      {Object.entries(tagsByType).map(([groupType, groupTags]) => (
                        <div key={groupType}>
                          <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
                            {groupType.replace(/_/g, " ")}
                          </span>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {groupTags.map((tag) => (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className="text-xs bg-zinc-800"
                                style={tag.color ? { borderLeft: `3px solid ${tag.color}` } : undefined}
                              >
                                {tag.tag_value}
                                <button
                                  type="button"
                                  className="ml-1 hover:text-red-400 cursor-pointer"
                                  onClick={() => deleteTag(tag.id)}
                                  disabled={tagsSaving}
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
