import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/places/autocomplete?input=123+Main+St
 *
 * Proxies Google Places Autocomplete (New) API — server-side to protect API key.
 * Returns address predictions.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const input = request.nextUrl.searchParams.get("input")
  if (!input || input.length < 3) {
    return NextResponse.json({ success: true, data: [] })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ success: true, data: [] })
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(
      "https://places.googleapis.com/v1/places:autocomplete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
        },
        body: JSON.stringify({
          input,
          includedPrimaryTypes: ["street_address", "subpremise", "premise"],
          includedRegionCodes: ["us"],
        }),
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    const data = await res.json()

    if (data.error) {
      console.error("[places/autocomplete] Google API error:", data.error.message)
      return NextResponse.json({ success: true, data: [] })
    }

    const predictions = (data.suggestions || [])
      .filter((s: any) => s.placePrediction)
      .map((s: any) => ({
        description: s.placePrediction.text?.text || "",
        place_id: s.placePrediction.placeId || "",
      }))

    return NextResponse.json({ success: true, data: predictions })
  } catch (error) {
    console.error("[places/autocomplete] error:", error)
    return NextResponse.json({ success: true, data: [] })
  }
}
