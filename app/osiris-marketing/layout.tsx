import type { Metadata } from "next"
import { TrackingScripts } from "@/components/marketing/tracking-scripts"
import { SoftwareApplicationJsonLd } from "@/components/marketing/json-ld"

export const metadata: Metadata = {
  metadataBase: new URL("https://theosirisai.com"),
  title: "Osiris — Operations Automation for Cleaning Businesses",
  description:
    "Osiris automates lead intake, AI phone answering, SMS follow-ups, job scheduling, cleaner dispatch, and payments for cleaning businesses. Stop losing leads. Start booking jobs.",
  openGraph: {
    title: "Osiris — Operations Automation for Cleaning Businesses",
    description:
      "AI phone answering, automated SMS follow-ups, scheduling, cleaner dispatch, and Stripe payments — all in one platform built for cleaning companies.",
    url: "https://theosirisai.com",
    siteName: "Osiris",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Osiris — Operations Automation for Cleaning Businesses",
    description:
      "Stop losing leads. Osiris automates phone answering, follow-ups, scheduling, dispatch, and payments for cleaning businesses.",
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function OsirisMarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-gray-950 text-white min-h-screen">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-gray-950 border-b border-gray-800">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <a href="/osiris-marketing" className="text-white font-semibold tracking-tight">
              Osiris
            </a>
            <a
              href="#demo"
              className="bg-[#2195b4] px-5 py-2 text-white text-sm font-medium hover:bg-[#1a7a94] transition-colors"
            >
              Book a Demo
            </a>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="pt-14">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-gray-950">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <span className="text-sm text-gray-600">
              &copy; {new Date().getFullYear()} Osiris
            </span>
            <a
              href="mailto:hello@theosirisai.com"
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            >
              hello@theosirisai.com
            </a>
          </div>
        </div>
      </footer>

      {/* Tracking */}
      <TrackingScripts
        metaPixelId={process.env.NEXT_PUBLIC_OSIRIS_META_PIXEL}
        ga4MeasurementId={process.env.NEXT_PUBLIC_OSIRIS_GA4}
      />

      {/* Structured data */}
      <SoftwareApplicationJsonLd />
    </div>
  )
}
