import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth } from "@/lib/cron-auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getAllActiveTenants, tenantUsesFeature, getTenantBusinessName, getTenantServiceDescription } from "@/lib/tenant"
import type { Tenant } from "@/lib/tenant"
import { getTopicsForTenant } from "@/lib/marketing/blog-topics"
import Anthropic from "@anthropic-ai/sdk"

/**
 * Blog Post Generation Cron (3x/week: Mon, Wed, Fri at 10 AM UTC)
 *
 * For each tenant with use_blog_generation enabled:
 *   1. Check if a post was published in the last 2 days
 *   2. If not, generate one via Claude and persist to blog_posts table
 */
export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 })
  }

  const client = getSupabaseServiceClient()
  const tenants = await getAllActiveTenants()
  const results: Record<string, string> = {}

  for (const tenant of tenants) {
    if (!tenantUsesFeature(tenant, "use_blog_generation")) {
      continue
    }

    try {
      // Check if a post was published in the last 2 days (runs Mon/Wed/Fri)
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentPosts } = await client
        .from("blog_posts")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("status", "published")
        .gte("published_at", twoDaysAgo)
        .limit(1)

      if (recentPosts && recentPosts.length > 0) {
        results[tenant.slug] = "skipped — recent post exists"
        continue
      }

      // Pick a topic not yet used
      const topic = await pickUnusedTopic(client, tenant)
      if (!topic) {
        results[tenant.slug] = "skipped — all topics used"
        continue
      }

      // Generate and persist
      const post = await generateAndPersist(client, tenant, topic, anthropicKey)
      results[tenant.slug] = post ? `published: ${post.slug}` : "generation failed"
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      console.error(`[Blog Cron] Error for ${tenant.slug}:`, msg)
      results[tenant.slug] = `error: ${msg}`
    }
  }

  return NextResponse.json({ success: true, results })
}

async function pickUnusedTopic(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: Tenant
) {
  const topics = getTopicsForTenant(tenant.slug)
  if (topics.length === 0) return null

  // Get keywords already used
  const { data: usedRows } = await client
    .from("blog_posts")
    .select("seo_keyword")
    .eq("tenant_id", tenant.id)
    .not("seo_keyword", "is", null)

  const usedKeywords = new Set((usedRows || []).map((r) => r.seo_keyword))

  // Filter to unused topics
  const unused = topics.filter((t) => !usedKeywords.has(t.keyword))
  if (unused.length === 0) return null

  // Pick random from unused
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

async function generateAndPersist(
  client: ReturnType<typeof getSupabaseServiceClient>,
  tenant: Tenant,
  topic: { keyword: string; topic: string; category: string },
  anthropicKey: string
) {
  const anthropic = new Anthropic({ apiKey: anthropicKey })
  const systemPrompt = buildSystemPrompt(tenant)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60000) // 60s for generation

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

    const textBlock = message.content.find((block) => block.type === "text")
    if (!textBlock || textBlock.type !== "text") return null

    const blogPost = JSON.parse(textBlock.text)

    // Persist to database
    const { data, error } = await client
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
      .select("slug")
      .single()

    if (error) {
      console.error(`[Blog Cron] DB insert error for ${tenant.slug}:`, error.message)
      return null
    }

    return data
  } finally {
    clearTimeout(timeout)
  }
}
