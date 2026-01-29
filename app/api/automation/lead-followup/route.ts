import { NextRequest, NextResponse } from "next/server"
import { verifySignature } from "@/lib/qstash"

export async function POST(request: NextRequest) {
  // This route came from an earlier automation spec but the referenced helper functions
  // (`callLead`, `sendLeadFollowUp`, `logAutomation`, etc.) are not implemented in this repo yet.
  // We keep the endpoint so QStash can be wired later, but return 501 for now.
  const signature = request.headers.get("upstash-signature")
  const body = await request.text()

  if (signature && !(await verifySignature(signature, body))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  return NextResponse.json(
    { success: false, error: "Not implemented yet (lead follow-up automation)" },
    { status: 501 }
  )
}
