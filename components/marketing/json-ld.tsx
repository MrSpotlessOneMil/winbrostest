import type { SpotlessArea } from "@/lib/marketing/spotless-areas"
import type { SpotlessService } from "@/lib/marketing/spotless-services"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"

// Generic JSON-LD injector
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

// LocalBusiness schema for the main site
export function LocalBusinessJsonLd({ area }: { area?: SpotlessArea }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${SPOTLESS_BUSINESS.url}/#business`,
    name: SPOTLESS_BUSINESS.name,
    description: SPOTLESS_BUSINESS.description,
    url: SPOTLESS_BUSINESS.url,
    telephone: SPOTLESS_BUSINESS.phone,
    email: SPOTLESS_BUSINESS.email,
    priceRange: SPOTLESS_BUSINESS.priceRange,
    foundingDate: String(SPOTLESS_BUSINESS.foundingYear),
    areaServed: area
      ? {
          "@type": "City",
          name: `${area.city}, ${area.stateAbbr}`,
          geo: {
            "@type": "GeoCoordinates",
            latitude: area.lat,
            longitude: area.lng,
          },
        }
      : {
          "@type": "AdministrativeArea",
          name: SPOTLESS_BUSINESS.areaServed,
        },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: SPOTLESS_BUSINESS.rating,
      reviewCount: SPOTLESS_BUSINESS.reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: area?.city || SPOTLESS_BUSINESS.address.city,
      addressRegion: SPOTLESS_BUSINESS.address.stateAbbr,
      addressCountry: SPOTLESS_BUSINESS.address.country,
    },
    ...(area && {
      geo: {
        "@type": "GeoCoordinates",
        latitude: area.lat,
        longitude: area.lng,
      },
    }),
    sameAs: Object.values(SPOTLESS_BUSINESS.social),
    founder: {
      "@type": "Person",
      name: "Dominic",
      jobTitle: "Founder & Owner",
    },
  }

  return <JsonLd data={data} />
}

// Founder schema
export function FounderJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Dominic",
    jobTitle: "Founder & Owner",
    worksFor: {
      "@type": "LocalBusiness",
      name: SPOTLESS_BUSINESS.name,
      url: SPOTLESS_BUSINESS.url,
    },
    knowsAbout: [
      "House Cleaning",
      "Commercial Cleaning",
      "Post-Construction Cleaning",
      "Professional Cleaning Standards",
      "Los Angeles County",
    ],
  }

  return <JsonLd data={data} />
}

// Service schema with AggregateOffer
export function ServiceJsonLd({ service, city }: { service: SpotlessService; city?: string }) {
  const locationSuffix = city ? ` in ${city}, CA` : " in Los Angeles"

  // Parse price from "Starting at $120" or "$120 - $250" format
  const startingAtMatch = service.priceRange.match(/Starting at \$(\d+)/)
  const rangeMatch = service.priceRange.match(/\$(\d+)\s*-\s*\$(\d+)/)
  const price = startingAtMatch ? startingAtMatch[1] : rangeMatch ? rangeMatch[1] : "100"

  const data = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${service.title}${locationSuffix}`,
    description: service.description,
    provider: {
      "@type": "LocalBusiness",
      name: SPOTLESS_BUSINESS.name,
      telephone: SPOTLESS_BUSINESS.phone,
      url: SPOTLESS_BUSINESS.url,
    },
    areaServed: {
      "@type": "City",
      name: city ? `${city}, CA` : "Los Angeles, CA",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price,
    },
    serviceType: service.title,
  }

  return <JsonLd data={data} />
}

// FAQ schema
export function FAQJsonLd({ faqs }: { faqs: { question: string; answer: string }[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  }

  return <JsonLd data={data} />
}

// Breadcrumb schema
export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[]
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return <JsonLd data={data} />
}

// HowTo schema
export function HowToJsonLd({
  name,
  steps,
}: {
  name: string
  steps: { name: string; text: string }[]
}) {
  const data = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  }

  return <JsonLd data={data} />
}

// SoftwareApplication schema (for Osiris)
export function SoftwareApplicationJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Osiris AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "AI-powered operations platform for service businesses. Automates lead intake, qualification, scheduling, dispatch, payments, and lifecycle management.",
    url: "https://theosirisai.com",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Book a demo for pricing",
    },
    creator: {
      "@type": "Organization",
      name: "Osiris AI",
      url: "https://theosirisai.com",
    },
  }

  return <JsonLd data={data} />
}
