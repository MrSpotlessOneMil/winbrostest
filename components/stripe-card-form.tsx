"use client"

import { useState, useEffect } from "react"
import { loadStripe, type Stripe, type StripeCardElement } from "@stripe/stripe-js"
import { Loader2, CreditCard, Check, AlertCircle } from "lucide-react"

interface StripeCardFormProps {
  customerId: string
  onSuccess: () => void
  onCancel: () => void
}

export function StripeCardForm({ customerId, onSuccess, onCancel }: StripeCardFormProps) {
  const [stripe, setStripe] = useState<Stripe | null>(null)
  const [cardElement, setCardElement] = useState<StripeCardElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [cardReady, setCardReady] = useState(false)

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        // Fetch publishable key from our API
        const res = await fetch("/api/actions/attach-card")
        const json = await res.json()
        if (!res.ok || !json.publishable_key) {
          setError(json.error || "Stripe not configured")
          setLoading(false)
          return
        }

        const stripeInstance = await loadStripe(json.publishable_key)
        if (!mounted || !stripeInstance) return

        setStripe(stripeInstance)

        const elements = stripeInstance.elements()
        const card = elements.create("card", {
          style: {
            base: {
              color: "#e4e4e7",
              fontFamily: "ui-monospace, monospace",
              fontSize: "14px",
              "::placeholder": { color: "#71717a" },
            },
            invalid: { color: "#f87171" },
          },
        })

        // Mount after a tick to ensure DOM is ready
        setTimeout(() => {
          if (!mounted) return
          const el = document.getElementById("stripe-card-element")
          if (el) {
            card.mount(el)
            setCardElement(card)

            card.on("change", (event) => {
              setCardReady(event.complete)
              setError(event.error ? event.error.message : null)
            })
          }
          setLoading(false)
        }, 50)
      } catch {
        if (mounted) {
          setError("Failed to load Stripe")
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      mounted = false
      cardElement?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit() {
    if (!stripe || !cardElement || saving) return

    setSaving(true)
    setError(null)

    try {
      const { paymentMethod, error: stripeError } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
      })

      if (stripeError || !paymentMethod) {
        setError(stripeError?.message || "Failed to create payment method")
        setSaving(false)
        return
      }

      // Attach to customer via our API
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
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading...
        </div>
      ) : (
        <>
          <div
            id="stripe-card-element"
            className="px-3 py-3 bg-zinc-800 border border-zinc-700 rounded-lg"
          />

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3 h-3" />
              {error}
            </div>
          )}

          <div className="flex gap-2">
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
        </>
      )}
    </div>
  )
}
