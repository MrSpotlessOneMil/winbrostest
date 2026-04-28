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

  // Optional body: appointment_job_id threads through Phase F so the
  // converted quote can later flip the salesman's pending credit to
  // earned. customer_id pre-populates the builder when launched from an
  // existing appointment. Body is optional — bare POST still works.
  let body: { appointment_job_id?: unknown; customer_id?: unknown } = {}
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }
  const appointmentJobId =
    typeof body.appointment_job_id === 'number' && body.appointment_job_id > 0
      ? body.appointment_job_id
      : null
  const customerId =
    typeof body.customer_id === 'number' && body.customer_id > 0
      ? body.customer_id
      : null

  const supabase = getSupabaseServiceClient()

  const insertRow: Record<string, unknown> = {
    tenant_id: tenant.id,
    status: "pending",
    customer_name: "New Quote",
    total_price: 0,
  }
  if (appointmentJobId) insertRow.appointment_job_id = appointmentJobId
  if (customerId) insertRow.customer_id = customerId

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert(insertRow)
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
