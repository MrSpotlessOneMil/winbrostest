"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Sliders, MessageSquare, DollarSign, Tag, ClipboardList,
  Save, Plus, Trash2, Loader2, Check, AlertCircle, X
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

type ToastType = "success" | "error"

interface Toast {
  id: number
  type: ToastType
  message: string
}

const API = "/api/actions/control-center"

const MESSAGE_TRIGGERS = [
  { trigger: "on_my_way", label: "On My Way" },
  { trigger: "visit_started", label: "Visit Started" },
  { trigger: "receipt", label: "Receipt" },
  { trigger: "review_request", label: "Review Request" },
  { trigger: "thank_you_tip", label: "Thank You + Tip" },
  { trigger: "quote_sent", label: "Quote Sent" },
  { trigger: "quote_approved", label: "Quote Approved" },
  { trigger: "service_plan_sent", label: "Service Plan Sent" },
  { trigger: "appointment_reminder", label: "Appointment Reminder" },
  { trigger: "reschedule_notice", label: "Reschedule Notice" },
] as const

const TAG_TYPES = [
  "salesman",
  "technician",
  "team_lead",
  "service_plan",
  "service_months",
  "custom",
] as const

// ── Component ────────────────────────────────────────────────────────────────

export default function ControlCenterPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState("messages")

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
  // Local edits keyed by trigger_type → template text
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

  // ── Fetch helpers ──
  const fetchMessages = useCallback(async () => {
    setMessagesLoading(true)
    try {
      const res = await fetch(`${API}?type=messages`)
      const json = await res.json()
      if (json.success) {
        setMessages(json.data)
        // Init drafts from fetched data
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
    fetchMessages()
    fetchPricebook()
    fetchTags()
    fetchChecklists()
  }, [fetchMessages, fetchPricebook, fetchTags, fetchChecklists])

  // ── Messages handlers ──
  async function saveMessages() {
    setMessagesSaving(true)
    try {
      const existingByTrigger = new Map(messages.map((m) => [m.trigger_type, m]))

      for (const t of MESSAGE_TRIGGERS) {
        const draft = messageDrafts[t.trigger] ?? ""
        const existing = existingByTrigger.get(t.trigger)

        if (existing) {
          // PATCH if template changed
          if (draft !== existing.message_template) {
            const res = await fetch(API, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "messages", id: existing.id, data: { message_template: draft } }),
            })
            const json = await res.json()
            if (!json.success) throw new Error(json.error)
          }
        } else if (draft.trim()) {
          // POST new message
          const res = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "messages", data: { trigger_type: t.trigger, message_template: draft } }),
          })
          const json = await res.json()
          if (!json.success) throw new Error(json.error)
        }
      }

      showToast("success", "Messages saved")
      await fetchMessages()
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Failed to save messages")
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

  // ── Loading spinner ──
  function LoadingBlock() {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading...
      </div>
    )
  }

  // ── Group tags by type ──
  const tagsByType = tags.reduce<Record<string, TagItem[]>>((acc, tag) => {
    if (!acc[tag.tag_type]) acc[tag.tag_type] = []
    acc[tag.tag_type].push(tag)
    return acc
  }, {})

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
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

      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Sliders className="w-5 h-5" />
          Control Center
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          Manage automated messages, price book, tags, and checklists
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="messages" className="cursor-pointer">
            <MessageSquare className="w-3 h-3 mr-1.5" />
            Messages
          </TabsTrigger>
          <TabsTrigger value="pricebook" className="cursor-pointer">
            <DollarSign className="w-3 h-3 mr-1.5" />
            Price Book
          </TabsTrigger>
          <TabsTrigger value="tags" className="cursor-pointer">
            <Tag className="w-3 h-3 mr-1.5" />
            Tag Bank
          </TabsTrigger>
          <TabsTrigger value="checklists" className="cursor-pointer">
            <ClipboardList className="w-3 h-3 mr-1.5" />
            Checklists
          </TabsTrigger>
        </TabsList>

        {/* ── Automated Messages ── */}
        <TabsContent value="messages" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-4">Automated Message Templates</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Use {"{{customer_name}}"}, {"{{services}}"}, {"{{total}}"}, {"{{payment_method}}"}, {"{{review_link}}"} as variables.
            </p>
            {messagesLoading ? (
              <LoadingBlock />
            ) : (
              <div className="space-y-4">
                {MESSAGE_TRIGGERS.map((t) => (
                  <div key={t.trigger} className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-400">{t.label}</label>
                    <Textarea
                      value={messageDrafts[t.trigger] ?? ""}
                      onChange={(e) =>
                        setMessageDrafts((prev) => ({ ...prev, [t.trigger]: e.target.value }))
                      }
                      className="min-h-[80px] text-sm"
                      placeholder={`Template for ${t.label.toLowerCase()}...`}
                    />
                  </div>
                ))}
                <Button onClick={saveMessages} disabled={messagesSaving} className="cursor-pointer">
                  {messagesSaving ? (
                    <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3 mr-1.5" />
                  )}
                  {messagesSaving ? "Saving..." : "Save Messages"}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Price Book ── */}
        <TabsContent value="pricebook" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Services & Pricing</h3>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setNewService(newService ? null : { name: "", price: "" })}
              >
                {newService ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                {newService ? "Cancel" : "Add Service"}
              </Button>
            </div>

            {pricebookLoading ? (
              <LoadingBlock />
            ) : (
              <>
                {/* New service inline form */}
                {newService && (
                  <div className="flex items-center gap-3 p-2 bg-zinc-800 rounded mb-2 border border-dashed border-zinc-600">
                    <Input
                      value={newService.name}
                      onChange={(e) => setNewService({ ...newService, name: e.target.value })}
                      className="text-sm flex-1"
                      placeholder="Service name..."
                      autoFocus
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500">$</span>
                      <Input
                        value={newService.price}
                        onChange={(e) => setNewService({ ...newService, price: e.target.value })}
                        className="text-sm w-24"
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

                <div className="space-y-2">
                  {pricebook.length === 0 && !newService && (
                    <p className="text-xs text-zinc-500 text-center py-4">No services yet. Click "Add Service" to get started.</p>
                  )}
                  {pricebook.map((svc) => (
                    <div key={svc.id} className="flex items-center gap-3 p-2 bg-zinc-900 rounded">
                      <Input
                        value={pricebookDrafts[svc.id]?.name ?? svc.name}
                        onChange={(e) =>
                          setPricebookDrafts((prev) => ({
                            ...prev,
                            [svc.id]: { ...prev[svc.id], name: e.target.value },
                          }))
                        }
                        className="text-sm flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-zinc-500">$</span>
                        <Input
                          value={pricebookDrafts[svc.id]?.price ?? String(svc.price)}
                          onChange={(e) =>
                            setPricebookDrafts((prev) => ({
                              ...prev,
                              [svc.id]: { ...prev[svc.id], price: e.target.value },
                            }))
                          }
                          className="text-sm w-24"
                          type="number"
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-zinc-500 hover:text-red-400 cursor-pointer"
                        onClick={() => deletePricebookItem(svc.id)}
                        disabled={pricebookSaving}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>

                {pricebook.length > 0 && (
                  <Button onClick={savePricebook} disabled={pricebookSaving} className="mt-4 cursor-pointer">
                    {pricebookSaving ? (
                      <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3 mr-1.5" />
                    )}
                    {pricebookSaving ? "Saving..." : "Save Price Book"}
                  </Button>
                )}
              </>
            )}
          </div>
        </TabsContent>

        {/* ── Tag Bank ── */}
        <TabsContent value="tags" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Tag Definitions</h3>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setNewTag(newTag ? null : { tag_type: TAG_TYPES[0], tag_value: "", color: "" })}
              >
                {newTag ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                {newTag ? "Cancel" : "Add Tag"}
              </Button>
            </div>

            {tagsLoading ? (
              <LoadingBlock />
            ) : (
              <>
                {/* New tag form */}
                {newTag && (
                  <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded mb-4 border border-dashed border-zinc-600">
                    <select
                      value={newTag.tag_type}
                      onChange={(e) => setNewTag({ ...newTag, tag_type: e.target.value })}
                      className="text-sm bg-zinc-900 text-zinc-300 border border-zinc-700 rounded px-2 py-1.5"
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
                      className="text-sm w-24"
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
                    <p className="text-xs text-zinc-500 text-center py-4">No tags yet. Click "Add Tag" to get started.</p>
                  )}
                  {Object.entries(tagsByType).map(([groupType, groupTags]) => (
                    <div key={groupType}>
                      <span className="text-xs font-medium text-zinc-400 uppercase">
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
        </TabsContent>

        {/* ── Checklists ── */}
        <TabsContent value="checklists" className="space-y-4">
          <div className="border border-zinc-800 rounded-lg bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-zinc-300">Checklist Templates</h3>
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setNewChecklist(newChecklist ? null : { name: "", items: "", is_default: false })}
              >
                {newChecklist ? <X className="w-3 h-3 mr-1" /> : <Plus className="w-3 h-3 mr-1" />}
                {newChecklist ? "Cancel" : "New Template"}
              </Button>
            </div>

            {checklistsLoading ? (
              <LoadingBlock />
            ) : (
              <>
                {/* New checklist form */}
                {newChecklist && (
                  <div className="p-3 bg-zinc-800 rounded-lg mb-4 border border-dashed border-zinc-600 space-y-3">
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
                      className="min-h-[100px] text-sm"
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
                        Set as default
                      </label>
                      <Button size="sm" onClick={addChecklist} disabled={checklistsSaving} className="cursor-pointer">
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

                <div className="space-y-3">
                  {checklists.length === 0 && !newChecklist && (
                    <p className="text-xs text-zinc-500 text-center py-4">No checklists yet. Click "New Template" to get started.</p>
                  )}
                  {checklists.map((cl) => (
                    <div key={cl.id} className="p-3 bg-zinc-900 rounded-lg">
                      {editingChecklist === cl.id ? (
                        /* Edit mode */
                        <div className="space-y-3">
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
                            className="min-h-[100px] text-sm"
                            placeholder="One item per line..."
                          />
                          <div className="flex items-center gap-3">
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
                            <Button size="sm" onClick={() => saveChecklist(cl.id)} disabled={checklistsSaving} className="cursor-pointer">
                              {checklistsSaving ? (
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              ) : (
                                <Save className="w-3 h-3 mr-1" />
                              )}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingChecklist(null)}
                              className="cursor-pointer text-zinc-500"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* View mode */
                        <>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">{cl.name}</span>
                            <div className="flex items-center gap-2">
                              {cl.is_default && (
                                <Badge variant="secondary" className="text-[10px] bg-green-900/30 text-green-400">
                                  Default
                                </Badge>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-zinc-500 hover:text-white cursor-pointer text-xs"
                                onClick={() => setEditingChecklist(cl.id)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-zinc-500 hover:text-red-400 cursor-pointer"
                                onClick={() => deleteChecklist(cl.id)}
                                disabled={checklistsSaving}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {cl.items.map((item, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                                <span className="text-zinc-600">{i + 1}.</span>
                                {item}
                              </div>
                            ))}
                            {cl.items.length === 0 && (
                              <p className="text-xs text-zinc-600 italic">No items</p>
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
