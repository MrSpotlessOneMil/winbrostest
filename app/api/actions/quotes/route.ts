import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — List quotes for the tenant
 * POST — Create a new quote
 */

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const supabase = getSupabaseServiceClient()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const customerId = searchParams.get("customer_id")
  const customerPhone = searchParams.get("customer_phone")
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10) || 50, 200)

  let query = supabase
    .from("quotes")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (status) {
    query = query.eq("status", status)
  }
  if (customerId) {
    query = query.eq("customer_id", Number(customerId))
  }
  if (customerPhone) {
    query = query.eq("customer_phone", customerPhone)
  }

  const { data: quotes, error } = await query

  if (error) {
    return NextResponse.json({ error: "Failed to load quotes" }, { status: 500 })
  }

  return NextResponse.json({ success: true, quotes })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const {
    customer_id,
    customer_name,
    customer_phone,
    customer_email,
    customer_address,
    square_footage,
    bedrooms,
    bathrooms,
    property_type,
    service_category,
    notes,
    custom_base_price,
    send_sms,
    // Pre-confirm cleaner fields
    cleaner_ids,
    cleaner_pay,
    description,
  } = body

  if (!customer_name) {
    return NextResponse.json({ error: "customer_name is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Cross-tenant check: verify customer belongs to tenant if customer_id provided
  if (customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("id", customer_id)
      .single()

    if (!customer || customer.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
  }

  // Validate service_category if provided
  const validCategories = ['standard', 'move_in_out']
  const category = service_category && validCategories.includes(service_category as string) ? service_category as string : 'standard'

  // Validate custom_base_price if provided
  const parsedCustomPrice = custom_base_price != null ? Number(custom_base_price) : null
  if (parsedCustomPrice != null && (isNaN(parsedCustomPrice) || parsedCustomPrice <= 0)) {
    return NextResponse.json({ error: "custom_base_price must be a positive number" }, { status: 400 })
  }

  // Validate cleaner_pay if provided
  const parsedCleanerPay = cleaner_pay != null ? Number(cleaner_pay) : null
  if (parsedCleanerPay != null && (isNaN(parsedCleanerPay) || parsedCleanerPay <= 0)) {
    return NextResponse.json({ error: "cleaner_pay must be a positive number" }, { status: 400 })
  }

  const hasPreconfirm = Array.isArray(cleaner_ids) && cleaner_ids.length > 0

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenant.id,
      customer_id: customer_id || null,
      customer_name,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      square_footage: square_footage || null,
      bedrooms: bedrooms || null,
      bathrooms: bathrooms || null,
      property_type: property_type || null,
      service_category: category,
      notes: notes || null,
      custom_base_price: parsedCustomPrice,
      ...(parsedCleanerPay != null ? { cleaner_pay: parsedCleanerPay } : {}),
      ...(description ? { description: description as string } : {}),
      ...(hasPreconfirm ? { preconfirm_status: 'awaiting_cleaners' } : {}),
    })
    .select()
    .single()

  if (error || !quote) {
    console.error("[quotes/POST] Insert failed:", error)
    return NextResponse.json({ error: "Failed to create quote" }, { status: 500 })
  }

  // Create pre-confirm rows for selected cleaners
  let preconfirms: any[] = []
  if (hasPreconfirm && quote) {
    const preconfirmRows = (cleaner_ids as number[]).map((cleanerId: number) => ({
      tenant_id: tenant.id,
      quote_id: quote.id,
      cleaner_id: cleanerId,
      cleaner_pay: parsedCleanerPay,
      status: 'pending',
    }))

    const { data: inserted } = await supabase
      .from("quote_cleaner_preconfirms")
      .insert(preconfirmRows)
      .select("id, cleaner_id, status")

    preconfirms = inserted || []
  }

  // Tag customer for quoted_not_booked retargeting (only if no existing override)
  if (customer_id) {
    await supabase
      .from('customers')
      .update({ lifecycle_stage_override: 'quoted_not_booked' })
      .eq('id', customer_id as number)
      .eq('tenant_id', tenant.id)
      .is('lifecycle_stage_override', null)
  }

  // Send SMS with quote link if requested and phone number available
  // Skip if pre-confirm is active — client gets the quote AFTER cleaners confirm
  if (send_sms && quote.customer_phone && !hasPreconfirm) {
    try {
      const { getTenantById } = await import("@/lib/tenant")
      const { sendSMS } = await import("@/lib/openphone")
      const fullTenant = await getTenantById(tenant.id)
      if (fullTenant) {
        const customerFirst = (customer_name as string)?.split(' ')[0] || 'there'
        const businessName = fullTenant.business_name || fullTenant.name
        const domain = fullTenant.website_url?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live'
        const quoteLink = `${domain}/quote/${quote.token}`
        const message = `Hey ${customerFirst}! Here's your custom quote from ${businessName}. You can review the details, add extras, and confirm right here: ${quoteLink}`
        await sendSMS(fullTenant, quote.customer_phone, message)
      }
    } catch (err) {
      console.error("[quotes/POST] Failed to send quote SMS:", err)
    }
  }

  return NextResponse.json({
    success: true,
    quote,
    quote_url: `/quote/${quote.token}`,
    ...(preconfirms.length > 0 ? { preconfirms } : {}),
  })
}
