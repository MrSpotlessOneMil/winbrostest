import type { Metadata } from "next"
import Link from "next/link"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  title: "Terms of Service - Spotless Scrubbers",
  description:
    "Spotless Scrubbers terms of service. Read our terms and conditions for using our cleaning services and website.",
}

export default function TermsPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Terms of Service", url: `${SPOTLESS_BUSINESS.url}/terms` },
        ]}
      />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-slate-500 mb-10">
          Last updated: March 18, 2026
        </p>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">1. Agreement to Terms</h2>
            <p>
              By accessing the website at {SPOTLESS_BUSINESS.url} or booking cleaning services
              through {SPOTLESS_BUSINESS.legalName} (&quot;Spotless Scrubbers,&quot; &quot;we,&quot; &quot;us,&quot;
              or &quot;our&quot;), you agree to be bound by these Terms of Service. If you do not agree
              with any part of these terms, you may not use our website or services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">2. Services</h2>
            <p className="mb-3">
              Spotless Scrubbers provides professional residential and commercial cleaning services
              across {SPOTLESS_BUSINESS.areaServed}. Our services include standard cleaning, deep
              cleaning, move-in/move-out cleaning, post-construction cleaning, commercial cleaning,
              and Airbnb/short-term rental cleaning.
            </p>
            <p>
              Service availability, pricing, and scheduling are subject to change. We will confirm
              all details before your appointment.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">3. Booking and Scheduling</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Bookings can be made through our website, by phone at {SPOTLESS_BUSINESS.phone}, or by email at {SPOTLESS_BUSINESS.email}.</li>
              <li>All bookings are subject to availability and confirmation by our team.</li>
              <li>You agree to provide accurate information about the property, including size, condition, and any special requirements.</li>
              <li>We will confirm your appointment and provide an estimated price before service begins.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">4. Pricing and Payment</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Prices provided through our website or quote calculator are estimates. Final pricing is confirmed based on the actual scope of work.</li>
              <li>Payment is due upon completion of service unless other arrangements have been made.</li>
              <li>We accept major credit cards, debit cards, and other payment methods as indicated at the time of booking.</li>
              <li>For recurring service clients, payment terms will be agreed upon at the start of the service agreement.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">5. Cancellation and Rescheduling</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may cancel or reschedule your appointment free of charge with at least 24 hours notice.</li>
              <li>Cancellations made less than 24 hours before the scheduled service may be subject to a cancellation fee of up to 50% of the estimated service cost.</li>
              <li>No-shows (failure to provide access at the scheduled time) will be charged the full estimated service cost.</li>
              <li>We reserve the right to cancel or reschedule appointments due to unforeseen circumstances, emergencies, or weather conditions. We will provide as much notice as possible.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">6. Access to Property</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>You are responsible for providing safe and reasonable access to the property for our cleaning team.</li>
              <li>If you provide keys, lockbox codes, or smart lock access, you consent to our team entering the property at the scheduled time.</li>
              <li>We are not responsible for any access issues caused by incorrect codes, broken locks, or other access problems beyond our control.</li>
              <li>Please secure valuables, fragile items, and anything requiring special handling before our team arrives.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">7. Satisfaction Guarantee</h2>
            <p className="mb-3">
              We stand behind the quality of our work. If you are not satisfied with any aspect
              of our cleaning:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Contact us within 24 hours of service completion.</li>
              <li>We will send a team back to re-clean the areas of concern at no additional charge.</li>
              <li>The re-clean must be scheduled within 48 hours of the original service.</li>
              <li>This guarantee covers the quality of cleaning performed, not personal preferences regarding cleaning methods or products.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">8. Liability and Insurance</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Spotless Scrubbers is fully insured and bonded. Our team members are covered by our general liability insurance policy.</li>
              <li>In the event of accidental damage to your property during service, please report it within 24 hours. We will assess the damage and work with you to resolve the issue.</li>
              <li>Our liability is limited to the cost of repair or replacement of the damaged item, up to a reasonable market value.</li>
              <li>We are not liable for damage to items that are already fragile, improperly installed, or not brought to our attention before service.</li>
              <li>We are not liable for pre-existing damage, normal wear and tear, or stains that cannot be removed through standard cleaning methods.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">9. Pet Policy</h2>
            <p>
              Please inform us if you have pets in the home. For the safety of our team and your
              pets, we ask that animals be secured in a separate room or area during cleaning.
              We are not responsible for pets that escape through open doors during service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">10. Website Use</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may use our website for its intended purpose of learning about and booking our services.</li>
              <li>You agree not to use our website for any unlawful purpose or to violate any applicable laws.</li>
              <li>We reserve the right to modify or discontinue our website at any time without notice.</li>
              <li>Website content, including text, images, and design, is the property of {SPOTLESS_BUSINESS.legalName} and may not be reproduced without permission.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">11. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by law, {SPOTLESS_BUSINESS.legalName} shall not be
              liable for any indirect, incidental, special, consequential, or punitive damages
              arising out of or relating to your use of our services or website. Our total liability
              shall not exceed the amount paid for the specific service giving rise to the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">12. Governing Law</h2>
            <p>
              These Terms of Service are governed by and construed in accordance with the laws of
              the State of California, without regard to its conflict of law provisions. Any disputes
              arising under these terms shall be resolved in the courts of Los Angeles County, California.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">13. Changes to Terms</h2>
            <p>
              We reserve the right to update these Terms of Service at any time. Changes will be
              posted on this page with an updated revision date. Your continued use of our website
              or services after changes are posted constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-3">14. Contact Us</h2>
            <p>
              If you have questions about these Terms of Service, contact us at:
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
