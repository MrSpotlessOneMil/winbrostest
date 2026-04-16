"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X, Phone } from "lucide-react"
import { trackPhoneClick } from "@/lib/marketing/tracking"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/services", label: "Services" },
  { href: "/areas", label: "Areas" },
  { href: "/blog", label: "Blog" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
]

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/images/marketing/spotless-logo.jpg"
              alt="Spotless Scrubbers"
              className="w-9 h-9 rounded-full object-cover"
            />
            <span className="font-bold text-lg text-[#164E63]" style={{ fontFamily: "'Quicksand', system-ui, sans-serif" }}>
              Spotless Scrubbers
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-slate-600 hover:text-[#2195b4] transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
              onClick={() => trackPhoneClick()}
              className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-[#2195b4]"
            >
              <Phone className="h-4 w-4" />
              {SPOTLESS_BUSINESS.phone}
            </a>
            <Link
              href="/contact"
              className="inline-flex items-center px-5 py-2 bg-[#2195b4] text-white text-sm font-medium hover:bg-[#155f73] transition-colors"
            >
              Book Now
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden p-2 text-slate-600"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white">
          <div className="px-4 py-4 space-y-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-base font-medium text-slate-700 hover:text-[#2195b4]"
              >
                {link.label}
              </Link>
            ))}
            <hr className="border-slate-200" />
            <a
              href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
              onClick={() => trackPhoneClick()}
              className="flex items-center gap-2 text-base font-medium text-slate-700"
            >
              <Phone className="h-4 w-4" />
              {SPOTLESS_BUSINESS.phone}
            </a>
            <Link
              href="/contact"
              onClick={() => setMobileOpen(false)}
              className="block w-full text-center px-4 py-3 bg-[#2195b4] text-white font-medium"
            >
              Book Now
            </Link>
          </div>
        </div>
      )}

      {/* Sticky mobile CTA bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#2195b4] border-t border-[#155f73] px-4 py-3 flex items-center justify-between">
        <a
          href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
          onClick={() => trackPhoneClick()}
          className="flex items-center gap-2 text-white font-medium text-sm"
        >
          <Phone className="h-4 w-4" />
          Call Now
        </a>
        <Link
          href="/contact"
          className="inline-flex items-center px-4 py-2 bg-white text-[#2195b4] text-sm font-bold"
        >
          Book Online
        </Link>
      </div>
    </header>
  )
}
