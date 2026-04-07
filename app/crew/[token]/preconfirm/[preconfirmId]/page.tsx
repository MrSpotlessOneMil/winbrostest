"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, XCircle, Loader2, MapPin, DollarSign, Sparkles, Calendar } from "lucide-react"

interface PreconfirmData {
  preconfirm: { id: number; status: string; cleaner_pay: number | null; currency: string; responded_at: string | null }
  quote: {
    description: string | null; customer_first_name: string | null; customer_address: string | null
    service_category: string | null; square_footage: number | null; bedrooms: number | null
    bathrooms: number | null; notes: string | null
  } | null
  cleaner_name: string
  business_name: string
  brand_color: string | null
}

function humanize(v: string) { return v.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }
function fmtPay(amount: number, currency = "usd") {
  const cur = (currency || "usd").toUpperCase()
  return new Intl.NumberFormat("en-US", { style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount)
}

export default function PreconfirmPage() {
  const params = useParams()
  const token = params.token as string
  const preconfirmId = params.preconfirmId as string

  const [data, setData] = useState<PreconfirmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [responded, setResponded] = useState<"confirmed" | "declined" | null>(null)

  useEffect(() => {
    fetch(`/api/crew/${token}/preconfirm/${preconfirmId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else {
          setData(d)
          if (d.preconfirm.status !== "pending") setResponded(d.preconfirm.status)
        }
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false))
  }, [token, preconfirmId])

  async function handleAction(action: "confirm" | "decline") {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/crew/${token}/preconfirm/${preconfirmId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const result = await res.json()
      if (result.success) {
        setResponded(result.status)
      } else {
        setError(result.error || "Something went wrong")
      }
    } catch {
      setError("Failed to submit response")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="size-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="text-center">
          <XCircle className="size-12 text-red-400 mx-auto mb-3" />
          <p className="text-gray-600">{error || "Something went wrong"}</p>
        </div>
      </div>
    )
  }

  const { preconfirm, quote, cleaner_name, business_name, brand_color } = data
  const accentColor = brand_color || "#3b82f6"

  // Already responded
  if (responded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          {responded === "confirmed" ? (
            <>
              <div className="size-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: accentColor + "20" }}>
                <CheckCircle2 className="size-8" style={{ color: accentColor }} />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">You're In!</h2>
              <p className="text-gray-600">
                We'll send you the details and date once the client confirms. Thanks, {cleaner_name.split(" ")[0]}!
              </p>
            </>
          ) : (
            <>
              <div className="size-16 rounded-full bg-gray-100 mx-auto mb-4 flex items-center justify-center">
                <XCircle className="size-8 text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">No Problem</h2>
              <p className="text-gray-600">
                Thanks for letting us know. We'll reach out for the next one!
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  // Pending — show details and confirm/decline buttons
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-6 py-8 text-center" style={{ backgroundColor: accentColor }}>
        <Sparkles className="size-8 mx-auto mb-2 opacity-80" />
        <h1 className="text-2xl font-bold">{business_name}</h1>
        <p className="text-white/80 mt-1">New Job Opportunity</p>
      </div>

      <div className="px-6 -mt-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-5">
          {/* Greeting */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Hey {cleaner_name.split(" ")[0]}!
            </h2>
            <p className="text-gray-600 text-sm mt-1">
              We have a job opportunity for you. The client will pick the date — are you interested?
            </p>
          </div>

          {/* Service */}
          {quote?.description && (
            <div className="flex items-start gap-3">
              <Sparkles className="size-5 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Service</p>
                <p className="font-medium text-gray-900">{quote.description}</p>
              </div>
            </div>
          )}
          {!quote?.description && quote?.service_category && (
            <div className="flex items-start gap-3">
              <Sparkles className="size-5 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Service</p>
                <p className="font-medium text-gray-900">{humanize(quote.service_category)}</p>
              </div>
            </div>
          )}

          {/* Pay */}
          {preconfirm.cleaner_pay && (
            <div className="flex items-start gap-3">
              <DollarSign className="size-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Your Pay</p>
                <p className="font-bold text-green-600 text-lg">{fmtPay(Number(preconfirm.cleaner_pay), preconfirm.currency)}</p>
              </div>
            </div>
          )}

          {/* Location */}
          {quote?.customer_address && (
            <div className="flex items-start gap-3">
              <MapPin className="size-5 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Area</p>
                <p className="font-medium text-gray-900">{quote.customer_address}</p>
              </div>
            </div>
          )}

          {/* Date TBD */}
          <div className="flex items-start gap-3">
            <Calendar className="size-5 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-gray-500">Date</p>
              <p className="font-medium text-gray-900">Client will choose</p>
            </div>
          </div>

          {/* Details */}
          {(quote?.bedrooms || quote?.bathrooms || quote?.square_footage) && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
              {[
                quote.bedrooms ? `${quote.bedrooms} bed` : null,
                quote.bathrooms ? `${quote.bathrooms} bath` : null,
                quote.square_footage ? `${quote.square_footage} sqft` : null,
              ].filter(Boolean).join(" · ")}
            </div>
          )}

          {/* Notes */}
          {quote?.notes && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
              {quote.notes}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            <button
              onClick={() => handleAction("confirm")}
              disabled={submitting}
              className="w-full py-4 rounded-xl text-white font-bold text-lg shadow-md transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {submitting ? <Loader2 className="size-5 animate-spin mx-auto" /> : "I'm In!"}
            </button>
            <button
              onClick={() => handleAction("decline")}
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium transition-all active:scale-[0.98] disabled:opacity-50"
            >
              Not Available
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 pb-8">
          Powered by {business_name}
        </p>
      </div>
    </div>
  )
}
