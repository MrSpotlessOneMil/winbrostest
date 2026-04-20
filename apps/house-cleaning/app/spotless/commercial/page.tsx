import type { Metadata } from "next"
import { BookingForm } from "@/components/marketing/booking-form"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"

export const metadata: Metadata = {
  title: "Office Cleaning in LA | Spotless Scrubbers",
  description:
    "Reliable commercial and office cleaning across LA County. Weekly, biweekly, or nightly service. Same team every visit, never a no-show. 5.0 stars, insured and bonded.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Office Cleaning in LA | Spotless Scrubbers",
    description:
      "Weekly office cleaning, one flat price, never a no-show. Same crew every visit. 5.0 stars across LA County.",
  },
}

const KEY_POINTS = [
  {
    title: "Never a No-Show",
    description: "The biggest problem with cleaners is they cancel. We don't. Same crew, same schedule, every visit.",
  },
  {
    title: "One Flat Price",
    description: "No per-service nickel-and-diming. Clear weekly or biweekly pricing based on your sqft. No surprises.",
  },
  {
    title: "After-Hours Available",
    description: "We clean when you're closed. Evening and weekend slots available so your team walks into a fresh office every morning.",
  },
  {
    title: "Fully Insured & Bonded",
    description: "Commercial liability insurance. Background-checked team. All supplies and equipment included.",
  },
]

const PAIN_POINTS = [
  {
    headline: "Stop chasing cleaners who ghost",
    body: "Most commercial cleaning companies rotate teams, cancel last minute, or send someone new every week. Your office deserves a real team you can count on.",
  },
  {
    headline: "A clean office is a working office",
    body: "Sick days spike when offices go uncleaned. Client impressions tank. Your team deserves a professional space, and your clients notice the details.",
  },
]

const INCLUDED_ITEMS = [
  "Desk and workstation sanitizing",
  "Common area and breakroom cleaning",
  "Restroom deep cleaning and restocking",
  "Floor vacuuming, mopping, and buffing",
  "Trash and recycling removal",
  "Window and glass partition cleaning",
  "Kitchen and breakroom appliance cleaning",
  "Reception and lobby maintenance",
  "Light fixture and vent dusting",
  "Door handle and touch-point sanitizing",
]

const TESTIMONIALS = [
  {
    quote:
      "We switched to Spotless after our old cleaners no-showed three times in a month. Six months in and the team has never missed a visit. Our office looks immaculate every Monday.",
    name: "Office Manager",
    city: "West LA",
  },
  {
    quote:
      "Professional, thorough, and on time. The restrooms are hotel-clean and the breakroom actually smells good now. Easy decision to go biweekly.",
    name: "Small Business Owner",
    city: "Culver City",
  },
  {
    quote:
      "I don't think about cleaning anymore. It just happens, the office is always ready, and the invoice is the same every month. Exactly what I wanted.",
    name: "Practice Administrator",
    city: "Santa Monica",
  },
]

const FAQS = [
  {
    question: "How is commercial pricing structured?",
    answer:
      "Flat monthly rate based on your square footage and frequency (weekly, biweekly, or monthly). No hidden fees, no per-service charges. We quote once, you pay the same every month.",
  },
  {
    question: "Can you clean after hours?",
    answer:
      "Yes. Most of our commercial clients prefer evening or early-morning service so we're out of your way. We can work around your business hours.",
  },
  {
    question: "Do you bring supplies?",
    answer:
      "We bring all professional cleaning supplies and equipment. We can also restock your office essentials (paper products, hand soap, etc.) if you want — just let us know.",
  },
  {
    question: "Is there a contract?",
    answer:
      "Month-to-month only. No long-term contracts. If we're not the right fit, you can cancel with 30 days notice. We'd rather earn your business every month than lock you in.",
  },
  {
    question: "Are you insured?",
    answer:
      "Yes — commercial general liability insurance and bonded team. Certificate of insurance available on request for property managers or landlords.",
  },
  {
    question: "Do you handle medical or dental offices?",
    answer:
      "Yes. We follow standard sanitization protocols for healthcare environments. Let us know about any specific compliance requirements during the quote and we'll make sure our process matches.",
  },
]

