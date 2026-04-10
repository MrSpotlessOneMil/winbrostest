import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { BLOG_POSTS, getBlogPostBySlug, getAllBlogSlugs, type BlogPost } from "@/lib/marketing/blog-posts"
import { SPOTLESS_BUSINESS } from "@/lib/marketing/spotless-areas"
import { BreadcrumbJsonLd, JsonLd } from "@/components/marketing/json-ld"
import { BookingForm } from "@/components/marketing/booking-form"
import { CopyLinkButton } from "./copy-link-button"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug } from "@/lib/tenant"

interface PageProps {
  params: Promise<{ slug: string }>
}

/** Try seed posts first, then fall back to Supabase for AI-generated posts */
async function getPost(slug: string): Promise<BlogPost | null> {
  const seedPost = getBlogPostBySlug(slug)
  if (seedPost) return seedPost

  try {
    const tenant = await getTenantBySlug("spotless")
    if (!tenant) return null

    const client = getSupabaseServiceClient()
    const { data: row } = await client
      .from("blog_posts")
      .select("slug, title, excerpt, content, category, published_at, reading_time, meta_description")
      .eq("tenant_id", tenant.id)
      .eq("slug", slug)
      .eq("status", "published")
      .single()

    if (!row) return null

    return {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt || "",
      content: row.content,
      category: (row.category || "Cleaning Tips") as BlogPost["category"],
      publishedAt: row.published_at ? row.published_at.split("T")[0] : "2026-01-01",
      readingTime: row.reading_time || 5,
      metaDescription: row.meta_description || "",
    }
  } catch {
    return null
  }
}

/** Get all posts (seed + DB) for navigation */
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
    return seedPosts
  }
}

// Seed posts are pre-rendered; AI posts render on demand and cache for 1 hour
export const revalidate = 3600

export async function generateStaticParams() {
  return getAllBlogSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return {}

  return {
    title: post.title,
    description: post.metaDescription,
    openGraph: {
      title: post.title,
      description: post.metaDescription,
      type: "article",
      publishedTime: post.publishedAt,
      authors: ["Dominic"],
      siteName: "Spotless Scrubbers",
    },
    alternates: {
      canonical: `${SPOTLESS_BUSINESS.url}/spotless/blog/${post.slug}`,
    },
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

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params
  const post = await getPost(slug)

  if (!post) {
    notFound()
  }

  const postUrl = `${SPOTLESS_BUSINESS.url}/spotless/blog/${post.slug}`

  // Find previous and next posts for navigation (seed + DB)
  const allPosts = await getAllPosts()
  const sortedPosts = allPosts.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  )
  const currentIndex = sortedPosts.findIndex((p) => p.slug === post.slug)
  const prevPost = currentIndex < sortedPosts.length - 1 ? sortedPosts[currentIndex + 1] : null
  const nextPost = currentIndex > 0 ? sortedPosts[currentIndex - 1] : null

  // Article JSON-LD
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.metaDescription,
    datePublished: post.publishedAt,
    author: {
      "@type": "Person",
      name: "Dominic",
      jobTitle: "Owner",
      worksFor: {
        "@type": "LocalBusiness",
        name: SPOTLESS_BUSINESS.name,
        url: SPOTLESS_BUSINESS.url,
      },
    },
    publisher: {
      "@type": "Organization",
      name: SPOTLESS_BUSINESS.name,
      url: SPOTLESS_BUSINESS.url,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": postUrl,
    },
    wordCount: post.content.split(/\s+/).length,
    articleSection: post.category,
  }

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: SPOTLESS_BUSINESS.url },
          { name: "Blog", url: `${SPOTLESS_BUSINESS.url}/spotless/blog` },
          { name: post.title, url: postUrl },
        ]}
      />
      <JsonLd data={articleJsonLd} />

      {/* Breadcrumb navigation */}
      <div className="bg-slate-50 border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <nav className="flex items-center gap-2 text-sm text-slate-500">
            <Link href="/spotless" className="hover:text-[#2195b4] transition-colors">
              Home
            </Link>
            <span>/</span>
            <Link href="/spotless/blog" className="hover:text-[#2195b4] transition-colors">
              Blog
            </Link>
            <span>/</span>
            <span className="text-slate-700 truncate max-w-[200px] sm:max-w-none">
              {post.title}
            </span>
          </nav>
        </div>
      </div>

      {/* Article */}
      <article className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <header className="mb-10">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="text-xs font-medium px-2.5 py-1 bg-[#2195b4]/10 text-[#2195b4] border border-[#2195b4]/20">
                {post.category}
              </span>
              <span className="text-sm text-slate-500">
                {formatDate(post.publishedAt)}
              </span>
              <span className="text-sm text-slate-400">
                {post.readingTime} min read
              </span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[2.5rem] font-bold text-slate-900 leading-tight mb-6">
              {post.title}
            </h1>

            <p className="text-lg text-slate-600 leading-relaxed mb-6">
              {post.excerpt}
            </p>

            {/* Author + Share */}
            <div className="flex items-center justify-between border-t border-b border-slate-200 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#2195b4] flex items-center justify-center text-white font-bold text-sm">
                  D
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-900">Dominic</div>
                  <div className="text-xs text-slate-500">
                    Owner, {SPOTLESS_BUSINESS.name}
                  </div>
                </div>
              </div>

              <CopyLinkButton url={postUrl} />
            </div>
          </header>

          {/* Content */}
          <div
            className="blog-content max-w-none"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />

          {/* Post-article CTA */}
          <div className="mt-12 border-t border-slate-200 pt-10">
            <div className="bg-slate-50 border border-slate-200 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Need a Cleaning? Let Us Handle It.
              </h3>
              <p className="text-slate-600 mb-6">
                Drop your info and Dominic will get back to you within the hour.
                No pressure, no automated calls. Just an honest quote from a real person.
              </p>
              <BookingForm source={`blog_${post.slug}`} />
            </div>

            <p className="text-center text-sm text-slate-500 mt-4">
              Or call us directly at{" "}
              <a
                href={`tel:${SPOTLESS_BUSINESS.phoneRaw}`}
                className="text-[#2195b4] font-medium hover:underline"
              >
                {SPOTLESS_BUSINESS.phone}
              </a>
            </p>
          </div>

          {/* Post navigation */}
          <nav className="mt-12 border-t border-slate-200 pt-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {prevPost ? (
                <Link
                  href={`/spotless/blog/${prevPost.slug}`}
                  className="group block"
                >
                  <span className="text-xs text-slate-500 mb-1 block">
                    &larr; Previous
                  </span>
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-[#2195b4] transition-colors">
                    {prevPost.title}
                  </span>
                </Link>
              ) : (
                <div />
              )}
              {nextPost ? (
                <Link
                  href={`/spotless/blog/${nextPost.slug}`}
                  className="group block text-right"
                >
                  <span className="text-xs text-slate-500 mb-1 block">
                    Next &rarr;
                  </span>
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-[#2195b4] transition-colors">
                    {nextPost.title}
                  </span>
                </Link>
              ) : (
                <div />
              )}
            </div>
          </nav>

          {/* Back to blog */}
          <div className="mt-8 text-center">
            <Link
              href="/spotless/blog"
              className="text-sm font-medium text-[#2195b4] hover:underline"
            >
              &larr; Back to all posts
            </Link>
          </div>
        </div>
      </article>
    </>
  )
}
