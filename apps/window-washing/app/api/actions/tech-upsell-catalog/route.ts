import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Tech Upsell Catalog CRUD (WinBros Round 2 Q1=C)
 *
 * GET    /api/actions/tech-upsell-catalog — list active items for tenant (all roles)
 * POST   /api/actions/tech-upsell-catalog — create new row (admin only)
 * PATCH  /api/actions/tech-upsell-catalog?id=N — update row (admin only)
 * DELETE /api/actions/tech-upsell-catalog?id=N — soft-delete via is_active=false (admin only)
 */

type CatalogBody = {
  name?: unknown
  description?: unknown
  price?: unknown
  is_active?: unknown
  sort_order?: unknown
}

function buildUpdates(body: CatalogBody): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.description === 'string') updates.description = body.description
  if (body.description === null) updates.description = null
  if (typeof body.price === 'number' && body.price >= 0) updates.price = body.price
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (typeof body.sort_order === 'number') updates.sort_order = Math.floor(body.sort_order)
  return updates
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseServiceClient()
  const tenantId = authResult.tenant.id

  const url = new URL(request.url)
  const includeInactive = url.searchParams.get('includeInactive') === 'true'

  let query = client
    .from('tech_upsell_catalog')
    .select('id, name, description, price, is_active, sort_order, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  // Write gate: must be an owner-session user (real row in users table), not a cleaner PIN session.
  // Cleaner sessions synthesize a negative id (-cleaner.id), so positive id = owner/admin.
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/owner access required' }, { status: 403 })
  }

  let body: CatalogBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const updates = buildUpdates(body)
  if (!updates.name || typeof updates.price !== 'number') {
    return NextResponse.json(
      { error: 'name and price are required' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('tech_upsell_catalog')
    .insert({ ...updates, tenant_id: authResult.tenant.id })
    .select('id, name, description, price, is_active, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
}

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  // Write gate: must be an owner-session user (real row in users table), not a cleaner PIN session.
  // Cleaner sessions synthesize a negative id (-cleaner.id), so positive id = owner/admin.
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/owner access required' }, { status: 403 })
  }

  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  let body: CatalogBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const updates = buildUpdates(body)
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('tech_upsell_catalog')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)
    .select('id, name, description, price, is_active, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item: data })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  // Write gate: must be an owner-session user (real row in users table), not a cleaner PIN session.
  // Cleaner sessions synthesize a negative id (-cleaner.id), so positive id = owner/admin.
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/owner access required' }, { status: 403 })
  }

  const url = new URL(request.url)
  const id = Number(url.searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const client = getSupabaseServiceClient()
  // Soft-delete so existing visit_line_items that reference the upsell retain their display values.
  const { error } = await client
    .from('tech_upsell_catalog')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
