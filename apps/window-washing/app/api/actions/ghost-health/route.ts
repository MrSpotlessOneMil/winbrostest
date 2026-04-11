/**
 * GET /api/actions/ghost-health
 *
 * Returns messaging system health metrics:
 * - pending_count: messages with disposition='pending' older than 5 min (should be 0)
 * - unresponded_24h: inbound messages in last 24h with no outbound follow-up
 * - watchdog_catches_24h: GHOST_WATCHDOG_CATCH events in last 24h
 * - avg_response_time_min: average response time in minutes (last 24h)
 * - status: green/yellow/red health indicator
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuthWithTenant } from '@/lib/auth'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const authResult = await requireAuthWithTenant(request)
  if (authResult instanceof NextResponse) return authResult
  const { tenant } = authResult

  const client = getSupabaseServiceClient()
  const now = new Date()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // 1. Pending messages (disposition='pending', older than 5 min) — should be 0
  const { count: pendingCount } = await client
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('direction', 'inbound')
    .eq('role', 'client')
    .lt('created_at', fiveMinAgo)
    .gte('created_at', twentyFourHoursAgo)
    .filter('metadata->>disposition', 'eq', 'pending')

  // 2. Unresponded messages in last 24h (brute force — check each inbound for outbound follow-up)
  const { data: recentInbound } = await client
    .from('messages')
    .select('id, phone_number, created_at')
    .eq('tenant_id', tenant.id)
    .eq('direction', 'inbound')
    .eq('role', 'client')
    .gte('created_at', twentyFourHoursAgo)
    .lt('created_at', fiveMinAgo) // at least 5 min old
    .order('created_at', { ascending: false })
    .limit(100)

  // Deduplicate by phone (only check most recent per phone)
  const seenPhones = new Set<string>()
  const uniqueInbound = (recentInbound || []).filter(m => {
    if (!m.phone_number || seenPhones.has(m.phone_number)) return false
    seenPhones.add(m.phone_number)
    return true
  })

  let unresponded24h = 0
  for (const msg of uniqueInbound) {
    const { count } = await client
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('phone_number', msg.phone_number)
      .eq('tenant_id', tenant.id)
      .eq('direction', 'outbound')
      .gt('created_at', msg.created_at)

    if (!count || count === 0) unresponded24h++
  }

  // 3. Ghost watchdog catches in last 24h
  const { count: watchdogCatches } = await client
    .from('system_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('event_type', 'GHOST_WATCHDOG_CATCH')
    .gte('created_at', twentyFourHoursAgo)

  // 4. Ghost watchdog recoveries (actual responses sent) in last 24h
  const { count: watchdogRecoveries } = await client
    .from('system_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('event_type', 'GHOST_WATCHDOG_RESPONSE')
    .gte('created_at', twentyFourHoursAgo)

  // 5. Health status
  const pending = pendingCount || 0
  const catches = watchdogCatches || 0
  let status: 'green' | 'yellow' | 'red' = 'green'
  if (pending >= 3 || catches >= 6) {
    status = 'red'
  } else if (pending >= 1 || catches >= 3) {
    status = 'yellow'
  }

  return NextResponse.json({
    pending_count: pending,
    unresponded_24h: unresponded24h,
    watchdog_catches_24h: catches,
    watchdog_recoveries_24h: watchdogRecoveries || 0,
    status,
  })
}
