import React from "react"
import { Phone } from "lucide-react"
import { TrackingScripts } from "@/components/marketing/tracking-scripts"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"

export default function DeepCleanOfferLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide parent layout's header, footer, and JSON-LD — landing page has its own minimal header */}
      <style>{`
        .light > header { display: none !important; }
        .light > footer { display: none !important; }
        .light > script[type="application/ld+json"] { display: none !important; }
      `}</style>

      {/* Minimal header: logo + phone only */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img
              src="/images/marketing/spotless-logo.jpg"
              alt="Spotless Scrubbers"
              className="w-8 h-8 rounded-full object-cover"
            />
            <span
              className="font-bold text-base text-[#164E63]"
              style={{ fontFamily: "'Quicksand', system-ui, sans-serif" }}
            >
              Spotless Scrubbers
            </span>
          </div>
          <a
            href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-[#2195b4] transition-colors"
          >
            <Phone className="h-4 w-4" />
            {SPOTLESS_BUSINESS.phone}
          </a>
        </div>
      </header>

      {children}

      <TrackingScripts
        metaPixelId={process.env.NEXT_PUBLIC_SPOTLESS_META_PIXEL}
      />
    </>
  )
}
