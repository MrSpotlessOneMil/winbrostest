import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getDefaultTenant } from '@/lib/tenant'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { toE164 } from '@/lib/phone-utils'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getDefaultTenant()
  if (!tenant) {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')
  const limit = Math.min(Number(searchParams.get('limit') || '200'), 500)

  if (!phone) {
    return NextResponse.json({ success: false, error: 'phone parameter is required' }, { status: 400 })
  }

  const normalized = toE164(phone)
  if (!normalized) {
    return NextResponse.json({ success: false, error: 'Invalid phone number' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('messages')
    .select('id, phone_number, direction, body, timestamp, status')
    .eq('tenant_id', tenant.id)
    .eq('phone_number', normalized)
    .order('timestamp', { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data || [] })
}
