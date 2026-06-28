import type { MetadataRoute } from "next"
import { SPOTLESS_AREAS } from "@/lib/marketing/spotless-areas"
import { SPOTLESS_SERVICES } from "@/lib/marketing/spotless-services"
import { BLOG_POSTS } from "@/lib/marketing/blog-posts"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug } from "@/lib/tenant"

const BASE_URL = "https://spotlessscrubbers.org"

// Merge AI-generated blog posts (blog_posts table) with the static seed list so every
// published post lands in the sitemap and gets indexed. Falls back to seed posts on error.
async function getAllBlogSitemapEntries(): Promise<
  { slug: string; lastModified: Date }[]
> {
  const seed = BLOG_POSTS.map((p) => ({
    slug: p.slug,
    lastModified: new Date(p.publishedAt),
  }))
  const seedSlugs = new Set(seed.map((p) => p.slug))
  try {
    const tenant = await getTenantBySlug("spotless")
    if (!tenant) return seed
    const client = getSupabaseServiceClient()
    const { data: dbPosts } = await client
      .from("blog_posts")
      .select("slug, published_at")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
    if (!dbPosts || dbPosts.length === 0) return seed
    const aiEntries = dbPosts
      .filter((row) => !seedSlugs.has(row.slug))
      .map((row) => ({
        slug: row.slug,
        lastModified: row.published_at ? new Date(row.published_at) : new Date(),
      }))
    return [...seed, ...aiEntries]
  } catch {
    return seed
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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

  // Blog posts (static seed + AI-generated from the blog_posts table)
  const blogEntries = await getAllBlogSitemapEntries()
  const blogPages: MetadataRoute.Sitemap = blogEntries.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: post.lastModified,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }))

  return [...staticPages, ...servicePages, ...areaPages, ...comboPages, ...blogPages]
}
