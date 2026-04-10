/**
 * Call Tasks API
 *
 * GET /api/call-tasks — returns today's pending manual call tasks for the auth'd tenant
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  if (!tenant) {
    return NextResponse.json({ success: true, data: [] })
  }

  const client = getSupabaseServiceClient()
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await client
    .from('call_tasks')
    .select('id, phone_number, customer_name, source, source_context, scheduled_for, created_at')
    .eq('tenant_id', tenant.id)
    .eq('scheduled_for', today)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data || [] })
}
