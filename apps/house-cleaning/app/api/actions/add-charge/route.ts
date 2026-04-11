/**
 * Add Charge Action Endpoint
 *
 * POST /api/actions/add-charge
 * Body: { job_id: string, addon_type: string, amount?: number, description?: string }
 *
 * Adds an on-site charge (pet fee, fridge, oven, etc.) to a job.
 * Updates the job price and notifies the customer via SMS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { logSystemEvent } from '@/lib/system-events'
import { getTenantById, getTenantBusinessName } from '@/lib/tenant'
import { getPricingAddons } from '@/lib/pricing-db'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  try {
    const body = await request.json()
    const { job_id, addon_type, amount, description } = body as {
      job_id: string
      addon_type: string
      amount?: number
      description?: string
    }

    if (!job_id) {
      return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
    }
    if (!addon_type) {
      return NextResponse.json({ error: 'addon_type is required' }, { status: 400 })
    }

    const serviceClient = getSupabaseServiceClient()

    // Fetch job + cross-tenant validation
    const { data: job, error: jobErr } = await serviceClient
      .from('jobs')
      .select('id, tenant_id, phone_number, customer_id, price, notes, service_type, status')
      .eq('id', job_id)
      .maybeSingle()

    if (jobErr || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.tenant_id !== authTenant.id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Resolve add-on price: check tenant's pricing_addons table first, then use provided amount
    const addons = await getPricingAddons(authTenant.id)
    const matchedAddon = addons.find(a => a.addon_key === addon_type)

    let chargeAmount: number
    let chargeLabel: string

    if (matchedAddon && matchedAddon.flat_price) {
      chargeAmount = matchedAddon.flat_price
      chargeLabel = matchedAddon.label
    } else if (amount && amount > 0) {
      chargeAmount = amount
      chargeLabel = description || addon_type.replace(/_/g, ' ')
    } else {
      return NextResponse.json(
        { error: 'Unknown add-on type and no amount provided' },
        { status: 400 }
      )
    }

    // Append add-on to job notes as structured marker
    const existingNotes = job.notes || ''
    const addonNote = `ADDON:${addon_type}:${chargeAmount}`
    const updatedNotes = existingNotes ? `${existingNotes}\n${addonNote}` : addonNote

    // Update job price to include add-on
    const currentPrice = job.price ? parseFloat(String(job.price)) : 0
    const newPrice = Math.round((currentPrice + chargeAmount) * 100) / 100

    const { error: updateErr } = await serviceClient
      .from('jobs')
      .update({ price: newPrice, notes: updatedNotes })
      .eq('id', job_id)
      .eq('tenant_id', authTenant.id)

    if (updateErr) {
      console.error('[add-charge] Failed to update job:', updateErr)
      return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
    }

    // Send SMS notification to customer
    const tenant = await getTenantById(authTenant.id)
    if (tenant && job.phone_number) {
      const businessName = getTenantBusinessName(tenant)
      const smsMsg = `A $${chargeAmount.toFixed(2)} ${chargeLabel} add-on has been added to your ${job.service_type || 'cleaning'} service. This will be included in your final charge. - ${businessName}`
      await sendSMS(tenant, job.phone_number, smsMsg)
    }

    await logSystemEvent({
      source: 'actions',
      event_type: 'ADDON_CHARGE_ADDED',
      message: `Add-on charge $${chargeAmount.toFixed(2)} (${chargeLabel}) added to job ${job_id}.`,
      job_id: job_id,
      customer_id: job.customer_id,
      phone_number: job.phone_number,
      metadata: {
        addon_type,
        charge_amount: chargeAmount,
        charge_label: chargeLabel,
        previous_price: currentPrice,
        new_price: newPrice,
      },
    })

    return NextResponse.json({
      success: true,
      addon_type,
      charge_amount: chargeAmount,
      charge_label: chargeLabel,
      new_total: newPrice,
    })
  } catch (error) {
    console.error('Add charge error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
