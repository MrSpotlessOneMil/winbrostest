import type { Metadata } from "next"
import { BookingForm } from "@/components/marketing/booking-form"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"

export const metadata: Metadata = {
  title: "Airbnb Turnover Cleaning in LA | Spotless Scrubbers",
  description:
    "Reliable Airbnb turnover cleaning in LA. Same team every time, photo-ready results, same-day availability. Protect your reviews and never clean between guests again.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Airbnb Turnover Cleaning in LA | Spotless Scrubbers",
    description:
      "Professional Airbnb turnover cleaning. Same team, photo-ready results, same-day availability. 5.0 stars across LA County.",
  },
}

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const KEY_POINTS = [
  {
    title: "Same-Day Availability",
    description: "Last-minute checkout? We've got you covered. Our teams are ready when you need them.",
  },
  {
    title: "Consistent Team",
    description: "The same cleaners every time. They learn your property and know exactly what guests expect.",
  },
  {
    title: "Photo-Ready Results",
    description: "Every surface spotless. Beds made. Towels folded. Your listing photos come to life — every turnover.",
  },
  {
    title: "Guest-Ready Every Time",
    description: "Restocked supplies, fresh linens staged, trash out. Your next guest walks into a perfect space.",
  },
]

const PAIN_POINTS = [
  {
    headline: "Stop cleaning between guests yourself",
    body: "You started hosting to earn passive income — not to scrub bathrooms at 11am before a 3pm check-in. Let us handle the turnovers so you can focus on growing your portfolio.",
  },
  {
    headline: "One bad review costs more than a cleaning",
    body: "A single \"not clean\" review tanks your listing ranking and costs you thousands in lost bookings. Professional turnovers protect the asset you've built.",
  },
]

const INCLUDED_ITEMS = [
  "Full kitchen clean & sanitize",
  "All bathrooms scrubbed",
  "Bed linens changed & made",
  "Towels folded & staged",
  "All surfaces wiped & dusted",
  "Floors vacuumed & mopped",
  "Trash out & new liners",
  "Mirrors & glass polished",
  "Supplies check & restock",
  "Lockbox / keypad sanitized",
]

const TESTIMONIALS = [
  {
    quote:
      "I'm a very busy professional who travels a lot for work and hadn't had time to give my home more than a quick surface clean in a while. They came in for a deep clean, and the results were beyond my expectations.",
    name: "Amy Blakeslee",
    city: "Manhattan Beach",
  },
  {
    quote:
      "Sonia was absolutely AMAZING!! She crushed this job and was so kind and easy to work with. I highly recommend this company, but especially Sonia because she does flawless work!",
    name: "Ocean Shapiro",
    city: "Manhattan Beach",
  },
  {
    quote:
      "They have been cleaning my home at their discounted bi-weekly rate for 3 months now and we love their services. They always bring a team and their own supplies. Amazing service!",
    name: "Vommy",
    city: "Los Angeles",
  },
]

const FAQS = [
  {
    question: "How quickly can you turn over my property?",
    answer:
      "Most turnovers take 1.5-2.5 hours depending on property size. We can handle tight windows between checkout and check-in — just let us know your schedule.",
  },
  {
    question: "Can you handle same-day bookings?",
    answer:
      "Yes. We keep availability for last-minute turnovers. Once you're set up with us, just text or call and we'll get a team there.",
  },
  {
    question: "Do you bring your own supplies?",
    answer:
      "We bring all professional-grade cleaning supplies and equipment. We can also restock your guest supplies (toilet paper, soap, etc.) if you keep them on-site.",
  },
  {
    question: "How does pricing work for turnovers?",
    answer:
      "Pricing is based on property size and turnover frequency. High-volume hosts get better rates. Tell us about your property and we'll quote you in minutes.",
  },
  {
    question: "Do I get the same team every time?",
    answer:
      "Yes — consistency is everything for turnovers. The same team learns your property, your linen setup, and your guest expectations. No re-training every visit.",
  },
  {
    question: "What if a guest leaves the place trashed?",
    answer:
      "We handle heavy turnovers too. If a guest leaves a mess beyond normal, we'll let you know the extra scope and take care of it. You'll have documentation for Airbnb's damage claim process.",
  },
]

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AirbnbPage() {
  return (
    <>
      {/* ---- Hero ---- */}
      <section className="relative bg-[#164E63] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#164E63] via-[#155f73] to-[#1a7a94] opacity-90" />

        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 text-xs font-semibold uppercase tracking-wide mb-4">
                For Airbnb Hosts
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4 font-heading">
                Never Clean Between{" "}
                <span className="text-amber-300">Guests Again</span>
              </h1>
              <p className="text-lg text-slate-200 mb-2">
                Professional turnover cleaning that protects your reviews and your time.
              </p>
              <p className="text-sm text-slate-300 mb-6">
                Same team every visit. Same-day availability. Photo-ready every time.
              </p>

              {/* Mobile: scroll to form */}
              <a
                href="#get-pricing"
                className="inline-block lg:hidden px-8 py-3.5 bg-amber-400 text-slate-900 font-bold rounded-lg text-base hover:bg-amber-300 transition-colors shadow-lg"
              >
                Get Turnover Pricing
              </a>

              {/* Trust signals */}
              <div className="flex flex-wrap gap-4 mt-8 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-400">&#9733;</span> 5.0 Stars
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> Insured & Bonded
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> Same-Day Available
                </span>
              </div>
            </div>

            {/* Right: Form */}
            <div id="get-pricing" className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
              <div className="text-center mb-5">
                <p className="text-sm text-slate-500 mb-1">AIRBNB TURNOVER CLEANING</p>
                <p className="text-lg font-semibold text-slate-800">Get your custom quote</p>
              </div>
              <BookingForm source="meta" preselectedService="airbnb-cleaning" ctaLabel="Get Turnover Pricing" />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Trust Bar ---- */}
      <TrustBar />

      {/* ---- Pain Points ---- */}
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

      {/* ---- Key Points ---- */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Why hosts choose us
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            Built for Hosts, Not Homeowners
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

      {/* ---- What's Included ---- */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Every turnover includes
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3 font-heading">
            Guest-Ready, Every Time
          </h2>
          <p className="text-center text-slate-500 mb-10 max-w-lg mx-auto">
            A complete turnover so your next guest walks into a perfect space.
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

      {/* ---- Social Proof ---- */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Real reviews
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            What Our Clients Say
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
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

      {/* ---- How It Works ---- */}
      <HowItWorks />

      {/* ---- FAQ ---- */}
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

      {/* ---- Final CTA ---- */}
      <section className="py-16 px-4 bg-[#164E63]">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-3 font-heading">
            Ready to stop cleaning between guests?
          </h2>
          <p className="text-slate-300 mb-8">
            Get your custom turnover pricing. Takes 60 seconds. No obligation.
          </p>

          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 text-left">
            <BookingForm source="meta" preselectedService="airbnb-cleaning" ctaLabel="Get Turnover Pricing" />
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
