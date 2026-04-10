/**
 * Complete Call Task Action
 *
 * POST /api/actions/complete-call-task
 * Body: { taskId: string }
 *
 * Marks a manual call task as completed from the dashboard checklist.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant: authTenant } = authResult

  let body: { taskId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { taskId } = body
  if (!taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 })
  }

  const client = getSupabaseServiceClient()

  const { data, error } = await client
    .from('call_tasks')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .eq('tenant_id', authTenant.id)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
