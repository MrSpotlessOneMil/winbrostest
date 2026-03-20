/**
 * Salesman New Quote API
 *
 * GET  /api/crew/[token]/new-quote — Pricing tiers/addons + availability for next 14 days
 * POST /api/crew/[token]/new-quote — Create quote from scratch (find/create customer, create quote, optionally book job)
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById, tenantUsesFeature } from '@/lib/tenant'
import { getQuotePricing, isWindowCleaningTenant } from '@/lib/quote-pricing'
import { sendSMS } from '@/lib/openphone'
import { scheduleRetargetingSequence } from '@/lib/scheduler'
import { cancelPendingTasks } from '@/lib/lifecycle-engine'
import { toE164 } from '@/lib/phone-utils'

type RouteParams = { params: Promise<{ token: string }> }

/** Resolve salesman cleaner by portal token */
async function resolveCleanerByToken(token: string) {
  const client = getSupabaseServiceClient()
  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id, employee_type')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  return cleaner
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { token } = await params
  const cleaner = await resolveCleanerByToken(token)
  if (!cleaner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const client = getSupabaseServiceClient()

  // Determine service category based on tenant type
  const serviceType = isWindowCleaningTenant(tenant.slug) ? 'window_cleaning' : 'house_cleaning'

  // Read optional sqft from query params (for live price recalculation)
  const url = new URL(request.url)
  const sqftParam = url.searchParams.get('sqft')
  const sqft = sqftParam ? parseInt(sqftParam) || null : null

  // Get pricing tiers/addons
  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: sqft,
    bedrooms: null,
    bathrooms: null,
  }, 'standard')

  // Get job counts per day for next 14 days (availability indicator)
  const today = new Date().toISOString().split('T')[0]
  const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: dayCounts } = await client
    .from('jobs')
    .select('date')
    .eq('tenant_id', tenant.id)
    .gte('date', today)
    .lte('date', twoWeeksOut)
    .in('status', ['scheduled', 'in_progress', 'pending'])
    .neq('job_type', 'estimate')

  const availability: Record<string, number> = {}
  for (const j of dayCounts || []) {
    if (j.date) {
      availability[j.date] = (availability[j.date] || 0) + 1
    }
  }

  return NextResponse.json({
    pricing: {
      tiers: pricing.tiers,
      tierPrices: pricing.tierPrices,
      addons: pricing.addons,
      serviceType: pricing.serviceType,
    },
    tenant: {
      name: tenant.business_name_short || tenant.name,
      slug: tenant.slug,
      serviceType,
    },
    cleaner: {
      id: cleaner.id,
      name: cleaner.name,
    },
    availability,
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params
  const cleaner = await resolveCleanerByToken(token)
  if (!cleaner) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // ── Extract & validate fields ──────────────────────────────────────

  const firstName = (body.first_name as string || '').trim()
  const lastName = (body.last_name as string || '').trim()
  const rawPhone = (body.phone as string || '').trim()
  const email = (body.email as string || '').trim() || null
  const address = (body.address as string || '').trim()
  const sqft = body.sqft != null ? Number(body.sqft) || null : null

  const action = body.action as 'accepted' | 'send_quote'
  if (!action || !['accepted', 'send_quote'].includes(action)) {
    return NextResponse.json({ error: 'action must be "accepted" or "send_quote"' }, { status: 400 })
  }

  if (!rawPhone) {
    return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
  }
  if (!address) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 })
  }

  // Normalize phone to E.164
  const phone = toE164(rawPhone)
  if (!phone) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const selectedTier = body.selected_tier as string | null
  const selectedAddons = (body.selected_addons || []) as string[]
  const addonQuantities = (body.addon_quantities || {}) as Record<string, number>
  const customPrice = body.custom_price != null ? Number(body.custom_price) : null
  const notes = (body.notes as string || '').trim() || null
  const serviceDate = body.service_date as string | null
  const serviceTime = body.service_time as string | null

  // Service date required for accepted jobs
  if (action === 'accepted' && !serviceDate) {
    return NextResponse.json({ error: 'service_date is required when customer accepts' }, { status: 400 })
  }

  // ── Compute price server-side ──────────────────────────────────────

  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: sqft,
    bedrooms: null,
    bathrooms: null,
  }, 'standard')

  let total: number
  if (customPrice != null && customPrice > 0) {
    let addonTotal = 0
    for (const key of selectedAddons) {
      const addon = pricing.addons.find(a => a.key === key)
      if (!addon) continue
      if (selectedTier) {
        const tierDef = pricing.tiers.find(t => t.key === selectedTier)
        if (tierDef && tierDef.included.includes(key)) continue
      }
      if (addon.priceType === 'per_unit') {
        addonTotal += addon.price * (addonQuantities[key] || 1)
      } else {
        addonTotal += addon.price
      }
    }
    total = customPrice + addonTotal
  } else if (selectedTier && pricing.tierPrices[selectedTier]) {
    let addonTotal = 0
    const tierDef = pricing.tiers.find(t => t.key === selectedTier)
    for (const key of selectedAddons) {
      if (tierDef && tierDef.included.includes(key)) continue
      const addon = pricing.addons.find(a => a.key === key)
      if (!addon) continue
      if (addon.priceType === 'per_unit') {
        addonTotal += addon.price * (addonQuantities[key] || 1)
      } else {
        addonTotal += addon.price
      }
    }
    total = pricing.tierPrices[selectedTier].price + addonTotal
  } else {
    return NextResponse.json({ error: 'Must provide selected_tier or custom_price' }, { status: 400 })
  }

  // ── Find or create customer ────────────────────────────────────────

  const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'Customer'

  // Look for existing customer by phone + tenant
  const { data: existingCustomer } = await client
    .from('customers')
    .select('id, first_name, last_name, phone_number, email, address')
    .eq('tenant_id', tenant.id)
    .eq('phone_number', phone)
    .maybeSingle()

  let customerId: number

  if (existingCustomer) {
    customerId = existingCustomer.id
    // Update customer info with latest data from salesman
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (firstName) updates.first_name = firstName
    if (lastName) updates.last_name = lastName
    if (email) updates.email = email
    if (address) updates.address = address
    if (sqft) updates.sqft = sqft

    await client
      .from('customers')
      .update(updates)
      .eq('id', customerId)
      .eq('tenant_id', tenant.id)
  } else {
    // Create new customer
    const { data: newCustomer, error: custError } = await client
      .from('customers')
      .insert({
        tenant_id: tenant.id,
        first_name: firstName || null,
        last_name: lastName || null,
        phone_number: phone,
        email: email,
        address: address,
        sqft: sqft,
      })
      .select('id')
      .single()

    if (custError || !newCustomer) {
      console.error('[new-quote] Customer creation failed:', custError)
      return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 })
    }
    customerId = newCustomer.id
  }

  // ── Normalize addons for storage ───────────────────────────────────

  const normalizedAddons = selectedAddons.map(key => ({
    key,
    quantity: addonQuantities[key] || 1,
  }))

  // ── Create quote record ────────────────────────────────────────────

  const quoteInsert: Record<string, unknown> = {
    tenant_id: tenant.id,
    customer_id: customerId,
    customer_name: customerName,
    customer_phone: phone,
    customer_email: email,
    customer_address: address,
    square_footage: sqft,
    service_category: 'standard',
    notes: notes,
    selected_tier: customPrice != null ? 'custom' : selectedTier,
    selected_addons: normalizedAddons,
    custom_base_price: customPrice != null ? customPrice : null,
    subtotal: total,
    total,
    status: action === 'accepted' ? 'approved' : 'pending',
    approved_at: action === 'accepted' ? new Date().toISOString() : null,
    valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }

  const { data: quote, error: quoteError } = await client
    .from('quotes')
    .insert(quoteInsert)
    .select('id, token')
    .single()

  if (quoteError || !quote) {
    console.error('[new-quote] Quote insert failed:', quoteError)
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 })
  }

  const businessName = tenant.business_name_short || tenant.name
  const domain = (tenant as any).website_url?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_SITE_URL || 'https://cleanmachine.live'
  const quoteLink = `${domain}/quote/${quote.token}`

  if (action === 'accepted') {
    // ── Customer accepted on the spot ──────────────────────────────

    const serviceType = isWindowCleaningTenant(tenant.slug) ? 'window_cleaning' : 'house_cleaning'

    const { data: cleaningJob, error: jobError } = await client
      .from('jobs')
      .insert({
        tenant_id: tenant.id,
        customer_id: customerId,
        phone_number: phone,
        address: address,
        service_type: serviceType,
        job_type: 'cleaning',
        status: 'scheduled',
        booked: true,
        date: serviceDate,
        scheduled_at: serviceTime || null,
        sqft: sqft,
        price: total,
        notes: notes,
      })
      .select('id')
      .single()

    if (jobError) {
      console.error('[new-quote] Job creation failed:', jobError)
    }

    // Send confirmation SMS with date + payment link
    const dateStr = new Date(serviceDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const timeStr = serviceTime ? ` at ${serviceTime}` : ''
    const displayServiceType = isWindowCleaningTenant(tenant.slug) ? 'window cleaning' : 'cleaning'
    const message = `Great news, ${firstName || 'there'}! Your ${displayServiceType} with ${businessName} is booked for ${dateStr}${timeStr} — $${total.toFixed(0)}. Save your card to lock in your spot: ${quoteLink}`
    await sendSMS(tenant, phone, message)

    return NextResponse.json({
      success: true,
      action: 'accepted',
      quote_id: quote.id,
      job_id: cleaningJob?.id || null,
      total,
    })
  } else {
    // ── Send quote — customer reviews/books later ──────────────────

    const message = `Hey ${firstName || 'there'}! Here's your custom quote from ${businessName}. Review and book when you're ready: ${quoteLink}`
    await sendSMS(tenant, phone, message)

    // Tag customer for quoted_not_booked retargeting
    await client
      .from('customers')
      .update({ lifecycle_stage_override: 'quoted_not_booked' })
      .eq('id', customerId)
      .eq('tenant_id', tenant.id)
      .is('lifecycle_stage_override', null)

    // Schedule retargeting sequence (cancel any active sequence first)
    if (tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
      try {
        await cancelPendingTasks(tenant.id, `retarget-${customerId}-`)
        await scheduleRetargetingSequence(
          tenant.id,
          customerId,
          phone,
          customerName,
          'quoted_not_booked',
        )
        console.log(`[new-quote] Enrolled customer ${customerId} in quoted_not_booked retargeting`)
      } catch (err) {
        console.error(`[new-quote] Failed to enroll retargeting:`, err)
      }
    }

    return NextResponse.json({
      success: true,
      action: 'send_quote',
      quote_id: quote.id,
      quote_token: quote.token,
      total,
    })
  }
}
