import { NextRequest, NextResponse } from "next/server"

/**
 * Telegram webhook — DEPRECATED
 * All cleaner communications now go through SMS (OpenPhone) + Cleaner Portal.
 */
export async function POST(request: NextRequest) {
  return NextResponse.json({ deprecated: true, message: "Telegram integration removed. Use cleaner portal + SMS." })
}
