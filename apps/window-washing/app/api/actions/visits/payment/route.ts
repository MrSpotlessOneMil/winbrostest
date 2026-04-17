/**
 * Visit Payment Endpoint
 *
 * POST /api/actions/visits/payment
 * Body: { visitId: number, payment_type: 'card'|'cash'|'check', payment_amount: number, tip_amount?: number }
 *
 * Records payment for a visit. Supports card (charge saved card), cash, or check.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { recordPayment } from '@/lib/visit-flow'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  let body: {
    visitId: number
    payment_type: 'card' | 'cash' | 'check'
    payment_amount: number
    tip_amount?: number
    stripe_payment_intent_id?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visitId, payment_type, payment_amount, tip_amount, stripe_payment_intent_id } = body
  if (!visitId || !payment_type || payment_amount == null) {
    return NextResponse.json(
      { error: 'visitId, payment_type, and payment_amount are required' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Verify visit belongs to tenant
  const { data: visit } = await client
    .from('visits')
    .select('tenant_id')
    .eq('id', visitId)
    .single()

  if (!visit || visit.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  }

  const result = await recordPayment(client, visitId, {
    payment_type,
    payment_amount,
    tip_amount,
    stripe_payment_intent_id,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
