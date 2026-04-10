import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_AREAS, SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "Service Areas - Los Angeles County House Cleaning",
  description:
    "Spotless Scrubbers serves 20+ cities across Los Angeles County. Find professional house cleaning in your neighborhood - insured, 5-star rated.",
  alternates: {
    canonical: `${SPOTLESS_BUSINESS.url}/spotless/areas`,
  },
}

export default function AreasPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Service Areas", url: `${SPOTLESS_BUSINESS.url}/areas` },
        ]}
      />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#a8e0ef]/30 to-white py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-slate-900 mb-4">
            House Cleaning Across Los Angeles County
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 max-w-3xl mx-auto">
            We proudly serve over 20 cities throughout Los Angeles County. From the beaches of
            Santa Monica to the hills of Pasadena, our insured and background-checked
            cleaning teams bring professional service right to your door.
          </p>
        </div>
      </section>

      {/* Area Cards Grid */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
          {SPOTLESS_AREAS.map((area) => (
            <Link
              key={area.slug}
              href={`/spotless/areas/${area.slug}`}
              className="group rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
            >
              {/* Teal accent bar */}
              <div className="h-1.5 bg-[#2195b4] group-hover:bg-[#155f73] transition-colors" />

              <div className="p-5 flex flex-col flex-1">
                <h2 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-[#2195b4] transition-colors">
                  {area.city}
                </h2>

                {/* Neighborhoods preview - first 3 */}
                <p className="text-sm text-slate-600 mb-3 leading-relaxed">
                  {area.neighborhoods.slice(0, 3).join(", ")}
                  {area.neighborhoods.length > 3 && " & more"}
                </p>

                {/* Spacer */}
                <div className="mt-auto" />

                {/* Zip code count badge */}
                <div className="flex items-center justify-between mt-3">
                  <span className="inline-block px-2.5 py-1 rounded-full bg-[#a8e0ef]/40 text-[#155f73] text-xs font-semibold">
                    {area.zipCodes.length} zip code{area.zipCodes.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-sm font-semibold text-[#2195b4] group-hover:text-[#155f73] transition-colors">
                    View Details &rarr;
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA Banner */}
      <section className="bg-[#155f73] py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Don&apos;t See Your City?
          </h2>
          <p className="text-[#a8e0ef] mb-6">
            We&apos;re expanding across LA County every month. Call us to check availability
            in your area or to schedule a cleaning today.
          </p>
          <a
            href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
            className="inline-block px-8 py-3 rounded-lg bg-white text-[#155f73] font-semibold hover:bg-[#a8e0ef] transition-colors"
          >
            Call {SPOTLESS_BUSINESS.phone}
          </a>
        </div>
      </section>
    </>
  )
}
