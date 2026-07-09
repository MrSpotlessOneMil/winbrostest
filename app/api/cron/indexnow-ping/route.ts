import { NextRequest, NextResponse } from "next/server"
import { verifyCronAuth } from "@/lib/cron-auth"
import { submitAllUrlsToIndexNow } from "@/lib/marketing/spotless-indexnow"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * IndexNow Submission Cron (Mon/Wed/Fri 12 PM UTC — 2h after the blog cron)
 *
 * Pushes every spotlessscrubbers.org sitemap URL to IndexNow so Bing,
 * DuckDuckGo, Yahoo, Ecosia, Yandex, and ChatGPT web search pick up new
 * area/service/blog pages without waiting for a crawl.
 */
async function handleCronRequest(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await submitAllUrlsToIndexNow()
    // 200/202 = accepted; 403 = key file not yet fetchable; 422 = URL/host mismatch.
    return NextResponse.json({ ok: result.status === 200 || result.status === 202, ...result })
  } catch (error) {
    console.error("[indexnow] submit failed:", error instanceof Error ? error.message : error)
    return NextResponse.json({ ok: false, error: "IndexNow submit failed" }, { status: 502 })
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request)
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request)
}
