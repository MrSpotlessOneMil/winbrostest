import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  SPOTLESS_AREAS,
  SPOTLESS_BUSINESS,
  getAreaBySlug,
  getAllAreaSlugs,
} from "@/lib/marketing/spotless-areas"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"
import {
  BreadcrumbJsonLd,
  LocalBusinessJsonLd,
  FAQJsonLd,
} from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"

interface CityPageProps {
  params: Promise<{ city: string }>
}

export async function generateStaticParams() {
  return getAllAreaSlugs().map((slug) => ({ city: slug }))
}

export async function generateMetadata({ params }: CityPageProps): Promise<Metadata> {
  const { city } = await params
  const area = getAreaBySlug(city)
  if (!area) return {}

  return {
    title: `House Cleaning in ${area.city}, CA | Spotless Scrubbers`,
    description: `Professional house cleaning in ${area.city}, CA. Serving ${area.neighborhoods.slice(0, 3).join(", ")} and more. Insured cleaners, satisfaction guaranteed.`,
    alternates: {
      canonical: `${SPOTLESS_BUSINESS.url}/spotless/areas/${city}`,
    },
  }
}

export default async function CityPage({ params }: CityPageProps) {
  const { city } = await params
  const area = getAreaBySlug(city)
  if (!area) notFound()

  const nearbyCities = SPOTLESS_AREAS.filter((a) => a.slug !== area.slug).slice(0, 6)

  const faqs = [
    {
      question: `How much does house cleaning cost in ${area.city}?`,
      answer: `House cleaning prices in ${area.city} typically range from $150 to $700 depending on the service type, home size, and condition. Our standard cleaning starts at $150, deep cleaning at $250, and move-in/out cleaning at $300. Call us at ${SPOTLESS_BUSINESS.phone} for a personalized quote.`,
    },
    {
      question: `What areas of ${area.city} do you serve?`,
      answer: `We serve all of ${area.city} including ${area.neighborhoods.join(", ")}. Our cleaners are familiar with the area${area.landmarks.length > 0 ? ` near landmarks like ${area.landmarks.slice(0, 2).join(" and ")}` : ""} and provide reliable, on-time service across every neighborhood.`,
    },
    {
      question: `How do I book a cleaning in ${area.city}?`,
      answer: `Booking a cleaning in ${area.city} is simple. Fill out the form on this page, call us at ${SPOTLESS_BUSINESS.phone}, or email ${SPOTLESS_BUSINESS.email}. We will confirm your appointment within the hour and match you with the best local cleaner for your needs.`,
    },
    {
      question: `Are your cleaners local to ${area.city}?`,
      answer: `Yes! We assign cleaners who live in or near ${area.city} and ${area.county}. All of our cleaners are professionally trained, background-checked, and insured. They know the ${area.city} area well and arrive on time, every time.`,
    },
  ]

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Service Areas", url: `${SPOTLESS_BUSINESS.url}/areas` },
          { name: area.city, url: `${SPOTLESS_BUSINESS.url}/areas/${area.slug}` },
        ]}
      />
      <LocalBusinessJsonLd area={area} />
      <FAQJsonLd faqs={faqs} />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#a8e0ef]/30 to-white py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-4">
            Professional House Cleaning in {area.city}, CA
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 max-w-3xl mx-auto">
            Spotless Scrubbers brings top-rated, professional cleaning to homes and
            businesses across {area.city}. Our insured and background-checked cleaners
            serve neighborhoods like {area.neighborhoods.slice(0, 3).join(", ")}, and
            everywhere in between.
          </p>
        </div>
      </section>

      {/* About Cleaning in This City */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="prose prose-slate max-w-none">
          <p className="text-lg text-slate-700 leading-relaxed">
            {area.city} is one of our most popular service areas in {area.county}. Whether
            you live near {area.neighborhoods[0]} or on the other side of town in{" "}
            {area.neighborhoods[area.neighborhoods.length - 1]}, our team delivers
            consistent, high-quality cleaning every visit. We use products that are
            safe for your family and pets.
          </p>
          <p className="text-lg text-slate-700 leading-relaxed mt-4">
            From the busy streets near{" "}
            {area.landmarks.length > 0 ? area.landmarks[0] : "downtown " + area.city} to
            the quieter residential neighborhoods, we understand the unique cleaning needs
            of {area.city} homes. Dust, allergens, and the Southern California climate mean
            regular cleaning is not just about appearance - it is about health and comfort.
          </p>
          {area.landmarks.length > 1 && (
            <p className="text-lg text-slate-700 leading-relaxed mt-4">
              Our cleaners know {area.city} well, from{" "}
              {area.landmarks.slice(0, -1).join(", ")} to{" "}
              {area.landmarks[area.landmarks.length - 1]}. We take pride in serving this
              community and building lasting relationships with our clients here.
            </p>
          )}
        </div>
      </section>

      {/* Services Available */}
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8 text-center">
            Services Available in {area.city}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {SPOTLESS_SERVICES.map((service) => (
              <Link
                key={service.slug}
                href={`/spotless/services/${service.slug}/${area.slug}`}
                className="group rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow p-5"
              >
                <h3 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-[#2195b4] transition-colors">
                  {service.shortTitle}
                </h3>
                <p className="text-sm text-slate-600 mb-3 line-clamp-2">
                  {service.description}
                </p>
                <span className="inline-block px-2.5 py-1 rounded-full bg-[#a8e0ef]/40 text-[#155f73] text-xs font-semibold">
                  {service.priceRange}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Neighborhoods */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
          Neighborhoods We Serve in {area.city}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {area.neighborhoods.map((neighborhood) => (
            <div
              key={neighborhood}
              className="flex items-center gap-2 px-4 py-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-700"
            >
              <span className="text-[#2195b4] shrink-0">&#10003;</span>
              {neighborhood}
            </div>
          ))}
        </div>
      </section>

      {/* Zip Codes */}
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
            Zip Codes We Cover in {area.city}
          </h2>
          <div className="flex flex-wrap gap-3">
            {area.zipCodes.map((zip) => (
              <span
                key={zip}
                className="inline-block px-4 py-2 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700"
              >
                {zip}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8 text-center">
          Frequently Asked Questions
        </h2>
        <div className="space-y-6">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                {faq.question}
              </h3>
              <p className="text-slate-600 leading-relaxed">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Booking Form */}
      <section id="book" className="bg-gradient-to-b from-white to-[#a8e0ef]/20 py-12 sm:py-16">
        <div className="max-w-xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2 text-center">
            Book a Cleaning in {area.city}
          </h2>
          <p className="text-slate-600 text-center mb-8">
            Fill out the form below and we will confirm your appointment within the hour.
          </p>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 sm:p-8">
            <BookingForm source={`area-${area.slug}`} />
          </div>
        </div>
      </section>

      {/* Nearby Cities */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6 text-center">
          Nearby Cities We Serve
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {nearbyCities.map((nearby) => (
            <Link
              key={nearby.slug}
              href={`/spotless/areas/${nearby.slug}`}
              className="text-center px-4 py-3 rounded-lg border border-slate-200 bg-white text-sm font-medium text-[#2195b4] hover:bg-[#2195b4] hover:text-white transition-colors"
            >
              {nearby.city}
            </Link>
          ))}
        </div>
      </section>
    </>
  )
}
