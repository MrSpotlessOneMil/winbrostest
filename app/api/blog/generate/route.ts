import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getTenantBySlug, getTenantBusinessName, getTenantServiceDescription } from "@/lib/tenant"
import type { Tenant } from "@/lib/tenant"
import { getTopicsForTenant } from "@/lib/marketing/blog-topics"
import Anthropic from "@anthropic-ai/sdk"

// route-check:no-vercel-cron

/**
 * Blog Post Generation API (manual trigger)
 *
 * POST /api/blog/generate
 * Body: { tenant_slug: string, keyword?: string }
 *
 * - Generates a blog post for the specified tenant
 * - Persists to blog_posts table
 * - If keyword provided, uses that specific topic; otherwise picks random unused
 */
export async function POST(request: NextRequest) {
  // Verify CRON_SECRET
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const tenantSlug = (body.tenant_slug as string) || ""
  if (!tenantSlug) {
    return NextResponse.json({ error: "tenant_slug is required" }, { status: 400 })
  }

  // Resolve tenant
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) {
    return NextResponse.json({ error: `Tenant '${tenantSlug}' not found` }, { status: 404 })
  }

  const client = getSupabaseServiceClient()

  // Pick topic
  const requestedKeyword = body.keyword as string | undefined
  let topic: { keyword: string; topic: string; category: string } | null = null

  if (requestedKeyword) {
    // Use specific keyword
    const topics = getTopicsForTenant(tenant.slug)
    topic = topics.find((t) => t.keyword === requestedKeyword) || null
    if (!topic) {
      return NextResponse.json(
        { error: `Keyword '${requestedKeyword}' not found in topic list for ${tenantSlug}` },
        { status: 400 }
      )
    }
  } else {
    // Pick random unused
    topic = await pickUnusedTopic(client, tenant)
    if (!topic) {
      return NextResponse.json(
        { error: "All topics have been used for this tenant" },
        { status: 400 }
      )
    }
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    const systemPrompt = buildSystemPrompt(tenant)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    try {
      const message = await anthropic.messages.create(
        {
          model: "claude-sonnet-4-6-20250620",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Write a blog post targeting the keyword "${topic.keyword}" about: ${topic.topic}

Return your response as a JSON object with exactly these fields:
{
  "title": "The blog post title (SEO optimized, under 60 characters)",
  "slug": "url-friendly-slug",
  "excerpt": "A 1-2 sentence excerpt for the blog listing page",
  "content": "The full HTML content of the blog post",
  "category": "${topic.category}",
  "readingTime": estimated_minutes_as_number,
  "metaDescription": "SEO meta description under 160 characters"
}

Return ONLY the JSON object, no markdown code fences, no explanation.`,
            },
          ],
        },
        { signal: controller.signal }
      )

      clearTimeout(timeout)

      // Extract text content
      const textBlock = message.content.find((block) => block.type === "text")
      if (!textBlock || textBlock.type !== "text") {
        return NextResponse.json({ error: "No text response from Claude" }, { status: 500 })
      }

      // Parse the JSON response
      let blogPost
      try {
        blogPost = JSON.parse(textBlock.text)
      } catch {
        return NextResponse.json(
          { error: "Failed to parse Claude response as JSON", raw: textBlock.text },
          { status: 500 }
        )
      }

      // Persist to database
      const { data: saved, error: dbError } = await client
        .from("blog_posts")
        .insert({
          tenant_id: tenant.id,
          slug: blogPost.slug,
          title: blogPost.title,
          excerpt: blogPost.excerpt || null,
          content: blogPost.content,
          category: blogPost.category || topic.category,
          published_at: new Date().toISOString(),
          reading_time: blogPost.readingTime || 5,
          meta_description: blogPost.metaDescription || null,
          seo_keyword: topic.keyword,
          status: "published",
          ai_generated: true,
        })
        .select("id, slug, title")
        .single()

      if (dbError) {
        return NextResponse.json(
          { error: "Failed to save blog post", details: dbError.message },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        post: {
          ...blogPost,
          id: saved?.id,
          publishedAt: new Date().toISOString().split("T")[0],
          generatedFrom: {
            keyword: topic.keyword,
            topic: topic.topic,
            category: topic.category,
          },
        },
      })
    } catch (err) {
      clearTimeout(timeout)
      throw err
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: "Failed to generate blog post", details: message },
      { status: 500 }
    )
  }
}

async function pickUnusedTopic(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: Tenant
) {
  const topics = getTopicsForTenant(tenant.slug)
  if (topics.length === 0) return null

  const { data: usedRows } = await client
    .from("blog_posts")
    .select("seo_keyword")
    .eq("tenant_id", tenant.id)
    .not("seo_keyword", "is", null)

  const usedKeywords = new Set((usedRows || []).map((r) => r.seo_keyword))
  const unused = topics.filter((t) => !usedKeywords.has(t.keyword))
  if (unused.length === 0) return null

  return unused[Math.floor(Math.random() * unused.length)]
}

function buildSystemPrompt(tenant: Tenant): string {
  const businessName = getTenantBusinessName(tenant)
  const serviceType = getTenantServiceDescription(tenant)
  const area = tenant.service_area || "the local area"
  const phone = tenant.openphone_phone_number || ""
  const website = tenant.website_url || ""
  const sdrName = tenant.sdr_persona || "the team"

  return `You are writing a blog post for ${businessName}, a professional ${serviceType} service in ${area}.

Writing style rules (follow these exactly):
- First person, casual, direct tone — write as ${sdrName} from ${businessName}
- NEVER use em dashes (the long dash). Use commas, periods, or rewrite the sentence instead.
- No corporate speak or marketing fluff
- Write like you are talking to a friend who asked for advice
- Short paragraphs, clear headings
- Mention specific cities in the service area naturally
- Include natural mentions of ${businessName} services (${serviceType} and related services)
- End with a soft CTA${phone ? ` mentioning the phone number ${phone}` : ""}${website ? ` or the website ${website}` : ""}
- Keep the word count between 600 and 900 words
- Use <h2> tags for main headings, <h3> for subheadings, <p> for paragraphs, <ul>/<li> for lists, <strong> for bold
- Do not include the title in the body content (it will be rendered separately)
- Do not start with "Hey folks" or "Hey everyone" every time. Vary your openings.
- Use contractions naturally

Business context:
- ${businessName} serves ${area}
- Primary service: ${serviceType}${phone ? `\n- Phone: ${phone}` : ""}${website ? `\n- Website: ${website}` : ""}`
}
