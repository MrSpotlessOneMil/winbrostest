import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getQuotePricing, computeQuoteTotal, isWindowCleaningTenant } from "@/lib/quote-pricing"
import { getStripeClientForTenant, getTenantRedirectDomain, findOrCreateStripeCustomer } from "@/lib/stripe-client"

/**
 * Public quote endpoints — NO auth required.
 * The token in the URL acts as the authorization.
 *
 * GET   — View a quote with tenant-aware tiers, addons, and plans
 * PATCH — Approve quote + create Stripe Checkout session for payment
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("token", token)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // Fetch tenant info for branding + service type
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, name, business_name, business_name_short, owner_phone, owner_email, google_review_link, workflow_config")
    .eq("id", quote.tenant_id)
    .single()

  if (!tenant) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }

  // If expired and still pending, update status
  if (quote.status === "pending" && new Date(quote.valid_until) < new Date()) {
    await supabase
      .from("quotes")
      .update({ status: "expired" })
      .eq("id", quote.id)
      .eq("status", "pending")

    quote.status = "expired"
  }

  // Get tenant-aware pricing (respects service_category for move-in/move-out)
  const serviceCategory = quote.service_category || 'standard'
  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: quote.square_footage,
    bedrooms: quote.bedrooms,
    bathrooms: quote.bathrooms,
  }, serviceCategory)

  // Fetch membership/service plans for this tenant
  const { data: servicePlans } = await supabase
    .from("service_plans")
    .select("id, slug, name, visits_per_year, interval_months, discount_per_visit, early_cancel_repay, free_addons, agreement_text")
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("discount_per_visit", { ascending: true })

  // Build service agreement text
  const wc = tenant.workflow_config as Record<string, unknown> || {}
  const cancellationFee = Number(wc.cancellation_fee_cents || 5000) / 100
  const cancellationWindow = Number(wc.cancellation_window_hours || 24)

  const serviceAgreement = {
    cancellation_fee: cancellationFee,
    cancellation_window_hours: cancellationWindow,
    satisfaction_guarantee: true,
    deposit_percentage: Number(wc.deposit_percentage || 50),
    processing_fee_percentage: 3,
    terms: [
      `A $${cancellationFee.toFixed(0)} cancellation fee applies if cancelled within ${cancellationWindow} hours of your scheduled appointment.`,
      `A ${Number(wc.deposit_percentage || 50)}% deposit is required to confirm your booking. The remaining balance is due upon completion.`,
      `A 3% processing fee is applied to all card payments.`,
      `100% Satisfaction Guarantee — if you're not happy with the service, we'll come back and make it right at no extra charge.`,
    ],
  }

  return NextResponse.json({
    success: true,
    quote,
    tierPrices: pricing.tierPrices,
    tiers: pricing.tiers,
    addons: pricing.addons,
    serviceType: pricing.serviceType,
    servicePlans: servicePlans || [],
    serviceAgreement,
    tenant: {
      name: tenant.business_name || tenant.name,
      slug: tenant.slug,
      phone: tenant.owner_phone,
      email: tenant.owner_email,
    },
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 })
  }

  const body = await request.json()
  const {
    selected_tier,
    selected_addons,
    customer_name,
    customer_email,
    membership_plan,
    service_agreement_accepted,
  } = body

  if (!selected_tier) {
    return NextResponse.json({ error: "selected_tier is required" }, { status: 400 })
  }

  if (selected_addons && !Array.isArray(selected_addons)) {
    return NextResponse.json({ error: "selected_addons must be an array" }, { status: 400 })
  }

  if (!service_agreement_accepted) {
    return NextResponse.json({ error: "You must accept the service agreement" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Look up quote by token
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("token", token)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // Validate quote is still actionable
  if (quote.status !== "pending") {
    return NextResponse.json(
      { error: `Quote is already ${quote.status}` },
      { status: 409 }
    )
  }

  if (new Date(quote.valid_until) < new Date()) {
    await supabase
      .from("quotes")
      .update({ status: "expired" })
      .eq("id", quote.id)
      .eq("status", "pending")

    return NextResponse.json({ error: "Quote has expired" }, { status: 410 })
  }

  // Fetch tenant for pricing + Stripe key
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, slug, name, business_name, stripe_secret_key, workflow_config")
    .eq("id", quote.tenant_id)
    .single()

  if (!tenant) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }

  if (!tenant.stripe_secret_key) {
    return NextResponse.json({ error: "Payment not configured for this business" }, { status: 400 })
  }

  // Compute price server-side (never trust client-side price)
  const addons: string[] = selected_addons || []
  const quoteServiceCategory = quote.service_category || 'standard'
  const { subtotal } = await computeQuoteTotal(
    tenant.id,
    tenant.slug,
    selected_tier,
    addons,
    {
      squareFootage: quote.square_footage,
      bedrooms: quote.bedrooms,
      bathrooms: quote.bathrooms,
    },
    quoteServiceCategory
  )

  // Look up membership plan if selected
  let plan: { id: string; slug: string; discount_per_visit: number; interval_months: number; visits_per_year: number; free_addons: string[] | null } | null = null
  let membershipDiscount = 0

  if (membership_plan) {
    const { data: planData } = await supabase
      .from("service_plans")
      .select("id, slug, discount_per_visit, interval_months, visits_per_year, free_addons")
      .eq("slug", membership_plan)
      .eq("tenant_id", quote.tenant_id)
      .eq("active", true)
      .single()

    if (planData) {
      plan = planData
      membershipDiscount = Number(plan.discount_per_visit) || 0
    }
  }

  const total = Math.max(subtotal - (Number(quote.discount) || 0) - membershipDiscount, 0)

  // Calculate deposit: 50% + 3% processing fee
  const wc = tenant.workflow_config as Record<string, unknown> || {}
  const depositPct = Number(wc.deposit_percentage || 50) / 100
  const depositAmount = Math.round(total * depositPct * 1.03 * 100) // cents

  // Determine service name for Stripe line item
  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: quote.square_footage,
    bedrooms: quote.bedrooms,
    bathrooms: quote.bathrooms,
  }, quoteServiceCategory)
  const tierDef = pricing.tiers.find(t => t.key === selected_tier)
  const serviceName = tierDef?.name || selected_tier
  const businessName = tenant.business_name || tenant.name

  // Update quote with selection (but keep status pending until payment)
  const updatePayload: Record<string, unknown> = {
    selected_tier,
    selected_addons: addons,
    subtotal,
    total,
    service_agreement_accepted: true,
    service_agreement_accepted_at: new Date().toISOString(),
  }
  if (plan) {
    updatePayload.membership_plan = plan.slug
    updatePayload.membership_discount = membershipDiscount
  }
  if (customer_name) updatePayload.customer_name = customer_name
  if (customer_email) updatePayload.customer_email = customer_email

  await supabase
    .from("quotes")
    .update(updatePayload)
    .eq("id", quote.id)

  // Create Stripe Checkout session for deposit
  try {
    const stripe = getStripeClientForTenant(tenant.stripe_secret_key)
    const domain = await getTenantRedirectDomain(tenant.id)
    const quoteSuccessUrl = `${domain}/quote/${token}/success`

    // If customer has an email, find or create Stripe customer
    const email = customer_email || quote.customer_email
    let stripeCustomerId: string | undefined
    if (email) {
      try {
        const stripeCustomer = await findOrCreateStripeCustomer(
          { email, phone_number: quote.customer_phone, first_name: customer_name || quote.customer_name } as any,
          tenant.stripe_secret_key
        )
        stripeCustomerId = stripeCustomer.id
      } catch {
        // Continue without Stripe customer — checkout will collect email
      }
    }

    const sessionParams: Record<string, unknown> = {
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${serviceName} — Deposit`,
              description: `${Math.round(depositPct * 100)}% deposit for ${serviceName.toLowerCase()} service from ${businessName}. Includes 3% processing fee.`,
            },
            unit_amount: depositAmount,
          },
          quantity: 1,
        },
      ],
      success_url: quoteSuccessUrl,
      cancel_url: `${domain}/quote/${token}`,
      metadata: {
        quote_id: quote.id,
        quote_token: token,
        payment_type: 'QUOTE_DEPOSIT',
        selected_tier,
        phone_number: quote.customer_phone || '',
        tenant_id: tenant.id,
        membership_plan: plan?.slug || '',
      },
    }

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId
    } else if (email) {
      sessionParams.customer_email = email
    }

    const session = await stripe.checkout.sessions.create(sessionParams as any)

    // Save checkout session ID on quote
    await supabase
      .from("quotes")
      .update({
        stripe_checkout_session_id: session.id,
        deposit_amount: depositAmount / 100,
      })
      .eq("id", quote.id)

    return NextResponse.json({
      success: true,
      checkout_url: session.url,
      deposit_amount: depositAmount / 100,
      total,
    })
  } catch (err) {
    console.error("[quote/approve] Stripe checkout error:", err)
    return NextResponse.json(
      { error: "Failed to create payment session. Please try again." },
      { status: 500 }
    )
  }
}
