/**
 * PATCH /api/teams/reorder
 *
 * Persist cleaner rank order for ranked assignment mode.
 * Body: { cleaners: [{ id: number, rank: number }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuthWithTenant } from '@/lib/auth'

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const { tenant } = authResult

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { cleaners } = body
  if (!Array.isArray(cleaners) || cleaners.length === 0) {
    return NextResponse.json({ error: 'cleaners array required' }, { status: 400 })
  }

  // Validate each entry
  for (const entry of cleaners) {
    if (typeof entry.id !== 'number' && typeof entry.id !== 'string') {
      return NextResponse.json({ error: 'Each cleaner must have an id' }, { status: 400 })
    }
    if (typeof entry.rank !== 'number' || entry.rank < 1) {
      return NextResponse.json({ error: 'Each cleaner must have a positive rank' }, { status: 400 })
    }
  }

  const client = getSupabaseServiceClient()

  // Verify all cleaners belong to this tenant before updating
  const ids = cleaners.map((c: any) => Number(c.id))
  const { data: ownedCleaners } = await client
    .from('cleaners')
    .select('id')
    .eq('tenant_id', tenant.id)
    .in('id', ids)

  const ownedIds = new Set((ownedCleaners || []).map((c: any) => Number(c.id)))
  const unauthorized = ids.filter(id => !ownedIds.has(id))
  if (unauthorized.length > 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Batch update ranks
  for (const entry of cleaners) {
    await client
      .from('cleaners')
      .update({ rank: entry.rank, updated_at: new Date().toISOString() })
      .eq('id', Number(entry.id))
      .eq('tenant_id', tenant.id)
  }

  return NextResponse.json({ success: true })
}
