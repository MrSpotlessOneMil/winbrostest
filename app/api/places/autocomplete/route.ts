import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"

/**
 * GET /api/places/autocomplete?input=123+Main+St
 *
 * Proxies Google Places Autocomplete API (server-side to protect API key).
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
    const params = new URLSearchParams({
      input,
      types: "address",
      components: "country:us",
      key: apiKey,
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    const data = await res.json()

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[places/autocomplete] Google API error:", data.status, data.error_message)
      return NextResponse.json({ success: true, data: [] })
    }

    const predictions = (data.predictions || []).map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
    }))

    return NextResponse.json({ success: true, data: predictions })
  } catch (error) {
    console.error("[places/autocomplete] error:", error)
    return NextResponse.json({ success: true, data: [] })
  }
}
