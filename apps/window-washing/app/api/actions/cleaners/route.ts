import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult

  const client = getSupabaseServiceClient()
  const { data, error } = await client
    .from('cleaners')
    .select('id, name, phone, email, is_team_lead, employee_type, role, active, home_address')
    .eq('tenant_id', authResult.tenant.id)
    .is('deleted_at', null)
    .order('is_team_lead', { ascending: false })
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
