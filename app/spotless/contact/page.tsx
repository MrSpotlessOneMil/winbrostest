import type { Metadata } from "next"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"
import { QuoteCalculator } from "@/components/marketing/quote-calculator"

export const metadata: Metadata = {
  title: "Book a Cleaning - Contact Spotless Scrubbers",
  description:
    "Book a professional house cleaning in Los Angeles County. Instant booking confirmation. Same-day available. Insured, background-checked cleaners.",
  alternates: {
    canonical: `${SPOTLESS_BUSINESS.url}/contact`,
  },
}

export default function ContactPage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Contact", url: `${SPOTLESS_BUSINESS.url}/contact` },
        ]}
      />

      {/* Hero */}
      <section className="relative py-16 sm:py-20 overflow-hidden">
        <img
          src="/images/marketing/hero-clean-home.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#155f73]/75" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Book Your Cleaning
          </h1>
          <p className="text-lg sm:text-xl text-white/90 max-w-2xl mx-auto">
            Fill out the form below for instant confirmation.
            Or call us for same-day bookings.
          </p>
        </div>
      </section>

      {/* Quote Calculator - Primary CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Left: Quote Calculator + Trust Signals */}
          <div className="lg:col-span-3 space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-1">
                Get Your Instant Quote
              </h2>
              <p className="text-sm text-slate-600 mb-6">
                Select your home details and see your price instantly. No commitment required.
              </p>
              <QuoteCalculator source="contact_page" />
            </div>

            {/* Trust Signals */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#059669" className="w-5 h-5">
                    <path fillRule="evenodd" d="M12.516 2.17a.75.75 0 00-1.032 0 11.209 11.209 0 01-7.877 3.08.75.75 0 00-.722.515A12.74 12.74 0 002.25 9.75c0 5.942 4.064 10.933 9.563 12.348a.749.749 0 00.374 0c5.499-1.415 9.563-6.406 9.563-12.348 0-1.39-.223-2.73-.635-3.985a.75.75 0 00-.722-.516c-2.95 0-5.633-1.14-7.877-3.08zm3.19 8.54a.75.75 0 00-1.06-1.06l-3.72 3.72-1.44-1.44a.75.75 0 10-1.06 1.06l1.97 1.97a.75.75 0 001.06 0l4.25-4.25z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">100% Satisfaction Guarantee</p>
                  <p className="text-xs text-slate-500 mt-0.5">Not happy? We re-clean for free.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2195b4]/10">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2195b4" className="w-5 h-5">
                    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Instant Confirmation</p>
                  <p className="text-xs text-slate-500 mt-0.5">Your booking is confirmed right away.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#f59e0b" className="w-5 h-5">
                    <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">5.0 Stars on Google</p>
                  <p className="text-xs text-slate-500 mt-0.5">Trusted by LA homeowners.</p>
                </div>
              </div>
            </div>

            {/* Secondary: Booking Form */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-1">
                Prefer to just leave a message?
              </h3>
              <p className="text-sm text-slate-600 mb-6">
                Fill out this quick form and we will reach out to confirm your preferred date and time.
              </p>
              <BookingForm source="contact-page" />
            </div>
          </div>

          {/* Right: Contact Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Phone */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Phone
              </h3>
              <a
                href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
                className="text-xl font-bold text-[#2195b4] hover:text-[#155f73] transition-colors"
              >
                {SPOTLESS_BUSINESS.phone}
              </a>
              <p className="text-sm text-slate-600 mt-1">
                Tap to call. Same-day bookings available.
              </p>
            </div>

            {/* Email */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Email
              </h3>
              <a
                href={`mailto:${SPOTLESS_BUSINESS.email}`}
                className="text-lg font-semibold text-[#2195b4] hover:text-[#155f73] transition-colors break-all"
              >
                {SPOTLESS_BUSINESS.email}
              </a>
              <p className="text-sm text-slate-600 mt-1">
                We typically respond within 1 hour during business hours.
              </p>
            </div>

            {/* Service Area */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Service Area
              </h3>
              <p className="text-lg font-semibold text-slate-900">
                {SPOTLESS_BUSINESS.areaServed}
              </p>
              <p className="text-sm text-slate-600 mt-1">
                Serving 20+ cities including Los Angeles, Santa Monica, Beverly Hills,
                Pasadena, Long Beach, Burbank, and more.
              </p>
            </div>

            {/* Hours */}
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Business Hours
              </h3>
              <div className="space-y-1 text-sm text-slate-700">
                <div className="flex justify-between">
                  <span>Monday - Friday</span>
                  <span className="font-medium">7:00 AM - 7:00 PM</span>
                </div>
                <div className="flex justify-between">
                  <span>Saturday</span>
                  <span className="font-medium">8:00 AM - 5:00 PM</span>
                </div>
                <div className="flex justify-between">
                  <span>Sunday</span>
                  <span className="font-medium">9:00 AM - 3:00 PM</span>
                </div>
              </div>
            </div>

            {/* Team photo */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <img
                src="/images/marketing/team-branded.jpg"
                alt="Spotless Scrubbers team member in branded uniform"
                className="w-full h-48 object-cover"
              />
              <div className="bg-[#a8e0ef]/20 p-4 text-center">
                <p className="text-lg font-semibold text-[#155f73]">
                  Serving All of Los Angeles County
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  From the beaches to the valleys, we bring professional cleaning to your
                  doorstep.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
