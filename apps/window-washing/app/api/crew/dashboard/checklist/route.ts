/**
 * Dashboard Checklist API
 *
 * POST /api/crew/dashboard/checklist — Toggle checklist item
 * Body: { visit_id: number, item_id: number, completed: boolean }
 *
 * PUT  /api/crew/dashboard/checklist — Add checklist item
 * Body: { visit_id: number, text: string }
 *
 * Uses requireAuthWithTenant for dashboard auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

  let body: { visit_id: number; item_id: number; completed: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visit_id, item_id, completed } = body
  if (!visit_id || item_id == null || completed == null) {
    return NextResponse.json({ error: 'visit_id, item_id, and completed are required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Verify visit belongs to tenant
  const { data: visit } = await client
    .from('visits')
    .select('id, tenant_id')
    .eq('id', visit_id)
    .single()

  if (!visit || visit.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  }

  // Verify checklist item belongs to this visit
  const { data: checkItem } = await client
    .from('visit_checklists')
    .select('id')
    .eq('id', item_id)
    .eq('visit_id', visit_id)
    .maybeSingle()

  if (!checkItem) {
    return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 })
  }

  const { error: updateErr } = await client
    .from('visit_checklists')
    .update({
      is_completed: !!completed,
      completed_at: completed ? new Date().toISOString() : null,
    })
    .eq('id', item_id)
    .eq('visit_id', visit_id)

  if (updateErr) {
    return NextResponse.json({ error: 'Failed to update checklist item' }, { status: 500 })
  }

  // Check if all items are now complete and update visit
  const { data: allItems } = await client
    .from('visit_checklists')
    .select('is_completed')
    .eq('visit_id', visit_id)

  const allComplete = allItems && allItems.length > 0 && allItems.every((i: { is_completed: boolean }) => i.is_completed)

  // Update visit checklist_completed flag
  await client
    .from('visits')
    .update({ checklist_completed: !!allComplete })
    .eq('id', visit_id)

  return NextResponse.json({ success: true, all_complete: !!allComplete })
}

export async function PUT(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if ('error' in authResult) {
    return NextResponse.json({ error: authResult.error }, { status: 401 })
  }

  let body: { visit_id: number; text: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { visit_id, text } = body
  if (!visit_id || !text?.trim()) {
    return NextResponse.json({ error: 'visit_id and text are required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  // Verify visit belongs to tenant
  const { data: visit } = await client
    .from('visits')
    .select('id, tenant_id')
    .eq('id', visit_id)
    .single()

  if (!visit || visit.tenant_id !== authResult.tenant.id) {
    return NextResponse.json({ error: 'Visit not found' }, { status: 404 })
  }

  // Get max sort order
  const { data: existingItems } = await client
    .from('visit_checklists')
    .select('sort_order')
    .eq('visit_id', visit_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  const nextOrder = (existingItems?.[0]?.sort_order ?? 0) + 1

  const { data: newItem, error: insertErr } = await client
    .from('visit_checklists')
    .insert({
      visit_id,
      tenant_id: authResult.tenant.id,
      item_text: text.trim(),
      sort_order: nextOrder,
      is_completed: false,
    })
    .select('id, item_text, is_completed, completed_at')
    .single()

  if (insertErr || !newItem) {
    return NextResponse.json({ error: 'Failed to add checklist item' }, { status: 500 })
  }

  return NextResponse.json({ success: true, item: newItem })
}
