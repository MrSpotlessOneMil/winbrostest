import type { Metadata } from "next"
import { Playfair_Display } from "next/font/google"
import { BookingForm } from "@/components/marketing/booking-form"

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Spotless Scrubbers | Turnover Cleaning for LA SuperHosts",
  description:
    "White-glove turnover cleaning for LA's top-performing short-term rentals. Same team every visit, photo-ready protocol, 5.0 stars across 40+ properties. Beverly Hills, WeHo, Venice, Santa Monica, Malibu.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Spotless Scrubbers | Turnover Cleaning for LA SuperHosts",
    description:
      "For listings that can't afford a 4-star review. Invitation-only turnover cleaning for LA SuperHosts.",
  },
}

const PILLARS = [
  {
    title: "Same Team. Every Visit.",
    body: "Your properties are learned, not re-trained. One team memorizes your linen setup, your staging, your guest expectations.",
  },
  {
    title: "5.0 Stars. 40+ Listings.",
    body: "We service some of LA's most-reviewed short-term rentals. Consistency is the reason our hosts hold perfect ratings.",
  },
  {
    title: "Photo-Ready Protocol.",
    body: "Every turnover is documented. Fold-marked towels, sealed bathroom, every pillow in its place. Your listing photos come to life, every time.",
  },
]

const TESTIMONIALS = [
  {
    quote:
      "The difference is in the details. Towels folded like a hotel, counters without a single smudge, the bed made exactly how I want it. I don't worry about cleanings anymore.",
    property: "Beverly Hills Villa",
    rating: "★★★★★",
  },
  {
    quote:
      "I used three other cleaning services before Spotless. This is the first one where my guests actually comment on how clean the place is.",
    property: "Hollywood Hills Modern",
    rating: "★★★★★",
  },
  {
    quote:
      "Same team every turnover. They know the property. I just text the checkout time and it's done. That's the entire service.",
    property: "Venice Canal Loft",
    rating: "★★★★★",
  },
]

const SERVICE_AREAS = [
  "Beverly Hills",
  "West Hollywood",
  "Hollywood Hills",
  "Venice",
  "Santa Monica",
  "Malibu",
  "Pacific Palisades",
  "Brentwood",
  "Bel Air",
]

const FAQS = [
  {
    question: "How does onboarding work?",
    answer:
      "A 15-minute intro call to understand the property, the linen closet, the staging, and your guest flow. After that, we send a confirmation and you text us checkout times as they come in.",
  },
  {
    question: "Do I get the same team?",
    answer:
      "Yes. The same team learns your property and handles every turnover. Consistency is non-negotiable for a listing that depends on 5-star reviews.",
  },
  {
    question: "What does a turnover include?",
    answer:
      "A full hotel-grade turnover: every surface, every bathroom, linen change, towel staging, supply check, and a photo report sent to you at completion.",
  },
  {
    question: "Do you handle last-minute turnovers?",
    answer:
      "We accept urgent requests when our schedule permits, but our model is built on predictability, not fire drills. Planning ahead protects everyone's quality.",
  },
  {
    question: "Are you insured?",
    answer:
      "Fully insured and bonded. We can provide proof of insurance to your property manager or rental agency.",
  },
]

