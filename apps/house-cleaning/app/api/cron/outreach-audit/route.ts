/**
 * Outreach Audit — nightly wrong-bucket detector.
 *
 * OUTREACH-SPEC v1.0 Section 10.6. Scans the last 24h of outbound messages
 * tagged `pipeline_a/b/c_*` and flags:
 *   - CRITICAL: send to a customer who should have been blocked (active member,
 *     active job, admin_disabled, opt-out, wrong state)
 *   - WARN: message contains a banned phrase (linter miss)
 *
 * Writes an `outreach_audit_reports` row + individual findings. Pages the owner
 * if any critical findings (via system_events CRITICAL level).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth, unauthorizedResponse } from '@/lib/cron-auth'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { GLOBAL_BANNED_PHRASES } from '@/lib/message-linter'
import { logSystemEvent } from '@/lib/system-events'
import { ACTIVE_JOB_STATUSES } from '@/lib/has-confirmed-booking'

// route-check:no-vercel-cron

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json(unauthorizedResponse(), { status: 401 })
  }

  const client = getSupabaseServiceClient()
  const windowEnd = new Date()
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000)

  // Pull outbound messages tagged with the new pipelines
  const { data: messages, error } = await client
    .from('messages')
    .select('id, tenant_id, customer_id, content, source, timestamp, phone_number')
    .eq('direction', 'outbound')
    .gte('timestamp', windowStart.toISOString())
    .or('source.like.pipeline_a_%,source.like.pipeline_b_%,source.like.pipeline_c_%')
    .limit(5000)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const findings: Array<{
    severity: 'critical' | 'warn' | 'info'
    tenant_id: string | null
    customer_id: number | null
    message_id: number | null
    reason: string
    detail: Record<string, unknown>
  }> = []

  const totalOutbound = messages?.length || 0

  // Load tenant info for slug lookup
  const { data: tenants } = await client.from('tenants').select('id, slug')
  const tenantBySlug = new Map((tenants || []).map(t => [t.id, t.slug]))

  for (const msg of messages || []) {
    if (!msg.customer_id) continue

    // Load customer + membership + active jobs to validate the send was legal
    const { data: customer } = await client
      .from('customers')
      .select('id, lifecycle_state, sms_opt_out, auto_response_disabled, retargeting_stopped_reason, manual_managed')
      .eq('id', msg.customer_id)
      .eq('tenant_id', msg.tenant_id)
      .maybeSingle()

    if (!customer) continue

    // Rule violations that should never happen
    if (customer.sms_opt_out) {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_opt_out', detail: { source: msg.source } })
    }
    if (customer.auto_response_disabled) {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_auto_response_disabled', detail: { source: msg.source } })
    }
    if (customer.retargeting_stopped_reason === 'admin_disabled') {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_admin_disabled', detail: { source: msg.source } })
    }
    if (customer.manual_managed) {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_manual_managed', detail: { source: msg.source } })
    }

    // Active membership check (at time of send, best-effort approximation using NOW)
    const { data: mem } = await client
      .from('customer_memberships')
      .select('id, status, created_at')
      .eq('tenant_id', msg.tenant_id)
      .eq('customer_id', msg.customer_id)
      .in('status', ['active', 'paused'])
      .lte('created_at', msg.timestamp)
      .limit(1)
      .maybeSingle()
    if (mem) {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_active_member', detail: { source: msg.source, membership_id: mem.id } })
    }

    // Active job at time of send
    const { data: activeJob } = await client
      .from('jobs')
      .select('id, status, created_at')
      .eq('tenant_id', msg.tenant_id)
      .eq('customer_id', msg.customer_id)
      .in('status', ACTIVE_JOB_STATUSES as unknown as string[])
      .lte('created_at', msg.timestamp)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (activeJob) {
      findings.push({ severity: 'critical', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'sent_to_active_job', detail: { source: msg.source, job_id: activeJob.id, job_status: activeJob.status } })
    }

    // Banned phrase linter miss
    const lowered = (msg.content || '').toLowerCase()
    for (const phrase of GLOBAL_BANNED_PHRASES) {
      if (lowered.includes(phrase)) {
        findings.push({ severity: 'warn', tenant_id: msg.tenant_id, customer_id: msg.customer_id, message_id: msg.id, reason: 'banned_phrase_leaked', detail: { phrase, source: msg.source } })
        break
      }
    }
  }

  const critical = findings.filter(f => f.severity === 'critical').length
  const warn = findings.filter(f => f.severity === 'warn').length

  // Write report
  const { data: report } = await client
    .from('outreach_audit_reports')
    .insert({
      window_start: windowStart.toISOString(),
      window_end: windowEnd.toISOString(),
      total_outbound: totalOutbound,
      critical_findings: critical,
      warn_findings: warn,
      findings: findings.slice(0, 500),
      summary: `${critical} critical, ${warn} warn across ${totalOutbound} outbound`,
    })
    .select('id')
    .single()

  if (report && findings.length > 0) {
    await client
      .from('outreach_audit_findings')
      .insert(findings.map(f => ({ ...f, report_id: report.id })))
  }

  if (critical > 0) {
    await logSystemEvent({
      source: 'cron',
      event_type: 'OUTREACH_AUDIT_CRITICAL',
      message: `${critical} wrong-bucket sends detected in last 24h`,
      metadata: { critical, warn, total_outbound: totalOutbound, report_id: report?.id, findings: findings.slice(0, 20) },
    })
  }

  return NextResponse.json({
    ok: critical === 0,
    critical,
    warn,
    totalOutbound,
    reportId: report?.id,
    sampleFindings: findings.slice(0, 10),
  })
}
