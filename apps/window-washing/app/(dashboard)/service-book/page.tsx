"use client"

/**
 * Price Book — admin/salesman view of the master service catalog.
 *
 * The Quote Builder's "Service Book" picker reads from the same table.
 * Per PRD #8: the Service Plan Hub's Price Book tile must route here.
 */

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Trash2, Save } from "lucide-react"

interface CatalogItem {
  id: number
  name: string
  description: string | null
  default_price: number | null
  is_active: boolean
  sort_order: number
}

export default function ServiceBookPage() {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [newItem, setNewItem] = useState({ name: "", description: "", price: "" })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/actions/service-book?includeInactive=true", {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to load")
      setItems(json.items ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addItem() {
    const name = newItem.name.trim()
    if (!name) return
    const priceNum = newItem.price ? Number(newItem.price) : null
    const res = await fetch("/api/actions/service-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: newItem.description.trim() || null,
        default_price: priceNum,
        is_active: true,
        sort_order: items.length,
      }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error || `Add failed (${res.status})`)
      return
    }
    setNewItem({ name: "", description: "", price: "" })
    load()
  }

  async function patchItem(id: number, patch: Partial<CatalogItem>) {
    setSaving(id)
    try {
      const res = await fetch(`/api/actions/service-book?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || `Update failed (${res.status})`)
        return
      }
      // Optimistic local update
      setItems((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    } finally {
      setSaving(null)
    }
  }

  async function removeItem(id: number) {
    if (!confirm("Soft-delete this catalog item? (Sets is_active=false.)")) return
    const res = await fetch(`/api/actions/service-book?id=${id}`, { method: "DELETE" })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error || `Delete failed (${res.status})`)
      return
    }
    load()
  }

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white tracking-tight">Price Book</h1>
        <p className="text-sm text-zinc-400">
          Master service catalog. Quote Builder pulls from this list, and tech upsells reference it for default pricing.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-rose-700 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-semibold text-zinc-100 uppercase tracking-wider mb-3">
          Add New Service
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_140px_auto] gap-2">
          <input
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            placeholder="Service name"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          />
          <input
            value={newItem.description}
            onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
            placeholder="Description (optional)"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          />
          <input
            type="number"
            value={newItem.price}
            onChange={(e) => setNewItem({ ...newItem, price: e.target.value })}
            placeholder="Default price"
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          />
          <button
            onClick={addItem}
            disabled={!newItem.name.trim()}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Add
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <h2 className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 text-sm font-semibold text-zinc-100 uppercase tracking-wider">
          Catalog ({items.length})
        </h2>
        {loading ? (
          <div className="p-8 flex items-center justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            No catalog items yet. Add the first one above.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/50">
            {items.map((item) => (
              <li
                key={item.id}
                className={`px-4 py-3 flex items-center gap-3 ${
                  !item.is_active ? "opacity-50" : ""
                }`}
              >
                <input
                  defaultValue={item.name}
                  onBlur={(e) =>
                    e.target.value.trim() &&
                    e.target.value !== item.name &&
                    patchItem(item.id, { name: e.target.value.trim() })
                  }
                  className="flex-1 rounded border border-transparent hover:border-zinc-700 bg-transparent px-2 py-1 text-sm font-medium text-zinc-100 focus:border-zinc-600 focus:outline-none"
                />
                <input
                  defaultValue={item.description ?? ""}
                  placeholder="—"
                  onBlur={(e) =>
                    e.target.value !== (item.description ?? "") &&
                    patchItem(item.id, {
                      description: e.target.value || null,
                    })
                  }
                  className="flex-1 rounded border border-transparent hover:border-zinc-700 bg-transparent px-2 py-1 text-sm text-zinc-300 focus:border-zinc-600 focus:outline-none"
                />
                <div className="flex items-center gap-1">
                  <span className="text-zinc-500 text-sm">$</span>
                  <input
                    type="number"
                    defaultValue={item.default_price ?? ""}
                    onBlur={(e) => {
                      const n = e.target.value === "" ? null : Number(e.target.value)
                      if (n !== item.default_price) {
                        patchItem(item.id, { default_price: n })
                      }
                    }}
                    className="w-24 rounded border border-transparent hover:border-zinc-700 bg-transparent px-2 py-1 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none text-right"
                  />
                </div>
                <button
                  onClick={() =>
                    patchItem(item.id, { is_active: !item.is_active })
                  }
                  title={item.is_active ? "Deactivate" : "Activate"}
                  className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  {item.is_active ? "Active" : "Inactive"}
                </button>
                <button
                  onClick={() => removeItem(item.id)}
                  className="text-zinc-500 hover:text-rose-400 p-1"
                >
                  {saving === item.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
