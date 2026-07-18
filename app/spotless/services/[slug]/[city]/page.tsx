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
  getLocalIntro,
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

  // Airbnb targets the full short-term-rental keyword cluster (VRBO, vacation rental,
  // turnover, same-day flip), not just "airbnb cleaning" — hosts search all of these.
  // Post-construction and commercial get the same treatment: contractors search "final
  // clean" / "construction cleanup", facility managers search "janitorial" / "office
  // cleaning" — the default title only wins the literal service name.
  const clusterTitles: Record<string, string> = {
    "airbnb-cleaning": `Airbnb & Short-Term Rental Turnover Cleaning in ${area.city}, CA | Spotless Scrubbers`,
    "post-construction-cleaning": `Post-Construction Cleaning in ${area.city}, CA | Final Clean & Construction Cleanup`,
    "commercial-cleaning": `Commercial Cleaning & Janitorial Services in ${area.city}, CA | Spotless Scrubbers`,
  }
  const clusterDescriptions: Record<string, string> = {
    "airbnb-cleaning": `Airbnb, VRBO & vacation rental turnover cleaning in ${area.city}. Same-day flips, linen changes, restocking, and damage reports between guests. Insured, 5-star rated. Book online or text today.`,
    "post-construction-cleaning": `Post-construction and final cleaning in ${area.city} for general contractors, builders, and homeowners. Rough, final, and touch-up cleans, drywall dust removal, sticker removal, punch-walk ready. Insured, COI available.`,
    "commercial-cleaning": `Office cleaning and janitorial services in ${area.city} for facility managers and business owners. Nightly or weekly after-hours service, restroom restocking, floor care. Insured and bonded, COI available. Free walkthrough quote.`,
  }
  const title =
    clusterTitles[service.slug] ??
    `${service.shortTitle} in ${area.city}, CA | Spotless Scrubbers`
  const description =
    clusterDescriptions[service.slug] ??
    `Professional ${service.title.toLowerCase()} in ${area.city}. Insured, 5-star rated. Book online or call today.`

  return {
    title,
    description,
    alternates: {
      canonical: `${SPOTLESS_BUSINESS.url}/services/${slug}/${city}`,
    },
  }
}

