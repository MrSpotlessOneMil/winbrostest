import type { MetadataRoute } from "next"
import { SPOTLESS_AREAS } from "@/lib/marketing/spotless-areas"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"
import { BLOG_POSTS } from "@/lib/marketing/blog-posts"

const BASE_URL = "https://spotlessscrubbers.org"

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  // Home page
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/services`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/areas`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ]

  // Individual service pages (6)
  const servicePages: MetadataRoute.Sitemap = SPOTLESS_SERVICES.map((service) => ({
    url: `${BASE_URL}/services/${service.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))

  // Individual city/area pages (20)
  const areaPages: MetadataRoute.Sitemap = SPOTLESS_AREAS.map((area) => ({
    url: `${BASE_URL}/areas/${area.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }))

  // Service x city combo pages (6 services x 20 cities = 120)
  const comboPages: MetadataRoute.Sitemap = SPOTLESS_SERVICES.flatMap((service) =>
    SPOTLESS_AREAS.map((area) => ({
      url: `${BASE_URL}/services/${service.slug}/${area.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    }))
  )

  // Blog posts
  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))

  return [...staticPages, ...servicePages, ...areaPages, ...comboPages, ...blogPages]
}
