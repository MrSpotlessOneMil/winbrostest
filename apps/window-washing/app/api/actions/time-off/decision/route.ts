/**
 * PATCH /api/actions/time-off/decision
 *   Admin-only. Approve or deny a pending day-off request.
 *
 * Body: { id: number, status: 'approved' | 'denied', denial_reason?: string }
 *
 * Worker logins (cleaner sessions) hit requireAuthWithTenant and fail because
 * getAuthUser only returns rows where session.user_id is set — i.e. dashboard
 * (admin) sessions. We belt-and-suspender that with an explicit user check.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

type TimeOffDecision = 'approved' | 'denied'

export async function PATCH(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { user, tenant } = authResult

  if (!user?.id) {
    return NextResponse.json({ error: 'Admin user required' }, { status: 403 })
  }

  let body: { id: number; status: TimeOffDecision; denial_reason?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.id || (body.status !== 'approved' && body.status !== 'denied')) {
    return NextResponse.json(
      { error: 'id and status (approved|denied) required' },
      { status: 400 }
    )
  }

  if (body.status === 'denied' && !body.denial_reason) {
    // Encourage a reason on denial so the worker knows why. Admin can pass
    // anything non-empty; UI captures it via a small prompt.
    return NextResponse.json(
      { error: 'denial_reason required when denying' },
      { status: 400 }
    )
  }

  const client = getSupabaseServiceClient()

  // Cross-tenant guard: WHERE tenant_id matches the authed admin's tenant.
  // If the row's tenant doesn't match, this returns null and we 404.
  const { data, error } = await client
    .from('time_off')
    .update({
      status: body.status,
      decided_by_user_id: user.id,
      decided_at: new Date().toISOString(),
      denial_reason: body.status === 'denied' ? body.denial_reason ?? null : null,
    })
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('id, cleaner_id, date, status, decided_at, decided_by_user_id, denial_reason')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true, timeOff: data })
}
