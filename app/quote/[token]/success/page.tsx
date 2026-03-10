"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle, Loader2, Calendar, Phone } from "lucide-react"

export default function QuoteSuccessPage() {
  const params = useParams()
  const token = params.token as string
  const [data, setData] = useState<{
    quote: { customer_name: string | null; selected_tier: string | null; total: string | null; deposit_amount: string | null }
    tenant: { name: string; phone?: string }
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-emerald-400" />
      </div>
    )
  }

  const customerName = data?.quote?.customer_name?.split(" ")[0] || "there"
  const businessName = data?.tenant?.name || "us"
  const businessPhone = data?.tenant?.phone
  const depositAmount = data?.quote?.deposit_amount ? `$${Number(data.quote.deposit_amount).toFixed(2)}` : null

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="h-1 bg-gradient-to-r from-emerald-600 via-green-500 to-emerald-600" />

      <div className="max-w-lg mx-auto px-4 py-16 flex flex-col items-center text-center gap-8">
        {/* Success icon */}
        <div className="relative">
          <div className="size-24 rounded-full bg-emerald-500/10 flex items-center justify-center ring-2 ring-emerald-500/30 animate-in zoom-in duration-500">
            <CheckCircle className="size-12 text-emerald-400" />
          </div>
          <div className="absolute inset-0 size-24 rounded-full bg-emerald-500/5 animate-ping" />
        </div>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-white">
            Payment Received!
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            Thank you, {customerName}! Your deposit{depositAmount ? ` of ${depositAmount}` : ''} has been processed successfully.
          </p>
        </div>

        {/* What happens next */}
        <div className="w-full bg-zinc-900/60 backdrop-blur rounded-xl border border-white/[0.06] p-6 space-y-4 text-left">
          <h2 className="text-white font-semibold text-sm uppercase tracking-wider">
            What happens next
          </h2>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-400 text-xs font-bold">1</span>
              </div>
              <div>
                <p className="text-zinc-200 text-sm font-medium">Confirmation</p>
                <p className="text-zinc-500 text-xs">You&apos;ll receive a confirmation text shortly.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-400 text-xs font-bold">2</span>
              </div>
              <div>
                <p className="text-zinc-200 text-sm font-medium">Scheduling</p>
                <p className="text-zinc-500 text-xs">We&apos;ll reach out to confirm the best date and time for your service.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="size-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <span className="text-emerald-400 text-xs font-bold">3</span>
              </div>
              <div>
                <p className="text-zinc-200 text-sm font-medium">Day of Service</p>
                <p className="text-zinc-500 text-xs">You&apos;ll get a reminder and your team&apos;s ETA the day before.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact info */}
        <div className="flex flex-col sm:flex-row items-center gap-4 text-sm">
          {businessPhone && (
            <a
              href={`tel:${businessPhone}`}
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
            >
              <Phone className="size-4" />
              {businessPhone}
            </a>
          )}
          <div className="flex items-center gap-2 text-zinc-500">
            <Calendar className="size-4" />
            We&apos;ll be in touch soon
          </div>
        </div>

        {/* Footer */}
        <p className="text-zinc-600 text-xs mt-8">
          Powered by {businessName}
        </p>
      </div>
    </div>
  )
}
