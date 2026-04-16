import type { Metadata } from "next"
import { BookingForm } from "@/components/marketing/booking-form"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"
import { StickyCTA } from "@/components/marketing/sticky-cta"

export const metadata: Metadata = {
  title: "$149 First Deep Clean | Spotless Scrubbers",
  description:
    "Get your first professional deep clean for just $149 (normally $250+). Kitchen, bathrooms, baseboards, fridge, oven — everything. 5.0 stars, 2,500+ homes cleaned across LA County.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "$149 First Deep Clean | Spotless Scrubbers",
    description:
      "Your first professional deep clean for $149. Normally $250+. Fridge, oven, baseboards included. 5.0 stars across LA County.",
  },
}

/* ------------------------------------------------------------------ */
/*  Static data                                                        */
/* ------------------------------------------------------------------ */

const INCLUDED_ITEMS = [
  "Full kitchen deep clean",
  "All bathrooms scrubbed top to bottom",
  "Inside your fridge",
  "Inside your oven",
  "Baseboards throughout",
  "All bedrooms dusted & vacuumed",
  "Mirrors, glass & fixtures",
  "Mopping all hard floors",
  "Trash taken out",
  "Counters, sinks & surfaces sanitized",
]

const VALUE_CARDS = [
  {
    title: "$250+ Value",
    subtitle: "for just $149",
    description: "Same deep clean our recurring clients get — at a fraction of the price.",
  },
  {
    title: "Fridge + Oven",
    subtitle: "included free",
    description: "Most companies charge $50-100 extra for appliances. We include them.",
  },
  {
    title: "Cancel Anytime",
    subtitle: "no contracts",
    description: "Love it? We come back biweekly. Don't? Cancel with zero fees or guilt.",
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
    question: "What if I don't like it?",
    answer:
      "If you're not happy with the clean, we'll come back and redo it — free. If we still can't get it right, you don't pay. Period.",
  },
  {
    question: "What's included in the $149 deep clean?",
    answer:
      "Everything. Kitchen, bathrooms, bedrooms, baseboards, inside your fridge and oven, all surfaces, mirrors, mopping — the works. It's the same deep clean we normally charge $250+ for.",
  },
  {
    question: "How does recurring work?",
    answer:
      "After your first clean, we can set you up on a biweekly schedule at our regular rate ($165/visit for most homes). You can cancel or skip anytime — no contracts, no cancellation fees.",
  },
  {
    question: "Is there a catch?",
    answer:
      "No catch. We ask for a card on file when you book (standard practice — we don't charge until after the clean). The $149 price is for your first deep clean only. If you love it and go recurring, your regular rate kicks in on visit two.",
  },
  {
    question: "How long does it take?",
    answer:
      "Most deep cleans take 2-3 hours depending on home size. We send a team of two so it gets done fast without cutting corners.",
  },
  {
    question: "Do I need to be home?",
    answer:
      "Nope. Many clients leave us a key or garage code. We're background-checked, insured, and bonded. You can trust us in your space.",
  },
]

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function OfferPage() {
  return (
    <>
      {/* ---- Hero ---- */}
      <section className="relative bg-[#164E63] overflow-hidden">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#164E63] via-[#155f73] to-[#1a7a94] opacity-90" />

        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 text-xs font-semibold uppercase tracking-wide mb-4">
                Limited Time Offer
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4 font-heading">
                Your First Deep Clean.{" "}
                <span className="text-amber-300">$149.</span>
              </h1>
              <p className="text-lg text-slate-200 mb-2">
                Normally $250+. Kitchen, bathrooms, baseboards, fridge, oven — everything.
              </p>
              <p className="text-sm text-slate-300 mb-6">
                2,500+ homes cleaned across LA County. 5.0 stars. Card on file required.
              </p>

              {/* Mobile: scroll to form */}
              <a
                href="#claim-offer"
                className="inline-block lg:hidden px-8 py-3.5 bg-amber-400 text-slate-900 font-bold rounded-lg text-base hover:bg-amber-300 transition-colors shadow-lg"
              >
                Claim Your $149 Clean
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
            <div id="claim-offer" className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
              <div className="text-center mb-5">
                <p className="text-sm text-slate-500 mb-1">YOUR FIRST DEEP CLEAN</p>
                <div className="flex items-center justify-center gap-3">
                  <span className="text-lg text-slate-400 line-through">$250+</span>
                  <span className="text-4xl font-bold text-[#2195b4]">$149</span>
                </div>
              </div>
              <BookingForm source="meta" preselectedService="deep-cleaning" />
            </div>
          </div>
        </div>
      </section>

      {/* ---- Trust Bar ---- */}
      <TrustBar />

      {/* ---- What's Included ---- */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <p className="text-sm font-medium text-[#2195b4] mb-3 text-center">
            What you get
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3 font-heading">
            Everything. For $149.
          </h2>
          <p className="text-center text-slate-500 mb-10 max-w-lg mx-auto">
            This is the same deep clean we normally charge $250+ for. No corners cut.
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

      {/* ---- Value Stack ---- */}
      <section className="py-16 px-4 bg-slate-50 border-y border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {VALUE_CARDS.map((card) => (
              <div
                key={card.title}
                className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 text-center"
              >
                <h3 className="text-xl font-bold text-[#2195b4] mb-0.5 font-heading">
                  {card.title}
                </h3>
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
                  {card.subtitle}
                </p>
                <p className="text-sm text-slate-600">{card.description}</p>
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
            Claim your $149 first deep clean. Available times in 60 seconds.
          </p>

          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 text-left">
            <BookingForm source="meta" preselectedService="deep-cleaning" />
          </div>

          <p className="text-xs text-slate-400 mt-6">
            Or call us directly:{" "}
            <a href="tel:+14246771146" className="text-amber-300 hover:underline">
              (424) 677-1146
            </a>
          </p>
        </div>
      </section>

      {/* ---- Sticky CTA (mobile) ---- */}
      <StickyCTA />
    </>
  )
}
