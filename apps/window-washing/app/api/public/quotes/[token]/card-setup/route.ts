import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { createCardOnFileLink, getTenantRedirectDomain } from '@/lib/stripe-client'
import { getTenantById } from '@/lib/tenant'

/**
 * Public card-on-file setup — WinBros Round 2 task 7.
 *
 * Token-gated endpoint the customer quote view hits to get a Stripe
 * Checkout (mode=setup) URL. Redirects the customer to Stripe to save
 * their card; Stripe webhook (setup_intent.succeeded) writes
 * customers.stripe_customer_id + card_on_file_at.
 *
 * POST /api/public/quotes/:token/card-setup → { url }
 */

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { data: quote } = await client
    .from('quotes')
    .select('id, tenant_id, customer_id, customer_name, customer_phone, customer_email, customer_address, status')
    .eq('token', token)
    .maybeSingle()

  if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (!['draft', 'sent'].includes(quote.status)) {
    return NextResponse.json(
      { error: `Quote already ${quote.status}` },
      { status: 409 }
    )
  }

  // We need a customers row for the Stripe SetupIntent flow to stash
  // stripe_customer_id on. If the quote was built without one (walk-in
  // style), fail closed — admin must attach a customer first.
  if (!quote.customer_id) {
    return NextResponse.json(
      { error: 'Quote has no customer on file. Contact us to add one.' },
      { status: 400 }
    )
  }

  const { data: customer } = await client
    .from('customers')
    .select(
      'id, tenant_id, first_name, last_name, email, phone_number, address, stripe_customer_id'
    )
    .eq('id', quote.customer_id)
    .maybeSingle()

  if (!customer || customer.tenant_id !== quote.tenant_id) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Populate a usable email for Stripe: customer.email → quote.customer_email.
  if (!customer.email && quote.customer_email) {
    await client
      .from('customers')
      .update({ email: quote.customer_email })
      .eq('id', customer.id)
    customer.email = quote.customer_email
  }

  if (!customer.email) {
    return NextResponse.json(
      { error: 'Customer email is required to save a card. Add email and retry.' },
      { status: 400 }
    )
  }

  // Load tenant + Stripe key — fail closed rather than fall back to env var
  // to match feedback_fail_closed_multitenant.
  const tenant = await getTenantById(quote.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 500 })
  }
  const stripeKey = tenant.stripe_secret_key || ''
  if (!stripeKey) {
    return NextResponse.json(
      { error: 'Stripe is not configured for this tenant' },
      { status: 500 }
    )
  }

  // Wave 3f — return the customer to the same quote page with `?card=saved`
  // so the client can re-fetch customer.card_on_file_at and unlock Approve.
  const domain = await getTenantRedirectDomain(quote.tenant_id)
  const returnTo = `${domain.replace(/\/$/, '')}/quote/${token}/v2?card=saved`

  const result = await createCardOnFileLink(
    {
      ...customer,
      tenant_id: quote.tenant_id,
    } as Parameters<typeof createCardOnFileLink>[0],
    String(quote.id),
    quote.tenant_id,
    stripeKey,
    returnTo
  )

  if (!result.success || !result.url) {
    return NextResponse.json(
      { error: result.error || 'Failed to create card setup session' },
      { status: 500 }
    )
  }

  return NextResponse.json({ url: result.url })
}
