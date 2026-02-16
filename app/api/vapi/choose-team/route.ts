import { NextRequest, NextResponse } from 'next/server'
import { safeJsonParse } from '@/lib/json-utils'
import { getVapiAvailabilityResponse } from '@/lib/vapi-choose-team'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractPayload(body: Record<string, unknown>): Record<string, unknown> {
  const candidate = body.body
  if (isRecord(candidate)) {
    return candidate
  }
  if (typeof candidate === 'string') {
    const parsed = safeJsonParse<Record<string, unknown>>(candidate)
    if (parsed.value && isRecord(parsed.value)) {
      return parsed.value
    }
  }
  return body
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  if (!rawBody) {
    return NextResponse.json({ error: 'Empty payload' }, { status: 400 })
  }

  const parsed = safeJsonParse<Record<string, unknown>>(rawBody)
  if (!parsed.value || !isRecord(parsed.value)) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  // LOG EVERYTHING VAPI sends — headers + full body — to discover assistant_id location
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => { headers[key] = value })
  console.log("[VAPI choose-team] === FULL REQUEST DUMP ===")
  console.log("[VAPI choose-team] HEADERS:", JSON.stringify(headers, null, 2))
  console.log("[VAPI choose-team] BODY:", JSON.stringify(parsed.value, null, 2))
  console.log("[VAPI choose-team] TOP-LEVEL KEYS:", Object.keys(parsed.value))
  // Also log nested keys one level deep to find call/assistant metadata
  for (const [key, val] of Object.entries(parsed.value)) {
    if (isRecord(val)) {
      console.log(`[VAPI choose-team] ${key} KEYS:`, Object.keys(val))
    }
  }
  console.log("[VAPI choose-team] === END DUMP ===")

  const payload = extractPayload(parsed.value)
  const response = await getVapiAvailabilityResponse(payload)
  return NextResponse.json(response)
}
