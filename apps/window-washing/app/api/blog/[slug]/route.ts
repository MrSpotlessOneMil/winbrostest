import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug } from "@/lib/tenant"

// route-check:no-vercel-cron

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=600",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

/**
 * Public Blog API
 *
 * GET /api/blog/{slug}           → list published posts for tenant (paginated)
 * GET /api/blog/{slug}?post=x    → single post by post slug
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  // Resolve tenant
  const tenant = await getTenantBySlug(slug)
  if (!tenant) {
    return NextResponse.json(
      { error: "Unknown business" },
      { status: 404, headers: corsHeaders }
    )
  }

  const client = getSupabaseServiceClient()
  const { searchParams } = new URL(request.url)
  const postSlug = searchParams.get("post")

  // Single post mode
  if (postSlug) {
    const { data: post, error } = await client
      .from("blog_posts")
      .select("slug, title, excerpt, content, category, published_at, reading_time, meta_description, seo_keyword")
      .eq("tenant_id", tenant.id)
      .eq("slug", postSlug)
      .eq("status", "published")
      .single()

    if (error || !post) {
      return NextResponse.json(
        { error: "Post not found" },
        { status: 404, headers: corsHeaders }
      )
    }

    return NextResponse.json({ post }, { headers: corsHeaders })
  }

  // List mode (paginated)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)))
  const offset = (page - 1) * limit

  const { data: posts, error, count } = await client
    .from("blog_posts")
    .select("slug, title, excerpt, category, published_at, reading_time, meta_description", { count: "exact" })
    .eq("tenant_id", tenant.id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch posts" },
      { status: 500, headers: corsHeaders }
    )
  }

  return NextResponse.json(
    {
      posts: posts || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    },
    { headers: corsHeaders }
  )
}
