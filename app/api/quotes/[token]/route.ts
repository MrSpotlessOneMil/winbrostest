import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { computeTierPrice, QUOTE_TIERS, QUOTE_ADDONS } from "@/lib/pricebook"

/**
 * Public quote endpoints — NO auth required.
 * The token in the URL acts as the authorization.
 *
 * GET  — View a quote by its public token
 * PATCH — Approve a quote (customer selects tier + addons)
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

  // If expired and still pending, update status
  if (quote.status === "pending" && new Date(quote.valid_until) < new Date()) {
    await supabase
      .from("quotes")
      .update({ status: "expired" })
      .eq("id", quote.id)
      .eq("status", "pending") // Atomic: only update if still pending

    quote.status = "expired"
  }

  // Compute tier prices based on quote's square footage
  const tierPrices = {
    good: computeTierPrice("good", quote.square_footage),
    better: computeTierPrice("better", quote.square_footage),
    best: computeTierPrice("best", quote.square_footage),
  }

  return NextResponse.json({
    success: true,
    quote,
    tierPrices,
    tiers: QUOTE_TIERS,
    addons: QUOTE_ADDONS,
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
  const { selected_tier, selected_addons, customer_name, customer_email, membership_plan } = body

  // Validate tier
  const validTiers = ["good", "better", "best"] as const
  if (!selected_tier || !validTiers.includes(selected_tier)) {
    return NextResponse.json(
      { error: `selected_tier must be one of: ${validTiers.join(", ")}` },
      { status: 400 }
    )
  }

  if (selected_addons && !Array.isArray(selected_addons)) {
    return NextResponse.json({ error: "selected_addons must be an array" }, { status: 400 })
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
    // Mark as expired atomically
    await supabase
      .from("quotes")
      .update({ status: "expired" })
      .eq("id", quote.id)
      .eq("status", "pending")

    return NextResponse.json({ error: "Quote has expired" }, { status: 410 })
  }

  // Compute price from tier
  const tierResult = computeTierPrice(
    selected_tier as "good" | "better" | "best",
    quote.square_footage
  )
  let subtotal = tierResult.price

  // Add addon prices
  const addons: string[] = selected_addons || []
  for (const addonKey of addons) {
    const addon = QUOTE_ADDONS.find((a) => a.key === addonKey)
    if (addon && addon.price > 0) {
      subtotal += addon.price
    }
  }

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

  const total = subtotal - (Number(quote.discount) || 0) - membershipDiscount

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    status: "approved",
    selected_tier,
    selected_addons: addons,
    subtotal,
    total: Math.max(total, 0),
    approved_at: new Date().toISOString(),
  }

  if (plan) {
    updatePayload.membership_plan = plan.slug
    updatePayload.membership_discount = membershipDiscount
  }

  // Optionally update customer info if provided
  if (customer_name) updatePayload.customer_name = customer_name
  if (customer_email) updatePayload.customer_email = customer_email

  const { data: updated, error: updateError } = await supabase
    .from("quotes")
    .update(updatePayload)
    .eq("id", quote.id)
    .eq("status", "pending") // Atomic: only approve if still pending
    .select()
    .single()

  if (updateError || !updated) {
    return NextResponse.json(
      { error: "Failed to approve quote — it may have already been updated" },
      { status: 409 }
    )
  }

  // Create membership record if plan was selected
  if (plan && quote.customer_id) {
    try {
      const nextVisit = new Date()
      nextVisit.setMonth(nextVisit.getMonth() + plan.interval_months)

      await supabase.from("customer_memberships").insert({
        tenant_id: quote.tenant_id,
        customer_id: quote.customer_id,
        plan_id: plan.id,
        status: "active",
        started_at: new Date().toISOString(),
        next_visit_at: nextVisit.toISOString(),
        visits_completed: 0,
        credits: 0,
      })
    } catch (err) {
      console.error("[quote/approve] Membership creation error:", err)
    }
  }

  // Auto-create a job from the approved quote
  try {
    const jobInsert: Record<string, unknown> = {
      tenant_id: quote.tenant_id,
      customer_id: quote.customer_id || null,
      phone_number: quote.customer_phone || null,
      address: quote.customer_address || null,
      service_type: selected_tier === "best" ? "Full Detail" : selected_tier === "better" ? "Complete Clean" : "Exterior Clean",
      price: Math.max(total, 0),
      status: "pending",
      booked: false,
      paid: false,
      payment_status: "pending",
      notes: `Quote #${token.slice(0, 8).toUpperCase()} approved — ${
        selected_tier === "best" ? "Full Detail" : selected_tier === "better" ? "Complete Clean" : "Exterior Clean"
      } package`,
      quote_id: quote.id,
    }

    const { error: jobError } = await supabase
      .from("jobs")
      .insert(jobInsert)

    if (jobError) {
      console.error("[quote/approve] Failed to create job:", jobError.message)
    }
  } catch (err) {
    console.error("[quote/approve] Job creation error:", err)
  }

  return NextResponse.json({ success: true, quote: updated })
}
