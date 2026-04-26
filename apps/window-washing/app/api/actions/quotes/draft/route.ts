import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * POST /api/actions/quotes/draft
 *
 * Admin/owner-side blank draft creator. Mirrors the crew portal's
 * /api/crew/[token]/quote-draft (but session-authenticated, not token).
 *
 * Used by the /jobs Calendar "+ New Quote" popup and any calendar-slot click
 * to mint a draft and open the QuoteBuilder Sheet — no navigation away.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenant.id,
      status: "pending",
      customer_name: "New Quote",
      total_price: 0,
    })
    .select("id")
    .single()

  if (error || !quote) {
    console.error("[quotes/draft] insert failed:", error?.message)
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create draft" },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, quoteId: quote.id })
}
