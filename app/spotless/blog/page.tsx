import type { Metadata } from "next"
import Link from "next/link"
import { BLOG_POSTS, BLOG_CATEGORIES, type BlogPost } from "@/lib/marketing/blog-posts"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd } from "@/components/marketing/json-ld"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug } from "@/lib/tenant"

// Revalidate every hour so new AI-generated posts appear within ~60 min
export const revalidate = 3600

export const metadata: Metadata = {
  title: "Cleaning Tips & Guides | Spotless Scrubbers Blog",
  description:
    "Cleaning tips, pricing guides, and home care advice from Spotless Scrubbers in Los Angeles. Written by the Spotless Scrubbers team.",
  openGraph: {
    title: "Cleaning Tips & Guides | Spotless Scrubbers Blog",
    description:
      "Cleaning tips, pricing guides, and home care advice from Spotless Scrubbers in Los Angeles.",
    type: "website",
  },
  alternates: {
    canonical: `${SPOTLESS_BUSINESS.url}/blog`,
  },
}

/** Fetch AI-generated posts from Supabase and merge with seed posts */
async function getAllPosts(): Promise<BlogPost[]> {
  const seedPosts = [...BLOG_POSTS]
  const seedSlugs = new Set(seedPosts.map((p) => p.slug))

  try {
    const tenant = await getTenantBySlug("spotless")
    if (!tenant) return seedPosts

    const client = getSupabaseServiceClient()
    const { data: dbPosts } = await client
      .from("blog_posts")
      .select("slug, title, excerpt, content, category, published_at, reading_time, meta_description")
      .eq("tenant_id", tenant.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })

    if (!dbPosts || dbPosts.length === 0) return seedPosts

    // Convert DB rows to BlogPost format, skip duplicates of seed slugs
    const aiPosts: BlogPost[] = dbPosts
      .filter((row) => !seedSlugs.has(row.slug))
      .map((row) => ({
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt || "",
        content: row.content,
        category: (row.category || "Cleaning Tips") as BlogPost["category"],
        publishedAt: row.published_at ? row.published_at.split("T")[0] : "2026-01-01",
        readingTime: row.reading_time || 5,
        metaDescription: row.meta_description || "",
      }))

    return [...seedPosts, ...aiPosts]
  } catch {
    // DB unavailable — fall back to seed posts
    return seedPosts
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString + "T00:00:00")
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

const CATEGORY_COLORS: Record<string, string> = {
  "Cleaning Tips": "bg-blue-50 text-blue-700 border-blue-200",
  "Home Care": "bg-emerald-50 text-emerald-700 border-emerald-200",
  Business: "bg-amber-50 text-amber-700 border-amber-200",
  "LA Living": "bg-purple-50 text-purple-700 border-purple-200",
  "Airbnb Hosting": "bg-rose-50 text-rose-700 border-rose-200",
}

export default async function BlogIndexPage() {
  const allPosts = await getAllPosts()
  const sortedPosts = allPosts.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )

  // Collect categories from all posts (seed + DB)
  const allCategories = Array.from(new Set([...BLOG_CATEGORIES, ...allPosts.map((p) => p.category)]))

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Blog", url: `${SPOTLESS_BUSINESS.url}/blog` },
        ]}
      />

      {/* Hero */}
      <section className="bg-slate-50 border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <p className="text-sm font-medium text-[#2195b4] mb-3">
            The Spotless Scrubbers Blog
          </p>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-4">
            Cleaning Tips, Guides & Real Talk
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl">
            Straightforward advice on keeping your home or business clean in LA.
            No fluff, no filler. Just what actually works, from someone who does this every day.
          </p>
        </div>
      </section>

      {/* Categories */}
      <section className="border-b border-slate-200 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap gap-2 py-4">
            {allCategories.map((cat) => {
              const count = allPosts.filter((p) => p.category === cat).length
              return (
                <span
                  key={cat}
                  className={`text-xs font-medium px-3 py-1.5 border ${CATEGORY_COLORS[cat] || "bg-slate-50 text-slate-700 border-slate-200"}`}
                >
                  {cat} ({count})
                </span>
              )
            })}
          </div>
        </div>
      </section>

      {/* Posts */}
      <section className="py-12 sm:py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-0">
            {sortedPosts.map((post, index) => (
              <article
                key={post.slug}
                className={`py-8 ${index !== sortedPosts.length - 1 ? "border-b border-slate-200" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span
                    className={`text-xs font-medium px-2.5 py-1 border ${CATEGORY_COLORS[post.category] || "bg-slate-50 text-slate-700 border-slate-200"}`}
                  >
                    {post.category}
                  </span>
                  <span className="text-sm text-slate-500">
                    {formatDate(post.publishedAt)}
                  </span>
                  <span className="text-sm text-slate-400">
                    {post.readingTime} min read
                  </span>
                </div>

                <Link href={`/blog/${post.slug}`} className="group block">
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900 group-hover:text-[#2195b4] transition-colors mb-2">
                    {post.title}
                  </h2>
                  <p className="text-slate-600 leading-relaxed mb-3">
                    {post.excerpt}
                  </p>
                  <span className="text-sm font-medium text-[#2195b4]">
                    Read more &rarr;
                  </span>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 bg-[#155f73] text-white">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Ready for a Spotless Home?
          </h2>
          <p className="text-white/80 mb-8">
            Stop reading about cleaning and let us handle it. Book in 60 seconds
            or call us for a free quote.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/#quote"
              className="inline-flex items-center px-8 py-3 bg-white text-[#155f73] font-semibold hover:bg-white/90 transition-colors"
            >
              Get a Free Quote
            </a>
            <a
              href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
              className="inline-flex items-center px-8 py-3 border-2 border-white/40 text-white font-semibold hover:bg-white/10 transition-colors"
            >
              Call {SPOTLESS_BUSINESS.phone}
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
