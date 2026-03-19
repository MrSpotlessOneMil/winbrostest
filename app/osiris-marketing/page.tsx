"use client"

import { useState, type FormEvent } from "react"

// ---------------------------------------------------------------------------
// Demo Request Form
// ---------------------------------------------------------------------------
function DemoRequestForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus("submitting")
    setErrorMsg("")

    const form = e.currentTarget
    const data = {
      name: (form.elements.namedItem("name") as HTMLInputElement).value.trim(),
      email: (form.elements.namedItem("email") as HTMLInputElement).value.trim(),
      phone: (form.elements.namedItem("phone") as HTMLInputElement).value.trim(),
      business_name: (form.elements.namedItem("business_name") as HTMLInputElement).value.trim(),
      company_size: (form.elements.namedItem("company_size") as HTMLSelectElement).value,
      message: (form.elements.namedItem("message") as HTMLTextAreaElement).value.trim(),
    }

    try {
      const res = await fetch("/api/marketing/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Request failed" }))
        throw new Error(body.error || "Request failed")
      }

      setStatus("success")
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.")
      setStatus("error")
    }
  }

  if (status === "success") {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 border-2 border-[#2195b4] flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#2195b4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="square" strokeLinejoin="miter" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Demo Request Received</h3>
        <p className="text-gray-400">
          We&apos;ll be in touch within 24 hours to schedule your personalized demo.
        </p>
      </div>
    )
  }

  const inputClasses =
    "w-full border border-gray-800 bg-gray-900 px-4 py-3 text-white placeholder:text-gray-600 focus:border-[#2195b4] focus:outline-none transition-colors text-sm"

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="name" className="block text-sm text-gray-400 mb-1.5">
            Full Name *
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            placeholder="John Smith"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="business_name" className="block text-sm text-gray-400 mb-1.5">
            Business Name
          </label>
          <input
            id="business_name"
            name="business_name"
            type="text"
            placeholder="Acme Cleaning Co."
            className={inputClasses}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="phone" className="block text-sm text-gray-400 mb-1.5">
            Phone *
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            placeholder="(555) 123-4567"
            className={inputClasses}
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm text-gray-400 mb-1.5">
            Email *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="john@company.com"
            className={inputClasses}
          />
        </div>
      </div>

      <div>
        <label htmlFor="company_size" className="block text-sm text-gray-400 mb-1.5">
          Company Size
        </label>
        <select id="company_size" name="company_size" className={inputClasses}>
          <option value="">Select team size</option>
          <option value="1-5">1 - 5 employees</option>
          <option value="6-20">6 - 20 employees</option>
          <option value="21-50">21 - 50 employees</option>
          <option value="50+">50+ employees</option>
        </select>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm text-gray-400 mb-1.5">
          Message
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          placeholder="Tell us about your business..."
          className={inputClasses}
        />
      </div>

      {status === "error" && (
        <p className="text-red-400 text-sm">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full bg-[#2195b4] px-6 py-3 text-white font-medium hover:bg-[#1a7a94] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
      >
        {status === "submitting" ? "Submitting..." : "Book My Demo"}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function OsirisMarketingPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-gray-950 py-32 sm:py-40">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
            Stop Losing Leads.
            <br />
            Start Booking Jobs.
          </h1>
          <p className="mt-6 text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Osiris automates the chaos of running a cleaning business — from the first missed call
            to the last unpaid invoice. AI phone answering, automated follow-ups, scheduling,
            dispatch, and payments. All in one place.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="#demo"
              className="inline-block bg-[#2195b4] px-8 py-3.5 text-white font-medium hover:bg-[#1a7a94] transition-colors text-sm"
            >
              Book a Demo
            </a>
            <a
              href="#how-it-works"
              className="inline-block border border-gray-700 px-8 py-3.5 text-gray-300 font-medium hover:border-gray-500 hover:text-white transition-colors text-sm"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* ── Explainer Video ─────────────────────────────────────────── */}
      <section className="bg-gray-950 py-20 border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">
            See how Osiris works
          </h2>
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src="https://www.youtube.com/embed/9gVtLSjkXMM"
              title="How Osiris Works"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      {/* ── Problem ───────────────────────────────────────────────────── */}
      <section className="bg-gray-900 py-24 border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Running a cleaning business shouldn&apos;t feel like this.
          </h2>
          <p className="text-gray-400 mb-12">
            You started a cleaning company, not a call center. But here you are.
          </p>

          <ul className="space-y-6">
            {[
              {
                title: "Missed calls, missed money",
                desc: "A lead calls at 2pm while you're on a job. By the time you call back, they've booked someone else. That's $200+ gone.",
              },
              {
                title: "Follow-ups that never happen",
                desc: "You meant to text that quote back. It's been three days. They're not waiting around.",
              },
              {
                title: "No-show cleaners",
                desc: "Your cleaner didn't confirm. The customer is home waiting. You're scrambling to find a replacement.",
              },
              {
                title: "Chasing payments",
                desc: "The job is done but you're still sending invoices, texting reminders, and hoping checks clear.",
              },
              {
                title: "Scheduling by spreadsheet",
                desc: "Copy-pasting addresses, texting times, double-booking Fridays. There has to be a better way.",
              },
            ].map((item) => (
              <li key={item.title} className="border-l-2 border-gray-700 pl-6">
                <h3 className="text-white font-medium mb-1">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────────────────── */}
      <section id="how-it-works" className="bg-gray-950 py-24 border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            How Osiris Works
          </h2>
          <p className="text-gray-400 mb-12">
            Four steps. Fully automated. You focus on cleaning, Osiris handles the rest.
          </p>

          <ol className="space-y-10">
            {[
              {
                step: "01",
                title: "A lead comes in",
                desc: "Phone call, web form, Facebook ad, Google, referral — doesn't matter. Osiris captures it instantly from any channel.",
              },
              {
                step: "02",
                title: "AI qualifies and follows up",
                desc: "Our AI phone agent answers the call, collects job details, and sends an automated SMS follow-up. No lead sits untouched for more than 2 minutes.",
              },
              {
                step: "03",
                title: "Job gets scheduled and dispatched",
                desc: "Osiris matches the job to an available cleaner based on location and availability. The cleaner gets a Telegram notification and confirms with one tap.",
              },
              {
                step: "04",
                title: "Payment collected automatically",
                desc: "Deposit charged at booking. Final payment collected after the job. Stripe handles everything. You just see the money hit your account.",
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-6">
                <span className="text-[#2195b4] font-mono text-sm font-bold mt-1 shrink-0">
                  {item.step}
                </span>
                <div>
                  <h3 className="text-white font-medium mb-1">{item.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────── */}
      <section className="bg-gray-900 py-24 border-t border-gray-800">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-12">
            Everything you need to run your cleaning business
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-800">
            {[
              {
                title: "AI Phone Agent",
                desc: "Answers every call 24/7. Qualifies leads, collects job details, and books appointments — powered by VAPI.",
              },
              {
                title: "Smart SMS Follow-Up",
                desc: "Automated text sequences via OpenPhone. Quote reminders, booking confirmations, review requests. No lead goes cold.",
              },
              {
                title: "Auto-Scheduling",
                desc: "Drag-and-drop calendar with intelligent matching. Jobs assigned based on location, cleaner availability, and workload.",
              },
              {
                title: "Cleaner Dispatch",
                desc: "Job details sent to cleaners via Telegram. One-tap accept. Real-time status updates. No app download required.",
              },
              {
                title: "Payments",
                desc: "Stripe-powered deposits at booking, final charges on completion. Automated invoicing. No more chasing checks.",
              },
              {
                title: "Lifecycle Campaigns",
                desc: "Post-job review requests, seasonal re-engagement, and win-back campaigns. Your past customers keep coming back.",
              },
            ].map((feature) => (
              <div key={feature.title} className="bg-gray-900 p-8">
                <h3 className="text-white font-medium mb-2">{feature.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Results ───────────────────────────────────────────────────── */}
      <section className="bg-gray-950 py-24 border-t border-gray-800">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-12">
            Osiris by the numbers
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-gray-800">
            {[
              { value: "2,500+", label: "Jobs managed" },
              { value: "3", label: "Cleaning companies on Osiris" },
              { value: "< 2 min", label: "Avg response time to new leads" },
            ].map((stat) => (
              <div key={stat.label} className="bg-gray-950 p-8 text-center">
                <div className="text-3xl font-bold text-[#2195b4] mb-2">{stat.value}</div>
                <div className="text-gray-500 text-sm">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────── */}
      <section className="bg-gray-900 py-24 border-t border-gray-800">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4">
            Simple pricing
          </h2>
          <p className="text-gray-400 leading-relaxed mb-2">
            Custom pricing based on your business size. Most cleaning companies pay{" "}
            <span className="text-white font-medium">$200 - $500/mo</span>.
          </p>
          <p className="text-gray-500 text-sm mb-10">
            No setup fees. No long-term contracts. Book a demo to get your quote.
          </p>
          <a
            href="#demo"
            className="inline-block bg-[#2195b4] px-8 py-3.5 text-white font-medium hover:bg-[#1a7a94] transition-colors text-sm"
          >
            Get a Quote
          </a>
        </div>
      </section>

      {/* ── Demo Form ─────────────────────────────────────────────────── */}
      <section id="demo" className="bg-gray-950 py-24 border-t border-gray-800 scroll-mt-16">
        <div className="max-w-lg mx-auto px-6">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
              Book a demo
            </h2>
            <p className="text-gray-400 text-sm">
              15 minutes. No commitment. We&apos;ll show you exactly how Osiris
              would work for your business.
            </p>
          </div>

          <div className="border border-gray-800 bg-gray-900 p-8">
            <DemoRequestForm />
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────────── */}
      <section className="bg-gray-900 py-20 border-t border-gray-800">
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Your competitors are already automating. Are you?
          </h2>
          <p className="text-gray-500 text-sm mb-8">
            Every missed call is revenue walking to the next cleaning company on Google.
          </p>
          <a
            href="#demo"
            className="inline-block bg-[#2195b4] px-8 py-3.5 text-white font-medium hover:bg-[#1a7a94] transition-colors text-sm"
          >
            Book a Demo
          </a>
        </div>
      </section>
    </>
  )
}
