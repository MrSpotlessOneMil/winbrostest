import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import Anthropic from "@anthropic-ai/sdk"

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const { text } = await request.json()

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Text is required" }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "AI service not configured" }, { status: 500 })
  }

  try {
    const anthropic = new Anthropic({ apiKey })

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Extract customer records from this text. Return a JSON array of objects with these fields:
- first_name (string, required)
- last_name (string, can be empty string if not provided)
- phone_number (string, required - US format with digits only like "5551234567", strip all formatting)
- email (string or null)
- address (string or null)

Rules:
- Every record MUST have a phone_number. Skip entries without a phone number.
- Strip phone formatting to just digits. If 11 digits starting with 1, remove the leading 1.
- If a name is a single word, put it in first_name and leave last_name as "".
- Return ONLY the JSON array, no other text.

Text to parse:
${text}`
        }
      ]
    })

    const content = response.content[0]
    if (content.type !== "text") {
      return NextResponse.json({ error: "Unexpected AI response" }, { status: 500 })
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = content.text.trim()
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
    }

    const parsed = JSON.parse(jsonStr)

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "Failed to parse customer data" }, { status: 500 })
    }

    // Validate each record has at minimum phone_number and first_name
    const valid = parsed.filter(
      (c: any) => c.phone_number && typeof c.phone_number === "string" && c.phone_number.length >= 7 && c.first_name
    )

    return NextResponse.json({ success: true, customers: valid })
  } catch (error) {
    console.error("[batch-parse-customers] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to parse customers" },
      { status: 500 }
    )
  }
}
