import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { createEmployeeSession, setSessionCookie } from "@/lib/auth"
import { validateQuoteSalesmanLink } from "@/lib/quote-link-validation"

/**
 * POST /api/crew/[token]/quote-draft
 *
 * Token-authenticated endpoint used by the crew portal "New Quote" button.
 *
 * - Resolves the cleaner by their portal token.
 * - Any active crew member (salesman, team lead, technician) can create a
 *   quote — Blake's call. Salesman attribution still only fires when
 *   employee_type='salesman' so payroll commission credits the right person.
 * - Creates an empty draft quote in the cleaner's tenant.
 * - Mints an employee session cookie on the response so the worker can
 *   follow the redirect into the admin quote builder (`/quotes/[id]`) and
 *   hit `/api/actions/quotes/*` without re-authenticating.
 * - Returns the new quote's id so the client can push the route.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const client = getSupabaseServiceClient()

  // Optional body — appointment_job_id threads Phase F linkage; customer_id
  // pre-populates the builder. Bare POST keeps working.
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

  // Any active crew can create a quote (Wave 3i). Only salesman attribution
  // stamps salesman_id — team leads and technicians create unattributed
  // drafts so payroll commission goes to whoever the admin sets later.
  let salesmanId: number | null =
    cleaner.employee_type === "salesman" ? cleaner.id : null

  // Phase I — if a non-salesman starts a quote FROM an appointment, fall
  // back to the appointment's crew_salesman_id so the linkage stays intact.
  // Without this, a team lead or tech opening a quote from a salesman's
  // appointment would create an orphaned draft that fails the
  // quotes_appointment_needs_salesman CHECK constraint.
  if (!salesmanId && appointmentJobId) {
    const { data: appt } = await client
      .from("jobs")
      .select("crew_salesman_id, tenant_id")
      .eq("id", appointmentJobId)
      .eq("tenant_id", cleaner.tenant_id)
      .maybeSingle()
    if (appt && typeof appt.crew_salesman_id === "number") {
      salesmanId = appt.crew_salesman_id
    }
  }

  const insertRow: Record<string, unknown> = {
    tenant_id: cleaner.tenant_id,
    status: "pending",
    customer_name: "New Quote",
    total_price: 0,
    salesman_id: salesmanId,
  }
  if (appointmentJobId) {
    insertRow.appointment_job_id = appointmentJobId
    // Phase N (2026-04-29): salesmen who launch a quote from /appointments
    // are converting an appointment, so the resulting quote pays at 12.5%
    // (handled via Phase F's salesman_appointment_credits ledger). Door-
    // knock quotes — created without an appointment linkage — leave the
    // flag false (default) and pay at 20%.
    insertRow.is_appointment_quote = true
  }
  if (customerId) insertRow.customer_id = customerId

  // Phase I validator — surface a clean 422 if the linkage is broken.
  const linkCheck = validateQuoteSalesmanLink({
    appointment_job_id: appointmentJobId,
    salesman_id: salesmanId,
  })
  if (!linkCheck.ok) {
    return NextResponse.json(
      { success: false, error: linkCheck.error },
      { status: 422 }
    )
  }

  const { data: quote, error: insertErr } = await client
    .from("quotes")
    .insert(insertRow)
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
