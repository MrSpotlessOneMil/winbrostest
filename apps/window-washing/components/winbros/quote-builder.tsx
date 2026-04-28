"use client"

/**
 * Quote builder component — extracted from /quotes/[id]/page.tsx so the same
 * UI can render either as a full page (direct URL access) or as a popup
 * Sheet on /jobs Calendar (no navigation away).
 *
 * The page wrapper passes onClose={() => router.push(backHref)}; the Sheet
 * wrapper passes onClose={() => setSheetOpen(false)}. Component itself stays
 * URL-agnostic.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Plus, Trash2, Send, BookOpen, X, UserPlus, User, Check } from "lucide-react"
import {
  computeQuoteTotals,
  formatTotalEquation,
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

interface PlanTemplate {
  id: string
  slug: string
  name: string
  recurring_price: number
  recurrence: { interval_months?: number; visits_per_year?: number } | null
  agreement_pdf_url: string | null
  description: string | null
  sort_order: number
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

function OptionalityPill({
  value,
  onChange,
}: {
  value: Optionality
  onChange: (next: Optionality) => void
}) {
  const style: Record<Optionality, string> = {
    required: 'bg-slate-800 text-white border-slate-800',
    recommended: 'bg-white text-slate-800 border-slate-400',
    optional: 'bg-white text-slate-500 border-slate-300',
  }
  const showCheck = value !== 'optional'
  return (
    <button
      type="button"
      aria-label={`Line state: ${OPTION_LABELS[value]}`}
      title="Click to cycle: Required → Recommended → Optional"
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${style[value]}`}
      onClick={() => onChange(OPTION_CYCLE[value])}
    >
      {showCheck ? (
        <Check className="h-3 w-3" />
      ) : (
        <span className="h-3 w-3 rounded-full border border-slate-400" />
      )}
      {OPTION_LABELS[value]}
    </button>
  )
}

interface QuoteBuilderProps {
  quoteId: string
  /** Render mode: page = full-bleed background; embedded = transparent (Sheet/Dialog) */
  variant?: 'page' | 'embedded'
  /** Back / close affordance. If undefined, no back button rendered. */
  onClose?: () => void
  backLabel?: string
  /** Optional callback fired after a successful save/approve. Lets parents refresh data. */
  onSaved?: (quote: Quote) => void
}

