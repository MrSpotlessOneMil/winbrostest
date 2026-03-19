import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  getServiceBySlug,
  getAllServiceSlugs,
  SPOTLESS_SERVICES,
} from "@/lib/marketing/spotless-services"
import type { SpotlessService } from "@/lib/marketing/spotless-services"
import {
  getAreaBySlug,
  getAllAreaSlugs,
  SPOTLESS_AREAS,
  SPOTLESS_BUSINESS,
} from "@/lib/marketing/spotless-areas"
import type { SpotlessArea } from "@/lib/marketing/spotless-areas"
import {
  ServiceJsonLd,
  FAQJsonLd,
  BreadcrumbJsonLd,
  LocalBusinessJsonLd,
} from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"

export function generateStaticParams() {
  const slugs = getAllServiceSlugs()
  const cities = getAllAreaSlugs()
  const params: { slug: string; city: string }[] = []
  for (const slug of slugs) {
    for (const city of cities) {
      params.push({ slug, city })
    }
  }
  return params
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; city: string }>
}): Promise<Metadata> {
  const { slug, city } = await params
  const service = getServiceBySlug(slug)
  const area = getAreaBySlug(city)
  if (!service || !area) return {}

  return {
    title: `${service.shortTitle} in ${area.city}, CA | Spotless Scrubbers`,
    description: `Professional ${service.title.toLowerCase()} in ${area.city}. Insured, 5-star rated. Book online or call today.`,
    alternates: {
      canonical: `${SPOTLESS_BUSINESS.url}/spotless/services/${slug}/${city}`,
    },
  }
}

function getCityServiceFAQs(service: SpotlessService, area: SpotlessArea) {
  const neighborhoodList = area.neighborhoods.slice(0, 4).join(", ")
  return [
    {
      question: `How much does ${service.title.toLowerCase()} cost in ${area.city}?`,
      answer: `${service.title} in ${area.city} typically ranges from ${service.priceRange}. Final pricing depends on the size of your home and any special requirements. We provide a free quote before every job - no hidden fees.`,
    },
    {
      question: `What's included in ${service.title.toLowerCase()} in ${area.city}?`,
      answer: `Our ${area.city} ${service.title.toLowerCase()} includes ${service.features.slice(0, 4).join(", ").toLowerCase()}, and more. Every cleaning is performed by insured, background-checked professionals.`,
    },
    {
      question: `How do I book ${service.title.toLowerCase()} in ${area.city}?`,
      answer: `Booking is simple - fill out the form on this page or call us at ${SPOTLESS_BUSINESS.phone}. We will confirm your appointment within the hour and match you with a cleaner familiar with the ${area.city} area.`,
    },
    {
      question: `Do you serve ${neighborhoodList}?`,
      answer: `Yes! We serve all neighborhoods in ${area.city}, including ${neighborhoodList}, and surrounding areas. If you are in ${area.county}, we can get to you.`,
    },
  ]
}

