import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"

/**
 * GET — List quotes for the tenant
 * POST — Create a new quote
 * PATCH — Edit an existing quote
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
    selected_tier,
    membership_plan,
    send_sms,
    // Pre-confirm cleaner fields
    cleaner_ids,
    cleaner_pay,
    description,
    // Line items (service-based quoting)
    line_items,
  } = body

  if (!customer_name) {
    return NextResponse.json({ error: "customer_name is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Resolve customer: verify existing or auto-create from phone
  let resolvedCustomerId = customer_id ? Number(customer_id) : null
  if (resolvedCustomerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, tenant_id")
      .eq("id", resolvedCustomerId)
      .single()

    if (!customer || customer.tenant_id !== tenant.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 })
    }
  } else if (customer_phone) {
    // Auto-create or find customer by phone (same pattern as jobs API)
    const phone = String(customer_phone).trim()
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("phone_number", phone)
      .maybeSingle()

    if (existing?.id) {
      resolvedCustomerId = Number(existing.id)
    } else {
      const nameParts = String(customer_name || "").trim().split(" ")
      const { data: created, error: createErr } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenant.id,
          phone_number: phone,
          first_name: nameParts[0] || undefined,
          last_name: nameParts.slice(1).join(" ") || undefined,
          email: customer_email || undefined,
          address: customer_address || undefined,
        })
        .select("id")
        .single()

      if (!createErr && created) {
        resolvedCustomerId = Number(created.id)
      }
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

  // Validate line_items if provided. Round 2 task 6: optionality + is_upsell.
  type ParsedLineItem = {
    service_name: string
    description?: string
    price: number
    quantity: number
    optionality: 'required' | 'recommended' | 'optional'
    is_upsell: boolean
  }
  const parsedLineItems: ParsedLineItem[] = []
  if (Array.isArray(line_items) && line_items.length > 0) {
    for (const item of line_items) {
      if (!item || typeof item !== 'object') continue
      const sName = typeof item.service_name === 'string' ? item.service_name.trim() : ''
      const sPrice = Number(item.price)
      const sQty = item.quantity != null ? Number(item.quantity) : 1
      if (!sName || isNaN(sPrice) || sPrice < 0) continue
      const rawOpt = typeof item.optionality === 'string' ? item.optionality : 'required'
      const optionality: ParsedLineItem['optionality'] =
        rawOpt === 'recommended' || rawOpt === 'optional' ? rawOpt : 'required'
      parsedLineItems.push({
        service_name: sName,
        description: typeof item.description === 'string' ? item.description.trim() || undefined : undefined,
        price: sPrice,
        quantity: sQty,
        optionality,
        is_upsell: item.is_upsell === true,
      })
    }
  }

  // Round 2: original_price is the editable anchor used by the customer view
  // to show discount math. Falls back to line-item total if omitted.
  const parsedOriginalPrice = body.original_price != null ? Number(body.original_price) : null
  const originalPrice =
    parsedOriginalPrice != null && !Number.isNaN(parsedOriginalPrice) && parsedOriginalPrice >= 0
      ? parsedOriginalPrice
      : null

  // Compute total_price from line items if present, otherwise fall back to custom_base_price.
  // Round 2: only 'required' and 'recommended' (default-on) lines contribute to
  // the shown total; 'optional' lines are opt-in by the customer. Upsell lines
  // count toward total like any other line so the quote reflects what the customer
  // will see.
  const lineItemsTotal = parsedLineItems.length > 0
    ? parsedLineItems
        .filter(item => item.optionality !== 'optional')
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
    : null

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      tenant_id: tenant.id,
      customer_id: resolvedCustomerId || null,
      customer_name,
      customer_phone: customer_phone || null,
      customer_email: customer_email || null,
      customer_address: customer_address || null,
      square_footage: square_footage || null,
      bedrooms: bedrooms || null,
      bathrooms: bathrooms || null,
      property_type: property_type || null,
      service_category: category,
      selected_tier: selected_tier || null,
      membership_plan: membership_plan && typeof membership_plan === 'string' ? membership_plan : null,
      notes: notes || null,
      custom_base_price: parsedCustomPrice,
      ...(lineItemsTotal != null ? { total_price: lineItemsTotal } : {}),
      ...(originalPrice != null ? { original_price: originalPrice } : {}),
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

  // Insert line items into quote_line_items table
  if (parsedLineItems.length > 0 && quote) {
    const lineItemRows = parsedLineItems.map((item, index) => ({
      quote_id: quote.id,
      tenant_id: tenant.id,
      service_name: item.service_name,
      description: item.description || null,
      price: item.price,
      quantity: item.quantity,
      optionality: item.optionality,
      is_upsell: item.is_upsell,
      sort_order: index,
    }))

    const { error: lineItemError } = await supabase
      .from("quote_line_items")
      .insert(lineItemRows)

    if (lineItemError) {
      console.error("[quotes/POST] Failed to insert line items:", lineItemError)
    }
  }

  // Tag customer for quoted_not_booked retargeting (only if no existing override)
  if (resolvedCustomerId) {
    await supabase
      .from('customers')
      .update({ lifecycle_stage_override: 'quoted_not_booked' })
      .eq('id', resolvedCustomerId)
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
        // Always use Osiris app domain for quote links — website_url may be a marketing site
        const domain = process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live'
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

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { id } = body
  if (!id) {
    return NextResponse.json({ error: "Quote id is required" }, { status: 400 })
  }

  const supabase = getSupabaseServiceClient()

  // Verify quote belongs to tenant
  const { data: existing } = await supabase
    .from("quotes")
    .select("id, tenant_id, status")
    .eq("id", Number(id))
    .eq("tenant_id", tenant.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 })
  }

  // Build update object from allowed fields
  const ALLOWED_FIELDS = [
    "customer_name", "customer_phone", "customer_email", "customer_address",
    "square_footage", "bedrooms", "bathrooms", "property_type",
    "service_category", "selected_tier", "selected_addons",
    "subtotal", "discount", "total", "deposit_amount",
    "membership_plan", "notes", "custom_base_price", "cleaner_pay",
    "description", "status", "service_date", "service_time",
  ] as const

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      updates[field] = body[field] ?? null
    }
  }

  // Validate numeric fields
  for (const numField of ["square_footage", "bedrooms", "bathrooms", "subtotal", "discount", "total", "deposit_amount", "custom_base_price", "cleaner_pay"]) {
    if (numField in updates && updates[numField] != null) {
      const val = Number(updates[numField])
      if (isNaN(val)) {
        return NextResponse.json({ error: `${numField} must be a number` }, { status: 400 })
      }
      updates[numField] = val
    }
  }

  // Validate status if changing
  if ("status" in updates && updates.status != null) {
    const validStatuses = ["pending", "approved", "expired", "cancelled"]
    if (!validStatuses.includes(updates.status as string)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
  }

  const { data: updated, error } = await supabase
    .from("quotes")
    .update(updates)
    .eq("id", Number(id))
    .eq("tenant_id", tenant.id)
    .select()
    .single()

  if (error) {
    console.error("[quotes/PATCH] Update failed:", error)
    return NextResponse.json({ error: "Failed to update quote" }, { status: 500 })
  }

  return NextResponse.json({ success: true, quote: updated })
}
