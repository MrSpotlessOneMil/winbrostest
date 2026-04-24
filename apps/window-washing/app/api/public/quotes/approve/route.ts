import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { approveAndConvertQuote } from '@/lib/quote-conversion'

/**
 * Public customer quote approval — WinBros Round 2 task 7.
 *
 * Token-based (no user auth). Validates the quote token, the signature,
 * and the agreement-read flag. Creates a `service_plans` row when a plan
 * was selected, stores signature_data + signed_ip + signed_at, then runs
 * the existing approveAndConvertQuote pipeline so original quote lines
 * materialize as visit_line_items with correct revenue_type.
 *
 * POST /api/public/quotes/approve
 *   body: {
 *     token: string,
 *     selected_plan_id?: number | null,   // quote_service_plans row id
 *     agreement_read: boolean,
 *     signature_data: string,              // base64 PNG from canvas
 *     opted_in_optional_ids?: (number|string)[],
 *     opted_out_recommended_ids?: (number|string)[]
 *   }
 */

type Body = {
  token?: unknown
  selected_plan_id?: unknown
  agreement_read?: unknown
  signature_data?: unknown
  opted_in_optional_ids?: unknown
  opted_out_recommended_ids?: unknown
}

function clientIp(request: NextRequest): string | null {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() || null
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return null
}

export async function POST(request: NextRequest) {
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 })
  }

  // Wave 3f — signature + agreement are only required when the customer is
  // signing up for a recurring service plan (that's what they're agreeing to).
  // One-time quotes approve with just a card on file — the captured card is
  // the commitment signal and the service_plans row won't be created.
  const hasPlanSelection =
    body.selected_plan_id != null &&
    Number.isFinite(Number(body.selected_plan_id)) &&
    Number(body.selected_plan_id) > 0

  const signature =
    typeof body.signature_data === 'string' ? body.signature_data : ''
  if (hasPlanSelection) {
    if (body.agreement_read !== true) {
      return NextResponse.json(
        { error: 'You must read and agree to the service agreement' },
        { status: 400 }
      )
    }
    if (!signature || signature.length < 200) {
      return NextResponse.json(
        { error: 'A drawn signature is required' },
        { status: 400 }
      )
    }
  }

  const client = getSupabaseServiceClient()

  const { data: quote, error: quoteErr } = await client
    .from('quotes')
    .select('id, tenant_id, status, customer_id, total_price, original_price')
    .eq('token', token)
    .maybeSingle()

  if (quoteErr) return NextResponse.json({ error: quoteErr.message }, { status: 500 })
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  // Wave 3f — legacy /api/actions/quotes POST creates quotes with status
  // 'pending' (not 'draft' or 'sent'), so the prior list was too narrow and
  // rejected every real salesman-sent quote. Treat converted/declined as
  // the only hard stops.
  if (['converted', 'declined', 'expired'].includes(quote.status)) {
    return NextResponse.json(
      { error: `Quote already ${quote.status}, cannot approve` },
      { status: 409 }
    )
  }

  const signedAt = new Date().toISOString()
  const signedIp = clientIp(request)

  // Resolve the selected plan, if any. Must belong to this quote and be offered.
  type PlanRow = {
    id: number
    name: string
    recurring_price: number
    first_visit_keeps_original_price: boolean
    recurrence: { visits_per_year?: number; interval_months?: number } | null
  }
  let selectedPlan: PlanRow | null = null
  if (body.selected_plan_id != null) {
    const planId = Number(body.selected_plan_id)
    if (Number.isFinite(planId) && planId > 0) {
      const { data: planRow } = await client
        .from('quote_service_plans')
        .select(
          'id, name, recurring_price, first_visit_keeps_original_price, offered_to_customer, tenant_id, quote_id, recurrence'
        )
        .eq('id', planId)
        .maybeSingle()
      if (
        !planRow ||
        planRow.quote_id !== quote.id ||
        planRow.tenant_id !== quote.tenant_id ||
        !planRow.offered_to_customer
      ) {
        return NextResponse.json({ error: 'Selected plan is not available' }, { status: 400 })
      }
      selectedPlan = {
        id: planRow.id,
        name: planRow.name,
        recurring_price: Number(planRow.recurring_price) || 0,
        first_visit_keeps_original_price: !!planRow.first_visit_keeps_original_price,
        recurrence: (planRow.recurrence as PlanRow['recurrence']) ?? null,
      }
    }
  }

  // Fetch tenant agreement PDF URL for the signature trail.
  const { data: tenant } = await client
    .from('tenants')
    .select('agreement_pdf_url')
    .eq('id', quote.tenant_id)
    .maybeSingle()

  // If a plan was selected, create the service_plans row FIRST so the
  // signature trail is persisted even if downstream conversion hits a
  // transient failure.
  let servicePlanId: number | null = null
  if (selectedPlan && quote.customer_id) {
    // Legacy service_plans has NOT NULL on: name, slug, visits_per_year,
    // interval_months. Derive sensible defaults from quote_service_plans.
    // Monthly (12/1) is the safest fallback; admin can correct post-approval.
    const rec = selectedPlan.recurrence ?? {}
    const visitsPerYear =
      typeof rec.visits_per_year === 'number' && rec.visits_per_year > 0
        ? rec.visits_per_year
        : 12
    const intervalMonths =
      typeof rec.interval_months === 'number' && rec.interval_months > 0
        ? rec.interval_months
        : 1
    const slug = `${String(selectedPlan.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${Date.now()}`

    const { data: inserted, error: insertErr } = await client
      .from('service_plans')
      .insert({
        tenant_id: quote.tenant_id,
        customer_id: quote.customer_id,
        quote_id: quote.id,
        name: selectedPlan.name,
        plan_name: selectedPlan.name,
        slug,
        visits_per_year: visitsPerYear,
        interval_months: intervalMonths,
        plan_price: selectedPlan.recurring_price,
        normal_price: quote.original_price ?? quote.total_price ?? null,
        status: 'active',
        signed_at: signedAt,
        signed_ip: signedIp,
        signature_data: signature,
        agreement_pdf_url: tenant?.agreement_pdf_url ?? null,
      })
      .select('id')
      .single()
    if (insertErr) {
      console.error('[public/approve] service_plans insert failed:', insertErr)
      return NextResponse.json(
        { error: 'Failed to record signed agreement' },
        { status: 500 }
      )
    }
    servicePlanId = inserted.id
  }

  // Persist customer selections on the quote so the admin can audit what
  // the customer actually approved. Non-destructive — just notes.
  const optedIn = Array.isArray(body.opted_in_optional_ids) ? body.opted_in_optional_ids : []
  const optedOut = Array.isArray(body.opted_out_recommended_ids)
    ? body.opted_out_recommended_ids
    : []
  const approvalNote = `Approved ${signedAt} from ${signedIp ?? 'unknown IP'}. opt_in=${JSON.stringify(optedIn)} opt_out=${JSON.stringify(optedOut)} plan=${selectedPlan?.id ?? 'none'}`
  await client
    .from('quotes')
    .update({
      notes: approvalNote,
      approved_at: signedAt,
    })
    .eq('id', quote.id)

  // Run the existing quote→job conversion. This also flips quote.status to
  // 'converted' on success, so it must run last.
  const result = await approveAndConvertQuote(client, quote.id as unknown as number, 'customer')
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    job_id: result.job_id,
    visit_id: result.visit_id,
    service_plan_id: servicePlanId,
  })
}
