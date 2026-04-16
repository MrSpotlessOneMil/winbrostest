import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { getQuotePricing, computeQuoteTotal, isWindowCleaningTenant } from "@/lib/quote-pricing"
import { getStripeClientForTenant, getTenantRedirectDomain, findOrCreateStripeCustomer } from "@/lib/stripe-client"
import { normalizeAddons, type AddonInput, type NormalizedAddon } from "@/lib/service-scope"

/** Safely add months without JS Date overflow (Jan 31 + 1 month = Feb 28, not Mar 3) */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const day = result.getDate()
  result.setMonth(result.getMonth() + months)
  // If the day overflowed (e.g., 31 → 3), clamp to last day of target month
  if (result.getDate() !== day) {
    result.setDate(0) // Sets to last day of previous month
  }
  return result
}

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
    .select("id, slug, name, business_name, business_name_short, owner_phone, owner_email, google_review_link, workflow_config, currency")
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
    .select("id, slug, name, visits_per_year, interval_months, discount_per_visit, free_addons, agreement_text")
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
    deposit_percentage: 0,
    processing_fee_percentage: 3,
    terms: [
      `A $${cancellationFee.toFixed(0)} cancellation fee applies if cancelled within ${cancellationWindow} hours of your scheduled appointment.`,
      `A card on file is required to confirm your booking. Your card will be charged the final amount after the service is completed.`,
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
    custom_base_price: quote.custom_base_price ? Number(quote.custom_base_price) : null,
    custom_terms: quote.custom_terms || null,
    quote_notes: quote.notes || null,
    tenant: {
      name: tenant.business_name || tenant.name,
      slug: tenant.slug,
      phone: tenant.owner_phone,
      email: tenant.owner_email,
      brand_color: wc.brand_color || null,
      brand_color_light: wc.brand_color_light || null,
      logo_url: wc.logo_url || null,
      currency: tenant.currency || 'usd',
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

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const {
    selected_tier,
    selected_addons,
    customer_name,
    customer_email,
    customer_address,
    membership_plan,
    service_agreement_accepted,
    service_date,
    service_time,
    customer_notes,
  } = body

  // selected_tier is required unless quote has custom_base_price (salesman-quoted)
  // We'll validate after fetching the quote

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

  // Custom-priced quotes (salesman-quoted) use 'custom' tier
  const hasCustomPrice = quote.custom_base_price != null
  const effectiveTier = hasCustomPrice ? 'custom' : selected_tier

  if (!effectiveTier) {
    return NextResponse.json({ error: "selected_tier is required" }, { status: 400 })
  }

  // Normalize addons with inclusion flag — single source of truth.
  // Custom-priced quotes → default included. Tiered → included if in tier upgrades.
  // Explicit { included: true/false } on an incoming addon object always wins.
  const rawAddons = (selected_addons || []) as unknown[]
  const filteredRawAddons: AddonInput[] = rawAddons.filter(
    (a): a is AddonInput =>
      typeof a === "string" || (typeof a === "object" && a !== null && "key" in a)
  )
  const tierForNormalization = hasCustomPrice ? 'custom' : (selected_tier as string)
  const normalizedAddons: NormalizedAddon[] = normalizeAddons(
    filteredRawAddons,
    tierForNormalization,
    hasCustomPrice
  )

  // Compute price server-side (never trust client-side price)
  const quoteServiceCategory = quote.service_category || 'standard'
  let subtotal: number

  if (hasCustomPrice) {
    // Custom-priced quote: locked base is the salesman's price.
    // Only add-ons explicitly marked NOT included contribute extra charge.
    const customBase = Number(quote.custom_base_price) || 0
    const pricing = await getQuotePricing(tenant.id, tenant.slug, {
      squareFootage: quote.square_footage,
      bedrooms: quote.bedrooms,
      bathrooms: quote.bathrooms,
    }, quoteServiceCategory)
    const addonTotal = normalizedAddons.reduce((sum, a) => {
      if (a.included) return sum
      const addon = pricing.addons.find((p) => p.key === a.key)
      if (!addon) return sum
      return sum + addon.price * (a.quantity || 1)
    }, 0)
    subtotal = customBase + addonTotal
  } else {
    const computed = await computeQuoteTotal(
      tenant.id,
      tenant.slug,
      selected_tier as string,
      normalizedAddons,
      {
        squareFootage: quote.square_footage,
        bedrooms: quote.bedrooms,
        bathrooms: quote.bathrooms,
      },
      quoteServiceCategory,
      false
    )
    subtotal = computed.subtotal
  }

  // Look up membership plan if selected
  let plan: { id: string; slug: string; discount_per_visit: number; interval_months: number; visits_per_year: number; free_addons: string[] | null } | null = null
  let membershipDiscount = 0

  if (membership_plan && typeof membership_plan === "string") {
    const { data: planData } = await supabase
      .from("service_plans")
      .select("id, slug, discount_per_visit, interval_months, visits_per_year, free_addons")
      .eq("slug", membership_plan)
      .eq("tenant_id", quote.tenant_id)
      .eq("active", true)
      .single()

    if (!planData) {
      return NextResponse.json({ error: `Membership plan "${membership_plan}" not found or inactive` }, { status: 400 })
    }

    plan = planData
    membershipDiscount = Number(plan.discount_per_visit) || 0
  }

  const total = Math.max(subtotal - (Number(quote.discount) || 0) - membershipDiscount, 0)

  // Determine service name
  let serviceName: string
  if (hasCustomPrice) {
    serviceName = 'Custom Quote'
  } else {
    const pricingForName = await getQuotePricing(tenant.id, tenant.slug, {
      squareFootage: quote.square_footage,
      bedrooms: quote.bedrooms,
      bathrooms: quote.bathrooms,
    }, quoteServiceCategory)
    const tierDef = pricingForName.tiers.find(t => t.key === selected_tier)
    serviceName = tierDef?.name || (selected_tier as string)
  }
  const businessName = tenant.business_name || tenant.name

  // Update quote with selection (but keep status pending until payment)
  const updatePayload: Record<string, unknown> = {
    selected_tier: effectiveTier,
    selected_addons: normalizedAddons,
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
  if (customer_address && typeof customer_address === 'string') updatePayload.customer_address = customer_address
  if (service_date && typeof service_date === 'string') updatePayload.service_date = service_date
  if (service_time && typeof service_time === 'string') updatePayload.service_time = service_time
  if (customer_notes && typeof customer_notes === 'string') updatePayload.notes = customer_notes.slice(0, 500)

  await supabase
    .from("quotes")
    .update(updatePayload)
    .eq("id", quote.id)

  // Create Stripe Checkout session in setup mode (card on file, no charge)
  try {
    const stripe = getStripeClientForTenant(tenant.stripe_secret_key)
    const domain = await getTenantRedirectDomain(tenant.id)
    const quoteSuccessUrl = `${domain}/quote/${token}/success`

    // Always find or create a Stripe customer so the card gets attached
    const email = (customer_email || quote.customer_email) as string | undefined
    let stripeCustomerId: string | undefined

    // Try with email first (enables receipt emails)
    if (email) {
      try {
        const stripeCustomer = await findOrCreateStripeCustomer(
          { email, phone_number: quote.customer_phone, first_name: customer_name || quote.customer_name } as any,
          tenant.stripe_secret_key
        )
        stripeCustomerId = stripeCustomer.id
      } catch {
        // Fall through to phone-only creation
      }
    }

    const sessionMetadata = {
      quote_id: quote.id,
      quote_token: token,
      purpose: 'quote_card_on_file',
      selected_tier: (effectiveTier as string) || '',
      phone_number: quote.customer_phone || '',
      tenant_id: tenant.id,
      membership_plan: plan?.slug || '',
    }

    const sessionParams: Record<string, unknown> = {
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: quoteSuccessUrl,
      cancel_url: `${domain}/quote/${token}`,
      metadata: sessionMetadata,
      setup_intent_data: {
        metadata: sessionMetadata,
      },
      // Always create a Stripe customer so the card gets attached and is chargeable
      customer_creation: 'always',
    }

    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId
      delete sessionParams.customer_creation // not needed when customer already exists
    } else if (email) {
      sessionParams.customer_email = email
    }

    const session = await stripe.checkout.sessions.create(sessionParams as any)

    // Save checkout session ID on quote
    await supabase
      .from("quotes")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", quote.id)

    return NextResponse.json({
      success: true,
      checkout_url: session.url,
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
