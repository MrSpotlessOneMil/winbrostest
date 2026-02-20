import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAuthTenant } from '@/lib/auth'
import { getTenantScopedClient, getSupabaseServiceClient } from '@/lib/supabase'
import { toE164 } from '@/lib/phone-utils'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request)
  if (authResult instanceof NextResponse) return authResult

  const tenant = await getAuthTenant(request)
  // Admin user (no tenant_id) sees all tenants' data
  if (!tenant && authResult.user.username !== 'admin') {
    return NextResponse.json({ success: false, error: 'No tenant configured' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')
  const telegramId = searchParams.get('telegram_id')
  const limit = Math.min(Number(searchParams.get('limit') || '200'), 500)

  if (!phone && !telegramId) {
    return NextResponse.json({ success: false, error: 'phone or telegram_id parameter is required' }, { status: 400 })
  }

  const normalized = phone ? toE164(phone) : null

  const client = tenant
    ? await getTenantScopedClient(tenant.id)
    : getSupabaseServiceClient()

  // Build query: match by phone OR by telegram_chat_id in metadata
  let query = client
    .from('messages')
    .select('id, phone_number, direction, content, timestamp, status')
  if (tenant) query = query.eq('tenant_id', tenant.id)

  if (normalized && telegramId) {
    // Match either phone number or telegram chat ID in metadata
    query = query.or(`phone_number.eq.${normalized},metadata->>telegram_chat_id.eq.${telegramId}`)
  } else if (normalized) {
    query = query.eq('phone_number', normalized)
  } else if (telegramId) {
    query = query.eq('metadata->>telegram_chat_id', telegramId)
  }

  const { data, error } = await query
    .order('timestamp', { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data || [] })
}
