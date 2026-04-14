"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Sliders, Save, Plus, Trash2, Loader2, Check, AlertCircle, X,
  ChevronDown, ChevronRight, Edit2, ClipboardList, DollarSign,
  Wrench, Tag, MessageSquare, RefreshCw,
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

interface AutoCleaningPlan {
  id: string
  label: string
  enabled: boolean
}

type ToastType = "success" | "error"

interface Toast {
  id: number
  type: ToastType
  message: string
}

const API = "/api/actions/control-center"

const DEFAULT_SERVICES = [
  "Window Cleaning",
  "Pressure Washing",
  "Gutter Cleaning",
  "Screen Cleaning",
  "Track Cleaning",
  "Skylight Cleaning",
]

const TAG_TYPES = [
  "salesman",
  "technician",
  "team_lead",
  "service_plan",
  "service_months",
  "custom",
] as const

const MESSAGE_FIELDS = [
  { trigger: "receipt", label: "Receipt Text", placeholder: "Text sent after payment is processed..." },
  { trigger: "review_request", label: "Review Request Text", placeholder: "Text asking the customer to leave a review..." },
  { trigger: "thank_you_tip", label: "Thank You / Tip Message", placeholder: "Text thanking the customer and requesting a tip..." },
] as const

// ── Component ────────────────────────────────────────────────────────────────

