import React from "react"
import type { Metadata, Viewport } from "next"
import { SiteHeader } from "@/components/marketing/site-header"
import { SiteFooter } from "@/components/marketing/site-footer"
import { TrackingScripts } from "@/components/marketing/tracking-scripts"
import { LocalBusinessJsonLd, FounderJsonLd } from "@/components/marketing/json-ld"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export const metadata: Metadata = {
  metadataBase: new URL("https://spotlessscrubbers.org"),
  icons: {
    icon: "/images/marketing/spotless-logo.jpg",
    apple: "/images/marketing/spotless-logo.jpg",
  },
  title: {
    template: "%s | Spotless Scrubbers - LA House Cleaning",
    default: "Spotless Scrubbers - Instant-Book House Cleaning in Los Angeles County",
  },
  description:
    "Professional house cleaning in Los Angeles County. Book in 60 seconds, instant confirmation. Insured, 5-star rated. Standard, deep, move-in/out, commercial, Airbnb cleaning.",
  openGraph: {
    title: "Spotless Scrubbers - Instant-Book House Cleaning in Los Angeles County",
    description:
      "Professional house cleaning in Los Angeles County. Book in 60 seconds, instant confirmation. Insured, 5-star rated.",
    type: "website",
    siteName: "Spotless Scrubbers",
    images: [
      {
        url: "/spotless-scrubbers-logo.jpg",
        width: 1200,
        height: 630,
        alt: "Spotless Scrubbers - Professional House Cleaning in Los Angeles County",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Spotless Scrubbers - Instant-Book House Cleaning in Los Angeles County",
    description:
      "Professional house cleaning in LA County. Book in 60 seconds, instant confirmation. Call (424) 677-1146.",
  },
}

export default function SpotlessLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="light bg-white text-slate-800" style={{ colorScheme: "light" }}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        h1, h2, h3, h4, h5, h6, .font-heading {
          font-family: 'Quicksand', system-ui, sans-serif;
        }
      `}</style>
      <SiteHeader />
      <main className="min-h-screen">{children}</main>
      <SiteFooter />
      <LocalBusinessJsonLd />
      <FounderJsonLd />
      <TrackingScripts
        metaPixelId={process.env.NEXT_PUBLIC_SPOTLESS_META_PIXEL || "5023947941164989"}
        ga4MeasurementId={process.env.NEXT_PUBLIC_SPOTLESS_GA4}
      />
      {/* Microsoft Clarity — heatmaps + session recordings */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","wbqamthvdd");`,
        }}
      />
    </div>
  )
}
