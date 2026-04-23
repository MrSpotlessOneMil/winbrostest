"use client"

/**
 * Tech Upsell Catalog — admin manages ring-fenced upsell items techs can add on-site.
 * WinBros Round 2 Q1=C. Replaces the old free-form in-visit upsell flow.
 */

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Trash2, Save } from "lucide-react"

interface CatalogItem {
  id: number
  name: string
  description: string | null
  price: number
  is_active: boolean
  sort_order: number
}

export default function TechUpsellCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [newItem, setNewItem] = useState<{ name: string; description: string; price: string }>({
    name: "",
    description: "",
    price: "",
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/actions/tech-upsell-catalog?includeInactive=true")
      const data = await res.json()
      setItems(data.items || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function patchItem(id: number, updates: Partial<CatalogItem>) {
    setSaving(id)
    await fetch(`/api/actions/tech-upsell-catalog?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    await load()
    setSaving(null)
  }

  async function createItem() {
    if (!newItem.name.trim() || !newItem.price) return
    await fetch("/api/actions/tech-upsell-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newItem.name.trim(),
        description: newItem.description.trim() || null,
        price: parseFloat(newItem.price),
        sort_order: (items[items.length - 1]?.sort_order || 0) + 10,
      }),
    })
    setNewItem({ name: "", description: "", price: "" })
    await load()
  }

  async function deleteItem(id: number) {
    if (!confirm("Deactivate this upsell item? (Existing visit line items keep their values.)")) return
    await fetch(`/api/actions/tech-upsell-catalog?id=${id}`, { method: "DELETE" })
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Tech Upsell Catalog</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Ring-fenced list techs can add on-site. Commission on these routes to the team lead on the job.
        </p>
      </div>

      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-950 border-b border-zinc-800">
              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wide">Description</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wide w-24">Price</th>
              <th className="text-center px-3 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wide w-20">Active</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-zinc-600 text-sm">
                  No catalog items yet — add one below.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className={item.is_active ? "" : "opacity-50"}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      defaultValue={item.name}
                      onBlur={(e) => {
                        if (e.target.value !== item.name) patchItem(item.id, { name: e.target.value })
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white focus:border-zinc-600 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      defaultValue={item.description || ""}
                      onBlur={(e) => {
                        const val = e.target.value || null
                        if (val !== item.description) patchItem(item.id, { description: val })
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 focus:border-zinc-600 focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-xs text-zinc-500">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={item.price}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val) && val !== item.price) patchItem(item.id, { price: val })
                        }}
                        className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-right text-white focus:border-zinc-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={item.is_active}
                      onChange={(e) => patchItem(item.id, { is_active: e.target.checked })}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {saving === item.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-500 inline" />
                    ) : (
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="text-zinc-500 hover:text-red-400 cursor-pointer"
                        title="Deactivate"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add-new row */}
      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950">
        <h2 className="text-sm font-semibold text-white mb-3">Add New</h2>
        <div className="grid grid-cols-12 gap-2">
          <input
            type="text"
            placeholder="Name"
            value={newItem.name}
            onChange={(e) => setNewItem((prev) => ({ ...prev, name: e.target.value }))}
            className="col-span-4 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newItem.description}
            onChange={(e) => setNewItem((prev) => ({ ...prev, description: e.target.value }))}
            className="col-span-5 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 focus:border-zinc-600 focus:outline-none"
          />
          <input
            type="number"
            placeholder="Price"
            min={0}
            step="0.01"
            value={newItem.price}
            onChange={(e) => setNewItem((prev) => ({ ...prev, price: e.target.value }))}
            className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-right text-white focus:border-zinc-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            onClick={createItem}
            disabled={!newItem.name.trim() || !newItem.price}
            className="col-span-1 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded px-2 py-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
