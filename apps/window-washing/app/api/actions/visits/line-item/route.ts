/**
 * PATCH /api/actions/visits/line-item
 *   Body: { id: number, price: number, service_name?: string }
 *
 *   Updates a single visit_line_items row's price (and optionally name).
 *   Used by the JobDetailDrawer's inline-edit on the visit screen so a tech
 *   in the field can correct a wrong-priced upsell or original-quote line
 *   without leaving the drawer.
 *
 *   Edits are blocked once the parent visit is `closed` (terminal state).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { id: number; price?: number; service_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const hasPrice = body.price !== undefined && body.price !== null
  const hasName = typeof body.service_name === 'string' && body.service_name.trim().length > 0
  if (!hasPrice && !hasName) {
    return NextResponse.json(
      { error: 'price or service_name required' },
      { status: 400 }
    )
  }

  if (hasPrice && (typeof body.price !== 'number' || !isFinite(body.price) || body.price < 0)) {
    return NextResponse.json({ error: 'price must be a non-negative number' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Tenant + closed-visit guard. We resolve the visit_line_item's parent
  // visit to (a) confirm tenant ownership and (b) block edits on closed
  // visits — payroll has already locked numbers in once a visit is closed.
  const { data: lineItem } = await client
    .from('visit_line_items')
    .select('id, visit_id, visits!inner(id, tenant_id, status)')
    .eq('id', body.id)
    .single()

  const parentVisit = (lineItem as unknown as { visits?: { tenant_id?: string; status?: string } | null } | null)?.visits ?? null
  if (!lineItem || !parentVisit || parentVisit.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Line item not found' }, { status: 404 })
  }
  if (parentVisit.status === 'closed') {
    return NextResponse.json(
      { error: 'Cannot edit line items on a closed visit' },
      { status: 409 }
    )
  }

  const patch: Record<string, unknown> = {}
  if (hasPrice) patch.price = body.price
  if (hasName) patch.service_name = body.service_name!.trim()

  const { data, error } = await client
    .from('visit_line_items')
    .update(patch)
    .eq('id', body.id)
    .select('id, service_name, price, revenue_type')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, line_item: data })
}
