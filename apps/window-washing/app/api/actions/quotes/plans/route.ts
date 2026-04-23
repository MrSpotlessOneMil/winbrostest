import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Quote Service Plans CRUD (WinBros Round 2 task 6, Q2).
 *
 * quote_service_plans rows belong to a specific quote. The builder creates
 * N candidate plans per quote; customer picks ≤1 on the public quote view.
 * commission_rule JSONB stays editable without schema changes (Q2 interim:
 * salesman gets first-visit only, no recurring commission).
 *
 * GET    /api/actions/quotes/plans?quote_id=UUID — list plans for a quote
 * POST   /api/actions/quotes/plans — create plan on a quote (admin/salesman)
 * PATCH  /api/actions/quotes/plans?id=N — update plan
 * DELETE /api/actions/quotes/plans?id=N — hard delete (plans pre-approval)
 *
 * Cross-tenant guard: quote.tenant_id must match authTenant.id on every op.
 */

type Body = {
  quote_id?: unknown
  name?: unknown
  discount_label?: unknown
  recurring_price?: unknown
  first_visit_keeps_original_price?: unknown
  offered_to_customer?: unknown
  recurrence?: unknown
  commission_rule?: unknown
  sort_order?: unknown
}

function buildUpdates(body: Body): Record<string, unknown> {
  const u: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) u.name = body.name.trim()
  if (typeof body.discount_label === 'string') u.discount_label = body.discount_label
  if (body.discount_label === null) u.discount_label = null
  if (typeof body.recurring_price === 'number' && body.recurring_price >= 0)
    u.recurring_price = body.recurring_price
  if (typeof body.first_visit_keeps_original_price === 'boolean')
    u.first_visit_keeps_original_price = body.first_visit_keeps_original_price
  if (typeof body.offered_to_customer === 'boolean')
    u.offered_to_customer = body.offered_to_customer
  if (body.recurrence && typeof body.recurrence === 'object') u.recurrence = body.recurrence
  if (body.commission_rule && typeof body.commission_rule === 'object')
    u.commission_rule = body.commission_rule
  if (typeof body.sort_order === 'number') u.sort_order = Math.floor(body.sort_order)
  return u
}

function ensureWriter(authResult: { user: { id: number } }): NextResponse | null {
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/salesman access required' }, { status: 403 })
  }
  return null
}

async function assertQuoteInTenant(
  client: ReturnType<typeof getSupabaseServiceClient>,
  quoteId: string,
  tenantId: string
): Promise<NextResponse | null> {
  const { data, error } = await client
    .from('quotes')
    .select('id, tenant_id')
    .eq('id', quoteId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  if (data.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const url = new URL(request.url)
  const quoteId = url.searchParams.get('quote_id')
  if (!quoteId) return NextResponse.json({ error: 'quote_id is required' }, { status: 400 })

  const client = getSupabaseServiceClient()
  const xtenant = await assertQuoteInTenant(client, quoteId, authResult.tenant.id)
  if (xtenant) return xtenant

  const { data, error } = await client
    .from('quote_service_plans')
    .select(
      'id, quote_id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, commission_rule, sort_order, created_at'
    )
    .eq('quote_id', quoteId)
    .eq('tenant_id', authResult.tenant.id)
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const gate = ensureWriter(authResult)
  if (gate) return gate

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (typeof body.quote_id !== 'string' || !body.quote_id) {
    return NextResponse.json({ error: 'quote_id is required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const xtenant = await assertQuoteInTenant(client, body.quote_id, authResult.tenant.id)
  if (xtenant) return xtenant

  const u = buildUpdates(body)
  if (!u.name || typeof u.recurring_price !== 'number') {
    return NextResponse.json(
      { error: 'name and recurring_price are required' },
      { status: 400 }
    )
  }

  const { data, error } = await client
    .from('quote_service_plans')
    .insert({ ...u, quote_id: body.quote_id, tenant_id: authResult.tenant.id })
    .select(
      'id, quote_id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, commission_rule, sort_order'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plan: data })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const gate = ensureWriter(authResult)
  if (gate) return gate

  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const u = buildUpdates(body)
  if (Object.keys(u).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('quote_service_plans')
    .update(u)
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)
    .select(
      'id, quote_id, name, discount_label, recurring_price, first_visit_keeps_original_price, offered_to_customer, recurrence, commission_rule, sort_order'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ plan: data })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const gate = ensureWriter(authResult)
  if (gate) return gate

  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const client = getSupabaseServiceClient()
  const { error } = await client
    .from('quote_service_plans')
    .delete()
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
