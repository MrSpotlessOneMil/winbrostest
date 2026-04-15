/**
 * Quote Approval Endpoint
 *
 * POST /api/actions/quotes/approve
 * Body: { quoteId: number, approvedBy: 'customer' | 'salesman' }
 *
 * Approves a quote and auto-converts it to a Job + Visit.
 * Original quote line items become "original_quote" revenue (salesman credited).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { approveAndConvertQuote } from '@/lib/quote-conversion'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  let body: { quoteId: number; approvedBy: 'customer' | 'salesman' }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { quoteId, approvedBy } = body
  if (!quoteId || !approvedBy || !['customer', 'salesman'].includes(approvedBy)) {
    return NextResponse.json(
      { error: 'quoteId and approvedBy (customer|salesman) are required' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Verify quote belongs to tenant
  const { data: quote } = await client
    .from('quotes')
    .select('tenant_id')
    .eq('id', quoteId)
    .single()

  if (!quote || quote.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  const result = await approveAndConvertQuote(client, quoteId, approvedBy)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    job_id: result.job_id,
    visit_id: result.visit_id,
  })
}
