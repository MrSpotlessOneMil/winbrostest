import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

/**
 * Service Book CRUD (WinBros Round 2 task 6).
 *
 * Per-tenant catalog of services the quote builder can insert as line items.
 * Customer-facing descriptions live here; line-item copies are editable per-quote.
 *
 * GET    /api/actions/service-book — list active rows for tenant (all roles)
 * POST   /api/actions/service-book — create row (admin + salesman)
 * PATCH  /api/actions/service-book?id=N — update row (admin + salesman)
 * DELETE /api/actions/service-book?id=N — soft-delete via is_active=false (admin + salesman)
 *
 * Cleaner sessions synthesize a negative user id (`-cleaner.id`). Technician-PIN
 * sessions also have negative ids — they can read the catalog but not edit.
 * Salesmen authenticate the same way as admins in this app (real users.id row),
 * so the positive-id gate covers both admin and salesman writes.
 */

type Body = {
  name?: unknown
  description?: unknown
  default_price?: unknown
  is_active?: unknown
  sort_order?: unknown
}

function buildUpdates(body: Body): Record<string, unknown> {
  const u: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) u.name = body.name.trim()
  if (typeof body.description === 'string') u.description = body.description
  if (body.description === null) u.description = null
  if (typeof body.default_price === 'number' && body.default_price >= 0) u.default_price = body.default_price
  if (body.default_price === null) u.default_price = null
  if (typeof body.is_active === 'boolean') u.is_active = body.is_active
  if (typeof body.sort_order === 'number') u.sort_order = Math.floor(body.sort_order)
  return u
}

function ensureWriter(authResult: { user: { id: number } }): NextResponse | null {
  if (authResult.user.id <= 0) {
    return NextResponse.json({ error: 'Admin/salesman access required' }, { status: 403 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const url = new URL(request.url)
  const includeInactive = url.searchParams.get('includeInactive') === 'true'

  const client = getSupabaseServiceClient()
  let q = client
    .from('service_book')
    .select('id, name, description, default_price, is_active, sort_order, created_at, updated_at')
    .eq('tenant_id', authResult.tenant.id)
    .order('sort_order', { ascending: true })
  if (!includeInactive) q = q.eq('is_active', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
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

  const u = buildUpdates(body)
  if (!u.name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('service_book')
    .insert({ ...u, tenant_id: authResult.tenant.id })
    .select('id, name, description, default_price, is_active, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data })
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
    .from('service_book')
    .update({ ...u, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)
    .select('id, name, description, default_price, is_active, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item: data })
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
    .from('service_book')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', authResult.tenant.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