function getCityServiceContent(service: SpotlessService, area: SpotlessArea) {
  const neighborhoodMention = area.neighborhoods.slice(0, 3).join(", ")
  const landmarkMention =
    area.landmarks.length > 0
      ? area.landmarks[0]
      : `downtown ${area.city}`

  // Build 3 varied paragraphs based on service type
  const paragraph1 = `Looking for reliable ${service.title.toLowerCase()} in ${area.city}? Spotless Scrubbers has been serving homes and businesses across ${area.county} since ${SPOTLESS_BUSINESS.foundingYear}. Whether you are in ${neighborhoodMention}, or anywhere else in ${area.city}, our insured and vetted cleaning professionals bring the same 5-star service to every appointment.`

  const paragraph2Map: Record<string, string> = {
    "standard-cleaning": `Keeping a home clean in ${area.city} can be tough with busy schedules. Our standard cleaning service gives ${area.city} residents a consistently fresh home without the hassle. We handle everything from dusting and vacuuming to kitchen and bathroom deep-sanitizing, using products that are safe for your family and pets. Many of our clients near ${landmarkMention} have been with us for years on weekly and biweekly plans.`,
    "deep-cleaning": `${area.city} homes deserve a thorough refresh. Our deep cleaning goes far beyond a surface wipe-down - we scrub baseboards, detail grout, clean inside appliances, and reach every corner that regular cleaning misses. Whether your home near ${landmarkMention} needs a seasonal reset or a first-time deep clean, we will leave it feeling brand new.`,
    "move-in-out-cleaning": `Moving in or out of a place in ${area.city}? Our move-in/out cleaning is designed to help tenants get their deposits back and new homeowners start fresh. We clean inside every cabinet, every appliance, and every surface. Property managers near ${landmarkMention} rely on us for reliable turnovers between tenants.`,
    "post-construction-cleaning": `After a renovation or build in ${area.city}, the dust and debris can be overwhelming. Our post-construction cleaning team removes drywall dust, cleans windows, scrubs floors, and makes your newly remodeled space move-in ready. Contractors and homeowners near ${landmarkMention} trust us to handle the final detail work so the space shines.`,
    "commercial-cleaning": `A clean workspace matters in ${area.city}. Our commercial cleaning service keeps offices, retail spaces, and professional environments spotless with flexible scheduling that works around your business hours. From coworking spaces near ${landmarkMention} to medical offices and storefronts, we deliver consistent, professional results.`,
    "airbnb-cleaning": `${area.city} is a popular destination for short-term rentals, and guest expectations are high. Our Airbnb turnover cleaning ensures your property near ${landmarkMention} is 5-star ready for every check-in. We handle linen changes, restocking, deep cleaning, and damage reporting - with same-day turnarounds available so you never miss a booking.`,
  }

  const paragraph2 =
    paragraph2Map[service.slug] ||
    `Our ${service.title.toLowerCase()} service in ${area.city} is trusted by hundreds of residents and businesses. We maintain full insurance coverage and back every job with a satisfaction guarantee. Clients near ${landmarkMention} count on us for consistent, professional results.`

  const paragraph3 = `All of our ${area.city} cleaners are background-checked, insured, and trained to our standards. We offer a satisfaction guarantee on every job. With a ${SPOTLESS_BUSINESS.rating}-star rating on Google, ${area.city} residents can book with confidence.`

  return { paragraph1, paragraph2, paragraph3 }
}

