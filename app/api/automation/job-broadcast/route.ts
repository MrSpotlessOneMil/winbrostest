import { NextRequest, NextResponse } from "next/server"
import { verifySignature } from "@/lib/qstash"

export async function POST(request: NextRequest) {
  // This route references functions that are not implemented in this repo yet
  // (job broadcast + Telegram escalation + exceptions table, etc).
  // Keep endpoint for later wiring, but return 501 for now so builds pass.
  const signature = request.headers.get("upstash-signature")
  const body = await request.text()

  if (signature && !(await verifySignature(signature, body))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  return NextResponse.json(
    { success: false, error: "Not implemented yet (job broadcast automation)" },
    { status: 501 }
  )
}
