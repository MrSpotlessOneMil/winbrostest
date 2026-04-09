"use client"

import { useState, useEffect, useRef } from "react"
import { trackLead, trackFormSubmit } from "@/lib/marketing/tracking"

// ---------------------------------------------------------------------------
// Pricing constants — exact values from Supabase pricing_tiers (Spotless Scrubbers)
// Keyed by `${bedrooms}_${bathrooms}`, covers all calculator combos (1-6 bed, 1-4 bath)
// ---------------------------------------------------------------------------

const DB_PRICES: Record<string, Record<string, number>> = {
  standard: {
    '1_1': 150, '1_2': 175, '1_3': 200, '1_4': 225,
    '2_1': 175, '2_2': 200, '2_3': 225, '2_4': 250,
    '3_1': 210, '3_2': 260, '3_3': 310, '3_4': 360,
    '4_1': 280, '4_2': 340, '4_3': 400, '4_4': 455,
    '5_1': 365, '5_2': 420, '5_3': 475, '5_4': 530,
    '6_1': 440, '6_2': 495, '6_3': 550, '6_4': 605,
  },
  deep: {
    '1_1': 250, '1_2': 275, '1_3': 300, '1_4': 325,
    '2_1': 285, '2_2': 325, '2_3': 365, '2_4': 405,
    '3_1': 325, '3_2': 400, '3_3': 475, '3_4': 550,
    '4_1': 450, '4_2': 525, '4_3': 600, '4_4': 675,
    '5_1': 550, '5_2': 625, '5_3': 700, '5_4': 775,
    '6_1': 650, '6_2': 725, '6_3': 800, '6_4': 875,
  },
  move_in_out: {
    '1_1': 300, '1_2': 325, '1_3': 350, '1_4': 375,
    '2_1': 342, '2_2': 390, '2_3': 440, '2_4': 485,
    '3_1': 390, '3_2': 480, '3_3': 570, '3_4': 660,
    '4_1': 540, '4_2': 630, '4_3': 720, '4_4': 810,
    '5_1': 660, '5_2': 750, '5_3': 840, '5_4': 930,
    '6_1': 780, '6_2': 870, '6_3': 960, '6_4': 1050,
  },
}

const FREQUENCY_DISCOUNTS: Record<string, number> = {
  one_time: 0,
  biweekly: 0.15,
  monthly: 0.1,
  weekly: 0.2,
}

function roundToNearest5(n: number): number {
  return Math.round(n / 5) * 5
}

function calculatePrice(
  cleaningType: string,
  bedrooms: number,
  bathrooms: number,
  frequency: string,
): number {
  const table = DB_PRICES[cleaningType]
  // Post-construction uses deep prices as baseline + 25%
  const base = table?.[`${bedrooms}_${bathrooms}`]
    ?? Math.round((DB_PRICES.deep[`${bedrooms}_${bathrooms}`] ?? 400) * 1.25)
  const discount = FREQUENCY_DISCOUNTS[frequency] ?? 0
  return roundToNearest5(base * (1 - discount))
}

// ---------------------------------------------------------------------------
// Option configs
// ---------------------------------------------------------------------------
const BEDROOM_OPTIONS = [1, 2, 3, 4, 5, 6]
const BATHROOM_OPTIONS = [1, 2, 3, 4]

const CLEANING_TYPES = [
  { value: "standard", label: "Standard Cleaning" },
  { value: "deep", label: "Deep Cleaning" },
  { value: "move_in_out", label: "Move-In / Move-Out" },
  { value: "post_construction", label: "Post-Construction" },
  { value: "commercial", label: "Commercial / Office" },
  { value: "airbnb", label: "Airbnb / Short-Term Rental" },
]

// These service types skip the bed/bath calculator and go straight to contact form
const REQUEST_ONLY_TYPES = new Set(["commercial", "post_construction", "airbnb"])

