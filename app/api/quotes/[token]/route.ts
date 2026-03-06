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
  const { selected_tier, selected_addons, customer_name, customer_email } = body

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

  const total = subtotal - (Number(quote.discount) || 0) - (Number(quote.membership_discount) || 0)

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    status: "approved",
    selected_tier,
    selected_addons: addons,
    subtotal,
    total: Math.max(total, 0),
    approved_at: new Date().toISOString(),
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

  return NextResponse.json({ success: true, quote: updated })
}
