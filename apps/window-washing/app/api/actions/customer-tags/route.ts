/**
 * Customer Tags API
 * GET  /api/actions/customer-tags?customer_id=123 — list tags for a customer
 * POST /api/actions/customer-tags — add a tag { customer_id, tag_type, tag_value }
 * DELETE /api/actions/customer-tags?id=456 — remove a tag
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const customerId = request.nextUrl.searchParams.get('customer_id')
  if (!customerId) {
    return NextResponse.json({ error: 'customer_id required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('customer_tags')
    .select('id, tag_type, tag_value')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', Number(customerId))
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  let body: { customer_id?: number; tag_type?: string; tag_value?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { customer_id, tag_type, tag_value } = body
  if (!customer_id || !tag_type || !tag_value) {
    return NextResponse.json({ error: 'customer_id, tag_type, and tag_value required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('customer_tags')
    .insert({
      customer_id,
      tenant_id: tenant.id,
      tag_type,
      tag_value,
    })
    .select('id, tag_type, tag_value')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tag: data })
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const tagId = request.nextUrl.searchParams.get('id')
  if (!tagId) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()
  const { error } = await client
    .from('customer_tags')
    .delete()
    .eq('id', Number(tagId))
    .eq('tenant_id', tenant.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
