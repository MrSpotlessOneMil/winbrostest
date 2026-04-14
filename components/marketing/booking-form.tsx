"use client"

import { useState, useEffect } from "react"
import { trackLead, trackFormSubmit } from "@/lib/marketing/tracking"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"

interface BookingFormProps {
  preselectedService?: string
  source?: string
  compact?: boolean
  ctaLabel?: string
}

function getUtmParams(): Record<string, string> {
  if (typeof window === "undefined") return {}
  const params = new URLSearchParams(window.location.search)
  const utms: Record<string, string> = {}
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const val = params.get(key)
    if (val) utms[key] = val
  }
  return utms
}

export function BookingForm({ preselectedService, source = "website", compact = false, ctaLabel = "Get Your Free Quote" }: BookingFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [utmParams, setUtmParams] = useState<Record<string, string>>({})
  const [selectedService, setSelectedService] = useState(preselectedService || "")

  useEffect(() => {
    setUtmParams(getUtmParams())
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus("submitting")
    setErrorMsg("")

    const form = e.currentTarget
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value,
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value,
      email: (form.elements.namedItem("email") as HTMLInputElement).value || undefined,
      address: (form.elements.namedItem("address") as HTMLInputElement).value || undefined,
      service_type: selectedService || (form.elements.namedItem("service_type") as HTMLSelectElement)?.value || undefined,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement)?.value || undefined,
      source,
      ...utmParams,
    }

    try {
      const res = await fetch("/api/webhooks/website/spotless-scrubbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) throw new Error("Failed to submit")

      setStatus("success")
      trackLead(source)
      trackFormSubmit("booking_form")
      form.reset()
    } catch {
      setStatus("error")
      setErrorMsg("Something went wrong. Please call us or try again.")
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-6 text-center">
        <div className="text-3xl mb-2">&#10003;</div>
        <h3 className="text-lg font-semibold text-emerald-800 mb-1">You&apos;re all set!</h3>
        <p className="text-sm text-emerald-700 mb-3">
          Check your phone — we just sent you a text to confirm your cleaning details.
        </p>
        <p className="text-xs text-slate-500">
          Didn&apos;t get it? Call us at{" "}
          <a href="tel:+14246771146" className="text-emerald-700 font-medium underline">(424) 677-1146</a>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Star rating — social proof near form */}
      <div className="flex items-center gap-2 justify-center text-sm text-slate-600">
        <div className="flex text-amber-400 tracking-tight">★★★★★</div>
        <span className="font-semibold">5.0</span>
        <span className="text-slate-400">from 47 reviews</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="bf-name" className="block text-sm font-medium text-slate-700 mb-1">
            Name *
          </label>
          <input
            id="bf-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Your name"
            className="w-full px-3 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-base"
          />
        </div>

        <div>
          <label htmlFor="bf-phone" className="block text-sm font-medium text-slate-700 mb-1">
            Phone *
          </label>
          <input
            id="bf-phone"
            name="phone"
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="(555) 123-4567"
            className="w-full px-3 py-3 border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-base"
          />
        </div>
      </div>

      {/* Only show service picker when NOT preselected (Book Now page) */}
      {!preselectedService ? (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            What do you need? *
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { slug: "standard-cleaning", label: "Standard" },
              { slug: "deep-cleaning", label: "Deep Clean" },
              { slug: "move-in-out-cleaning", label: "Move-In/Out" },
            ].map((s) => (
              <button
                type="button"
                key={s.slug}
                onClick={() => setSelectedService(s.slug)}
                className={`py-3 rounded-lg text-sm font-medium border transition-colors ${
                  selectedService === s.slug
                    ? "bg-[#164E63] text-white border-[#164E63]"
                    : "bg-white text-slate-700 border-slate-300 hover:border-slate-400"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input type="hidden" name="service_type" value={selectedService} />
        </div>
      ) : (
        <input type="hidden" name="service_type" value={preselectedService} />
      )}

      {/* Hidden fields */}
      <input type="hidden" name="email" value="" />
      <input type="hidden" name="address" value="" />
      <input type="hidden" name="message" value="" />

      {status === "error" && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full px-6 py-4 bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base shadow-lg"
      >
        {status === "submitting" ? "Sending..." : ctaLabel}
      </button>

      <p className="text-xs text-slate-500 text-center">
        We&apos;ll text you within 60 seconds. No spam, no pressure.
      </p>
    </form>
  )
}
