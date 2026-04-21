import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/openphone'
import { getTenantById } from '@/lib/tenant'
import { logSystemEvent } from '@/lib/system-events'
import { isWithinQuietHoursWindow, resolveTimezone } from '@/lib/timezone-from-area-code'

/**
 * Drain SMS Outreach Queue (T6 — 2026-04-20).
 *
 * Every 5 minutes: pick pending rows whose scheduled_for_at has passed, verify
 * the tenant is STILL within quiet-hours (DST / TZ mistakes catch here), and
 * dispatch via sendSMS with kind='internal' to skip re-queuing.
 *
 * Rows are claimed atomically by UPDATE status='sending' WHERE id=... AND status='pending'.
 * Failures bump attempts and set status='failed' after 3 tries.
 */

// route-check:no-vercel-cron

const CLAIM_LIMIT = 100
const MAX_ATTEMPTS = 3

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const now = new Date()

  const { data: due, error } = await client
    .from('sms_outreach_queue')
    .select('id, tenant_id, customer_id, phone, body, source, scheduled_for_at, attempts, metadata')
    .eq('status', 'pending')
    .lte('scheduled_for_at', now.toISOString())
    .order('scheduled_for_at', { ascending: true })
    .limit(CLAIM_LIMIT)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ drained: 0 })
  }

  let drained = 0
  let queued = 0
  let failed = 0
  const byTenant: Record<string, { drained: number; failed: number; requeued: number }> = {}

  for (const row of due) {
    const bucket = (byTenant[row.tenant_id] ||= { drained: 0, failed: 0, requeued: 0 })

    // Claim the row
    const { data: claimed } = await client
      .from('sms_outreach_queue')
      .update({ status: 'sending', attempts: (row.attempts || 0) + 1 })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (!claimed) continue // someone else claimed it

    const tenant = await getTenantById(row.tenant_id).catch(() => null)
    if (!tenant) {
      await client
        .from('sms_outreach_queue')
        .update({ status: 'failed', last_error: 'Tenant not found' })
        .eq('id', row.id)
      failed++
      bucket.failed++
      continue
    }

    // Re-check quiet hours — DST, clock skew, race with TZ change
    const tz = resolveTimezone({ tenantTimezone: tenant.timezone, phone: row.phone })
    if (!isWithinQuietHoursWindow(tz, now)) {
      // Push back — release the claim and re-schedule for next window
      const next = new Date(now.getTime() + 60 * 60 * 1000) // +1h then drain will re-check
      await client
        .from('sms_outreach_queue')
        .update({ status: 'pending', scheduled_for_at: next.toISOString() })
        .eq('id', row.id)
      bucket.requeued++
      queued++
      continue
    }

    // Actually send. Use kind='internal' to bypass the quiet-hours gate in sendSMS
    // (we just verified above — avoid an infinite requeue loop).
    const result = await sendSMS(tenant, row.phone, row.body, {
      source: row.source || 'drain_queue',
      customerId: row.customer_id ?? null,
      kind: 'internal',
    })

    if (result.success) {
      await client
        .from('sms_outreach_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id)
      drained++
      bucket.drained++
    } else {
      const isFinal = (row.attempts || 0) + 1 >= MAX_ATTEMPTS
      await client
        .from('sms_outreach_queue')
        .update({
          status: isFinal ? 'failed' : 'pending',
          last_error: result.error || 'unknown',
          scheduled_for_at: isFinal ? row.scheduled_for_at : new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
        })
        .eq('id', row.id)
      failed++
      bucket.failed++
    }
  }

  if (drained > 0 || failed > 0) {
    await logSystemEvent({
      source: 'cron',
      event_type: 'SMS_QUEUE_DRAINED',
      message: `Drain queue: ${drained} sent, ${queued} requeued, ${failed} failed across ${Object.keys(byTenant).length} tenant(s)`,
      metadata: { drained, queued, failed, byTenant },
    })
  }

  return NextResponse.json({ drained, queued, failed, byTenant })
}
