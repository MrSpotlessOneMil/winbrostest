import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Robin Line lead proxy (Spotless website → Robin Line v2)
 *
 * The marketing site (spotlessscrubbers.org) is served by THIS app, so its
 * quote/booking forms post here same-origin. We forward server-side to Robin
 * Line's public intake route:
 *
 *     POST {ROBINLINE_PUBLIC_BASE_URL}/api/public/contact-forms/{slug}/submit
 *     body: { answers: <the form fields> }
 *
 * Why a server-side proxy instead of posting straight to Robin Line from the
 * browser: Robin Line's public route sets no CORS headers and has no OPTIONS
 * handler, so a cross-origin browser POST would fail preflight and silently
 * drop the lead. Server-to-server has no CORS, and we don't have to touch the
 * Robin Line repo. Robin Line reads name/phone/email/beds(=bedrooms)/
 * baths(=bathrooms)/address etc. straight out of `answers`, so we forward the
 * form payload as-is.
 *
 * Response is normalized to { success: boolean } — the website forms only
 * check res.ok, and the smoke test asserts body.success.
 *
 * ROBINLINE_PUBLIC_BASE_URL overrides the default Robin Line production host
 * (useful for staging tests); no env var is required in production.
 */
const DEFAULT_ROBINLINE_BASE = "https://app.robinline.com"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    )
  }

  // CI smoke-test short-circuit: never forward synthetic leads to Robin Line
  // (no ci-smoke cleanup exists there, and it would text a fake number).
  const sourceVal = typeof body.source === "string" ? body.source : ""
  if (sourceVal === "ci-smoke" || sourceVal.startsWith("ci-smoke")) {
    return NextResponse.json({ success: true, skipped: "ci-smoke" })
  }

  const base = (process.env.ROBINLINE_PUBLIC_BASE_URL || DEFAULT_ROBINLINE_BASE).replace(/\/+$/, "")

  const target = `${base}/api/public/contact-forms/${encodeURIComponent(slug)}/submit`

  // 12s timeout — never hang the customer's submit on a slow upstream.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  // Robin Line rate-limits per client IP; without this every visitor shares
  // this proxy's egress IP. Forward the visitor's IP so the upstream can key
  // limits per visitor (harmless if the upstream edge overwrites the header).
  const visitorIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(visitorIp ? { "X-Forwarded-For": visitorIp } : {}),
      },
      body: JSON.stringify({ answers: body }),
      signal: controller.signal,
    })

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "")
      console.error(
        `[robinline-lead] upstream ${upstream.status} for slug "${slug}": ${detail.slice(0, 300)}`
      )
      // Surface failure so the form shows its error instead of telling the
      // customer "you're all set" when the lead didn't actually save.
      return NextResponse.json(
        { success: false, error: "Could not submit. Please try again or call us." },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error"
    console.error(`[robinline-lead] forward failed for slug "${slug}": ${msg}`)
    return NextResponse.json(
      { success: false, error: "Could not submit. Please try again or call us." },
      { status: 502 }
    )
  } finally {
    clearTimeout(timeout)
  }
}
