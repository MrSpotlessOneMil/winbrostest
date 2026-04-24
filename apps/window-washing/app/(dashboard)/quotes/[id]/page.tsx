"use client"

/**
 * Quote builder — WinBros Round 2 task 6.
 *
 * Per the hand-drawn PDF page 7:
 *  - Client header (name/phone/email)
 *  - Line items with three-state optionality toggle + description + price
 *    + is_upsell checkbox. Plus a ServiceBookPicker for canned rows.
 *  - Discount is just a negative-price line (no separate UI).
 *  - Live subtotal + editable original_price anchor.
 *  - Service plan boxes (min 3, add more). Each has recurring_price,
 *    discount_label, first_visit_keeps_original_price, offered_to_customer.
 *  - Approve / Send to Customer buttons (approve wired via existing route).
 *
 * All prices are always editable (pane-count pricing is elsewhere). The
 * only hard validation is "line needs a name" and "plan needs a name+price".
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Plus, Trash2, Save, Send, BookOpen, X, UserPlus, User } from "lucide-react"
import {
  computeQuoteTotals,
  type Optionality,
  type QuoteLineItemLike,
} from "@/lib/quote-totals"
import {
  CustomerPickerModal,
  customerDisplayName,
  type PickerCustomer,
} from "@/components/winbros/customer-picker"

interface LineItem {
  id?: number | string
  service_name: string
  description: string | null
  price: number
  quantity: number
  optionality: Optionality
  is_upsell: boolean
  sort_order: number
}

interface Plan {
  id?: number | string
  name: string
  discount_label: string | null
  recurring_price: number
  first_visit_keeps_original_price: boolean
  offered_to_customer: boolean
  sort_order: number
}

interface Quote {
  id: string
  token?: string | null
  customer_id: number | null
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  description: string | null
  notes: string | null
  total_price: number | null
  original_price: number | null
  status: string | null
}

interface ServiceBookItem {
  id: number
  name: string
  description: string | null
  default_price: number
}

const OPTION_CYCLE: Record<Optionality, Optionality> = {
  required: 'recommended',
  recommended: 'optional',
  optional: 'required',
}

const OPTION_LABELS: Record<Optionality, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
}

function OptionalityToggle({
  value,
  onChange,
}: {
  value: Optionality
  onChange: (next: Optionality) => void
}) {
  const color: Record<Optionality, string> = {
    required: 'bg-slate-700 text-white',
    recommended: 'bg-blue-600 text-white',
    optional: 'bg-gray-200 text-gray-700',
  }
  return (
    <button
      type="button"
      className={`rounded px-2 py-1 text-xs font-medium ${color[value]}`}
      onClick={() => onChange(OPTION_CYCLE[value])}
    >
      {OPTION_LABELS[value]}
    </button>
  )
}

export default function QuoteBuilderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const quoteId = params?.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [catalog, setCatalog] = useState<ServiceBookItem[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)

  const load = useCallback(async () => {
    if (!quoteId) return
    setLoading(true)
    setError(null)
    try {
      const [qRes, bookRes] = await Promise.all([
        fetch(`/api/actions/quotes/${quoteId}`),
        fetch(`/api/actions/service-book`),
      ])
      if (!qRes.ok) {
        const body = await qRes.json().catch(() => ({ error: qRes.statusText }))
        throw new Error(body.error || `HTTP ${qRes.status}`)
      }
      const qBody = await qRes.json()
      setQuote(qBody.quote as Quote)
      setLineItems(
        (qBody.line_items as LineItem[]).map((li, i) => ({
          ...li,
          description: li.description ?? null,
          quantity: li.quantity ?? 1,
          optionality: li.optionality ?? 'required',
          is_upsell: !!li.is_upsell,
          sort_order: li.sort_order ?? i,
        }))
      )
      setPlans(
        (qBody.plans as Plan[]).map((p, i) => ({
          ...p,
          discount_label: p.discount_label ?? null,
          first_visit_keeps_original_price: !!p.first_visit_keeps_original_price,
          offered_to_customer: !!p.offered_to_customer,
          sort_order: p.sort_order ?? i,
        }))
      )
      if (bookRes.ok) {
        const bookBody = await bookRes.json()
        setCatalog(
          (bookBody.items || []).map((it: ServiceBookItem) => ({
            ...it,
            default_price: Number(it.default_price ?? 0),
          }))
        )
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load quote')
    } finally {
      setLoading(false)
    }
  }, [quoteId])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(() => {
    const forTotals: QuoteLineItemLike[] = lineItems.map(li => ({
      id: li.id,
      price: li.price,
      quantity: li.quantity,
      optionality: li.optionality,
      is_upsell: li.is_upsell,
    }))
    return computeQuoteTotals({ lineItems: forTotals })
  }, [lineItems])

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLineItems(prev => prev.map((li, i) => (i === index ? { ...li, ...patch } : li)))
  }

  function removeLine(index: number) {
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  function addLine(partial?: Partial<LineItem>) {
    setLineItems(prev => [
      ...prev,
      {
        service_name: partial?.service_name ?? '',
        description: partial?.description ?? null,
        price: partial?.price ?? 0,
        quantity: partial?.quantity ?? 1,
        optionality: partial?.optionality ?? 'required',
        is_upsell: partial?.is_upsell ?? false,
        sort_order: prev.length,
      },
    ])
  }

  function addFromCatalog(item: ServiceBookItem) {
    addLine({
      service_name: item.name,
      description: item.description,
      price: Number(item.default_price),
      quantity: 1,
      optionality: 'required',
    })
    setShowPicker(false)
  }

  function updatePlan(index: number, patch: Partial<Plan>) {
    setPlans(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function removePlan(index: number) {
    setPlans(prev => prev.filter((_, i) => i !== index))
  }

  function addPlan() {
    setPlans(prev => [
      ...prev,
      {
        name: '',
        discount_label: null,
        recurring_price: 0,
        first_visit_keeps_original_price: false,
        offered_to_customer: false,
        sort_order: prev.length,
      },
    ])
  }

  function applyPickedCustomer(c: PickerCustomer) {
    if (!quote) return
    const displayName = customerDisplayName(c)
    setQuote({
      ...quote,
      customer_id: c.id,
      customer_name: displayName,
      customer_phone: c.phone_number ?? quote.customer_phone,
      customer_email: c.email ?? quote.customer_email,
      customer_address: c.address ?? quote.customer_address,
    })
  }

  async function save(): Promise<Quote | null> {
    if (!quoteId) return null
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/actions/quotes/${quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: quote?.customer_id,
          customer_name: quote?.customer_name,
          customer_phone: quote?.customer_phone,
          customer_email: quote?.customer_email,
          customer_address: quote?.customer_address,
          description: quote?.description,
          notes: quote?.notes,
          total_price: totals.total,
          original_price: quote?.original_price,
          line_items: lineItems,
          plans: plans.filter(p => p.name.trim()),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setQuote(body.quote)
      setLineItems(body.line_items || [])
      setPlans(body.plans || [])
      return body.quote as Quote
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function sendToCustomer() {
    const saved = await save()
    if (!saved) return
    setSending(true)
    try {
      const res = await fetch(`/api/actions/quotes/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send quote')
    } finally {
      setSending(false)
    }
  }

  async function approve() {
    const saved = await save()
    if (!saved) return
    setApproving(true)
    try {
      const res = await fetch(`/api/actions/quotes/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId, approved_by: 'admin' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to approve quote')
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-sm text-gray-600">Loading quote…</div>
    )
  }

  if (!quote) {
    return (
      <div className="p-6">
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error || 'Quote not found'}
        </div>
        <button
          className="mt-3 rounded border px-3 py-1 text-sm"
          onClick={() => router.push('/quotes')}
        >
          Back to quotes
        </button>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Quote Builder
            <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-sm font-normal text-gray-700">
              {quote.status || 'draft'}
            </span>
          </h1>
          {quote.token && (
            <a
              className="text-xs text-blue-600 hover:underline"
              href={`/quote/${quote.token}`}
              target="_blank"
              rel="noreferrer"
            >
              Customer URL → /quote/{quote.token}
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 rounded border px-3 py-1 text-sm disabled:opacity-60"
          >
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={sendToCustomer}
            disabled={saving || sending}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {sending ? 'Sending…' : 'Send to Customer'}
          </button>
          <button
            onClick={approve}
            disabled={saving || approving || quote.status === 'converted'}
            className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-60"
          >
            {approving ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mb-6 rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Client</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCustomerPicker(true)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"
            >
              <User className="h-3.5 w-3.5" /> Select Client
            </button>
            <button
              type="button"
              onClick={() => setShowCustomerPicker(true)}
              className="flex items-center gap-1 rounded border bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
            >
              <UserPlus className="h-3.5 w-3.5" /> Create Client
            </button>
          </div>
        </div>
        {quote.customer_id ? (
          <div className="rounded border bg-gray-50 p-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">
                  {quote.customer_name || `Customer #${quote.customer_id}`}
                </div>
                <div className="mt-0.5 text-sm text-gray-700">
                  {quote.customer_phone || "—"}
                </div>
                {quote.customer_address && (
                  <div className="text-sm text-gray-600">{quote.customer_address}</div>
                )}
                {quote.customer_email && (
                  <div className="text-sm text-gray-500">{quote.customer_email}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(true)}
                className="text-xs text-blue-600 hover:underline"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded border border-dashed p-3 text-center text-sm text-gray-500">
            No client selected. Pick one above to fill in name, phone, and address.
          </div>
        )}
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Line items</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
            >
              <BookOpen className="h-3.5 w-3.5" /> Service book
            </button>
            <button
              type="button"
              onClick={() => addLine()}
              className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </button>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="p-1">Optionality</th>
              <th className="p-1">Name / Description</th>
              <th className="p-1 text-right">Qty</th>
              <th className="p-1 text-right">Price</th>
              <th className="p-1 text-center">Upsell</th>
              <th className="p-1"></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-3 text-center text-sm text-gray-500">
                  No line items yet. Click &ldquo;Add line&rdquo; or &ldquo;Service book&rdquo;.
                </td>
              </tr>
            ) : (
              lineItems.map((li, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="p-1">
                    <OptionalityToggle
                      value={li.optionality}
                      onChange={next => updateLine(i, { optionality: next })}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className="w-full rounded border px-2 py-1"
                      placeholder="Service name"
                      value={li.service_name}
                      onChange={e => updateLine(i, { service_name: e.target.value })}
                    />
                    <input
                      className="mt-1 w-full rounded border px-2 py-1 text-xs text-gray-600"
                      placeholder="Description (shown on customer view)"
                      value={li.description ?? ''}
                      onChange={e => updateLine(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="p-1 text-right">
                    <input
                      type="number"
                      min={1}
                      className="w-14 rounded border px-1 py-1 text-right"
                      value={li.quantity}
                      onChange={e =>
                        updateLine(i, { quantity: Number(e.target.value) || 1 })
                      }
                    />
                  </td>
                  <td className="p-1 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="w-24 rounded border px-1 py-1 text-right"
                      value={li.price}
                      onChange={e =>
                        updateLine(i, { price: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="p-1 text-center">
                    <input
                      type="checkbox"
                      checked={li.is_upsell}
                      onChange={e => updateLine(i, { is_upsell: e.target.checked })}
                    />
                  </td>
                  <td className="p-1">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-gray-400 hover:text-red-600"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-end gap-6 text-sm">
          <div className="text-gray-600">
            Required only: <span className="font-medium">${totals.requiredTotal.toFixed(2)}</span>
          </div>
          <div>
            Total: <span className="text-lg font-semibold">${totals.total.toFixed(2)}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            Original Price
            <input
              type="number"
              step="0.01"
              className="w-28 rounded border px-2 py-1 text-right"
              value={quote.original_price ?? ''}
              onChange={e =>
                setQuote({
                  ...quote,
                  original_price: e.target.value === '' ? null : Number(e.target.value) || 0,
                })
              }
              placeholder="anchor"
            />
          </label>
        </div>
      </section>

      <section className="mb-6 rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Service plans</h2>
          <button
            type="button"
            onClick={addPlan}
            className="flex items-center gap-1 rounded border px-2 py-1 text-xs"
          >
            <Plus className="h-3.5 w-3.5" /> Add plan
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="p-3 text-center text-sm text-gray-500">
            No service plans. Add one to offer recurring pricing to the customer.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.map((p, i) => (
              <div key={i} className="rounded border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <input
                    className="flex-1 rounded border px-2 py-1 text-sm font-medium"
                    placeholder="Plan name (e.g. Monthly)"
                    value={p.name}
                    onChange={e => updatePlan(i, { name: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => removePlan(i)}
                    className="ml-2 text-gray-400 hover:text-red-600"
                    aria-label="Remove plan"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <label className="mb-2 block text-xs text-gray-600">
                  Discount label (e.g. &ldquo;20% off recurring&rdquo;)
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={p.discount_label ?? ''}
                    onChange={e => updatePlan(i, { discount_label: e.target.value })}
                  />
                </label>
                <label className="mb-2 block text-xs text-gray-600">
                  Recurring price
                  <input
                    type="number"
                    step="0.01"
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={p.recurring_price}
                    onChange={e =>
                      updatePlan(i, { recurring_price: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className="mb-1 flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={p.first_visit_keeps_original_price}
                    onChange={e =>
                      updatePlan(i, { first_visit_keeps_original_price: e.target.checked })
                    }
                  />
                  First visit bills at original price
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={p.offered_to_customer}
                    onChange={e => updatePlan(i, { offered_to_customer: e.target.checked })}
                  />
                  Offer to customer
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      <CustomerPickerModal
        open={showCustomerPicker}
        onClose={() => setShowCustomerPicker(false)}
        onSelect={applyPickedCustomer}
        initialQuery={quote.customer_name ?? ""}
      />

      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-4 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-medium">Service Book</h3>
              <button type="button" onClick={() => setShowPicker(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {catalog.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">
                Catalog is empty. Seed defaults in the admin &gt; Service Book.
              </div>
            ) : (
              <ul className="max-h-96 divide-y overflow-auto">
                {catalog.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-2 py-2 text-left hover:bg-gray-50"
                      onClick={() => addFromCatalog(c)}
                    >
                      <div>
                        <div className="font-medium">{c.name}</div>
                        {c.description && (
                          <div className="text-xs text-gray-600">{c.description}</div>
                        )}
                      </div>
                      <div className="text-sm font-medium text-gray-700">
                        ${Number(c.default_price).toFixed(2)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
