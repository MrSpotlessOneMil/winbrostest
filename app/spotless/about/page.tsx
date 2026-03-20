import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "About Us - Spotless Scrubbers",
  description:
    "Learn about Spotless Scrubbers - Los Angeles County's trusted house cleaning service. Insured, professionally trained cleaners since 2023.",
  alternates: {
    canonical: `${SPOTLESS_BUSINESS.url}/spotless/about`,
  },
}

const VALUES = [
  {
    title: "Instant Booking",
    description:
      "Book online in under a minute. Get instant confirmation. No phone tag, no waiting for callbacks.",
    icon: "\u26A1", // lightning
  },
  {
    title: "Transparent Pricing",
    description:
      "See your price before you book. No hidden fees, no surprise charges.",
    icon: "\uD83D\uDCCB", // clipboard
  },
  {
    title: "Safe & Professional",
    description:
      "Every cleaner is background-checked, insured, and professionally trained. We only use high-quality, safe products in your home.",
    icon: "\uD83C\uDF3F", // leaf
  },
  {
    title: "Satisfaction Guaranteed",
    description:
      "Not happy? Let us know within 24 hours and we come back and fix it at no charge.",
    icon: "\u2B50", // star
  },
]

const STATS = [
  { label: "Cities Served", value: "20+" },
  { label: "Google Rating", value: "5.0" },
  { label: "Homes Cleaned", value: "2,500+" },
  { label: "Years in Business", value: String(new Date().getFullYear() - SPOTLESS_BUSINESS.foundingYear) },
]

export default function AboutPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "About", url: `${SPOTLESS_BUSINESS.url}/about` },
        ]}
      />

      {/* Hero */}
      <section className="relative py-24 sm:py-32">
        <img
          src="/images/marketing/team-branded.jpg"
          alt="Spotless Scrubbers cleaning team at work"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/65" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Meet the Team Behind the Clean
          </h1>
          <p className="text-lg sm:text-xl text-white/85 max-w-2xl mx-auto">
            Founded in LA. Powered by a professional team and modern systems
            that make booking fast and service flawless.
          </p>
        </div>
      </section>

      {/* Our Story */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">
          Our Story
        </h2>
        <div className="flex flex-col lg:flex-row gap-8 items-start">
          <div className="space-y-4 text-lg text-slate-700 leading-relaxed lg:flex-1">
            <p>
              Spotless Scrubbers was founded in 2023 right here in Los Angeles.
              After seeing too many cleaning companies cancel last minute, cut corners,
              and leave clients frustrated — we set out to build something better.
              A service that actually delivers on its promises.
            </p>
            <p>
              What started with a handful of homes in one neighborhood has grown into
              a team of 9 professional cleaners serving over 20 cities across LA County —
              from Santa Monica to Pasadena, Long Beach to Burbank, and everywhere in between.
            </p>
            <p>
              Every cleaner is background-checked, insured, and trained to the same high
              standard. We run on modern systems that enable instant booking, automated
              scheduling, and real-time updates — so you get the speed and reliability
              you deserve.
            </p>
          </div>
          <div className="lg:flex-1 w-full">
            <img
              src="/images/marketing/clean-bedroom.jpg"
              alt="Spotlessly clean bedroom after a professional Spotless Scrubbers cleaning"
              className="rounded-xl w-full h-auto object-cover shadow-lg"
            />
          </div>
        </div>
      </section>

      {/* Our Values */}
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8 text-center">
            Our Values
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((value) => (
              <div
                key={value.title}
                className="rounded-xl border border-slate-200 bg-white p-6 text-center"
              >
                <div className="text-3xl mb-3">{value.icon}</div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{value.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {value.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* By the Numbers */}
      <section className="bg-[#2195b4] py-12 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-8 text-center">
            By the Numbers
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl sm:text-5xl font-bold text-white mb-1">
                  {stat.value}
                </div>
                <div className="text-[#a8e0ef] text-sm font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Team */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6 text-center">
          Our Cleaning Team
        </h2>
        <div className="mb-8">
          <img
            src="/images/marketing/team-branded.jpg"
            alt="Spotless Scrubbers team member in branded uniform at a Los Angeles property"
            className="rounded-xl w-full h-64 sm:h-80 object-cover shadow-lg"
          />
        </div>
        <div className="space-y-4 text-lg text-slate-700 leading-relaxed text-center max-w-3xl mx-auto mb-8">
          <p>
            Every cleaner goes through a comprehensive training program before their
            first job. They learn our standards, our techniques, and understand that
            your home is not just another appointment.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {[
            {
              title: "Professionally Trained",
              description:
                "Every cleaner completes our comprehensive training program covering cleaning techniques, product safety, and customer service.",
            },
            {
              title: "Background-Checked",
              description:
                "All team members pass a thorough background check before they ever step foot in your home. Your safety is non-negotiable.",
            },
            {
              title: "Fully Insured",
              description:
                "We carry comprehensive liability insurance and bonding. You are protected from the moment we walk through your door.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[#2195b4]">&#10003;</span>
                <h3 className="font-bold text-slate-900">{item.title}</h3>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-[#155f73] py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Ready to See What We Can Do?
          </h2>
          <p className="text-[#a8e0ef] mb-6">
            Book in 60 seconds. If you are not happy, we re-clean for free. That is our guarantee.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/spotless/contact"
              className="inline-block px-8 py-3 rounded-lg bg-white text-[#155f73] font-semibold hover:bg-[#a8e0ef] transition-colors"
            >
              Book a Cleaning
            </Link>
            <a
              href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
              className="inline-block px-8 py-3 rounded-lg border border-white text-white font-semibold hover:bg-white/10 transition-colors"
            >
              Call {SPOTLESS_BUSINESS.phone}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
