import { NextRequest, NextResponse } from "next/server"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * Cleaner Pre-Confirm Portal API
 *
 * GET  — Returns pre-confirm details (service, pay, quote info)
 * POST — Cleaner confirms or declines { action: "confirm" | "decline" }
 *
 * Auth: portal_token in URL (same pattern as /api/crew/[token]/job/[jobId])
 */

interface RouteParams {
  params: Promise<{ token: string; preconfirmId: string }>
}

async function resolveCleaner(token: string) {
  const supabase = getSupabaseServiceClient()
  const { data } = await supabase
    .from("cleaners")
    .select("id, name, phone, portal_token, tenant_id")
    .eq("portal_token", token)
    .eq("active", true)
    .single()
  return data
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token, preconfirmId } = await params

  const cleaner = await resolveCleaner(token)
  if (!cleaner) {
    return NextResponse.json({ error: "Invalid portal token" }, { status: 404 })
  }

  const supabase = getSupabaseServiceClient()

  const { data: pc } = await supabase
    .from("quote_cleaner_preconfirms")
    .select("id, quote_id, cleaner_id, cleaner_pay, status, notified_at, responded_at")
    .eq("id", preconfirmId)
    .eq("cleaner_id", cleaner.id)
    .eq("tenant_id", cleaner.tenant_id)
    .single()

  if (!pc) {
    return NextResponse.json({ error: "Pre-confirm not found" }, { status: 404 })
  }

  // Get quote details (don't expose client price — only show service info)
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, description, customer_name, customer_address, service_category, square_footage, bedrooms, bathrooms, notes")
    .eq("id", pc.quote_id)
    .eq("tenant_id", cleaner.tenant_id)
    .single()

  // Get tenant name for branding
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, business_name, brand_color, currency")
    .eq("id", cleaner.tenant_id)
    .single()

  return NextResponse.json({
    success: true,
    preconfirm: {
      id: pc.id,
      status: pc.status,
      cleaner_pay: pc.cleaner_pay,
      currency: tenant?.currency || 'usd',
      responded_at: pc.responded_at,
    },
    quote: quote ? {
      description: quote.description,
      customer_first_name: quote.customer_name?.split(' ')[0] || null,
      customer_address: quote.customer_address,
      service_category: quote.service_category,
      square_footage: quote.square_footage,
      bedrooms: quote.bedrooms,
      bathrooms: quote.bathrooms,
      notes: quote.notes,
    } : null,
    cleaner_name: cleaner.name,
    business_name: tenant?.business_name || tenant?.name || 'Your Company',
    brand_color: tenant?.brand_color || null,
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, preconfirmId } = await params

  const cleaner = await resolveCleaner(token)
  if (!cleaner) {
    return NextResponse.json({ error: "Invalid portal token" }, { status: 404 })
  }

  let body: { action: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { action } = body
  if (!['confirm', 'decline'].includes(action)) {
    return NextResponse.json({ error: "action must be 'confirm' or 'decline'" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Fetch the preconfirm row — must be pending and belong to this cleaner
  const { data: pc } = await supabase
    .from("quote_cleaner_preconfirms")
    .select("id, quote_id, status, tenant_id")
    .eq("id", preconfirmId)
    .eq("cleaner_id", cleaner.id)
    .eq("tenant_id", cleaner.tenant_id)
    .single()

  if (!pc) {
    return NextResponse.json({ error: "Pre-confirm not found" }, { status: 404 })
  }

  if (pc.status !== 'pending') {
    return NextResponse.json({ error: `Already responded (${pc.status})` }, { status: 400 })
  }

  const newStatus = action === 'confirm' ? 'confirmed' : 'declined'

  // Update preconfirm status
  await supabase
    .from("quote_cleaner_preconfirms")
    .update({
      status: newStatus,
      responded_at: new Date().toISOString(),
    })
    .eq("id", preconfirmId)

  // Check if at least one cleaner confirmed → update quote preconfirm_status
  if (action === 'confirm') {
    await supabase
      .from("quotes")
      .update({ preconfirm_status: 'cleaners_confirmed' })
      .eq("id", pc.quote_id)
      .eq("tenant_id", pc.tenant_id)
  } else {
    // Check if ALL cleaners declined → notify owner
    const { data: remaining } = await supabase
      .from("quote_cleaner_preconfirms")
      .select("id")
      .eq("quote_id", pc.quote_id)
      .eq("tenant_id", pc.tenant_id)
      .eq("status", "pending")

    if (!remaining?.length) {
      // Check if anyone confirmed
      const { data: confirmed } = await supabase
        .from("quote_cleaner_preconfirms")
        .select("id")
        .eq("quote_id", pc.quote_id)
        .eq("tenant_id", pc.tenant_id)
        .eq("status", "confirmed")
        .limit(1)

      if (!confirmed?.length) {
        // All declined, nobody confirmed — alert owner
        await supabase
          .from("quotes")
          .update({ preconfirm_status: 'awaiting_cleaners' })
          .eq("id", pc.quote_id)
      }
    }
  }

  // Notify owner (Dominic) via SMS
  try {
    const { data: quote } = await supabase
      .from("quotes")
      .select("customer_name, tenant_id")
      .eq("id", pc.quote_id)
      .single()

    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, name, owner_phone")
      .eq("id", pc.tenant_id)
      .single()

    if (tenant?.owner_phone && quote) {
      const { sendSMS } = await import("@/lib/openphone")
      const { getTenantById } = await import("@/lib/tenant")
      const fullTenant = await getTenantById(tenant.id)
      if (fullTenant) {
        const custFirst = quote.customer_name?.split(' ')[0] || 'client'
        const cleanerFirst = cleaner.name.split(' ')[0]
        const msg = action === 'confirm'
          ? `${cleanerFirst} confirmed for ${custFirst}'s quote! You can now send the quote to the client.`
          : `${cleanerFirst} declined ${custFirst}'s quote. ${(await supabase.from("quote_cleaner_preconfirms").select("id").eq("quote_id", pc.quote_id).eq("status", "pending")).data?.length ? 'Other cleaners are still pending.' : 'No more cleaners pending — you may want to add more.'}`
        await sendSMS(fullTenant, tenant.owner_phone, msg)
      }
    }
  } catch (err) {
    console.error('[preconfirm] Failed to notify owner:', err)
  }

  return NextResponse.json({
    success: true,
    status: newStatus,
  })
}
