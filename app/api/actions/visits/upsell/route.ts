/**
 * Visit Upsell Endpoint
 *
 * POST /api/actions/visits/upsell
 * Body: { visitId: number, service_name: string, price: number, description?: string }
 *
 * Adds a technician upsell line item to an active visit.
 * ONLY allowed when visit status is "in_progress".
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { addUpsell } from '@/apps/window-washing/lib/visit-flow'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

  let body: { visitId: number; service_name: string; price: number; description?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visitId, service_name, price, description } = body
  if (!visitId || !service_name || price == null) {
    return NextResponse.json({ error: 'visitId, service_name, and price are required' }, { status: 400 })
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

  const result = await addUpsell(client, visitId, {
    service_name,
    description,
    price,
    added_by_cleaner_id: authResult.user?.cleaner_id || 0,
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true, line_item_id: result.line_item_id })
}
