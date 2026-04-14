import type { Metadata } from "next"
import { BookingForm } from "@/components/marketing/booking-form"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"

export const metadata: Metadata = {
  title: "Professional House Cleaning in LA | Spotless Scrubbers",
  description:
    "LA's most trusted house cleaning service. Licensed, insured, background-checked teams. Standard, deep, and move-in/out cleaning. 5.0 stars, 2,500+ homes cleaned.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Professional House Cleaning in LA | Spotless Scrubbers",
    description:
      "Licensed, insured, background-checked cleaning teams. 5.0 stars across LA County. Get a free quote in 60 seconds.",
  },
}

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const PRICING_TIERS = [
  {
    name: "Standard Clean",
    from: "$150",
    description: "Regular maintenance cleaning — kitchen, bathrooms, bedrooms, floors, surfaces.",
    features: ["All rooms cleaned", "Kitchen & bathrooms", "Dusting & vacuuming", "Mopping all floors"],
  },
  {
    name: "Deep Clean",
    from: "$250",
    description: "Top-to-bottom deep clean including appliances, baseboards, and hard-to-reach areas.",
    features: ["Everything in Standard", "Inside fridge & oven", "Baseboards throughout", "Ceiling fans & fixtures"],
    highlighted: true,
  },
  {
    name: "Move-In / Move-Out",
    from: "$295",
    description: "Get your deposit back or start fresh. Inside cabinets, appliances, every surface.",
    features: ["Everything in Deep", "Inside all cabinets", "Window tracks cleaned", "Garage sweep available"],
  },
]

const TRUST_POINTS = [
  {
    title: "Licensed & Insured",
    description: "Fully licensed, insured, and bonded. Your home is protected — every visit.",
  },
  {
    title: "Background-Checked",
    description: "Every cleaner passes a thorough background check before they ever enter a home.",
  },
  {
    title: "100% Satisfaction",
    description: "Not happy? We come back and redo it free. Still not right? You don't pay. Period.",
  },
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
    question: "How does pricing work?",
    answer:
      "Pricing is based on your home size and the type of clean. We give you an instant quote after you tell us your bedrooms and bathrooms. No hidden fees, no surprises.",
  },
  {
    question: "What if I'm not happy with the clean?",
    answer:
      "We'll come back and redo it — free. If we still can't get it right, you don't pay. Period. We've been doing this for years and our 5.0 rating speaks for itself.",
  },
  {
    question: "Do I need to be home?",
    answer:
      "Nope. Many clients leave us a key or garage code. We're background-checked, insured, and bonded. You can trust us in your space.",
  },
  {
    question: "What products do you use?",
    answer:
      "We bring all our own professional-grade supplies and equipment. Have preferences or allergies? Just let us know — we're happy to accommodate.",
  },
  {
    question: "How does recurring service work?",
    answer:
      "Pick weekly, biweekly, or monthly. Same team every visit. Cancel or skip anytime — no contracts, no cancellation fees. Your cleaning just shows up on schedule.",
  },
  {
    question: "How quickly can you start?",
    answer:
      "Most clients get their first cleaning within 2-3 days of booking. Need it sooner? Call us and we'll do our best to accommodate.",
  },
]

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function BookPage() {
  return (
    <>
      {/* ---- Hero ---- */}
      <section className="relative bg-[#164E63] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#164E63] via-[#155f73] to-[#1a7a94] opacity-90" />

        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left: Copy */}
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4 font-heading">
                LA&apos;s Most Trusted{" "}
                <span className="text-amber-300">Cleaning Service</span>
              </h1>
              <p className="text-lg text-slate-200 mb-2">
                Get a free quote in 60 seconds. Licensed, insured, and background-checked teams.
              </p>
              <p className="text-sm text-slate-300 mb-6">
                2,500+ homes cleaned across LA County. 5.0 stars. No contracts, cancel anytime.
              </p>

              {/* Mobile: scroll to form */}
              <a
                href="#book-now"
                className="inline-block lg:hidden px-8 py-3.5 bg-amber-400 text-slate-900 font-bold rounded-lg text-base hover:bg-amber-300 transition-colors shadow-lg"
              >
                Get Your Free Quote
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
                  <span className="text-emerald-400">&#10003;</span> Background-Checked
                </span>
              </div>
            </div>

            {/* Right: Form */}
            <div id="book-now" className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
              <div className="text-center mb-5">
                <p className="text-sm text-slate-500 mb-1">FREE QUOTE IN 60 SECONDS</p>
                <p className="text-lg font-semibold text-slate-800">Tell us about your home</p>
              </div>
              <BookingForm source="meta" ctaLabel="Get Your Free Quote" />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Trust Bar ---- */}
      <TrustBar />

      {/* ---- Pricing Tiers ---- */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            Transparent pricing
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3 font-heading">
            Choose Your Clean
          </h2>
          <p className="text-center text-slate-500 mb-10 max-w-lg mx-auto">
            Simple, honest pricing based on your home size. No hidden fees, no surprises.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PRICING_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl p-6 border text-center ${
                  tier.highlighted
                    ? "bg-[#164E63] text-white border-[#164E63] shadow-lg"
                    : "bg-white border-slate-200 shadow-sm"
                }`}
              >
                {tier.highlighted && (
                  <div className="inline-block px-3 py-0.5 rounded-full bg-amber-400 text-slate-900 text-xs font-semibold uppercase tracking-wide mb-3">
                    Most Popular
                  </div>
                )}
                <h3 className={`text-lg font-bold mb-1 font-heading ${tier.highlighted ? "text-white" : "text-slate-900"}`}>
                  {tier.name}
                </h3>
                <p className={`text-3xl font-bold mb-1 ${tier.highlighted ? "text-amber-300" : "text-[#2195b4]"}`}>
                  {tier.from}
                </p>
                <p className={`text-xs mb-4 ${tier.highlighted ? "text-slate-300" : "text-slate-500"}`}>
                  starting price
                </p>
                <p className={`text-sm mb-4 ${tier.highlighted ? "text-slate-200" : "text-slate-600"}`}>
                  {tier.description}
                </p>
                <ul className="text-left space-y-2">
                  {tier.features.map((feature) => (
                    <li key={feature} className={`flex items-start gap-2 text-sm ${tier.highlighted ? "text-slate-200" : "text-slate-600"}`}>
                      <span className={`flex-shrink-0 mt-0.5 ${tier.highlighted ? "text-amber-300" : "text-emerald-500"}`}>&#10003;</span>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Trust Points ---- */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TRUST_POINTS.map((point) => (
              <div
                key={point.title}
                className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 text-center"
              >
                <h3 className="text-xl font-bold text-[#2195b4] mb-2 font-heading">
                  {point.title}
                </h3>
                <p className="text-sm text-slate-600">{point.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Social Proof ---- */}
      <section className="py-16 px-4 bg-white">
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
                className="bg-slate-50 rounded-xl p-6 border border-slate-100"
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
            Ready for a spotless home?
          </h2>
          <p className="text-slate-300 mb-8">
            Get your free quote in 60 seconds. No obligation, no pressure.
          </p>

          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 text-left">
            <BookingForm source="meta" ctaLabel="Get Your Free Quote" />
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
