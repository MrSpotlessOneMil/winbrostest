import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { sendSMS } from "@/lib/openphone"
import { getBaseUrl } from "@/lib/admin-onboard"

/**
 * POST — Send a quote link to a customer via SMS
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let quote_id: string
  try {
    const body = await request.json()
    quote_id = body.quote_id
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!quote_id) {
    return NextResponse.json({ error: "quote_id is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Look up quote and verify tenant ownership
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, token, customer_name, customer_phone, status, tenant_id")
    .eq("id", quote_id)
    .single()

  if (!quote || quote.tenant_id !== tenant.id) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  if (quote.status !== "pending") {
    return NextResponse.json({ error: `Cannot send — quote is ${quote.status}` }, { status: 400 })
  }

  if (!quote.customer_phone) {
    return NextResponse.json({ error: "No phone number on this quote" }, { status: 400 })
  }

  const baseUrl = getBaseUrl() || "https://cleanmachine.live"
  const quoteUrl = `${baseUrl}/quote/${quote.token}`

  const name = quote.customer_name?.split(" ")[0] || "there"
  const message = `Hey ${name}! Your quote from ${tenant.name} is ready. Check it out and choose your package here: ${quoteUrl}`

  const result = await sendSMS(tenant, quote.customer_phone, message)

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Failed to send SMS" }, { status: 500 })
  }

  return NextResponse.json({ success: true, message_id: result.messageId })
}
