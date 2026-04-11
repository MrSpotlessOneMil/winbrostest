import Link from "next/link"
import { Phone, Mail, MapPin } from "lucide-react"
import { SPOTLESS_BUSINESS, SPOTLESS_AREAS } from "@/lib/marketing/spotless-areas"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"

export function SiteFooter() {
  const topAreas = SPOTLESS_AREAS.slice(0, 10)

  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <img
                src="/images/marketing/spotless-logo.jpg"
                alt="Spotless Scrubbers"
                className="w-9 h-9 rounded-full object-cover"
              />
              <span className="font-bold text-lg text-white">Spotless Scrubbers</span>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              {SPOTLESS_BUSINESS.description}
            </p>
            <div className="space-y-2">
              <a
                href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
                className="flex items-center gap-2 text-sm hover:text-white transition-colors"
              >
                <Phone className="h-4 w-4 text-[#2195b4]" />
                {SPOTLESS_BUSINESS.phone}
              </a>
              <a
                href={`mailto:${SPOTLESS_BUSINESS.email}`}
                className="flex items-center gap-2 text-sm hover:text-white transition-colors"
              >
                <Mail className="h-4 w-4 text-[#2195b4]" />
                {SPOTLESS_BUSINESS.email}
              </a>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-[#2195b4]" />
                Serving {SPOTLESS_BUSINESS.areaServed}
              </div>
            </div>
          </div>

          {/* Services */}
          <div>
            <h3 className="font-semibold text-white mb-4">Our Services</h3>
            <ul className="space-y-2">
              {SPOTLESS_SERVICES.map((service) => (
                <li key={service.slug}>
                  <Link
                    href={`/spotless/services/${service.slug}`}
                    className="text-sm hover:text-white transition-colors"
                  >
                    {service.shortTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Service Areas */}
          <div>
            <h3 className="font-semibold text-white mb-4">Service Areas</h3>
            <ul className="space-y-2">
              {topAreas.map((area) => (
                <li key={area.slug}>
                  <Link
                    href={`/spotless/areas/${area.slug}`}
                    className="text-sm hover:text-white transition-colors"
                  >
                    {area.city}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/spotless/areas"
                  className="text-sm text-[#2195b4] hover:text-[#a8e0ef] transition-colors"
                >
                  View all areas...
                </Link>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-white mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/spotless" className="text-sm hover:text-white transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/spotless/services" className="text-sm hover:text-white transition-colors">
                  Services
                </Link>
              </li>
              <li>
                <Link href="/spotless/areas" className="text-sm hover:text-white transition-colors">
                  Service Areas
                </Link>
              </li>
              <li>
                <Link href="/spotless/about" className="text-sm hover:text-white transition-colors">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/spotless/blog" className="text-sm hover:text-white transition-colors">
                  Blog
                </Link>
              </li>
              <li>
                <Link href="/spotless/contact" className="text-sm hover:text-white transition-colors">
                  Book a Cleaning
                </Link>
              </li>
            </ul>

            {/* Social */}
            <h3 className="font-semibold text-white mt-8 mb-4">Follow Us</h3>
            <div className="flex gap-4">
              <a
                href={SPOTLESS_BUSINESS.social.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:text-white transition-colors"
              >
                Facebook
              </a>
              <a
                href={SPOTLESS_BUSINESS.social.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:text-white transition-colors"
              >
                Instagram
              </a>
              <a
                href={SPOTLESS_BUSINESS.social.yelp}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:text-white transition-colors"
              >
                Yelp
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} {SPOTLESS_BUSINESS.name}. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <Link href="/spotless/privacy" className="hover:text-slate-300 transition-colors">
              Privacy Policy
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/spotless/terms" className="hover:text-slate-300 transition-colors">
              Terms of Service
            </Link>
            <span className="text-slate-700">|</span>
            <Link href="/spotless/accessibility" className="hover:text-slate-300 transition-colors">
              Accessibility
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom padding on mobile for sticky CTA */}
      <div className="md:hidden h-16" />
    </footer>
  )
}