export default function AirbnbPage() {
  return (
    <div className={`${playfair.className} bg-[#FAF7F2] text-[#1A1A1A]`}>
      {/* Hero */}
      <section className="relative">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/images/marketing/airbnb-bedroom-clean.jpg')" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#1A1A1A]/60 via-[#1A1A1A]/40 to-[#FAF7F2]" />

        <div className="relative max-w-5xl mx-auto px-6 py-24 md:py-32">
          <div className="max-w-2xl">
            <p className="text-[#B8955A] text-sm uppercase tracking-[0.2em] mb-6 font-sans">
              For LA SuperHosts
            </p>
            <h1 className="text-4xl md:text-6xl font-normal leading-[1.1] text-white mb-6">
              <span className="italic">For the listings that can't afford</span>
              <br />
              <span className="font-medium">a 4-star review.</span>
            </h1>
            <p className="text-lg text-white/85 max-w-xl mb-10 leading-relaxed font-sans">
              Invitation-only turnover cleaning for LA's top-performing short-term rentals.
              Same team every visit. Photo-ready every turnover.
            </p>

            <a
              href="#inquire"
              className="inline-block px-10 py-4 bg-[#B8955A] text-white font-medium tracking-wide text-sm uppercase hover:bg-[#a08149] transition-colors"
              style={{ fontFamily: "var(--font-sans, system-ui)" }}
            >
              Request Consultation
            </a>

            <p className="mt-10 text-xs uppercase tracking-[0.18em] text-white/70 font-sans">
              Serving Beverly Hills &middot; West Hollywood &middot; Venice &middot; Santa Monica &middot; Malibu
            </p>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="bg-[#FAF7F2] py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            Why SuperHosts choose us
          </p>
          <h2 className="text-center text-3xl md:text-4xl mb-20 font-normal italic">
            The difference between 4.8 and 5.0 is in the details.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
            {PILLARS.map((p) => (
              <div key={p.title} className="text-center">
                <h3 className="text-2xl mb-4 font-medium">{p.title}</h3>
                <p className="text-[#1A1A1A]/70 leading-relaxed font-sans text-sm">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-6 border-t border-[#1A1A1A]/10">
        <div className="max-w-4xl mx-auto">
          <p className="text-center text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            From our hosts
          </p>
          <h2 className="text-center text-3xl md:text-4xl mb-20 font-normal italic">
            Quiet, consistent, hotel-grade.
          </h2>

          <div className="space-y-16">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="max-w-2xl mx-auto text-center">
                <div className="text-[#B8955A] text-xl tracking-[0.3em] mb-6">{t.rating}</div>
                <p className="text-xl md:text-2xl italic leading-relaxed mb-6 font-normal">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <p className="text-xs uppercase tracking-[0.25em] text-[#1A1A1A]/60 font-sans">
                  {t.property}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How we work */}
      <section className="bg-[#1A1A1A] text-white py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            How we work
          </p>
          <h2 className="text-center text-3xl md:text-4xl mb-20 font-normal italic">
            Four steps. No surprises.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 text-center">
            {[
              { n: "01", title: "Intro Call", body: "A short conversation about your property and your guest flow." },
              { n: "02", title: "Confirmation", body: "We confirm availability within 60 seconds of each turnover request." },
              { n: "03", title: "Same Team Arrives", body: "Your trained crew executes the turnover to the documented spec." },
              { n: "04", title: "Photo Report", body: "Completion report with photos, delivered to your phone." },
            ].map((s) => (
              <div key={s.n}>
                <p className="text-[#B8955A] text-sm tracking-[0.2em] mb-4 font-sans">{s.n}</p>
                <h3 className="text-xl mb-3 font-medium">{s.title}</h3>
                <p className="text-white/70 text-sm leading-relaxed font-sans">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service areas */}
      <section className="py-20 px-6 border-t border-[#1A1A1A]/10">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            Accepting inquiries from
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm uppercase tracking-[0.18em] text-[#1A1A1A]/80 font-sans">
            {SERVICE_AREAS.map((area) => (
              <span key={area}>{area}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Inquiry form */}
      <section id="inquire" className="bg-[#FAF7F2] py-24 px-6 border-t border-[#1A1A1A]/10">
        <div className="max-w-xl mx-auto">
          <p className="text-center text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            By invitation
          </p>
          <h2 className="text-center text-3xl md:text-4xl mb-4 font-normal italic">
            Request your consultation.
          </h2>
          <p className="text-center text-[#1A1A1A]/70 mb-12 font-sans text-sm">
            We accept a limited number of new properties each season. A member of our team will reach out within 24 hours.
          </p>

          <div className="bg-white rounded-sm border border-[#1A1A1A]/10 shadow-sm p-8 md:p-10">
            <BookingForm
              source="meta"
              preselectedService="airbnb-cleaning"
              ctaLabel="Request Consultation"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-6 border-t border-[#1A1A1A]/10">
        <div className="max-w-3xl mx-auto">
          <p className="text-center text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-6">
            Questions
          </p>
          <h2 className="text-center text-3xl md:text-4xl mb-16 font-normal italic">
            Before you inquire.
          </h2>

          <div className="space-y-6">
            {FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group border-b border-[#1A1A1A]/15 pb-6"
              >
                <summary className="flex items-center justify-between cursor-pointer text-lg font-medium">
                  {faq.question}
                  <span className="text-[#B8955A] group-open:rotate-45 transition-transform text-2xl ml-4 font-light">
                    +
                  </span>
                </summary>
                <div className="mt-4 text-[#1A1A1A]/70 leading-relaxed font-sans text-sm">
                  {faq.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final */}
      <section className="bg-[#1A1A1A] text-white py-20 px-6 text-center">
        <p className="text-[#B8955A] text-xs uppercase tracking-[0.25em] mb-4">
          Spotless Scrubbers
        </p>
        <p className="text-xl italic mb-2">White-glove turnovers for LA's top listings.</p>
        <p className="text-white/60 text-sm font-sans">
          <a href="tel:+14246771146" className="hover:text-[#B8955A] transition-colors">
            (424) 677-1146
          </a>
          <span className="mx-3">&middot;</span>
          <a
            href="mailto:dominic@spotlesservices.com"
            className="hover:text-[#B8955A] transition-colors"
          >
            dominic@spotlesservices.com
          </a>
        </p>
      </section>
    </div>
  )
}
