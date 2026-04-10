"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { loadStripe, type Stripe, type StripeCardNumberElement, type StripeCardExpiryElement, type StripeCardCvcElement } from "@stripe/stripe-js"
import { Loader2, CreditCard, Check, AlertCircle } from "lucide-react"

interface StripeCardFormProps {
  customerId: string
  onSuccess: () => void
  onCancel: () => void
}

const ELEMENT_STYLE = {
  base: {
    color: "#e4e4e7",
    fontFamily: "ui-monospace, monospace",
    fontSize: "14px",
    "::placeholder": { color: "#71717a" },
  },
  invalid: { color: "#f87171" },
}

export function StripeCardForm({ customerId, onSuccess, onCancel }: StripeCardFormProps) {
  const [stripe, setStripe] = useState<Stripe | null>(null)
  const [stripeReady, setStripeReady] = useState(false)
  const cardNumberRef = useRef<StripeCardNumberElement | null>(null)
  const cardExpiryRef = useRef<StripeCardExpiryElement | null>(null)
  const cardCvcRef = useRef<StripeCardCvcElement | null>(null)
  const numDivRef = useRef<HTMLDivElement>(null)
  const expDivRef = useRef<HTMLDivElement>(null)
  const cvcDivRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [numberComplete, setNumberComplete] = useState(false)
  const [expiryComplete, setExpiryComplete] = useState(false)
  const [cvcComplete, setCvcComplete] = useState(false)
  const [brand, setBrand] = useState<string>("unknown")
  const mountedRef = useRef(true)

  const cardReady = numberComplete && expiryComplete && cvcComplete

  // Phase 1: Load Stripe instance
  useEffect(() => {
    mountedRef.current = true

    async function init() {
      try {
        const res = await fetch("/api/actions/attach-card")
        const json = await res.json()
        if (!mountedRef.current) return
        if (!res.ok || !json.publishable_key) {
          setError(json.error || "Stripe not configured")
          setLoading(false)
          return
        }

        const stripeInstance = await loadStripe(json.publishable_key)
        if (!mountedRef.current || !stripeInstance) return

        setStripe(stripeInstance)
        setStripeReady(true)
        setLoading(false)
      } catch {
        if (mountedRef.current) {
          setError("Failed to load Stripe")
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      mountedRef.current = false
      cardNumberRef.current?.destroy()
      cardExpiryRef.current?.destroy()
      cardCvcRef.current?.destroy()
    }
  }, [])

  // Phase 2: Mount Stripe Elements AFTER divs are in the DOM
  // This runs when stripeReady becomes true and the div refs are available
  const mountAttempted = useRef(false)
  useEffect(() => {
    if (!stripeReady || !stripe || mountAttempted.current) return
    if (!numDivRef.current || !expDivRef.current || !cvcDivRef.current) return

    mountAttempted.current = true
    const elements = stripe.elements()

    const cardNumber = elements.create("cardNumber", { style: ELEMENT_STYLE, showIcon: true })
    const cardExpiry = elements.create("cardExpiry", { style: ELEMENT_STYLE })
    const cardCvc = elements.create("cardCvc", { style: ELEMENT_STYLE })

    cardNumber.mount(numDivRef.current)
    cardNumberRef.current = cardNumber
    cardNumber.on("change", (event) => {
      setNumberComplete(event.complete)
      setBrand(event.brand || "unknown")
      setError(event.error ? event.error.message : null)
    })

    cardExpiry.mount(expDivRef.current)
    cardExpiryRef.current = cardExpiry
    cardExpiry.on("change", (event) => {
      setExpiryComplete(event.complete)
      if (event.error) setError(event.error.message)
    })

    cardCvc.mount(cvcDivRef.current)
    cardCvcRef.current = cardCvc
    cardCvc.on("change", (event) => {
      setCvcComplete(event.complete)
      if (event.error) setError(event.error.message)
    })
  }, [stripeReady, stripe])

  async function handleSubmit() {
    if (!stripe || !cardNumberRef.current || saving) return

    setSaving(true)
    setError(null)

    try {
      const { paymentMethod, error: stripeError } = await stripe.createPaymentMethod({
        type: "card",
        card: cardNumberRef.current,
      })

      if (stripeError || !paymentMethod) {
        setError(stripeError?.message || "Failed to create payment method")
        setSaving(false)
        return
      }

      const res = await fetch("/api/actions/attach-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          payment_method_id: paymentMethod.id,
        }),
      })

      const json = await res.json()
      if (res.ok && json.success) {
        setSuccess(true)
        setTimeout(() => onSuccess(), 1500)
      } else {
        setError(json.error || "Failed to save card")
      }
    } catch {
      setError("Failed to save card")
    } finally {
      setSaving(false)
    }
  }

  if (success) {
    return (
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-400">
          <Check className="w-4 h-4" />
          <span className="text-sm font-medium">Card saved successfully!</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm font-medium text-zinc-200 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-blue-400" />
        Enter Card Details
        {brand !== "unknown" && (
          <span className="text-xs text-zinc-500 capitalize">{brand}</span>
        )}
      </p>

      {loading && (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      )}

      {/* Always render the mount targets so refs are available when Stripe loads */}
      <div style={{ display: loading ? "none" : "block" }}>
        <div className="space-y-1">
          <label className="text-xs text-zinc-500">Card Number</label>
          <div
            ref={numDivRef}
            className="px-3 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
            style={{ minHeight: 44 }}
          />
        </div>

        <div className="flex gap-3 mt-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-zinc-500">Expiry</label>
            <div
              ref={expDivRef}
              className="px-3 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
              style={{ minHeight: 44 }}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs text-zinc-500">CVC</label>
            <div
              ref={cvcDivRef}
              className="px-3 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
              style={{ minHeight: 44 }}
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400 mt-3">
            <AlertCircle className="w-3 h-3" />
            {error}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 text-xs text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !cardReady}
            className="flex-1 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Card"}
          </button>
        </div>
      </div>
    </div>
  )
}
