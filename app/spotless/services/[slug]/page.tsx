import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getServiceBySlug,
  getAllServiceSlugs,
  SPOTLESS_SERVICES,
} from "@/lib/marketing/spotless-services"
import { SPOTLESS_AREAS, SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import {
  ServiceJsonLd,
  FAQJsonLd,
  BreadcrumbJsonLd,
} from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"

export function generateStaticParams() {
  return getAllServiceSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const service = getServiceBySlug(slug)
  if (!service) return {}

  return {
    title: `${service.title} in Los Angeles | Spotless Scrubbers`,
    description: service.metaDescription,
    alternates: {
      canonical: `${SPOTLESS_BUSINESS.url}/services/${slug}`,
    },
  }
}

function getServiceFAQs(service: { title: string; priceRange: string; slug: string }) {
  return [
    {
      question: `How much does ${service.title.toLowerCase()} cost?`,
      answer: `Our ${service.title.toLowerCase()} typically ranges from ${service.priceRange}, depending on the size of your home and the scope of work. We provide a free, no-obligation quote before every job so there are no surprises.`,
    },
    {
      question: `How long does ${service.title.toLowerCase()} take?`,
      answer: `Most ${service.title.toLowerCase()} appointments take between 2 and 5 hours, depending on the size of the space and the level of detail required. We will give you a time estimate when you book so you can plan your day.`,
    },
    {
      question: `How often should I get ${service.title.toLowerCase()}?`,
      answer: `It depends on your needs. Many customers book ${service.title.toLowerCase()} on a recurring basis - weekly, biweekly, or monthly - to keep their space consistently clean. For one-time needs, a single session works great too. We can help you decide when you call.`,
    },
    {
      question: `What areas do you serve for ${service.title.toLowerCase()}?`,
      answer: `We offer ${service.title.toLowerCase()} across all of Los Angeles County, including Los Angeles, Santa Monica, Beverly Hills, Pasadena, Long Beach, Burbank, Glendale, and 13 more cities. Check our service area page or call ${SPOTLESS_BUSINESS.phone} to confirm.`,
    },
  ]
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const service = getServiceBySlug(slug)
  if (!service) notFound()

  const faqs = getServiceFAQs(service)

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Services", url: `${SPOTLESS_BUSINESS.url}/services` },
          {
            name: service.title,
            url: `${SPOTLESS_BUSINESS.url}/services/${service.slug}`,
          },
        ]}
      />
      <ServiceJsonLd service={service} />
      <FAQJsonLd faqs={faqs} />

      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-gradient-to-b from-[#a8e0ef]/30 to-white py-16 sm:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <Link
              href="/services"
              className="inline-flex items-center gap-1 text-sm text-[#2195b4] hover:text-[#155f73] mb-6"
            >
              &larr; All Services
            </Link>
            <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-4">
              {service.title} in Los Angeles
            </h1>
            <p className="text-lg text-slate-600 leading-relaxed max-w-3xl">
              {service.description}
            </p>
            <div className="mt-6">
              <span className="inline-block px-4 py-1.5 rounded-full bg-[#a8e0ef]/40 text-[#155f73] text-sm font-semibold">
                {service.priceRange}
              </span>
            </div>
          </div>
        </section>

        {/* What's Included */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
            What&apos;s Included
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {service.features.map((feature) => (
              <div
                key={feature}
                className="flex items-start gap-3 p-3 rounded-lg bg-slate-50"
              >
                <span className="text-emerald-500 mt-0.5 shrink-0 font-bold">
                  &#10003;
                </span>
                <span className="text-slate-700">{feature}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Who It's For */}
        <section className="bg-[#a8e0ef]/10 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
              Who It&apos;s For
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {service.idealFor.map((item) => (
                <div
                  key={item}
                  className="p-4 rounded-xl bg-white border border-[#a8e0ef]/50 shadow-sm"
                >
                  <p className="text-slate-800 font-medium">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {faqs.map((faq) => (
              <div
                key={faq.question}
                className="border-b border-slate-200 pb-6 last:border-0"
              >
                <h3 className="text-lg font-semibold text-slate-900 mb-2">
                  {faq.question}
                </h3>
                <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Available Cities */}
        <section className="bg-slate-50 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
              Available in These Cities
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {SPOTLESS_AREAS.map((area) => (
                <Link
                  key={area.slug}
                  href={`/services/${service.slug}/${area.slug}`}
                  className="px-4 py-3 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-[#2195b4] hover:text-[#2195b4] transition-colors text-center"
                >
                  {area.city}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Booking CTA */}
        <section id="book" className="py-12 sm:py-16 scroll-mt-8">
          <div className="max-w-xl mx-auto px-4 sm:px-6">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">
                Book {service.shortTitle} Today
              </h2>
              <p className="text-slate-500 text-sm mb-6 text-center">
                Fill out the form and we will confirm your appointment within the
                hour.
              </p>
              <BookingForm preselectedService={service.slug} />
            </div>
          </div>
        </section>

        {/* Other Services */}
        <section className="bg-[#155f73] py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl font-bold text-white mb-6">
              Explore Our Other Services
            </h2>
            <div className="flex flex-wrap justify-center gap-3">
              {SPOTLESS_SERVICES.filter((s) => s.slug !== service.slug).map(
                (s) => (
                  <Link
                    key={s.slug}
                    href={`/services/${s.slug}`}
                    className="px-5 py-2.5 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/20 transition-colors"
                  >
                    {s.shortTitle}
                  </Link>
                )
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
