import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "Privacy Policy - Spotless Scrubbers",
  description:
    "Spotless Scrubbers privacy policy. Learn how we collect, use, and protect your personal information.",
}

export default function PrivacyPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Privacy Policy", url: `${SPOTLESS_BUSINESS.url}/privacy` },
        ]}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-slate-500 mb-10">
          Last updated: March 18, 2026
        </p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Who We Are</h2>
            <p>
              {SPOTLESS_BUSINESS.legalName} (&quot;Spotless Scrubbers,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
              operates the website {SPOTLESS_BUSINESS.url} and provides professional cleaning
              services across {SPOTLESS_BUSINESS.areaServed}. This Privacy Policy explains how we
              collect, use, disclose, and safeguard your information when you visit our website or
              use our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Information We Collect</h2>
            <p className="mb-3">We may collect the following types of information:</p>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Personal Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-1 mb-4">
              <li>Name and contact information (email address, phone number)</li>
              <li>Home or business address where cleaning services are requested</li>
              <li>Service preferences, scheduling details, and special instructions</li>
              <li>Payment information (processed securely through our payment processor)</li>
              <li>Communications you send to us (emails, form submissions, phone calls)</li>
            </ul>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Information Collected Automatically</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>Device information (browser type, operating system)</li>
              <li>IP address and approximate location</li>
              <li>Pages visited, time spent on pages, and referring URLs</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide, maintain, and improve our cleaning services</li>
              <li>To process bookings, payments, and send appointment confirmations</li>
              <li>To communicate with you about your service, including reminders and follow-ups</li>
              <li>To respond to your inquiries and provide customer support</li>
              <li>To send promotional communications (you can opt out at any time)</li>
              <li>To analyze website usage and improve our online experience</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. How We Share Your Information</h2>
            <p className="mb-3">We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Service providers</strong> - payment processors, scheduling software, communication tools, and analytics providers that help us operate our business</li>
              <li><strong>Our cleaning team</strong> - your name, address, and service details so they can perform your cleaning</li>
              <li><strong>Legal compliance</strong> - when required by law, court order, or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Cookies and Tracking</h2>
            <p className="mb-3">
              We use cookies and similar technologies to improve your experience on our website. This includes:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Essential cookies</strong> - required for the website to function properly</li>
              <li><strong>Analytics cookies</strong> - help us understand how visitors use our site (Google Analytics)</li>
              <li><strong>Advertising cookies</strong> - used to deliver relevant ads and measure campaign performance (Meta Pixel)</li>
            </ul>
            <p className="mt-3">
              You can control cookies through your browser settings. Disabling cookies may affect some website functionality.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Data Security</h2>
            <p>
              We implement reasonable administrative, technical, and physical security measures to protect
              your personal information. However, no method of transmission over the internet or electronic
              storage is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Your California Privacy Rights</h2>
            <p className="mb-3">
              If you are a California resident, you have additional rights under the California Consumer
              Privacy Act (CCPA) and the California Privacy Rights Act (CPRA):
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>The right to know what personal information we collect and how it is used</li>
              <li>The right to request deletion of your personal information</li>
              <li>The right to opt out of the sale or sharing of your personal information</li>
              <li>The right to non-discrimination for exercising your privacy rights</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact us at{" "}
              <a href={`mailto:${SPOTLESS_BUSINESS.email}`} className="text-[#2195b4] hover:underline">
                {SPOTLESS_BUSINESS.email}
              </a>{" "}
              or call{" "}
              <a href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`} className="text-[#2195b4] hover:underline">
                {SPOTLESS_BUSINESS.phone}
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">8. Data Retention</h2>
            <p>
              We retain your personal information for as long as necessary to provide our services,
              comply with legal obligations, resolve disputes, and enforce our agreements. When your
              information is no longer needed, we will securely delete or anonymize it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">9. Children&apos;s Privacy</h2>
            <p>
              Our services are not directed to individuals under the age of 18. We do not knowingly
              collect personal information from children. If we become aware that a child has provided
              us with personal information, we will take steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any material
              changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
              Your continued use of our website or services after changes are posted constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">11. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or our data practices, contact us at:
            </p>
            <div className="mt-3 bg-slate-50 rounded-xl p-5 text-sm">
              <p className="font-semibold text-slate-900">{SPOTLESS_BUSINESS.legalName}</p>
              <p>{SPOTLESS_BUSINESS.areaServed}</p>
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
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link
            href="/"
            className="text-sm text-[#2195b4] hover:text-[#155f73] transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </>
  )
}