export default async function ServiceCityPage({
  params,
}: {
  params: Promise<{ slug: string; city: string }>
}) {
  const { slug, city } = await params
  const service = getServiceBySlug(slug)
  const area = getAreaBySlug(city)
  if (!service || !area) notFound()

  const faqs = getCityServiceFAQs(service, area)
  const { paragraph1, paragraph2, paragraph3 } = getCityServiceContent(
    service,
    area
  )

  // Sibling services in same city
  const siblingServices = SPOTLESS_SERVICES.filter((s) => s.slug !== service.slug)
  // Same service in other cities
  const otherCities = SPOTLESS_AREAS.filter((a) => a.slug !== area.slug)

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
          {
            name: `${service.shortTitle} in ${area.city}`,
            url: `${SPOTLESS_BUSINESS.url}/services/${service.slug}/${area.slug}`,
          },
        ]}
      />
      <ServiceJsonLd service={service} city={area.city} />
      <LocalBusinessJsonLd area={area} />
      <FAQJsonLd faqs={faqs} />

      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-gradient-to-b from-[#a8e0ef]/30 to-white py-16 sm:py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 mb-6">
              <Link href="/spotless/services" className="hover:text-[#2195b4]">
                Services
              </Link>
              <span>/</span>
              <Link
                href={`/spotless/services/${service.slug}`}
                className="hover:text-[#2195b4]"
              >
                {service.shortTitle}
              </Link>
              <span>/</span>
              <span className="text-slate-700">{area.city}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
              {service.title} in {area.city}, CA
            </h1>
            <p className="text-lg text-slate-600 leading-relaxed max-w-3xl">
              Professional {service.title.toLowerCase()} in {area.city} and
              surrounding neighborhoods. Insured and backed by five-star
              reviews on Google.
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-6">
              <span className="inline-block px-4 py-1.5 rounded-full bg-[#a8e0ef]/40 text-[#155f73] text-sm font-semibold">
                {service.priceRange}
              </span>
              <span className="text-sm text-slate-500">
                {SPOTLESS_BUSINESS.rating} stars on Google
              </span>
            </div>
          </div>
        </section>

        {/* Content Paragraphs */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="prose prose-slate max-w-none space-y-4">
            <p className="text-slate-700 leading-relaxed">{paragraph1}</p>
            <p className="text-slate-700 leading-relaxed">{paragraph2}</p>
            <p className="text-slate-700 leading-relaxed">{paragraph3}</p>
          </div>
        </section>

        {/* What's Included */}
        <section className="bg-slate-50 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
              What&apos;s Included
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {service.features.map((feature) => (
                <div
                  key={feature}
                  className="flex items-start gap-3 p-3 rounded-lg bg-white"
                >
                  <span className="text-emerald-500 mt-0.5 shrink-0 font-bold">
                    &#10003;
                  </span>
                  <span className="text-slate-700">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">
            {service.shortTitle} in {area.city} - FAQs
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

        {/* Trust Signals */}
        <section className="bg-[#a8e0ef]/10 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
              <div className="p-6 rounded-xl bg-white border border-[#a8e0ef]/50 shadow-sm">
                <div className="text-3xl font-bold text-[#2195b4] mb-1">
                  {SPOTLESS_BUSINESS.rating}
                </div>
                <div className="text-sm text-slate-500">Star Rating</div>
              </div>
              <div className="p-6 rounded-xl bg-white border border-[#a8e0ef]/50 shadow-sm">
                <div className="text-3xl font-bold text-[#2195b4] mb-1">
                  5-Star
                </div>
                <div className="text-sm text-slate-500">Rated on Google</div>
              </div>
              <div className="p-6 rounded-xl bg-white border border-[#a8e0ef]/50 shadow-sm">
                <div className="text-3xl font-bold text-[#2195b4] mb-1">
                  100%
                </div>
                <div className="text-sm text-slate-500">
                  Satisfaction Guarantee
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Booking CTA */}
        <section id="book" className="py-12 sm:py-16 scroll-mt-8">
          <div className="max-w-xl mx-auto px-4 sm:px-6">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-lg p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">
                Book {service.shortTitle} in {area.city}
              </h2>
              <p className="text-slate-500 text-sm mb-6 text-center">
                Fill out the form and we will confirm your appointment within
                the hour.
              </p>
              <BookingForm preselectedService={service.slug} />
            </div>
          </div>
        </section>

        {/* Internal Links */}
        <section className="bg-slate-50 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-10">
            {/* Other services in this city */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                Other Services in {area.city}
              </h2>
              <div className="flex flex-wrap gap-3">
                {siblingServices.map((s) => (
                  <Link
                    key={s.slug}
                    href={`/spotless/services/${s.slug}/${area.slug}`}
                    className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-[#2195b4] hover:text-[#2195b4] transition-colors"
                  >
                    {s.shortTitle}
                  </Link>
                ))}
              </div>
            </div>

            {/* More about this city */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                More About {area.city}
              </h2>
              <Link
                href={`/spotless/areas/${area.slug}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2195b4] text-white text-sm font-semibold hover:bg-[#155f73] transition-colors"
              >
                Cleaning Services in {area.city} &rarr;
              </Link>
            </div>

            {/* Same service in other cities */}
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-4">
                {service.shortTitle} in Other Cities
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {otherCities.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/spotless/services/${service.slug}/${a.slug}`}
                    className="px-4 py-2.5 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-[#2195b4] hover:text-[#2195b4] transition-colors text-center"
                  >
                    {a.city}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
