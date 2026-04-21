import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { logSystemEvent } from '@/lib/system-events'

/**
 * Release expired human takeovers (W3 — 2026-04-20).
 *
 * Daily at 5am UTC. Any customer whose human_takeover_until has passed gets
 * cleared so normal auto-response resumes. We keep this separate from the
 * 15-min auto_response_paused unpause (which runs inline in the OpenPhone
 * webhook) because those are temporary holds; human_takeover_until is an
 * explicit 24h (or tenant-configurable) hard pause used when a human operator
 * asserts ownership of a thread.
 *
 * Schedule: 0 5 * * *
 */

// route-check:no-vercel-cron

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const now = new Date().toISOString()

  const { data: released, error } = await client
    .from('customers')
    .update({ human_takeover_until: null })
    .lt('human_takeover_until', now)
    .not('human_takeover_until', 'is', null)
    .select('id, tenant_id')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = released?.length || 0
  if (count > 0) {
    await logSystemEvent({
      source: 'cron',
      event_type: 'HUMAN_TAKEOVERS_RELEASED',
      message: `Released ${count} expired human takeovers`,
      metadata: { count, ids: released?.map(r => r.id) },
    })
  }

  return NextResponse.json({ released: count })
}