const FREQUENCY_OPTIONS = [
  { value: "one_time", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function QuoteCalculator({ source = "homepage" }: { source?: string }) {
  // Step 1 state
  const [bedrooms, setBedrooms] = useState(2)
  const [bathrooms, setBathrooms] = useState(2)
  const [cleaningType, setCleaningType] = useState("standard")
  const [frequency, setFrequency] = useState("one_time")
  const [priceRevealed, setPriceRevealed] = useState(false)

  // Step navigation
  const [step, setStep] = useState(1)

  // Step 2 state
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [notes, setNotes] = useState("")

  const isRequestOnly = REQUEST_ONLY_TYPES.has(cleaningType)

  // Submit state
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  // Animated price counter
  const [displayedPrice, setDisplayedPrice] = useState(0)
  const animFrameRef = useRef<number | null>(null)

  const estimatedPrice = isRequestOnly ? 0 : calculatePrice(cleaningType, bedrooms, bathrooms, frequency)

  // Reveal the price section once all step-1 fields have a selection
  useEffect(() => {
    if (!isRequestOnly && bedrooms && bathrooms && cleaningType && frequency) {
      setPriceRevealed(true)
    }
  }, [bedrooms, bathrooms, cleaningType, frequency, isRequestOnly])

  // Animate the price number when it changes
  useEffect(() => {
    if (!priceRevealed) return
    const start = displayedPrice
    const end = estimatedPrice
    if (start === end) return

    const duration = 400 // ms
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress)
      const current = Math.round(start + (end - start) * eased)
      setDisplayedPrice(roundToNearest5(current))
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        setDisplayedPrice(end)
      }
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimatedPrice, priceRevealed])

  // ------- Handlers -------

  function goToStep2() {
    setStep(2)
  }

  function goToStep1() {
    setStep(1)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus("submitting")
    setErrorMsg("")

    const payload = {
      name,
      phone,
      email: email || undefined,
      service_type: cleaningType,
      ...(isRequestOnly
        ? { message: notes || undefined }
        : { bedrooms, bathrooms, frequency, estimated_price: estimatedPrice }),
      source: source === "homepage" ? "quote_calculator" : `quote_calculator_${source}`,
    }

    try {
      const res = await fetch("/api/webhooks/website/spotless-scrubbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error("Failed to submit")

      setStatus("success")
      trackLead(source)
      trackFormSubmit("quote_calculator")
    } catch {
      setStatus("error")
      setErrorMsg("Something went wrong. Please call us at (319) 826-4311 or try again.")
    }
  }

  // Discount label for the selected frequency
  const discountPct = FREQUENCY_DISCOUNTS[frequency]
  const discountLabel = discountPct ? `${Math.round(discountPct * 100)}% off` : null

  // ------- Success state -------
  if (status === "success") {
    return (
      <div className="w-full max-w-lg mx-auto rounded-2xl bg-white shadow-xl p-8 text-center">
        {/* Animated checkmark */}
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 animate-[scaleIn_0.4s_ease-out]">
          <svg
            className="h-10 w-10 text-emerald-600 animate-[drawCheck_0.5s_ease-out_0.3s_both]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
              style={{
                strokeDasharray: 24,
                strokeDashoffset: 0,
              }}
            />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re All Set!</h3>
        <p className="text-slate-600 mb-1">
          {isRequestOnly
            ? "We'll reach out shortly with a custom quote for your project."
            : "We'll call you within the hour to confirm your cleaning."}
        </p>
        {!isRequestOnly && (
          <p className="text-sm text-slate-500">
            Your estimated price: <span className="font-semibold text-[#2195b4]">${estimatedPrice}</span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg mx-auto rounded-2xl bg-white shadow-xl overflow-hidden">
      {/* ---- Progress bar ---- */}
      <div className="px-6 pt-6 pb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-500">
            Step {step} of 2
          </span>
          <span className="text-xs text-slate-400">
            {step === 1 ? (isRequestOnly ? "Service Details" : "Home Details") : "Contact Info"}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#2195b4] transition-all duration-500 ease-out"
            style={{ width: step === 1 ? "50%" : "100%" }}
          />
        </div>
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mt-3">
          <div
            className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
              step >= 1 ? "bg-[#2195b4]" : "bg-slate-200"
            }`}
          />
          <div
            className={`h-2.5 w-2.5 rounded-full transition-colors duration-300 ${
              step >= 2 ? "bg-[#2195b4]" : "bg-slate-200"
            }`}
          />
        </div>
      </div>

      {/* ---- Step 1: Home Details ---- */}
      <div
        className={`transition-all duration-400 ease-out ${
          step === 1
            ? "opacity-100 translate-x-0 h-auto px-6 pb-6"
            : "opacity-0 -translate-x-8 h-0 overflow-hidden px-6 pb-0"
        }`}
      >
        {/* Cleaning Type — always shown */}
        <div className="mt-4">
          <label htmlFor="qc-cleaning-type" className="block text-sm font-semibold text-slate-700 mb-2">
            Cleaning Type
          </label>
          <select
            id="qc-cleaning-type"
            value={cleaningType}
            onChange={(e) => setCleaningType(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent bg-white appearance-none"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 12px center",
            }}
          >
            {CLEANING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {isRequestOnly ? (
          <>
            {/* Request-only: show message + notes instead of bed/bath */}
            <div className="mt-6 rounded-xl bg-gradient-to-r from-[#2195b4]/5 to-[#2195b4]/10 border border-[#2195b4]/20 p-5 text-center">
              <p className="text-sm font-medium text-slate-700 mb-1">Custom Quote</p>
              <p className="text-sm text-slate-500">
                Tell us about the job and we&apos;ll get back to you within the hour with a personalized quote.
              </p>
            </div>

            <div className="mt-4">
              <label htmlFor="qc-notes" className="block text-sm font-semibold text-slate-700 mb-2">
                Tell us about the job <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                id="qc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Approximate size, timeline, any special requirements..."
                rows={3}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm resize-none"
              />
            </div>

            <button
              type="button"
              onClick={goToStep2}
              className="mt-5 w-full px-6 py-3.5 rounded-xl bg-[#2195b4] text-white font-semibold text-base hover:bg-[#1a7a94] active:bg-[#155f73] transition-colors shadow-lg shadow-[#2195b4]/20"
            >
              Request a Quote
            </button>
          </>
        ) : (
        <>
        {/* Bedrooms */}
        <fieldset className="mt-4">
          <legend className="block text-sm font-semibold text-slate-700 mb-2">Bedrooms</legend>
          <div className="flex flex-wrap gap-2">
            {BEDROOM_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBedrooms(n)}
                className={`h-10 w-12 rounded-lg text-sm font-medium transition-all duration-200 border ${
                  bedrooms === n
                    ? "bg-[#2195b4] text-white border-[#2195b4] shadow-md shadow-[#2195b4]/25"
                    : "bg-white text-slate-700 border-slate-200 hover:border-[#2195b4] hover:text-[#2195b4]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Bathrooms */}
        <fieldset className="mt-5">
          <legend className="block text-sm font-semibold text-slate-700 mb-2">Bathrooms</legend>
          <div className="flex flex-wrap gap-2">
            {BATHROOM_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setBathrooms(n)}
                className={`h-10 w-12 rounded-lg text-sm font-medium transition-all duration-200 border ${
                  bathrooms === n
                    ? "bg-[#2195b4] text-white border-[#2195b4] shadow-md shadow-[#2195b4]/25"
                    : "bg-white text-slate-700 border-slate-200 hover:border-[#2195b4] hover:text-[#2195b4]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Frequency */}
        <fieldset className="mt-5">
          <legend className="block text-sm font-semibold text-slate-700 mb-2">Frequency</legend>
          <div className="grid grid-cols-2 gap-2">
            {FREQUENCY_OPTIONS.map((f) => {
              const disc = FREQUENCY_DISCOUNTS[f.value]
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFrequency(f.value)}
                  className={`relative px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border ${
                    frequency === f.value
                      ? "bg-[#2195b4] text-white border-[#2195b4] shadow-md shadow-[#2195b4]/25"
                      : "bg-white text-slate-700 border-slate-200 hover:border-[#2195b4] hover:text-[#2195b4]"
                  }`}
                >
                  {f.label}
                  {disc > 0 && (
                    <span
                      className={`block text-xs mt-0.5 ${
                        frequency === f.value ? "text-teal-100" : "text-emerald-600"
                      }`}
                    >
                      Save {Math.round(disc * 100)}%
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* ---- Price reveal ---- */}
        <div
          className={`mt-6 rounded-xl bg-gradient-to-r from-[#2195b4]/5 to-[#2195b4]/10 border border-[#2195b4]/20 p-5 text-center transition-all duration-500 ${
            priceRevealed
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 translate-y-4 scale-95"
          }`}
        >
          <p className="text-sm text-slate-500 mb-1">Your Estimate</p>
          <p className="text-4xl font-bold text-[#2195b4] tabular-nums">
            ${displayedPrice}
          </p>
          {discountLabel && (
            <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
              {discountLabel} with {FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.label.toLowerCase()} service
            </span>
          )}
        </div>

        {/* Next step */}
        <button
          type="button"
          onClick={goToStep2}
          disabled={!priceRevealed}
          className="mt-5 w-full px-6 py-3.5 rounded-xl bg-[#2195b4] text-white font-semibold text-base hover:bg-[#1a7a94] active:bg-[#155f73] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#2195b4]/20"
        >
          Get My Quote
        </button>
        </>
        )}
      </div>

      {/* ---- Step 2: Contact info ---- */}
      <div
        className={`transition-all duration-400 ease-out ${
          step === 2
            ? "opacity-100 translate-x-0 h-auto px-6 pb-6"
            : "opacity-0 translate-x-8 h-0 overflow-hidden px-6 pb-0"
        }`}
      >
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Recap */}
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">
                {CLEANING_TYPES.find((t) => t.value === cleaningType)?.label}
              </span>
              {!isRequestOnly && (
                <>
                  <span className="mx-1">-</span>
                  {bedrooms} bed, {bathrooms} bath
                  <span className="mx-1">-</span>
                  {FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.label}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={goToStep1}
              className="text-xs text-[#2195b4] font-medium hover:underline flex-shrink-0 ml-2"
            >
              Edit
            </button>
          </div>

          {/* Price summary — only for calculator types */}
          {!isRequestOnly && (
            <div className="text-center py-2">
              <p className="text-sm text-slate-500">Estimated Price</p>
              <p className="text-3xl font-bold text-[#2195b4]">${estimatedPrice}</p>
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="qc-name" className="block text-sm font-medium text-slate-700 mb-1">
              Name *
            </label>
            <input
              id="qc-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
            />
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="qc-phone" className="block text-sm font-medium text-slate-700 mb-1">
              Phone *
            </label>
            <input
              id="qc-phone"
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="qc-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="qc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2195b4] focus:border-transparent text-sm"
            />
          </div>

          {status === "error" && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{errorMsg}</p>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={status === "submitting"}
            className="w-full px-6 py-3.5 rounded-xl bg-[#2195b4] text-white font-semibold text-base hover:bg-[#1a7a94] active:bg-[#155f73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#2195b4]/20"
          >
            {status === "submitting" ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Booking...
              </span>
            ) : (
              "Book My Cleaning"
            )}
          </button>

          {/* Back */}
          <button
            type="button"
            onClick={goToStep1}
            className="w-full text-center text-sm text-slate-500 hover:text-[#2195b4] transition-colors py-1"
          >
            Back to home details
          </button>
        </form>
      </div>
    </div>
  )
}