export default function ControlCenterPage() {
  useAuth() // ensures auth context is active for API calls

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

  // ── Messages state ──
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [messagesSaving, setMessagesSaving] = useState(false)
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({})

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

  // ── Expanded sections (inline editors) ──
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  // ── Auto Cleanings state (local for now) ──
  const [autoPlans, setAutoPlans] = useState<AutoCleaningPlan[]>([
    { id: "quarterly", label: "Quarterlys", enabled: false },
    { id: "triannual", label: "Triannuals", enabled: false },
    { id: "monthly", label: "Monthly", enabled: false },
    { id: "cut_only", label: "Cut Only", enabled: false },
  ])
  const [newPlanName, setNewPlanName] = useState("")
  const [showAddPlan, setShowAddPlan] = useState(false)

  // ── Fetch helpers ──
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

  useEffect(() => {
    fetchMessages()
    fetchPricebook()
    fetchTags()
    fetchChecklists()
  }, [fetchMessages, fetchPricebook, fetchTags, fetchChecklists])

  // ── Messages handlers ──
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

      showToast("success", "Message saved")
      await fetchMessages()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save message")
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

  // ── Auto Cleanings handlers ──
  function toggleAutoPlan(planId: string) {
    setAutoPlans((prev) =>
      prev.map((p) => (p.id === planId ? { ...p, enabled: !p.enabled } : p))
    )
    showToast("success", "Plan updated")
  }

  function addAutoPlan() {
    const label = newPlanName.trim()
    if (!label) {
      showToast("error", "Plan name is required")
      return
    }
    const id = label.toLowerCase().replace(/\s+/g, "_")
    if (autoPlans.some((p) => p.id === id)) {
      showToast("error", "Plan already exists")
      return
    }
    setAutoPlans((prev) => [...prev, { id, label, enabled: false }])
    setNewPlanName("")
    setShowAddPlan(false)
    showToast("success", "Plan type added")
  }

  // ── Derived data ──
  const tagsByType = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
    if (!acc[tag.tag_type]) acc[tag.tag_type] = []
    acc[tag.tag_type].push(tag)
    return acc
  }, {})

  function toggleSection(section: string) {
    setExpandedSection((prev) => (prev === section ? null : section))
  }

  // ── Loading spinner ──
  function LoadingBlock() {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs">Loading...</span>
      </div>
    )
  }

  // ── Settings row component ──
  function SettingsRow({
    icon,
    label,
    badge,
    sectionKey,
    children,
  }: {
    icon: React.ReactNode
    label: string
    badge?: string
    sectionKey: string
    children: React.ReactNode
  }) {
    const isOpen = expandedSection === sectionKey
    return (
      <div className="border-b border-zinc-800/50 last:border-b-0">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">{icon}</span>
            <span className="text-sm font-medium text-zinc-200">{label}</span>
            {badge && (
              <Badge variant="secondary" className="text-[10px] bg-zinc-800 text-zinc-400">
                {badge}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleSection(sectionKey)}
            className="cursor-pointer text-xs text-zinc-400 hover:text-white gap-1.5"
          >
            {isOpen ? (
              <>
                Close
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Edit
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
        {isOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-zinc-800/30">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-[900px] mx-auto space-y-6">
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

      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Sliders className="w-5 h-5" />
          Control Center
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Settings and configuration for your operations
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: Jobs Configuration                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">
            Jobs Configuration
          </h2>
        </div>

        {/* ── Checklists ── */}
        <SettingsRow
          icon={<ClipboardList className="w-4 h-4" />}
          label="Checklists"
          badge={`${checklists.length} template${checklists.length !== 1 ? "s" : ""}`}
          sectionKey="checklists"
        >
          {checklistsLoading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
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
                <div className="p-3 bg-zinc-800 rounded-lg border border-dashed border-zinc-600 space-y-2">
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
                      {checklistsSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Plus className="w-3 h-3 mr-1" />}
                      Create
                    </Button>
                  </div>
                </div>
              )}

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
          )}
        </SettingsRow>

        {/* ── Price Book ── */}
        <SettingsRow
          icon={<DollarSign className="w-4 h-4" />}
          label="Price Book"
          badge={`${pricebook.length} service${pricebook.length !== 1 ? "s" : ""}`}
          sectionKey="pricebook"
        >
          {pricebookLoading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
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
                <div className="flex items-center gap-2 p-2 bg-zinc-800 rounded-lg border border-dashed border-zinc-600">
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
                  <Button size="sm" onClick={addPricebookItem} disabled={pricebookSaving} className="cursor-pointer">
                    {pricebookSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
              )}

              {pricebook.length === 0 && !newService ? (
                <p className="text-xs text-zinc-600 text-center py-4">No services in price book yet</p>
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
                <div className="flex justify-end">
                  <Button size="sm" onClick={savePricebook} disabled={pricebookSaving} className="cursor-pointer text-xs">
                    {pricebookSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                    Save Pricing
                  </Button>
                </div>
              )}
            </div>
          )}
        </SettingsRow>

        {/* ── Services ── */}
        <SettingsRow
          icon={<Wrench className="w-4 h-4" />}
          label="Services"
          badge={`${DEFAULT_SERVICES.length} offered`}
          sectionKey="services"
        >
          <div className="space-y-1.5">
            {DEFAULT_SERVICES.map((service) => (
              <div
                key={service}
                className="flex items-center gap-2 px-3 py-2 bg-zinc-900 rounded-lg"
              >
                <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                <span className="text-sm text-zinc-200">{service}</span>
              </div>
            ))}
          </div>
        </SettingsRow>

        {/* ── Tag Bank ── */}
        <SettingsRow
          icon={<Tag className="w-4 h-4" />}
          label="Tag Bank"
          badge={`${tags.length} tag${tags.length !== 1 ? "s" : ""}`}
          sectionKey="tags"
        >
          {tagsLoading ? (
            <LoadingBlock />
          ) : (
            <div className="space-y-3">
              <div className="flex justify-end">
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
                <div className="flex items-center gap-2 p-3 bg-zinc-800 rounded-lg border border-dashed border-zinc-600">
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
                  <Button size="sm" onClick={addTag} disabled={tagsSaving} className="cursor-pointer">
                    {tagsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  </Button>
                </div>
              )}

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
          )}
        </SettingsRow>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: Auto Cleanings Configuration                               */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">
            Auto Cleanings Configuration
          </h2>
        </div>

        <div className="divide-y divide-zinc-800/50">
          {autoPlans.map((plan) => (
            <div key={plan.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-200">{plan.label}</span>
              </div>
              <Switch
                checked={plan.enabled}
                onCheckedChange={() => toggleAutoPlan(plan.id)}
              />
            </div>
          ))}
        </div>

        {/* Add new plan type */}
        <div className="px-4 py-3 border-t border-zinc-800/50">
          {showAddPlan ? (
            <div className="flex items-center gap-2">
              <Input
                value={newPlanName}
                onChange={(e) => setNewPlanName(e.target.value)}
                className="text-sm flex-1"
                placeholder="Plan name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") addAutoPlan()
                  if (e.key === "Escape") {
                    setShowAddPlan(false)
                    setNewPlanName("")
                  }
                }}
              />
              <Button size="sm" onClick={addAutoPlan} className="cursor-pointer text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowAddPlan(false); setNewPlanName("") }}
                className="cursor-pointer text-xs text-zinc-500"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddPlan(true)}
              className="cursor-pointer text-xs w-full"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Plan Type
            </Button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3: Automated Messages                                         */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider">
            Automated Messages
          </h2>
        </div>

        {messagesLoading ? (
          <div className="p-4">
            <LoadingBlock />
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {MESSAGE_FIELDS.map((field) => {
              const msg = messages.find((m) => m.trigger_type === field.trigger)
              const draft = messageDrafts[field.trigger] ?? ""
              const hasChanges = msg ? draft !== msg.message_template : draft.trim().length > 0

              return (
                <div key={field.trigger} className="px-4 py-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-zinc-400" />
                      <label className="text-sm font-medium text-zinc-200">{field.label}</label>
                    </div>
                    {hasChanges && (
                      <Button
                        size="sm"
                        onClick={() => saveMessageTemplate(field.trigger)}
                        disabled={messagesSaving}
                        className="cursor-pointer text-xs"
                      >
                        {messagesSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                        Save
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={draft}
                    onChange={(e) =>
                      setMessageDrafts((prev) => ({ ...prev, [field.trigger]: e.target.value }))
                    }
                    className="min-h-[80px] text-sm bg-zinc-900"
                    placeholder={field.placeholder}
                  />
                  <p className="text-[10px] text-zinc-600">
                    Variables: {"{{customer_name}}"} {"{{services}}"} {"{{total}}"} {"{{payment_method}}"} {"{{review_link}}"}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
