import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { FAQJsonLd, BreadcrumbJsonLd } from "@/components/marketing/json-ld"
import { QuoteCalculator } from "@/components/marketing/quote-calculator"
import { TrustBar } from "@/components/marketing/trust-bar"

export const metadata: Metadata = {
  title: "Our Cleaning Services | Spotless Scrubbers",
  description:
    "Professional house cleaning, deep cleaning, move-in/out, post-construction, commercial, and Airbnb cleaning across Los Angeles County. Insured, 5-star rated.",
  alternates: {
    canonical: `${SPOTLESS_BUSINESS.url}/spotless/services`,
  },
}

const SERVICE_IMAGES: Record<string, string> = {
  "standard-cleaning": "/images/marketing/standard-bathroom-result.webp",
  "deep-cleaning": "/images/marketing/stock-deep-clean-kitchen.jpg",
  "move-in-out-cleaning": "/images/marketing/move-cleaning.jpg",
  "post-construction-cleaning": "/images/marketing/post-construction-site.jpg",
  "commercial-cleaning": "/images/marketing/stock-commercial-office.jpg",
  "airbnb-cleaning": "/images/marketing/airbnb-bedroom-clean.jpg",
}

const SERVICE_STARTING_PRICES: Record<string, number> = {
  "standard-cleaning": 120,
  "deep-cleaning": 200,
  "move-in-out-cleaning": 250,
  "post-construction-cleaning": 300,
  "commercial-cleaning": 150,
  "airbnb-cleaning": 100,
}

const SERVICE_FAQS = [
  {
    question: "What cleaning services do you offer in Los Angeles?",
    answer:
      "We offer six professional cleaning services across LA County: standard house cleaning, deep cleaning, move-in/move-out cleaning, post-construction cleaning, commercial and office cleaning, and Airbnb/short-term rental cleaning. All services are performed by insured, background-checked cleaners.",
  },
  {
    question: "Do you serve all of Los Angeles County?",
    answer: `Yes! Spotless Scrubbers serves over 20 cities across Los Angeles County, including Los Angeles, Santa Monica, Beverly Hills, Pasadena, Long Beach, Burbank, Glendale, and more. Call us at ${SPOTLESS_BUSINESS.phone} to confirm availability in your area.`,
  },
  {
    question: "How do I book a cleaning service?",
    answer:
      "Booking is easy - fill out our online form on any service page, or call us directly. We confirm your appointment instantly and match you with the best cleaner for your needs. Same-day bookings are available for select services.",
  },
]

export default function ServicesPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Services", url: `${SPOTLESS_BUSINESS.url}/services` },
        ]}
      />
      <FAQJsonLd faqs={SERVICE_FAQS} />

      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="relative text-white">
          <div className="absolute inset-0">
            <img src="/images/marketing/hero-clean-home.jpg" alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-br from-[#2195b4]/85 to-[#155f73]/90" />
          </div>
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold mb-4">
              Our Cleaning Services
            </h1>
            <p className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto">
              Professional cleaning for every need across all of Los Angeles County.
              Insured cleaners and a 100% satisfaction guarantee.
            </p>
          </div>
        </section>

        {/* Trust Bar */}
        <TrustBar />

        {/* Service Cards Grid */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {SPOTLESS_SERVICES.map((service) => (
              <div
                key={service.slug}
                className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                {/* Service image banner */}
                <div className="h-48 rounded-t-xl overflow-hidden">
                  <img
                    src={SERVICE_IMAGES[service.slug]}
                    alt={service.shortTitle}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="p-6 flex flex-col flex-1">
                  <h2 className="text-xl font-bold text-slate-900 mb-2">
                    {service.title}
                  </h2>
                  <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                    {service.description}
                  </p>

                  {/* Features preview - first 4 */}
                  <ul className="space-y-1.5 mb-5">
                    {service.features.slice(0, 4).map((feature) => (
                      <li
                        key={feature}
                        className="flex items-start gap-2 text-sm text-slate-700"
                      >
                        <span className="text-[#2195b4] mt-0.5 shrink-0">&#10003;</span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {/* Spacer to push bottom content down */}
                  <div className="mt-auto" />

                  {/* Price badge */}
                  <div className="mb-4 flex items-center gap-2 flex-wrap">
                    <span className="inline-block px-3 py-1 rounded-full bg-[#2195b4] text-white text-sm font-bold">
                      Starting at ${SERVICE_STARTING_PRICES[service.slug]}
                    </span>
                    <span className="text-xs text-slate-500">
                      {service.priceRange}
                    </span>
                  </div>

                  {/* CTAs */}
                  <div className="flex gap-3">
                    <Link
                      href={`/spotless/services/${service.slug}`}
                      className="flex-1 text-center px-4 py-2.5 rounded-lg border border-[#2195b4] text-[#2195b4] font-semibold text-sm hover:bg-[#2195b4]/5 transition-colors"
                    >
                      Learn More
                    </Link>
                    <Link
                      href={`/spotless/services/${service.slug}#book`}
                      className="flex-1 text-center px-4 py-2.5 rounded-lg bg-[#2195b4] text-white font-semibold text-sm hover:bg-[#155f73] transition-colors"
                    >
                      Book Now
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {SERVICE_FAQS.map((faq) => (
              <div key={faq.question}>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  {faq.question}
                </h3>
                <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA Section with Quote Calculator */}
        <section className="bg-gradient-to-b from-slate-50 to-white py-12 sm:py-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
                Ready for a Cleaner Home?
              </h2>
              <p className="text-slate-600 max-w-xl mx-auto">
                Get your instant estimate in 30 seconds. No commitment, no
                credit card. Or call us at{" "}
                <a
                  href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
                  className="font-semibold text-[#2195b4] hover:text-[#155f73] transition-colors"
                >
                  {SPOTLESS_BUSINESS.phone}
                </a>
                .
              </p>
            </div>
            <QuoteCalculator source="services_page" />
          </div>
        </section>
      </main>
    </>
  )
}
