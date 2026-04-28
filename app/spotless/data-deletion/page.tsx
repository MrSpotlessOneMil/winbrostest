import type { Metadata } from "next"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "Data Deletion - Spotless Scrubbers",
  description:
    "How to request deletion of your personal data from Spotless Scrubbers.",
}

export default function DataDeletionPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Data Deletion", url: `${SPOTLESS_BUSINESS.url}/data-deletion` },
        ]}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">
          Data Deletion Request
        </h1>
        <p className="text-sm text-slate-500 mb-10">Last updated: April 28, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Your Right to Deletion</h2>
            <p>
              You can request that {SPOTLESS_BUSINESS.legalName} (&quot;Spotless Scrubbers&quot;)
              delete the personal information we have collected about you, including any data
              obtained through Facebook Login, Meta lead ads, or our website forms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">How to Request Deletion</h2>
            <p className="mb-3">
              Send an email to{" "}
              <a
                href="mailto:dominic@spotlesservices.com?subject=Data%20Deletion%20Request"
                className="text-blue-600 underline"
              >
                dominic@spotlesservices.com
              </a>{" "}
              with the subject line <strong>&quot;Data Deletion Request&quot;</strong>. Include:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your full name</li>
              <li>The phone number and/or email address associated with your account</li>
              <li>Any property address(es) we have on file for you</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">What Happens Next</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                We will confirm receipt of your request within 3 business days.
              </li>
              <li>
                We will permanently delete your personal information from our active systems within
                30 days of confirmation.
              </li>
              <li>
                We will notify you by email once the deletion is complete.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">What We May Retain</h2>
            <p>
              We may retain a limited subset of your information when required by law or for
              legitimate business purposes, such as completed transaction records for tax and
              accounting compliance, or fraud prevention. Any retained data is kept securely and
              used only for these specific purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">Questions</h2>
            <p>
              If you have any questions about this process or need help submitting a request,
              email{" "}
              <a
                href="mailto:dominic@spotlesservices.com"
                className="text-blue-600 underline"
              >
                dominic@spotlesservices.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
