/**
 * Tag Definitions API
 * GET /api/actions/tag-definitions — list all active tag definitions for the tenant
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('tag_definitions')
    .select('tag_type, tag_value, color')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('tag_type', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}