function getCityServiceFAQs(service: SpotlessService, area: SpotlessArea) {
  const neighborhoodList = area.neighborhoods.slice(0, 4).join(", ")

  // Airbnb/STR hosts ask different questions than homeowners (turnaround speed, linens,
  // calendar sync, damage reports, per-turnover pricing). Answer-first copy here feeds
  // both the visible FAQ and FAQ schema — the biggest GEO/AI-citation lever for this niche.
  if (service.slug === "airbnb-cleaning") {
    return [
      {
        question: `How fast is your Airbnb turnover cleaning in ${area.city}?`,
        answer: `We offer same-day turnovers in ${area.city}, so your rental is guest-ready between check-out and check-in. Send us your booking gaps and we hit every window - even tight same-day flips - so you never have to block a night for cleaning.`,
      },
      {
        question: `Do you change linens and restock supplies between guests?`,
        answer: `Yes. Every ${area.city} turnover includes fresh linen and towel changes, bed making, and restocking the essentials guests expect - toiletries, paper goods, coffee, and more. We can work from your supply closet or a checklist you provide so each stay starts 5-star ready.`,
      },
      {
        question: `Do you report damage or missing items after each stay?`,
        answer: `Always. After every clean we send a quick damage-and-maintenance report with photos, so you catch issues before the next guest checks in - protecting your reviews and any AirCover or VRBO claims.`,
      },
      {
        question: `Can you coordinate with my booking calendar in ${area.city}?`,
        answer: `Yes. Share your Airbnb or VRBO calendar, or just text us your turn dates, and we schedule cleans around your check-ins automatically. Property managers with multiple ${area.city} units get one point of contact for all of them.`,
      },
      {
        question: `How much does Airbnb cleaning cost in ${area.city}?`,
        answer: `${area.city} short-term rental turnovers start at ${service.priceRange}, priced per turnover based on unit size and whether linens and restocking are included - not by the hour. You get a flat per-clean rate up front so your margins stay predictable.`,
      },
      {
        question: `Do you serve ${neighborhoodList}?`,
        answer: `Yes! We clean short-term rentals across ${area.city}, including ${neighborhoodList}, and surrounding areas. If your ${area.county} property books guests, we can turn it over.`,
      },
    ]
  }

  // Contractors and builders ask job-site questions (phases, COI, scheduling around
  // trades, punch walks) — not homeowner questions. Same answer-first pattern as Airbnb.
  if (service.slug === "post-construction-cleaning") {
    return [
      {
        question: `How much does post-construction cleaning cost in ${area.city}?`,
        answer: `Post-construction cleaning in ${area.city} starts at $300 and is priced by square footage and the condition of the site - a light final clean on a small remodel costs less than a full new build covered in drywall dust. Send us the square footage and a few photos and we quote it flat, up front. No hourly surprises.`,
      },
      {
        question: `What's the difference between a rough clean and a final clean?`,
        answer: `A rough clean happens mid-project - removing debris and heavy dust so trades can keep working. The final clean happens after all trades are done: drywall dust wiped from every surface, windows cleaned with stickers and tape removed, floors scrubbed, paint splatter removed, fixtures polished. We also do touch-up cleans after the punch walk. You can book any phase or all three.`,
      },
      {
        question: `Do you work with general contractors in ${area.city}?`,
        answer: `Yes - general contractors and builders across ${area.county} use us as their go-to final-clean crew. We're insured, we can provide a COI for your job site, and we schedule around your trades and your punch-walk date so the clean never holds up the handover.`,
      },
      {
        question: `How soon can you get a crew to a job site in ${area.city}?`,
        answer: `Usually within a few days, and we can often accommodate tight handover deadlines in ${area.city}. Construction schedules slip - when your completion date moves, we move with it at no charge. Text us the new date and we rebook the crew.`,
      },
      {
        question: `What does your post-construction cleaning include?`,
        answer: `Everything between construction-done and move-in ready: construction dust and debris removal, drywall dust wiped from walls, ceilings, and every surface, window and glass cleaning with sticker and tape removal, floor scrubbing and polishing, paint splatter removal, HVAC vent and register cleaning, and a final detail inspection against your punch list.`,
      },
      {
        question: `Do you serve job sites in ${neighborhoodList}?`,
        answer: `Yes! We handle post-construction cleans across ${area.city}, including ${neighborhoodList}, and all of ${area.county} - residential remodels, new builds, and commercial buildouts alike.`,
      },
    ]
  }

  // Facility and office managers ask vendor questions (contracts, COI, after-hours,
  // consistency) — the generic homeowner FAQ answers none of them.
  if (service.slug === "commercial-cleaning") {
    return [
      {
        question: `How much does commercial cleaning cost in ${area.city}?`,
        answer: `Commercial cleaning in ${area.city} starts at $150 per visit, with most offices on a flat monthly rate based on square footage, cleaning frequency, and scope. We do a free 10-minute walkthrough of your space and give you an exact quote - no obligation, no hidden fees.`,
      },
      {
        question: `Do you require long-term janitorial contracts?`,
        answer: `No. We're month-to-month with no lock-in. Most commercial clients in ${area.city} stay because the cleaning is consistent, not because a contract forces them to. If you're stuck with an unreliable janitorial vendor, switching is a single walkthrough away.`,
      },
      {
        question: `Can you clean after business hours in ${area.city}?`,
        answer: `Yes - most of our ${area.city} commercial cleaning happens after hours or before opening, so your team and your customers never see a mop bucket. Nightly, weekly, or custom schedules all work, and we coordinate building access with your facility or property manager.`,
      },
      {
        question: `What types of facilities do you clean in ${area.city}?`,
        answer: `Offices and office buildings, coworking spaces, medical and dental practices, gyms and fitness studios, retail stores and showrooms, and managed commercial facilities across ${area.city}. Each space gets a scope tailored to how it's actually used - restrooms, breakrooms, lobbies, treatment rooms, or sales floors.`,
      },
      {
        question: `Are you insured, and can you provide a COI for our building?`,
        answer: `Yes. We're fully insured and bonded, every cleaner is background-checked, and we can provide a certificate of insurance for your building or property management company as part of vendor onboarding. Facility managers get one point of contact for scheduling, walkthroughs, and any issue that comes up.`,
      },
      {
        question: `Do you serve businesses in ${neighborhoodList}?`,
        answer: `Yes! We clean commercial spaces across ${area.city}, including ${neighborhoodList}, and all of ${area.county}. Book a free walkthrough and we'll quote your space this week.`,
      },
    ]
  }

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
      answer: `Booking is simple - fill out the form on this page or call us at ${SPOTLESS_BUSINESS.phone}. We confirm your appointment instantly and match you with a cleaner familiar with the ${area.city} area.`,
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
    "post-construction-cleaning": `After a renovation or build in ${area.city}, the dust and debris can be overwhelming. Our post-construction crews handle every phase - rough cleans mid-project, the full final clean once trades are done, and touch-up cleans after the punch walk. We remove drywall dust from every surface, pull stickers and tape off new windows, scrub floors, and clean out vents and registers. General contractors and builders near ${landmarkMention} use us as their handover crew because we hit deadlines, move when the schedule moves, and can put a COI on file for the job site - and homeowners finishing a remodel get the same detail-obsessed final clean.`,
    "commercial-cleaning": `A clean workspace matters in ${area.city}. Our commercial cleaning and janitorial service keeps offices, medical practices, gyms, retail spaces, and managed facilities spotless on a nightly, weekly, or custom schedule - almost always after hours, so your team and customers never see us work. Facility and property managers near ${landmarkMention} get one insured, bonded vendor with a COI on file, a single point of contact, and month-to-month terms with no lock-in contract. From restroom restocking and floor care to lobby and breakroom upkeep, the space is simply always presentable.`,
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
              <Link href="/services" className="hover:text-[#2195b4]">
                Services
              </Link>
              <span>/</span>
              <Link
                href={`/services/${service.slug}`}
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
            <p className="text-slate-700 leading-relaxed">{getLocalIntro(area.slug)}</p>
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
                Fill out the form and your appointment is confirmed instantly.
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
                    href={`/services/${s.slug}/${area.slug}`}
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
                href={`/areas/${area.slug}`}
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
                    href={`/services/${service.slug}/${a.slug}`}
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