export function QuoteBuilder({
  quoteId,
  variant = 'embedded',
  onClose,
  backLabel = 'Close',
  onSaved,
}: QuoteBuilderProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [catalog, setCatalog] = useState<ServiceBookItem[]>([])
  const [planTemplates, setPlanTemplates] = useState<PlanTemplate[]>([])
  const [showPicker, setShowPicker] = useState(false)
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)

  const load = useCallback(async () => {
    if (!quoteId) return
    setLoading(true)
    setError(null)
    try {
      const [qRes, bookRes, tmplRes] = await Promise.all([
        fetch(`/api/actions/quotes/${quoteId}`),
        fetch(`/api/actions/service-book`),
        // Phase E: pull tenant's plan templates so the QuoteBuilder can
        // offer a quick-pick instead of forcing the salesman to type out
        // "Monthly $99" every time. Soft-fail so a tenant without seeded
        // templates still gets the freeform Add-Plan flow.
        fetch(`/api/actions/service-plan-templates`).catch(() => null),
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
      if (tmplRes && tmplRes.ok) {
        const tBody = await tmplRes.json()
        setPlanTemplates((tBody.templates || []) as PlanTemplate[])
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

  const quoteLevelFirstVisitKeepsOriginal = useMemo(
    () =>
      plans.length > 0 &&
      plans.some(p => p.first_visit_keeps_original_price),
    [plans]
  )
  function setQuoteLevelFirstVisitKeepsOriginal(next: boolean) {
    setPlans(prev =>
      prev.map(p => ({ ...p, first_visit_keeps_original_price: next }))
    )
  }
  const [showPerPlanFirstVisit, setShowPerPlanFirstVisit] = useState(false)
  const offeredPlansCount = plans.filter(p => p.offered_to_customer).length

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

  function addPlanFromTemplate(slug: string) {
    const tmpl = planTemplates.find(t => t.slug === slug)
    if (!tmpl) return
    setPlans(prev => [
      ...prev,
      {
        name: tmpl.name,
        discount_label: null,
        recurring_price: Number(tmpl.recurring_price) || 0,
        first_visit_keeps_original_price: false,
        offered_to_customer: true,  // sensible default — admin tweaks if not
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

  const save = useCallback(async (): Promise<Quote | null> => {
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
      onSaved?.(body.quote as Quote)
      return body.quote as Quote
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      return null
    } finally {
      setSaving(false)
    }
  }, [quoteId, quote, totals.total, lineItems, plans, onSaved])

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

  const wrapperClass =
    variant === 'page'
      ? 'min-h-screen bg-zinc-950 text-zinc-100'
      : 'bg-zinc-950 text-zinc-100'

  if (loading) {
    return (
      <div className={`${wrapperClass} p-6 text-sm text-zinc-400`} data-testid="quote-builder-loading">
        Loading quote…
      </div>
    )
  }

  if (!quote) {
    return (
      <div className={`${wrapperClass} p-6`}>
        <div className="mx-auto max-w-2xl rounded-lg border border-red-900/50 bg-red-950/40 p-4 text-sm text-red-200">
          {error || 'Quote not found'}
        </div>
        {onClose && (
          <div className="mx-auto mt-4 max-w-2xl">
            <button
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              onClick={onClose}
            >
              {backLabel}
            </button>
          </div>
        )}
      </div>
    )
  }

  const statusBadge = (() => {
    const s = (quote.status || 'draft').toLowerCase()
    const styles: Record<string, string> = {
      draft: 'bg-zinc-800 text-zinc-300 border-zinc-700',
      pending: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
      sent: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
      converted: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
      declined: 'bg-red-500/10 text-red-300 border-red-500/30',
    }
    return styles[s] || styles.draft
  })()

  return (
    <div className={wrapperClass} data-testid="quote-builder">
      <div
        className={
          variant === 'page'
            ? 'mx-auto max-w-5xl p-4 sm:p-6 lg:p-8 pb-24'
            : 'p-4 sm:p-6 pb-24'
        }
      >

        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"
                data-testid="quote-builder-close"
              >
                <ArrowLeft className="h-4 w-4" />
                {backLabel}
              </button>
            )}
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Quote Builder</h1>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusBadge}`}
              >
                {quote.status || 'draft'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="text-sm text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={sendToCustomer}
              disabled={saving || sending}
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> {sending ? 'Sending…' : 'Send to Customer'}
            </button>
            <button
              onClick={approve}
              disabled={saving || approving || quote.status === 'converted'}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {approving ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="mb-12 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Client</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCustomerPicker(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
              >
                <User className="h-3.5 w-3.5" /> Select Client
              </button>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600/15 border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25"
              >
                <UserPlus className="h-3.5 w-3.5" /> Create Client
              </button>
            </div>
          </div>
          {quote.customer_id ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-zinc-100">
                    {quote.customer_name || `Customer #${quote.customer_id}`}
                  </div>
                  <div className="mt-1 text-sm text-zinc-300">
                    {quote.customer_phone || "—"}
                  </div>
                  {quote.customer_address && (
                    <div className="text-sm text-zinc-400">{quote.customer_address}</div>
                  )}
                  {quote.customer_email && (
                    <div className="text-sm text-zinc-500">{quote.customer_email}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomerPicker(true)}
                  className="text-xs font-medium text-blue-400 hover:text-blue-300 hover:underline"
                >
                  Change
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
              No client selected. Use{' '}
              <span className="font-medium text-zinc-300">Select Client</span>{' '}
              or{' '}
              <span className="font-medium text-zinc-300">Create Client</span>{' '}
              above to populate name, phone, and address.
            </div>
          )}
        </section>

        <section className="mb-12 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Line items</h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
              >
                <BookOpen className="h-3.5 w-3.5" /> Service book
              </button>
              <button
                type="button"
                onClick={() => addLine()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600/15 border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25"
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {lineItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center text-sm text-zinc-400">
                No line items yet. Pull from the{' '}
                <span className="font-medium text-zinc-300">Service book</span>{' '}
                or click{' '}
                <span className="font-medium text-zinc-300">Add line</span>.
              </div>
            ) : (
              lineItems.map((li, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 transition hover:bg-zinc-800/70 sm:flex-row sm:items-start sm:gap-3"
                  data-testid="line-item-row"
                >
                  <div className="flex items-center justify-between gap-2 sm:block sm:w-[8rem] sm:shrink-0">
                    <OptionalityPill
                      value={li.optionality}
                      onChange={next => updateLine(i, { optionality: next })}
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-zinc-500 hover:text-red-400 sm:hidden"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Service name"
                      value={li.service_name}
                      onChange={e => updateLine(i, { service_name: e.target.value })}
                    />
                    <input
                      className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-400 placeholder-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Description (shown on customer view)"
                      value={li.description ?? ''}
                      onChange={e => updateLine(i, { description: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2 sm:items-start">
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      Qty
                      <input
                        type="number"
                        min={1}
                        className="w-14 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                        value={li.quantity}
                        onChange={e =>
                          updateLine(i, { quantity: Number(e.target.value) || 1 })
                        }
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      $
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-sm font-medium text-zinc-100 focus:border-blue-500 focus:outline-none"
                        value={li.price}
                        onChange={e =>
                          updateLine(i, { price: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="hidden text-zinc-500 hover:text-red-400 sm:inline-flex"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 border-t border-zinc-800 pt-4">
            <div
              className="text-right text-xs text-zinc-500"
              data-testid="total-equation"
            >
              {formatTotalEquation(lineItems as unknown as QuoteLineItemLike[])}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
              <div className="text-zinc-400">
                Required only:{' '}
                <span className="font-medium text-zinc-200">
                  ${totals.requiredTotal.toFixed(2)}
                </span>
              </div>
              <div className="text-zinc-300">
                Total:{' '}
                <span className="text-2xl font-bold text-white">
                  ${totals.total.toFixed(2)}
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Original Price
                <input
                  type="number"
                  step="0.01"
                  className="w-28 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
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
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={quoteLevelFirstVisitKeepsOriginal}
                  onChange={e => setQuoteLevelFirstVisitKeepsOriginal(e.target.checked)}
                  className="h-4 w-4 accent-blue-500"
                />
                First cleaning keeps original price (applies to all plans)
              </label>
            </div>
          </div>
        </section>

        <section className="mb-12 rounded-xl border border-zinc-800 bg-zinc-900 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Service plans</h2>
              {plans.length > 0 && (
                <span
                  className="rounded-full bg-blue-500/15 border border-blue-500/30 px-2.5 py-0.5 text-xs font-semibold text-blue-300"
                  data-testid="offered-plans-count"
                >
                  {offeredPlansCount} of {plans.length} offered
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {plans.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPerPlanFirstVisit(v => !v)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 hover:underline"
                >
                  {showPerPlanFirstVisit ? 'Hide per-plan override' : 'Customize per plan'}
                </button>
              )}
              {planTemplates.length > 0 && (
                <select
                  data-testid="plan-template-picker"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
                  value=""
                  onChange={e => {
                    if (e.target.value) {
                      addPlanFromTemplate(e.target.value)
                      e.target.value = ''
                    }
                  }}
                >
                  <option value="">+ From template…</option>
                  {planTemplates.map(t => (
                    <option key={t.slug} value={t.slug}>
                      {t.name} — ${Number(t.recurring_price).toFixed(0)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={addPlan}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600/15 border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-600/25"
              >
                <Plus className="h-3.5 w-3.5" /> Add plan
              </button>
            </div>
          </div>

          {plans.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
              No service plans yet. Add one to offer recurring pricing to the customer.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {plans.map((p, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-4 transition ${
                    p.offered_to_customer
                      ? 'border-blue-500/50 bg-blue-500/5'
                      : 'border-zinc-800 bg-zinc-800/40'
                  }`}
                  data-testid="plan-card"
                >
                  <label className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-zinc-300">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.offered_to_customer}
                        onChange={e =>
                          updatePlan(i, { offered_to_customer: e.target.checked })
                        }
                        className="h-4 w-4 accent-blue-500"
                      />
                      Offer to customer
                    </span>
                    <button
                      type="button"
                      onClick={() => removePlan(i)}
                      className="text-zinc-500 hover:text-red-400"
                      aria-label="Remove plan"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </label>
                  <input
                    className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-semibold text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                    placeholder="Plan name (e.g. Monthly)"
                    value={p.name}
                    onChange={e => updatePlan(i, { name: e.target.value })}
                  />
                  <label className="mb-2 block text-xs text-zinc-400">
                    Discount label
                    <input
                      className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
                      placeholder="e.g. 20% off recurring"
                      value={p.discount_label ?? ''}
                      onChange={e => updatePlan(i, { discount_label: e.target.value })}
                    />
                  </label>
                  <label className="mb-3 block text-xs text-zinc-400">
                    Recurring price
                    <div className="mt-1 flex items-center rounded-md border border-zinc-700 bg-zinc-900 focus-within:border-blue-500">
                      <span className="pl-3 text-sm text-zinc-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full bg-transparent px-2 py-1.5 text-sm font-semibold text-zinc-100 focus:outline-none"
                        value={p.recurring_price}
                        onChange={e =>
                          updatePlan(i, { recurring_price: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                  </label>
                  {showPerPlanFirstVisit && (
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={p.first_visit_keeps_original_price}
                        onChange={e =>
                          updatePlan(i, {
                            first_visit_keeps_original_price: e.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-blue-500"
                      />
                      First visit keeps original price
                    </label>
                  )}
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
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-zinc-100">Service Book</h3>
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {catalog.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
                  Catalog is empty. Seed defaults in the admin &gt; Service Book.
                </div>
              ) : (
                <ul className="max-h-96 divide-y divide-zinc-800 overflow-auto rounded-lg border border-zinc-800">
                  {catalog.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-800"
                        onClick={() => addFromCatalog(c)}
                      >
                        <div>
                          <div className="font-medium text-zinc-100">{c.name}</div>
                          {c.description && (
                            <div className="text-xs text-zinc-400">{c.description}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-zinc-200">
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
    </div>
  )
}
