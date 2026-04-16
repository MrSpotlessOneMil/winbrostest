import { NextRequest, NextResponse } from "next/server"
import { requireAuthWithTenant } from "@/lib/auth"
import { getSupabaseServiceClient } from "@/lib/supabase"
import { normalizeAddons, type AddonInput } from "@/lib/service-scope"

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
    selected_addons,
    membership_plan,
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

  // Normalize add-ons with the correct included-flag defaults at write time so
  // downstream reads (customer page, create-job, invoice) don't re-derive.
  const hasCustomPriceForNorm = parsedCustomPrice != null
  const tierForNorm = hasCustomPriceForNorm ? 'custom' : ((selected_tier as string | undefined) || 'standard')
  const rawAddonsIn = Array.isArray(selected_addons) ? (selected_addons as unknown[]) : []
  const filteredAddonsIn: AddonInput[] = rawAddonsIn.filter(
    (a): a is AddonInput =>
      typeof a === 'string' || (typeof a === 'object' && a !== null && 'key' in a)
  )
  const normalizedAddonsIn = normalizeAddons(filteredAddonsIn, tierForNorm, hasCustomPriceForNorm)

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
      selected_addons: normalizedAddonsIn.length > 0 ? normalizedAddonsIn : null,
      membership_plan: membership_plan && typeof membership_plan === 'string' ? membership_plan : null,
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
    .select("id, tenant_id, status, selected_tier, custom_base_price")
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

  // Normalize selected_addons with the correct included-flag defaults.
  // Use the pending update values when present, fall back to stored row.
  if ('selected_addons' in updates && Array.isArray(updates.selected_addons)) {
    const nextCustomBase =
      'custom_base_price' in updates && updates.custom_base_price != null
        ? Number(updates.custom_base_price)
        : existing.custom_base_price != null
          ? Number(existing.custom_base_price)
          : null
    const hasCustomPriceUpd = nextCustomBase != null
    const nextTier =
      'selected_tier' in updates && updates.selected_tier
        ? (updates.selected_tier as string)
        : (existing.selected_tier as string | null) || 'standard'
    const tierForUpd = hasCustomPriceUpd ? 'custom' : nextTier
    const rawAddonsUpd = updates.selected_addons as unknown[]
    const filteredAddonsUpd: AddonInput[] = rawAddonsUpd.filter(
      (a): a is AddonInput =>
        typeof a === 'string' || (typeof a === 'object' && a !== null && 'key' in a)
    )
    const normalizedUpd = normalizeAddons(filteredAddonsUpd, tierForUpd, hasCustomPriceUpd)
    updates.selected_addons = normalizedUpd.length > 0 ? normalizedUpd : null
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
