"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle, Loader2, Calendar, Phone } from "lucide-react"

function fmtCurrency(amount: number, currency = "USD"): string {
  // Always use en-US locale so non-USD currencies get a distinguishing prefix (CA$, not $)
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount)
}

export default function QuoteSuccessPage() {
  const params = useParams()
  const token = params.token as string
  const [data, setData] = useState<{
    quote: { customer_name: string | null; selected_tier: string | null; total: string | null; deposit_amount: string | null }
    tenant: { name: string; phone?: string; currency?: string | null }
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/quotes/${token}`)
        const json = await res.json()
        if (json.success) setData(json)
      } catch {
        // Fail silently — show generic success
      } finally {
        setLoading(false)
      }
    }
    if (token) load()
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  const customerName = data?.quote?.customer_name?.split(" ")[0] || "there"
  const businessName = data?.tenant?.name || "us"
  const businessPhone = data?.tenant?.phone
  const tenantCurrency = data?.tenant?.currency?.toUpperCase() || "USD"
  const fmt = (amount: number) => fmtCurrency(amount, tenantCurrency)
  const depositAmount = data?.quote?.deposit_amount ? fmt(Number(data.quote.deposit_amount)) : null

  return (
    <div className="min-h-screen bg-white">
      <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-500" />

      <div className="max-w-lg mx-auto px-4 py-16 flex flex-col items-center text-center gap-8">
        {/* Success icon */}
        <div className="relative">
          <div className="size-24 rounded-full bg-emerald-50 flex items-center justify-center ring-4 ring-emerald-100 animate-in zoom-in duration-500">
            <CheckCircle className="size-12 text-emerald-500" />
          </div>
        </div>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-slate-800">
            You&apos;re All Set!
          </h1>
          <p className="text-slate-500 text-lg leading-relaxed">
            Thank you, {customerName}! Your card is on file{depositAmount ? ` and your deposit of ${depositAmount} has been processed` : ''}. We&apos;ll be in touch!
          </p>
        </div>

        {/* What happens next */}
        <div className="w-full bg-blue-50/50 rounded-2xl border border-blue-100 p-6 space-y-4 text-left">
          <h2 className="text-slate-800 font-semibold text-sm uppercase tracking-wider">
            What happens next
          </h2>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-600 text-xs font-bold">1</span>
              </div>
              <div>
                <p className="text-slate-800 text-sm font-medium">Confirmation</p>
                <p className="text-slate-500 text-xs">You&apos;ll receive a confirmation text shortly.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-600 text-xs font-bold">2</span>
              </div>
              <div>
                <p className="text-slate-800 text-sm font-medium">Scheduling</p>
                <p className="text-slate-500 text-xs">We&apos;ll reach out to confirm the best date and time for your service.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-600 text-xs font-bold">3</span>
              </div>
              <div>
                <p className="text-slate-800 text-sm font-medium">Day of Service</p>
                <p className="text-slate-500 text-xs">You&apos;ll get a reminder and your team&apos;s ETA the day before.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-sm">
          {businessPhone && (
            <a
              href={`tel:${businessPhone}`}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-700 transition-colors font-medium"
            >
              <Phone className="size-4" />
              {businessPhone}
            </a>
          )}
          <div className="flex items-center gap-2 text-slate-400">
            <Calendar className="size-4" />
            We&apos;ll be in touch soon
          </div>
        </div>

        {/* Footer */}
        <p className="text-slate-300 text-xs mt-8">
          Powered by {businessName}
        </p>
      </div>
    </div>
  )
}
