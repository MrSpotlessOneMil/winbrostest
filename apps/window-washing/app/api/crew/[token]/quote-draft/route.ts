import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { createEmployeeSession, setSessionCookie } from "@/lib/auth"

/**
 * POST /api/crew/[token]/quote-draft
 *
 * Token-authenticated endpoint used by the crew portal "New Quote" button.
 *
 * - Resolves the cleaner by their portal token.
 * - Only salesmen and team leads are allowed to create quotes per Max's
 *   Round 2 spec. Other employee types get 403.
 * - Creates an empty draft quote in the cleaner's tenant.
 * - Mints an employee session cookie on the response so the salesman can
 *   follow the redirect into the admin quote builder (`/quotes/[id]`) and
 *   hit `/api/actions/quotes/*` without re-authenticating.
 * - Returns the new quote's id so the client can push the route.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  const { data: cleaner, error: cleanerErr } = await client
    .from("cleaners")
    .select("id, tenant_id, employee_type, is_team_lead, active")
    .eq("portal_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (cleanerErr || !cleaner || !cleaner.active) {
    return NextResponse.json(
      { success: false, error: "Invalid portal link" },
      { status: 404 }
    )
  }

  const canCreate =
    cleaner.employee_type === "salesman" || cleaner.is_team_lead === true
  if (!canCreate) {
    return NextResponse.json(
      { success: false, error: "Not authorized to create quotes" },
      { status: 403 }
    )
  }

  const { data: quote, error: insertErr } = await client
    .from("quotes")
    .insert({
      tenant_id: cleaner.tenant_id,
      status: "pending",
      customer_name: "New Quote",
      total_price: 0,
    })
    .select("id")
    .single()

  if (insertErr || !quote) {
    console.error("[crew/quote-draft] insert failed:", insertErr?.message)
    return NextResponse.json(
      { success: false, error: insertErr?.message || "Failed to create quote" },
      { status: 500 }
    )
  }

  const sessionToken = await createEmployeeSession(cleaner.id)
  const response = NextResponse.json({ success: true, quoteId: quote.id })
  setSessionCookie(response, sessionToken)
  return response
}
