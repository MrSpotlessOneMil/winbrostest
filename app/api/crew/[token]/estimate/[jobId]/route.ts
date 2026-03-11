/**
 * Salesman Estimate Completion API
 *
 * GET  /api/crew/[token]/estimate/[jobId] — Estimate details + pricebook tiers/addons
 * POST /api/crew/[token]/estimate/[jobId] — Complete estimate (create quote, optionally create job)
 *
 * Public (no auth — token = access).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { getTenantById, tenantUsesFeature } from '@/lib/tenant'
import { getQuotePricing } from '@/lib/quote-pricing'
import { sendSMS } from '@/lib/openphone'
import { scheduleRetargetingSequence } from '@/lib/scheduler'
import { cancelPendingTasks } from '@/lib/lifecycle-engine'

type RouteParams = { params: Promise<{ token: string; jobId: string }> }

/** Resolve salesman + verify they're assigned to this estimate job */
async function resolveEstimateContext(token: string, jobId: string) {
  const client = getSupabaseServiceClient()

  const { data: cleaner } = await client
    .from('cleaners')
    .select('id, name, phone, portal_token, tenant_id')
    .eq('portal_token', token)
    .is('deleted_at', null)
    .maybeSingle()

  if (!cleaner) return null

  // Verify assignment exists for this job
  const { data: assignment } = await client
    .from('cleaner_assignments')
    .select('id, status, tenant_id')
    .eq('cleaner_id', cleaner.id)
    .eq('job_id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .in('status', ['pending', 'accepted', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!assignment) return null

  const { data: job } = await client
    .from('jobs')
    .select(`
      id, date, scheduled_at, address, service_type, status, notes, job_type,
      bedrooms, bathrooms, sqft, hours, price,
      customer_id, phone_number,
      customers(id, first_name, last_name, phone_number, email, address)
    `)
    .eq('id', parseInt(jobId))
    .eq('tenant_id', cleaner.tenant_id)
    .maybeSingle()

  if (!job) return null

  const tenant = await getTenantById(cleaner.tenant_id)
  if (!tenant) return null

  return { cleaner, assignment, job, tenant, client }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveEstimateContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { job, tenant, client } = ctx
  const customer = (job as any).customers

  // Get pricing tiers/addons for this tenant
  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: job.sqft,
    bedrooms: job.bedrooms,
    bathrooms: job.bathrooms,
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
    job: {
      id: job.id,
      date: job.date,
      scheduled_at: job.scheduled_at,
      address: job.address,
      service_type: job.service_type,
      job_type: (job as any).job_type,
      sqft: job.sqft,
      notes: job.notes,
    },
    customer: {
      id: customer?.id || null,
      first_name: customer?.first_name || null,
      last_name: customer?.last_name || null,
      phone: customer?.phone_number || job.phone_number || null,
      email: customer?.email || null,
      address: customer?.address || job.address || null,
    },
    pricing: {
      tiers: pricing.tiers,
      tierPrices: pricing.tierPrices,
      addons: pricing.addons,
      serviceType: pricing.serviceType,
    },
    tenant: {
      name: tenant.business_name_short || tenant.name,
      slug: tenant.slug,
    },
    availability,
  })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token, jobId } = await params
  const ctx = await resolveEstimateContext(token, jobId)
  if (!ctx) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { cleaner, assignment, job, tenant, client } = ctx
  const customer = (job as any).customers

  const action = body.action as 'accepted' | 'send_quote'
  if (!action || !['accepted', 'send_quote'].includes(action)) {
    return NextResponse.json({ error: 'action must be "accepted" or "send_quote"' }, { status: 400 })
  }

  const selectedTier = body.selected_tier as string | null
  const selectedAddons = (body.selected_addons || []) as string[]
  const addonQuantities = (body.addon_quantities || {}) as Record<string, number>
  const customPrice = body.custom_price != null ? Number(body.custom_price) : null
  const notes = body.notes as string | null
  const serviceDate = body.service_date as string | null
  const serviceTime = body.service_time as string | null

  // Service date required for accepted jobs
  if (action === 'accepted' && !serviceDate) {
    return NextResponse.json({ error: 'service_date is required when customer accepts' }, { status: 400 })
  }

  // Compute price server-side
  const pricing = await getQuotePricing(tenant.id, tenant.slug, {
    squareFootage: job.sqft,
    bedrooms: job.bedrooms,
    bathrooms: job.bathrooms,
  }, 'standard')

  let total: number
  if (customPrice != null && customPrice > 0) {
    // Salesman override price + addons
    let addonTotal = 0
    for (const key of selectedAddons) {
      const addon = pricing.addons.find(a => a.key === key)
      if (!addon) continue
      if (selectedTier) {
        const tierDef = pricing.tiers.find(t => t.key === selectedTier)
        if (tierDef && tierDef.included.includes(key)) continue // included in tier
      }
      if (addon.priceType === 'per_unit') {
        addonTotal += addon.price * (addonQuantities[key] || 1)
      } else {
        addonTotal += addon.price
      }
    }
    total = customPrice + addonTotal
  } else if (selectedTier && pricing.tierPrices[selectedTier]) {
    // Standard tier pricing
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

  const customerPhone = customer?.phone_number || job.phone_number
  const customerName = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || 'Customer'
  const customerEmail = customer?.email || null
  const customerAddress = customer?.address || job.address || null

  // Normalize addons with quantities for storage
  const normalizedAddons = selectedAddons.map(key => ({
    key,
    quantity: addonQuantities[key] || 1,
  }))

  // Create quote record
  const quoteInsert: Record<string, unknown> = {
    tenant_id: tenant.id,
    customer_id: customer?.id || null,
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_email: customerEmail,
    customer_address: customerAddress,
    square_footage: job.sqft || null,
    service_category: 'standard',
    notes: notes || job.notes || null,
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
    console.error('[estimate/complete] Quote insert failed:', quoteError)
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 })
  }

  // Mark estimate job as completed
  await client
    .from('jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      price: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parseInt(jobId))

  if (action === 'accepted') {
    // Customer accepted on the spot → create cleaning job with scheduled date
    const { data: cleaningJob, error: jobError } = await client
      .from('jobs')
      .insert({
        tenant_id: tenant.id,
        customer_id: customer?.id || null,
        phone_number: customerPhone,
        address: customerAddress,
        service_type: job.service_type || 'window_cleaning',
        job_type: 'cleaning',
        status: 'scheduled',
        booked: true,
        date: serviceDate,
        scheduled_at: serviceTime || null,
        sqft: job.sqft,
        price: total,
        notes: notes || job.notes || null,
        source: 'estimate_conversion',
      })
      .select('id')
      .single()

    if (jobError) {
      console.error('[estimate/complete] Job creation failed:', jobError)
    }

    // Send confirmation SMS with date + payment link
    if (customerPhone) {
      const businessName = tenant.business_name_short || tenant.name
      const domain = (tenant as any).website_url?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_SITE_URL || 'https://spotless-scrubbers-api.vercel.app'
      const quoteLink = `${domain}/quote/${quote.token}`
      const dateStr = new Date(serviceDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const timeStr = serviceTime ? ` at ${serviceTime}` : ''
      const message = `Great news, ${customer?.first_name || 'there'}! Your ${job.service_type || 'service'} with ${businessName} is booked for ${dateStr}${timeStr} — $${total.toFixed(0)}. Save your card to lock in your spot: ${quoteLink}`
      await sendSMS(tenant, customerPhone, message)
    }

    return NextResponse.json({
      success: true,
      action: 'accepted',
      quote_id: quote.id,
      job_id: cleaningJob?.id || null,
      total,
    })
  } else {
    // Send quote → customer gets link to review/approve later
    if (customerPhone) {
      const businessName = tenant.business_name_short || tenant.name
      const domain = (tenant as any).website_url?.replace(/\/+$/, '') || process.env.NEXT_PUBLIC_SITE_URL || 'https://spotless-scrubbers-api.vercel.app'
      const quoteLink = `${domain}/quote/${quote.token}`
      const message = `Hey ${customer?.first_name || 'there'}! Here's your custom quote from ${businessName}. Review and book when you're ready: ${quoteLink}`
      await sendSMS(tenant, customerPhone, message)
    }

    // Tag customer for quoted_not_booked retargeting
    if (customer?.id) {
      await client
        .from('customers')
        .update({ lifecycle_stage_override: 'quoted_not_booked' })
        .eq('id', customer.id)
        .eq('tenant_id', tenant.id)
        .is('lifecycle_stage_override', null)

      // Schedule retargeting sequence (cancel any active sequence first)
      if (tenantUsesFeature(tenant, 'monthly_followup_enabled')) {
        try {
          await cancelPendingTasks(tenant.id, `retarget-${customer.id}-`)
          await scheduleRetargetingSequence(
            tenant.id,
            customer.id,
            customerPhone,
            customerName,
            'quoted_not_booked',
          )
          console.log(`[estimate/complete] Enrolled customer ${customer.id} in quoted_not_booked retargeting`)
        } catch (err) {
          console.error(`[estimate/complete] Failed to enroll retargeting:`, err)
        }
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
