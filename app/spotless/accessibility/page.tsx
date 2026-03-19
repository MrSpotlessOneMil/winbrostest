import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "Accessibility Statement - Spotless Scrubbers",
  description:
    "Spotless Scrubbers is committed to ensuring digital accessibility for people with disabilities.",
}

export default function AccessibilityPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Accessibility", url: `${SPOTLESS_BUSINESS.url}/accessibility` },
        ]}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">
          Accessibility Statement
        </h1>
        <p className="text-sm text-slate-500 mb-10">
          Last updated: March 18, 2026
        </p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Our Commitment</h2>
            <p>
              {SPOTLESS_BUSINESS.legalName} is committed to ensuring digital accessibility for
              people with disabilities. We are continually improving the user experience for everyone
              and applying the relevant accessibility standards to ensure we provide equal access to
              all users.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Conformance Status</h2>
            <p>
              We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA.
              These guidelines explain how to make web content more accessible for people with
              disabilities and more user-friendly for everyone.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Measures We Take</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Semantic HTML structure for screen reader compatibility</li>
              <li>Sufficient color contrast ratios for text readability</li>
              <li>Alt text for all meaningful images</li>
              <li>Keyboard-navigable interface elements</li>
              <li>Responsive design that works across devices and screen sizes</li>
              <li>Clear and consistent navigation</li>
              <li>Form labels and error messages for assistive technology</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Alternative Ways to Book</h2>
            <p>
              If you experience any difficulty using our website, you can always reach us through
              alternative channels to book a cleaning or ask questions:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-3">
              <li>
                Call us at{" "}
                <a href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`} className="text-[#2195b4] hover:underline">
                  {SPOTLESS_BUSINESS.phone}
                </a>
              </li>
              <li>
                Email us at{" "}
                <a href={`mailto:${SPOTLESS_BUSINESS.email}`} className="text-[#2195b4] hover:underline">
                  {SPOTLESS_BUSINESS.email}
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Feedback</h2>
            <p>
              We welcome your feedback on the accessibility of our website. If you encounter any
              accessibility barriers or have suggestions for improvement, please contact us:
            </p>
            <div className="mt-3 bg-slate-50 rounded-xl p-5 text-sm">
              <p className="font-semibold text-slate-900">{SPOTLESS_BUSINESS.legalName}</p>
              <p>
                Email:{" "}
                <a href={`mailto:${SPOTLESS_BUSINESS.email}`} className="text-[#2195b4] hover:underline">
                  {SPOTLESS_BUSINESS.email}
                </a>
              </p>
              <p>
                Phone:{" "}
                <a href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`} className="text-[#2195b4] hover:underline">
                  {SPOTLESS_BUSINESS.phone}
                </a>
              </p>
            </div>
            <p className="mt-3">
              We try to respond to accessibility feedback within 2 business days.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link
            href="/spotless"
            className="text-sm text-[#2195b4] hover:text-[#155f73] transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </>
  )
}
