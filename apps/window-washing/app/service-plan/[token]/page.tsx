"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { CheckCircle, Loader2, AlertTriangle, Calendar, DollarSign } from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────

interface ServicePlanData {
  id: number
  plan_type: string
  service_months: number[]
  plan_price: number
  normal_price: number | null
  status: string
  first_service_date: string | null
  signed_at: string | null
  customer: {
    first_name: string | null
    last_name: string | null
    phone_number: string | null
    address: string | null
  }
  tenant: {
    name: string
    slug: string
    phone: string | null
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const PLAN_TYPE_LABELS: Record<string, string> = {
  quarterly: "Quarterly",
  triannual: "Triannual",
  triannual_exterior: "Triannual Exterior",
  monthly: "Monthly",
  biannual: "Biannual",
}

function getVisitsPerYear(planType: string): number {
  switch (planType) {
    case "quarterly": return 4
    case "triannual": case "triannual_exterior": return 3
    case "monthly": return 12
    case "biannual": return 2
    default: return 1
  }
}

function fmtCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

// ── Component ────────────────────────────────────────────────────────

export default function ServicePlanSigningPage() {
  const params = useParams()
  const token = params.token as string

  const [plan, setPlan] = useState<ServicePlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Signing form state
  const [signatureName, setSignatureName] = useState("")
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signed, setSigned] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  const fetchPlan = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`/api/service-plans/sign?planId=${token}`)
      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.error || "Plan not found")
        return
      }

      setPlan(data.plan)

      // If already signed, show confirmation
      if (data.plan.status === "active" && data.plan.signed_at) {
        setSigned(true)
      }
    } catch {
      setError("Failed to load service plan")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchPlan()
  }, [token, fetchPlan])

  const handleSign = async () => {
    if (!signatureName.trim() || !agreedToTerms) return

    setSigning(true)
    setSignError(null)

    try {
      const res = await fetch("/api/service-plans/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: token,
          signature_name: signatureName.trim(),
          agreed_to_terms: agreedToTerms,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.success) {
        setSignError(data.error || "Failed to sign agreement")
        return
      }

      setSigned(true)
    } catch {
      setSignError("Something went wrong. Please try again.")
    } finally {
      setSigning(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <Loader2 className="size-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading service agreement...</p>
        </div>
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────

  if (error || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="size-10 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Plan Not Found</h2>
          <p className="text-slate-500 text-sm">
            {error || "This service plan link may be invalid or expired."}
          </p>
        </div>
      </div>
    )
  }

  // ── Signed Confirmation ──────────────────────────────────────────

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="text-center max-w-sm">
          <div className="size-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="size-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Agreement Signed</h2>
          <p className="text-slate-600 text-sm mb-6">
            Your service plan is now active. We&apos;ll be in touch to schedule your first visit!
          </p>
          <div className="bg-slate-50 rounded-lg p-4 text-left text-sm">
            <p className="text-slate-500 mb-1">Plan</p>
            <p className="font-medium text-slate-800">
              {PLAN_TYPE_LABELS[plan.plan_type] || plan.plan_type} &mdash; {fmtCurrency(plan.plan_price)}/visit
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Plan details ─────────────────────────────────────────────────

  const visitsPerYear = getVisitsPerYear(plan.plan_type)
  const totalAnnualValue = plan.plan_price * visitsPerYear
  const customerName = [plan.customer?.first_name, plan.customer?.last_name].filter(Boolean).join(" ") || "Valued Customer"
  const todayFormatted = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <div className="size-10 rounded-lg bg-blue-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">W</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">{plan.tenant?.name || "WinBros"}</h1>
            <p className="text-xs text-slate-500">Window Cleaning Services</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Title */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-800">Service Agreement</h2>
          <p className="text-slate-500 text-sm mt-1">
            Prepared for {customerName}
          </p>
        </div>

        {/* Plan Summary Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-blue-600 px-5 py-3">
            <h3 className="text-white font-semibold text-sm uppercase tracking-wider">
              {PLAN_TYPE_LABELS[plan.plan_type] || plan.plan_type} Service Plan
            </h3>
          </div>
          <div className="p-5 space-y-4">
            {/* Price per visit */}
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <DollarSign className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Price per visit</p>
                <p className="text-lg font-bold text-slate-800">{fmtCurrency(plan.plan_price)}</p>
              </div>
            </div>

            {/* Service months */}
            <div className="flex items-start gap-3">
              <div className="size-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 mt-0.5">
                <Calendar className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500">Service months ({visitsPerYear} visits/year)</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {plan.service_months.map((m) => (
                    <span
                      key={m}
                      className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full"
                    >
                      {MONTH_NAMES[m - 1]}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Total annual value */}
            <div className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-slate-600">Total annual value</span>
              <span className="font-bold text-slate-800">{fmtCurrency(totalAnnualValue)}</span>
            </div>

            {plan.first_service_date && (
              <div className="text-sm text-slate-500">
                First service: <span className="font-medium text-slate-700">{fmtDate(plan.first_service_date)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Agreement Terms */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h3 className="font-semibold text-slate-800 mb-3">Terms &amp; Conditions</h3>
          <div className="text-sm text-slate-600 space-y-3 leading-relaxed">
            <p>
              This Service Agreement (&quot;Agreement&quot;) is entered into between{" "}
              <span className="font-medium text-slate-800">{plan.tenant?.name || "WinBros"}</span>{" "}
              (&quot;Service Provider&quot;) and{" "}
              <span className="font-medium text-slate-800">{customerName}</span>{" "}
              (&quot;Customer&quot;) for recurring window cleaning services.
            </p>
            <p>
              <span className="font-medium text-slate-800">1. Services.</span>{" "}
              The Service Provider agrees to perform professional window cleaning services at the
              Customer&apos;s property during the designated service months listed above. The specific
              service date within each month will be coordinated between the parties.
            </p>
            <p>
              <span className="font-medium text-slate-800">2. Pricing.</span>{" "}
              The Customer agrees to pay {fmtCurrency(plan.plan_price)} per service visit. Payment is
              due upon completion of each service. Total annual value of this agreement
              is {fmtCurrency(totalAnnualValue)}.
            </p>
            <p>
              <span className="font-medium text-slate-800">3. Scheduling.</span>{" "}
              Services will be scheduled during the designated months. The Service Provider will
              contact the Customer to arrange a specific date and time for each visit. The Service
              Provider reserves the right to reschedule due to inclement weather, with services to
              be rescheduled within a reasonable timeframe.
            </p>
            <p>
              <span className="font-medium text-slate-800">4. Cancellation.</span>{" "}
              Either party may cancel this agreement with 30 days written notice. Cancellation
              does not affect payment obligations for services already rendered.
            </p>
            <p>
              <span className="font-medium text-slate-800">5. Satisfaction Guarantee.</span>{" "}
              If the Customer is not satisfied with any service, they must notify the Service
              Provider within 48 hours to arrange a complimentary re-service.
            </p>
            <p>
              <span className="font-medium text-slate-800">6. Access.</span>{" "}
              The Customer agrees to provide reasonable access to the property on scheduled
              service dates and ensure that windows and surrounding areas are accessible for
              cleaning.
            </p>
          </div>
        </div>

        {/* Signature Area */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
          <h3 className="font-semibold text-slate-800">Electronic Signature</h3>

          {/* Typed signature */}
          <div>
            <label htmlFor="signature" className="block text-sm font-medium text-slate-700 mb-1.5">
              Type your full name to sign
            </label>
            <input
              id="signature"
              type="text"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="e.g. John Smith"
              className="w-full px-4 py-3 rounded-lg border border-slate-300 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              autoComplete="name"
            />
            {signatureName.trim() && (
              <div className="mt-2 px-4 py-2 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Signature preview</p>
                <p className="text-lg italic text-slate-800 font-serif">{signatureName}</p>
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <p className="text-sm text-slate-500">Date</p>
            <p className="text-sm font-medium text-slate-800">{todayFormatted}</p>
          </div>

          {/* Agreement checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="mt-0.5 size-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
            />
            <span className="text-sm text-slate-600 leading-snug">
              I have read and agree to the terms and conditions of this service agreement.
            </span>
          </label>

          {/* Error */}
          {signError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {signError}
            </div>
          )}

          {/* Submit button */}
          <button
            onClick={handleSign}
            disabled={!signatureName.trim() || !agreedToTerms || signing}
            className="w-full py-3.5 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors text-base flex items-center justify-center gap-2"
          >
            {signing ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Signing...
              </>
            ) : (
              "Sign Agreement"
            )}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-slate-400 pb-8">
          <p>This electronic signature is legally binding.</p>
          {plan.tenant?.phone && (
            <p className="mt-1">Questions? Call us at {plan.tenant.phone}</p>
          )}
        </div>
      </main>
    </div>
  )
}
