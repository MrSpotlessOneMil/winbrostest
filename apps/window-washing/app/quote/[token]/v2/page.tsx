"use client"

/**
 * Customer Quote View — Round 2 (task 7, side-by-side with /quote/[token]).
 *
 * Matches PDF pages 3 & 5:
 *   - Required lines: plain, always counted.
 *   - Recommended lines: pre-checked checkbox, counted unless unchecked.
 *   - Optional lines: unchecked, counted when checked.
 *   - Plan cards: only offered_to_customer=true. Pick ≤1.
 *   - When a plan is picked: expand agreement PDF viewer + "I agree"
 *     checkbox + drawn signature canvas + "Save card on file" button.
 *   - Approve POSTs to /api/public/quotes/approve.
 *
 * Customer cannot edit prices — matches Max's non-negotiable.
 * Customer cannot convert without: plan picked (if plans offered), agreement
 * read, signature drawn, card saved (if Stripe configured).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle, Loader2, PenLine, ShieldCheck } from "lucide-react"
import {
  computeQuoteTotals,
  firstVisitChargeForPlan,
  type Optionality,
  type QuoteLineItemLike,
} from "@/lib/quote-totals"

interface LineItem {
  id: number | string
  service_name: string
  description: string | null
  price: number
  quantity: number
  optionality: Optionality
  is_upsell: boolean
  sort_order: number
}

interface Plan {
  id: number
  name: string
  discount_label: string | null
  recurring_price: number
  first_visit_keeps_original_price: boolean
  offered_to_customer: boolean
  sort_order: number
}

interface Quote {
  id: string
  token: string
  status: string
  customer_name: string | null
  customer_phone: string | null
  customer_email: string | null
  customer_address: string | null
  description: string | null
  notes: string | null
  total_price: number | null
  original_price: number | null
  valid_until: string | null
  approved_at: string | null
}

interface Tenant {
  slug: string
  name: string
  phone: string | null
  email: string | null
  website_url: string | null
  currency: string | null
  brand_color: string | null
  logo_url: string | null
  agreement_pdf_url: string | null
}

function fmtCurrency(amount: number, currency = "USD"): string {
  const locale = currency.toUpperCase() === "CAD" ? "en-CA" : "en-US"
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount)
}

function SignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = canvas.clientWidth * ratio
    canvas.height = canvas.clientHeight * ratio
    ctx.scale(ratio, ratio)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2
    ctx.strokeStyle = "#111827"
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  }, [])

  function relativePoint(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if ("touches" in e && e.touches.length) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    if ("clientX" in e) {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    return null
  }

  function start(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    drawing.current = true
    lastPoint.current = relativePoint(e)
  }
  function move(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    const p = relativePoint(e)
    if (!canvas || !ctx || !p) return
    ctx.beginPath()
    if (lastPoint.current) ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    else ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
  }
  function end() {
    if (!drawing.current) return
    drawing.current = false
    lastPoint.current = null
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL("image/png"))
  }
  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="h-32 w-full touch-none rounded border border-gray-300 bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="flex justify-between text-xs text-gray-600">
        <span>Sign above with your mouse or finger</span>
        <button type="button" onClick={clear} className="text-blue-600 hover:underline">
          Clear
        </button>
      </div>
    </div>
  )
}

export default function CustomerQuoteV2Page() {
  const params = useParams<{ token: string }>()
  const token = params?.token

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [optedIn, setOptedIn] = useState<Set<number | string>>(new Set())
  const [optedOut, setOptedOut] = useState<Set<number | string>>(new Set())
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [agreementRead, setAgreementRead] = useState(false)
  const [signature, setSignature] = useState<string | null>(null)
  const [cardSetupStarted, setCardSetupStarted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`/api/public/quotes/${token}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setQuote(body.quote as Quote)
      setLineItems(body.line_items as LineItem[])
      setPlans(body.plans as Plan[])
      setTenant(body.tenant as Tenant | null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load quote")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const selectedPlan = useMemo(
    () => (selectedPlanId != null ? plans.find(p => p.id === selectedPlanId) ?? null : null),
    [selectedPlanId, plans]
  )

  const liveInputs = useMemo(() => {
    const asCompat: QuoteLineItemLike[] = lineItems.map(li => ({
      id: li.id,
      price: li.price,
      quantity: li.quantity,
      optionality: li.optionality,
      is_upsell: li.is_upsell,
    }))
    return asCompat
  }, [lineItems])

  const totals = useMemo(
    () =>
      computeQuoteTotals({
        lineItems: liveInputs,
        optedInOptionalIds: optedIn,
        optedOutRecommendedIds: optedOut,
      }),
    [liveInputs, optedIn, optedOut]
  )

  const firstVisitCharge = useMemo(() => {
    if (!selectedPlan) return totals.total
    return firstVisitChargeForPlan(
      totals.total,
      selectedPlan.recurring_price,
      selectedPlan.first_visit_keeps_original_price
    )
  }, [selectedPlan, totals.total])

  function toggleOptional(id: number | string) {
    setOptedIn(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleRecommended(id: number | string) {
    setOptedOut(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function startCardSetup() {
    if (!token) return
    try {
      const res = await fetch(`/api/public/quotes/${token}/card-setup`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      if (body.url) {
        setCardSetupStarted(true)
        window.location.href = body.url
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start card setup")
    }
  }

  async function approve() {
    if (!token) return
    setError(null)
    if (plans.length > 0 && !selectedPlan) {
      setError("Please pick a plan before approving")
      return
    }
    if (!agreementRead) {
      setError("Please read and agree to the service agreement")
      return
    }
    if (!signature) {
      setError("Please sign above")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/quotes/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          selected_plan_id: selectedPlan?.id ?? null,
          agreement_read: true,
          signature_data: signature,
          opted_in_optional_ids: Array.from(optedIn),
          opted_out_recommended_ids: Array.from(optedOut),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve quote")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-gray-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (!quote || !tenant) {
    return (
      <div className="p-6">
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error || "This quote is not available."}
        </div>
      </div>
    )
  }

  if (done || quote.status === "converted") {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <CheckCircle className="mx-auto h-10 w-10 text-green-600" />
        <h1 className="mt-3 text-2xl font-semibold">Thanks, {quote.customer_name || "there"}!</h1>
        <p className="mt-2 text-gray-600">
          Your approval is confirmed. You&apos;ll get an SMS with your appointment
          details shortly.
        </p>
      </div>
    )
  }

  const currency = tenant.currency || "USD"
  const required = lineItems.filter(li => (li.optionality ?? "required") === "required")
  const recommended = lineItems.filter(li => li.optionality === "recommended")
  const optional = lineItems.filter(li => li.optionality === "optional")

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        {tenant.logo_url && (
          <img src={tenant.logo_url} alt={tenant.name} className="h-10" />
        )}
        <h1 className="mt-2 text-2xl font-semibold">Your Quote from {tenant.name}</h1>
        {quote.customer_name && (
          <p className="text-sm text-gray-600">Prepared for {quote.customer_name}</p>
        )}
      </header>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mb-5 rounded border bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Services</h2>

        {required.length > 0 && (
          <ul className="mb-3">
            {required.map(li => (
              <li key={li.id} className="flex items-start justify-between border-b py-2">
                <div>
                  <div className="font-medium">{li.service_name}</div>
                  {li.description && (
                    <div className="text-xs text-gray-600">{li.description}</div>
                  )}
                </div>
                <div className="font-medium">
                  {fmtCurrency(Number(li.price) * (li.quantity ?? 1), currency)}
                </div>
              </li>
            ))}
          </ul>
        )}

        {recommended.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              Recommended
            </div>
            <ul>
              {recommended.map(li => (
                <li
                  key={li.id}
                  className="flex items-start justify-between border-b py-2"
                >
                  <label className="flex flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!optedOut.has(li.id)}
                      onChange={() => toggleRecommended(li.id)}
                    />
                    <div>
                      <div className="font-medium">{li.service_name}</div>
                      {li.description && (
                        <div className="text-xs text-gray-600">{li.description}</div>
                      )}
                    </div>
                  </label>
                  <div className="font-medium">
                    {fmtCurrency(Number(li.price) * (li.quantity ?? 1), currency)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {optional.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              Optional add-ons
            </div>
            <ul>
              {optional.map(li => (
                <li
                  key={li.id}
                  className="flex items-start justify-between border-b py-2"
                >
                  <label className="flex flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={optedIn.has(li.id)}
                      onChange={() => toggleOptional(li.id)}
                    />
                    <div>
                      <div className="font-medium">{li.service_name}</div>
                      {li.description && (
                        <div className="text-xs text-gray-600">{li.description}</div>
                      )}
                    </div>
                  </label>
                  <div className="font-medium">
                    {fmtCurrency(Number(li.price) * (li.quantity ?? 1), currency)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-4 text-sm">
          {quote.original_price != null && (
            <div className="text-gray-500 line-through">
              {fmtCurrency(Number(quote.original_price), currency)}
            </div>
          )}
          <div className="text-lg font-semibold">
            Total: {fmtCurrency(totals.total, currency)}
          </div>
        </div>
      </section>

      {plans.length > 0 && (
        <section className="mb-5 rounded border bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Service plans</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {plans.map(p => {
              const selected = p.id === selectedPlanId
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPlanId(selected ? null : p.id)}
                  className={`rounded border p-3 text-left transition ${
                    selected
                      ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  {p.discount_label && (
                    <div className="text-xs text-gray-600">{p.discount_label}</div>
                  )}
                  <div className="mt-2 text-sm">
                    Recurring: {fmtCurrency(Number(p.recurring_price), currency)}
                  </div>
                  {p.first_visit_keeps_original_price && (
                    <div className="text-xs text-gray-600">
                      First visit at full price; discount from visit 2 onward.
                    </div>
                  )}
                </button>
              )
            })}
          </div>
          {selectedPlan && (
            <div className="mt-3 rounded bg-blue-50 p-2 text-sm text-blue-900">
              First visit charge will be{" "}
              <span className="font-semibold">
                {fmtCurrency(firstVisitCharge, currency)}
              </span>
              .
            </div>
          )}
        </section>
      )}

      <section className="mb-5 rounded border bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-gray-700 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Service agreement
        </h2>
        {tenant.agreement_pdf_url ? (
          <iframe
            src={tenant.agreement_pdf_url}
            title="Service Agreement"
            className="h-64 w-full rounded border"
          />
        ) : (
          <div className="rounded border border-dashed p-3 text-sm text-gray-500">
            Standard service agreement. Your card is saved securely by Stripe
            and only charged once the work is complete.
          </div>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={agreementRead}
            onChange={e => setAgreementRead(e.target.checked)}
          />
          I have read and agree to the service agreement.
        </label>
      </section>

      <section className="mb-5 rounded border bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-gray-700 flex items-center gap-2">
          <PenLine className="h-4 w-4" /> Signature
        </h2>
        <SignaturePad onChange={setSignature} />
      </section>

      <section className="mb-5 rounded border bg-white p-4">
        <h2 className="mb-2 text-sm font-medium text-gray-700">Save card on file</h2>
        <p className="mb-2 text-sm text-gray-600">
          We keep your card on file and charge{" "}
          <span className="font-semibold">{fmtCurrency(firstVisitCharge, currency)}</span> the
          day the work is done. You&apos;ll get a receipt by text.
        </p>
        <button
          type="button"
          onClick={startCardSetup}
          disabled={cardSetupStarted}
          className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {cardSetupStarted ? "Redirecting to Stripe…" : "Save card on file"}
        </button>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={approve}
          disabled={submitting || !signature || !agreementRead}
          className="rounded bg-green-600 px-5 py-2 text-white hover:bg-green-700 disabled:opacity-60"
        >
          {submitting ? "Approving…" : "Approve quote"}
        </button>
      </div>
    </div>
  )
}
