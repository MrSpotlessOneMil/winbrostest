import type { Metadata } from "next"
import { BookingForm } from "@/components/marketing/booking-form"
import { TrustBar } from "@/components/marketing/trust-bar"
import { HowItWorks } from "@/components/marketing/how-it-works"

export const metadata: Metadata = {
  title: "Post-Construction Cleaning in LA | Spotless Scrubbers",
  description:
    "Post-construction cleaning across LA County. Drywall dust removal, paint splatter, sticker scraping, floor polishing. Photo-ready in 48 hours. Insured and thorough.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Post-Construction Cleaning in LA | Spotless Scrubbers",
    description:
      "Reno done? We make your space photo-ready in 48 hours. Construction dust, paint splatter, sticker removal, floor polishing. Licensed and insured.",
  },
}

const KEY_POINTS = [
  {
    title: "48-Hour Turnaround",
    description: "Contractors and flippers need speed. We show up fast, clean fast, and get your space ready for the listing photo or the walkthrough.",
  },
  {
    title: "Drywall Dust Specialists",
    description: "Construction dust gets into everything. We have the equipment and the process to pull it from every surface, vent, and crevice.",
  },
  {
    title: "Sticker & Tape Removal",
    description: "Window stickers, appliance tags, paint tape residue — all handled without damaging finishes. Your new build looks factory-fresh.",
  },
  {
    title: "Fully Insured",
    description: "Full general liability insurance. Certificate of insurance available on request for GCs and property managers.",
  },
]

const PAIN_POINTS = [
  {
    headline: "Construction dust is everywhere",
    body: "Every surface, every vent, every crevice. Regular cleaners can't handle it. Our team shows up with the right equipment and knocks it out in one visit so you can hand over keys or shoot photos.",
  },
  {
    headline: "Photo-ready beats almost-done",
    body: "A listing that looks half-finished costs you real money. Buyers notice specks, smudges, and haze on the windows. A proper post-construction clean is the difference between \"wow\" and \"hmm.\"",
  },
]

const INCLUDED_ITEMS = [
  "Construction dust and debris removal",
  "Drywall dust wiping on every surface",
  "Window and glass cleaning (sticker and tape removal)",
  "Paint splatter and drip removal",
  "Floor scrubbing, vacuuming, and polishing",
  "HVAC vent and register cleaning",
  "Cabinet interiors and exteriors",
  "Appliance cleaning inside and out",
  "Fixture and hardware polishing",
  "Baseboard and trim detailing",
  "Final inspection walkthrough",
]

const TESTIMONIALS = [
  {
    quote:
      "We use Spotless after every flip. They're the reason our listing photos pop. Two days from \"we're done\" to \"ready to shoot\" — consistent every time.",
    name: "Real Estate Flipper",
    city: "Mar Vista",
  },
  {
    quote:
      "Drywall dust everywhere after our kitchen remodel. Spotless came in, knocked it out in a day, and I couldn't believe how clean it was. Worth every penny.",
    name: "Homeowner",
    city: "Highland Park",
  },
  {
    quote:
      "I'm a GC and I've tried every cleaning company in LA. Spotless is the only one that actually understands post-construction. They're on my speed dial now.",
    name: "General Contractor",
    city: "Venice",
  },
]

const FAQS = [
  {
    question: "How is pricing structured?",
    answer:
      "Quoted per project based on square footage, finish level, and debris volume. We come out (or you send photos) and give you a flat quote. No hourly surprises.",
  },
  {
    question: "How fast can you come out?",
    answer:
      "Most post-construction jobs we can start within 48-72 hours. If you're under a tight deadline for a listing or closing, let us know and we'll make it work.",
  },
  {
    question: "Do you handle new construction?",
    answer:
      "Yes. New builds, remodels, additions, commercial buildouts. Our process handles everything from light drywall dust to heavy post-framing debris.",
  },
  {
    question: "Do you remove debris or just clean?",
    answer:
      "Primarily cleaning (dust, residue, stickers, paint). Large debris removal (lumber scraps, bags of trash) is not our main service, but we can coordinate that for an additional fee if needed. Usually your GC handles debris removal.",
  },
  {
    question: "Are you insured for construction sites?",
    answer:
      "Yes — general liability insurance. We can send a certificate of insurance to your GC, property manager, or general contractor before the job.",
  },
  {
    question: "Can you work with my GC's schedule?",
    answer:
      "Absolutely. We coordinate with GCs, flippers, and real estate agents all the time. Just give us the access plan and target date and we'll match it.",
  },
]

export default function PostConstructionPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative bg-[#164E63] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#164E63] via-[#155f73] to-[#1a7a94] opacity-90" />

        <div className="relative max-w-5xl mx-auto px-4 py-16 md:py-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <div className="inline-block px-3 py-1 rounded-full bg-amber-400/20 text-amber-300 text-xs font-semibold uppercase tracking-wide mb-4">
                For Contractors, Flippers & Homeowners
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4 font-heading">
                Reno Done?{" "}
                <span className="text-amber-300">Photo-Ready in 48 Hours.</span>
              </h1>
              <p className="text-lg text-slate-200 mb-2">
                Construction dust, paint splatter, sticker tape, drywall haze. All gone.
              </p>
              <p className="text-sm text-slate-300 mb-6">
                Serving LA County. Licensed, insured, thorough. Quote in minutes.
              </p>

              <a
                href="#get-pricing"
                className="inline-block lg:hidden px-8 py-3.5 bg-amber-400 text-slate-900 font-bold rounded-lg text-base hover:bg-amber-300 transition-colors shadow-lg"
              >
                Get Post-Construction Quote
              </a>

              <div className="flex flex-wrap gap-4 mt-8 text-sm text-slate-300">
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-400">&#9733;</span> 5.0 Stars
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> Licensed & Insured
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-emerald-400">&#10003;</span> 48-Hour Turnaround
                </span>
              </div>
            </div>

            <div id="get-pricing" className="bg-white rounded-2xl shadow-2xl p-6 md:p-8">
              <div className="text-center mb-5">
                <p className="text-sm text-slate-500 mb-1">POST-CONSTRUCTION CLEANING</p>
                <p className="text-lg font-semibold text-slate-800">Get your custom quote</p>
              </div>
              <BookingForm source="meta" preselectedService="post-construction-cleaning" ctaLabel="Get Post-Construction Quote" />
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
            Why LA builders choose us
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10 font-heading">
            Built for Post-Construction
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
            What's included
          </p>
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-3 font-heading">
            Every Surface. Every Corner.
          </h2>
          <p className="text-center text-slate-500 mb-10 max-w-lg mx-auto">
            A complete post-construction clean so your space is truly move-in ready.
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
            What LA Builders Say
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
            Ready to make it photo-ready?
          </h2>
          <p className="text-slate-300 mb-8">
            Get your custom post-construction quote. Takes 60 seconds. No obligation.
          </p>

          <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 text-left">
            <BookingForm source="meta" preselectedService="post-construction-cleaning" ctaLabel="Get Post-Construction Quote" />
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
