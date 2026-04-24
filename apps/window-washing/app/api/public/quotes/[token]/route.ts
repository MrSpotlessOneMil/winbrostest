import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Public quote detail — WinBros Round 2 task 7.
 *
 * Token-based access (no user session). Returns the customer-facing view
 * of a quote: required/recommended/optional line items, plans that were
 * explicitly offered_to_customer, and tenant branding.
 *
 * GET /api/public/quotes/:token
 *   → { quote, line_items, plans, tenant }
 *
 * Security:
 *   - token is 128-bit random (existing column). No enumeration risk.
 *   - Only returns plans where offered_to_customer=true (admin-only plans hidden).
 *   - Stops early if the quote is already converted, declined, or expired — the
 *     response includes `status` so the client can show a "this quote is
 *     already approved/expired" state instead of the approve form.
 */

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { data: quote, error: quoteErr } = await client
    .from('quotes')
    .select(
      'id, token, status, customer_id, customer_name, customer_phone, customer_email, customer_address, notes, description, total_price, original_price, valid_until, approved_at, tenant_id'
    )
    .eq('token', token)
    .maybeSingle()

  if (quoteErr) return NextResponse.json({ error: quoteErr.message }, { status: 500 })
  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

  // Wave 3f — the customer page needs to know whether a card is already saved
  // so it can gate the Approve CTA. The webhook `setup_intent.succeeded`
  // stamps customers.card_on_file_at once Stripe confirms the PM, so a
  // non-null value is the source of truth for "card captured for this
  // customer". Fetch it alongside the quote in the same round-trip.
  let cardOnFileAt: string | null = null
  if (quote.customer_id) {
    const { data: cust } = await client
      .from('customers')
      .select('card_on_file_at')
      .eq('id', quote.customer_id)
      .maybeSingle()
    cardOnFileAt = cust?.card_on_file_at ?? null
  }

  const [{ data: lineItems }, { data: plans }, { data: tenant }] = await Promise.all([
    client
      .from('quote_line_items')
      .select('id, service_name, description, price, quantity, optionality, is_upsell, sort_order')
      .eq('quote_id', quote.id)
      .order('sort_order', { ascending: true }),
    client
      .from('quote_service_plans')
      .select(
        'id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, sort_order'
      )
      .eq('quote_id', quote.id)
      .eq('offered_to_customer', true)
      .order('sort_order', { ascending: true }),
    client
      .from('tenants')
      .select('slug, name, business_name, email, website_url, currency, agreement_pdf_url')
      .eq('id', quote.tenant_id)
      .maybeSingle(),
  ])

  return NextResponse.json({
    quote: {
      id: quote.id,
      token: quote.token,
      status: quote.status,
      customer_name: quote.customer_name,
      customer_phone: quote.customer_phone,
      customer_email: quote.customer_email,
      customer_address: quote.customer_address,
      notes: quote.notes,
      description: quote.description,
      total_price: quote.total_price,
      original_price: quote.original_price,
      valid_until: quote.valid_until,
      approved_at: quote.approved_at,
      card_on_file_at: cardOnFileAt,
    },
    line_items: lineItems ?? [],
    plans: plans ?? [],
    tenant: tenant
      ? {
          slug: tenant.slug,
          name: tenant.business_name || tenant.name,
          phone: null,
          email: tenant.email,
          website_url: tenant.website_url,
          currency: tenant.currency,
          brand_color: null,
          logo_url: null,
          agreement_pdf_url: tenant.agreement_pdf_url,
        }
      : null,
  })
}
