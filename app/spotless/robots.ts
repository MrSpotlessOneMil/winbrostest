import type { MetadataRoute } from "next"

// spotlessscrubbers.org robots. middleware.ts rewrites /robots.txt -> /spotless/robots.txt,
// so this is what crawlers get for the Spotless domain. Its main job is declaring the sitemap,
// which was previously undiscoverable. NOTE: paid landers (/book, /offer, ...) are intentionally
// left crawlable — they already carry a noindex meta tag, and disallowing them here would stop
// Google from crawling them to SEE that noindex. Only truly non-indexable paths are blocked.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/"],
      },
    ],
    sitemap: "https://spotlessscrubbers.org/sitemap.xml",
    host: "https://spotlessscrubbers.org",
  }
}