export default function CommercialPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative bg-[#164E63] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#164E63] via-[#155f73] to-[#1a7a94] opacity-90" />

        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 text-xs font-semibold uppercase tracking-wide mb-4">
                For Office Managers & Small Businesses
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4 font-heading">
                Weekly Office Cleaning.{" "}
                <span className="text-amber-300">One Flat Price.</span>
              </h1>
              <p className="text-lg text-slate-200 mb-2">
                Same team every visit. Never a no-show. Your office, professionally clean.
              </p>
              <p className="text-sm text-slate-300 mb-6">
                Flexible scheduling across LA County. Insured and bonded. Quote in minutes.
              </p>

              <a
                href="#get-pricing"
                className="inline-block lg:hidden px-8 py-3.5 bg-amber-400 text-slate-900 font-bold rounded-lg text-base hover:bg-amber-300 transition-colors shadow-lg"
              >
                Get Office Pricing
              </a>

              <div className="flex flex-wrap gap-4 mt-8 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-400">&#9733;</span> 5.0 Stars
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> Insured & Bonded
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> After-Hours Available
                </span>
              </div>
            </div>

            <div id="get-pricing" className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
              <div className="text-center mb-5">
                <p className="text-sm text-slate-500 mb-1">COMMERCIAL & OFFICE CLEANING</p>
                <p className="text-lg font-semibold text-slate-800">Get your custom quote</p>
              </div>
              <BookingForm source="meta" preselectedService="commercial-cleaning" ctaLabel="Get Office Pricing" />
            </div>
          </div>
        </div>
      </section>

      <TrustBar />

      {/* Pain points */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-3xl mx-auto space-y-10">
          {PAIN_POINTS.map((point) => (
            <div key={point.headline} className="text-center">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 font-heading">
                {point.headline}
              </h2>
              <p className="text-slate-600 leading-relaxed max-w-2xl mx-auto">
                {point.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Key points */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Why LA businesses choose us
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            Built for Offices That Just Want It Done
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {KEY_POINTS.map((point) => (
              <div
                key={point.title}
                className="bg-white rounded-xl p-6 shadow-sm border border-slate-100"
              >
                <h3 className="text-lg font-bold text-[#2195b4] mb-2 font-heading">
                  {point.title}
                </h3>
                <p className="text-sm text-slate-600">{point.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Included */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Every visit includes
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3 font-heading">
            Top to Bottom, Every Time
          </h2>
          <p className="text-center text-slate-500 mb-10 max-w-lg mx-auto">
            A thorough clean so your team walks into a fresh office every morning.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {INCLUDED_ITEMS.map((item) => (
              <div key={item} className="flex items-start gap-3 py-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xs font-bold mt-0.5">
                  &#10003;
                </span>
                <span className="text-sm text-slate-700">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Real reviews
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            What LA Businesses Say
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name + t.city}
                className="bg-white rounded-xl p-6 border border-slate-100"
              >
                <div className="flex gap-0.5 mb-3 text-amber-400 text-sm">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i}>&#9733;</span>
                  ))}
                </div>
                <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.city}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <HowItWorks />

      {/* FAQ */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Common questions
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            Frequently Asked Questions
          </h2>

          <div className="space-y-4">
            {FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group bg-slate-50 rounded-xl border border-slate-200 overflow-hidden"
              >
                <summary className="flex items-center justify-between cursor-pointer px-6 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition-colors">
                  {faq.question}
                  <span className="text-slate-400 group-open:rotate-45 transition-transform text-lg ml-4">
                    +
                  </span>
                </summary>
                <div className="px-6 pb-4 text-sm text-slate-600 leading-relaxed">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16 px-4 bg-[#164E63]">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-3 font-heading">
            Ready to stop worrying about the cleaning?
          </h2>
          <p className="text-slate-300 mb-8">
            Get your custom office cleaning quote. Takes 60 seconds. No obligation.
          </p>

          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 text-left">
            <BookingForm source="meta" preselectedService="commercial-cleaning" ctaLabel="Get Office Pricing" />
          </div>

          <p className="text-xs text-slate-400 mt-6">
            Or call us directly:{" "}
            <a href="tel:+14246771146" className="text-amber-300 hover:underline">
              (424) 677-1146
            </a>
          </p>
        </div>
      </section>

      <div className="h-20 md:hidden" />
    </>
  )
}
