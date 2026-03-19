"use client"

import { useState } from "react"
import { trackLead, trackFormSubmit } from "@/lib/marketing/tracking"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"

interface BookingFormProps {
  preselectedService?: string
  source?: string
  compact?: boolean
}

export function BookingForm({ preselectedService, source = "website", compact = false }: BookingFormProps) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

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
      service_type: (form.elements.namedItem("service_type") as HTMLSelectElement).value || undefined,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement)?.value || undefined,
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
        <h3 className="text-lg font-semibold text-emerald-800 mb-1">Request Received!</h3>
        <p className="text-sm text-emerald-700">
          We&apos;ll be in touch within the hour to confirm your appointment.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            placeholder="Your name"
            className="w-full px-3 py-2.5 border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
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
            placeholder="(555) 123-4567"
            className="w-full px-3 py-2.5 border border-slate-300 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="bf-service" className="block text-sm font-medium text-slate-700 mb-1">
          What do you need? *
        </label>
        <select
          id="bf-service"
          name="service_type"
          required
          defaultValue={preselectedService || ""}
          className="w-full px-3 py-2.5 border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
        >
          <option value="">Select a service...</option>
          {SPOTLESS_SERVICES.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.shortTitle}
            </option>
          ))}
        </select>
      </div>

      {/* Hidden fields still submitted but not shown unless expanded */}
      <input type="hidden" name="email" value="" />
      <input type="hidden" name="address" value="" />
      <input type="hidden" name="message" value="" />

      {status === "error" && (
        <p className="text-sm text-red-600">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full px-6 py-3 bg-[#2195b4] text-white font-semibold hover:bg-[#155f73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        {status === "submitting" ? "Sending..." : "Get Your Free Quote"}
      </button>

      <p className="text-xs text-slate-500 text-center">
        We will call you back within the hour. No spam, no pressure.
      </p>
    </form>
  )
}
