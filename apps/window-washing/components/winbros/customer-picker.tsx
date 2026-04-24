"use client"

/**
 * Shared customer picker modal — Round 2 Wave 3d.
 *
 * Used by the quote builder (`/quotes/[id]`) and the New Appointment modal
 * (`/appointments`). Matches Max's sketch pattern:
 *   [Select Client] [Create Client]  → picker modal opens
 *   On select: caller shows a card with name/phone/address.
 *
 * Search queries hit the existing /api/customers endpoint. Creating a new
 * customer happens inline in the picker — only phone is required by the
 * API; name/email/address are all optional.
 */

import { useCallback, useEffect, useState } from "react"
import { Loader2, Search, UserPlus, X } from "lucide-react"

export interface PickerCustomer {
  id: number
  first_name: string | null
  last_name: string | null
  phone_number: string | null
  email: string | null
  address: string | null
}

export function customerDisplayName(c: PickerCustomer | null | undefined): string {
  if (!c) return ""
  const first = (c.first_name || "").trim()
  const last = (c.last_name || "").trim()
  const full = `${first} ${last}`.trim()
  return full || c.phone_number || `Customer #${c.id}`
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (customer: PickerCustomer) => void
  initialQuery?: string
}

export function CustomerPickerModal({ open, onClose, onSelect, initialQuery = "" }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<PickerCustomer[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createMode, setCreateMode] = useState(false)
  const [createForm, setCreateForm] = useState({
    first_name: "",
    last_name: "",
    phone_number: "",
    email: "",
    address: "",
  })
  const [error, setError] = useState<string | null>(null)

  const runSearch = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = q.trim()
        ? `/api/actions/customer-search?search=${encodeURIComponent(q.trim())}`
        : `/api/actions/customer-search`
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const body = await res.json()
      const list: PickerCustomer[] = (body.data || []).map(
        (c: Record<string, unknown>) => ({
          id: Number(c.id),
          first_name: (c.first_name as string) ?? null,
          last_name: (c.last_name as string) ?? null,
          phone_number: (c.phone_number as string) ?? null,
          email: (c.email as string) ?? null,
          address: (c.address as string) ?? null,
        })
      )
      // Limit to first 25 so the list stays scannable.
      setResults(list.slice(0, 25))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to search customers")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setCreateMode(false)
    runSearch(initialQuery)
  }, [open, initialQuery, runSearch])

  useEffect(() => {
    if (!open) return
    const handle = setTimeout(() => runSearch(query), 300)
    return () => clearTimeout(handle)
  }, [query, open, runSearch])

  async function handleCreate() {
    const phone = createForm.phone_number.trim()
    if (!phone) {
      setError("Phone number is required to create a customer")
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: createForm.first_name.trim() || undefined,
          last_name: createForm.last_name.trim() || undefined,
          phone_number: phone,
          email: createForm.email.trim() || undefined,
          address: createForm.address.trim() || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      onSelect(body.data as PickerCustomer)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create customer")
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">
            {createMode ? "Create Client" : "Select Client"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {!createMode && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by name or phone"
                  className="w-full rounded border pl-8 pr-2 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => setCreateMode(true)}
                className="flex items-center gap-1 rounded border bg-blue-50 px-2 py-2 text-xs text-blue-700 hover:bg-blue-100"
              >
                <UserPlus className="h-3.5 w-3.5" /> Create
              </button>
            </div>

            <div className="max-h-80 overflow-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-sm text-gray-600">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="p-3 text-center text-sm text-gray-500">
                  No customers found.
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(c)
                          onClose()
                        }}
                        className="w-full px-2 py-2 text-left hover:bg-gray-50"
                      >
                        <div className="font-medium">{customerDisplayName(c)}</div>
                        <div className="text-xs text-gray-600">
                          {c.phone_number || "no phone"}
                          {c.address ? ` · ${c.address}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {createMode && (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="block text-xs text-gray-600">First name</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={createForm.first_name}
                  onChange={e =>
                    setCreateForm(f => ({ ...f, first_name: e.target.value }))
                  }
                />
              </label>
              <label>
                <span className="block text-xs text-gray-600">Last name</span>
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={createForm.last_name}
                  onChange={e =>
                    setCreateForm(f => ({ ...f, last_name: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="block">
              <span className="block text-xs text-gray-600">Phone *</span>
              <input
                required
                className="mt-1 w-full rounded border px-2 py-1"
                value={createForm.phone_number}
                onChange={e =>
                  setCreateForm(f => ({ ...f, phone_number: e.target.value }))
                }
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Email</span>
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={createForm.email}
                onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="block">
              <span className="block text-xs text-gray-600">Address</span>
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={createForm.address}
                onChange={e =>
                  setCreateForm(f => ({ ...f, address: e.target.value }))
                }
              />
            </label>
            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setCreateMode(false)}
                className="rounded border px-3 py-1 text-sm"
              >
                Back to search
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !createForm.phone_number.trim()}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Helper to open a Google Maps directions link for a given address. */
export function mapsDirectionsUrl(address: string | null | undefined): string | null {
  if (!address || !address.trim()) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    address.trim()
  )}`
}
