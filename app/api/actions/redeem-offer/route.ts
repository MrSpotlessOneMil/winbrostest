import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { redeemOffer } from '@/lib/offers'

/**
 * POST /api/actions/redeem-offer
 * Body: { offer_id, job_id }
 * Manual redemption — sets status='redeemed', links job, adjusts job price.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const offerId = Number(body.offer_id)
  const jobId = Number(body.job_id)

  if (!offerId || !jobId) {
    return NextResponse.json({ error: 'offer_id and job_id are required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Verify offer belongs to this tenant
  const { data: offer } = await client
    .from('offers')
    .select('id, tenant_id, offer_type, status')
    .eq('id', offerId)
    .eq('tenant_id', tenant.id)
    .single()

  if (!offer) {
    return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
  }

  if (offer.status !== 'pending') {
    return NextResponse.json({ error: `Offer is already ${offer.status}` }, { status: 400 })
  }

  // Verify job belongs to this tenant
  const { data: job } = await client
    .from('jobs')
    .select('id, tenant_id')
    .eq('id', jobId)
    .eq('tenant_id', tenant.id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  // Redeem the offer
  const success = await redeemOffer(client, offerId, jobId)
  if (!success) {
    return NextResponse.json({ error: 'Failed to redeem offer' }, { status: 500 })
  }

  // Adjust job price based on offer type
  if (offer.offer_type === 'free_standard_cleaning') {
    await client
      .from('jobs')
      .update({ price: 0, notes: `FREE CLEANING — offer ${offerId} manually redeemed` })
      .eq('id', jobId)
      .eq('tenant_id', tenant.id)
  } else if (offer.offer_type === '$99_deep_clean') {
    await client
      .from('jobs')
      .update({ price: 99 })
      .eq('id', jobId)
      .eq('tenant_id', tenant.id)
  }

  return NextResponse.json({ success: true, offer_id: offerId, job_id: jobId })
}
