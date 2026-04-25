"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Plus, Loader2, Save, X, Trash2 } from "lucide-react"

interface Cleaner {
  id: number
  tenant_id: string
  name: string
  phone: string | null
  email: string | null
  telegram_id: string | null  // deprecated
  telegram_username: string | null  // deprecated
  portal_token: string | null
  is_team_lead: boolean
  home_address: string | null
  max_jobs_per_day: number
  active: boolean
  created_at: string
  updated_at: string
}

interface Props {
  tenantId: string
  tenantName: string
}

const DEFAULT_MAX_JOBS = "3"

export function CleanersManager({ tenantId }: Props) {
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [pending, setPending] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const mountedRef = useRef(true)

  // New cleaner form
  const [form, setForm] = useState({
    name: "", phone: "", email: "",
    home_address: "", max_jobs_per_day: DEFAULT_MAX_JOBS, is_team_lead: false,
  })

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchCleaners = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cleaners?tenant_id=${tenantId}`, { signal })
      if (!res.ok) throw new Error(`Failed to load cleaners (${res.status})`)
      const json = await res.json()
      if (json.error) throw new Error(json.error)
      if (mountedRef.current) setCleaners(json.cleaners || [])
    } catch (e: any) {
      if (e.name === "AbortError") return
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    resetForm()
    const controller = new AbortController()
    fetchCleaners(controller.signal)
    return () => controller.abort()
  }, [fetchCleaners])

  function resetForm() {
    setForm({ name: "", phone: "", email: "", home_address: "", max_jobs_per_day: DEFAULT_MAX_JOBS, is_team_lead: false })
    setEditingId(null)
    setShowAdd(false)
  }

  async function handleSave() {
    if (!form.name.trim() || pending) return
    const parsedMax = parseInt(form.max_jobs_per_day)
    if (isNaN(parsedMax) || parsedMax < 1) {
      setError("Max jobs/day must be at least 1")
      return
    }
    setPending(true)
    setError(null)
    try {
      const payload: Record<string, any> = {
        tenant_id: tenantId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        home_address: form.home_address.trim() || null,
        max_jobs_per_day: parsedMax,
        is_team_lead: form.is_team_lead,
      }

      if (editingId !== null) {
        payload.id = editingId
        const res = await fetch("/api/admin/cleaners", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        if (!res.ok) { const json = await res.json().catch(() => ({})); throw new Error(json.error || `Update failed (${res.status})`) }
      } else {
        const res = await fetch("/api/admin/cleaners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        if (!res.ok) { const json = await res.json().catch(() => ({})); throw new Error(json.error || `Create failed (${res.status})`) }
      }

      resetForm()
      if (mountedRef.current) await fetchCleaners()
    } catch (e: any) {
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setPending(false)
    }
  }

  function startEdit(c: Cleaner) {
    setForm({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      home_address: c.home_address || "",
      max_jobs_per_day: String(c.max_jobs_per_day),
      is_team_lead: c.is_team_lead,
    })
    setEditingId(c.id)
    setShowAdd(true)
  }

  async function toggleActive(c: Cleaner) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/cleaners", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, tenant_id: tenantId, active: !c.active }),
      })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw new Error(json.error || `Toggle failed (${res.status})`) }
      if (mountedRef.current) await fetchCleaners()
    } catch (e: any) {
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setPending(false)
    }
  }

  async function deleteCleaner(c: Cleaner) {
    if (pending) return
    if (!confirm(`Remove ${c.name}? This will soft-delete the cleaner.`)) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/cleaners?id=${c.id}&tenant_id=${tenantId}`, { method: "DELETE" })
      if (!res.ok) { const json = await res.json().catch(() => ({})); throw new Error(json.error || `Delete failed (${res.status})`) }
      if (mountedRef.current) await fetchCleaners()
    } catch (e: any) {
      if (mountedRef.current) setError(e.message)
    } finally {
      if (mountedRef.current) setPending(false)
    }
  }

  const activeCount = cleaners.filter(c => c.active).length

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Cleaners</h3>
          <Badge variant="secondary" className="text-xs">{activeCount} active</Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { resetForm(); setShowAdd(true) }} disabled={pending}>
          <Plus className="h-3 w-3 mr-1" /> Add Cleaner
        </Button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Add/Edit form */}
      {showAdd && (
        <div className="border border-zinc-600 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <Label className="text-sm font-medium">{editingId !== null ? "Edit Cleaner" : "New Cleaner"}</Label>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={resetForm}><X className="h-3 w-3" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input className="h-8 text-sm" placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input className="h-8 text-sm" placeholder="(555) 123-4567" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input className="h-8 text-sm" type="email" placeholder="cleaner@email.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Home Address</Label>
              <Input className="h-8 text-sm" placeholder="For route optimization" value={form.home_address} onChange={e => setForm({ ...form, home_address: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Max Jobs/Day</Label>
              <Input className="h-8 text-sm" type="number" min="1" max="10" value={form.max_jobs_per_day} onChange={e => setForm({ ...form, max_jobs_per_day: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 pt-4">
              <Switch checked={form.is_team_lead} onCheckedChange={v => setForm({ ...form, is_team_lead: v })} />
              <Label className="text-xs">Team Lead</Label>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={pending || !form.name.trim()}>
              {pending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              {editingId !== null ? "Update" : "Add"}
            </Button>
          </div>
        </div>
      )}

      {/* Cleaners list */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading cleaners...
        </div>
      ) : cleaners.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">No cleaners yet — add one to enable dispatch</p>
      ) : (
        <div className="space-y-1">
          {cleaners.map(c => (
            <div key={c.id} className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded border ${c.active ? "border-zinc-700" : "border-zinc-800 opacity-50"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium truncate">{c.name}</span>
                  {c.is_team_lead && <Badge variant="outline" className="text-[10px] px-1 py-0">Lead</Badge>}
                  {!c.active && <Badge variant="secondary" className="text-[10px] px-1 py-0">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {c.phone && <span>{c.phone}</span>}
                  {!c.phone && <span className="text-orange-500">No phone number</span>}
                  {(c as any).portal_token && <span className="text-blue-400 cursor-pointer" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/auth/portal-exchange?token=${encodeURIComponent((c as any).portal_token)}&next=${encodeURIComponent('/schedule')}`)} title="Click to copy dashboard auto-signin link">Portal link</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} disabled={pending} className="scale-75" />
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(c)} disabled={pending}>
                  <span className="text-xs">Edit</span>
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-500 hover:text-red-400" onClick={() => deleteCleaner(c)} disabled={pending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}