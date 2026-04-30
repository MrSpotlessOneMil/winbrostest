#!/usr/bin/env tsx
/**
 * v2 backfill: enroll customers who got the initial AI message but never
 * received any follow-up (because the v2 wiring was missing).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Two modes (BACKFILL_MODE):
 *   "ghosted" (default) — paid-acquisition / form-fill leads who got the
 *      initial AI message but never replied. Filtered by lead.source
 *      whitelist (BACKFILL_SOURCES) and recent activity (BACKFILL_LOOKBACK_DAYS).
 *   "broad" — every customer who has gone quiet AND is not currently
 *      active. Includes:
 *        a) past clients (had a completed job)
 *        b) ghosted leads (outbound > 0, inbound = 0)
 *        c) engaged but unconverted (had inbound, never booked)
 *      Excluded: bulk-imported "manual" / "phone" / "email" sources
 *      (no SMS consent confirmed). Excluded: customers in active
 *      lifecycle states (recurring, scheduled, in_service, awaiting_payment).
 *
 * Always-on hard gates (regardless of mode):
 *   - tenant has followup_rebuild_v2_enabled = true
 *   - customer has phone_number
 *   - not unsubscribed_at, not sms_opt_out, not auto_response_disabled
 *   - not already retargeting_active
 *   - no pending followup.ghost_chase / retargeting.win_back row
 *
 * Action: enroll each in retargeting (single retargeting.win_back at +24h,
 * structured phase). Partial unique index on scheduled_tasks prevents
 * double-enrollment.
 *
 * Modes:
 *   default (DRY-RUN)         — counts + samples, no DB writes
 *   BACKFILL_LIVE=true        — actually enroll customers
 *   BACKFILL_TENANT=slug      — limit to a single tenant slug (default: spotless-scrubbers)
 *   BACKFILL_LOOKBACK_DAYS=N  — only customers contacted in last N days (default 60)
 *   BACKFILL_SOURCES=a,b,c    — lead.source whitelist (default: meta,website)
 *   MAX_ENROLLS_PER_RUN=N     — cap (default 50)
 *   JITTER_SECONDS=N          — spread between enrolls so SMS dont fire same minute (default 60)
 *
 * Usage:
 *   pnpm tsx scripts/v2-backfill-ghosted-leads.ts             # dry run, spotless, 50 cap, meta+website
 *   BACKFILL_LIVE=true pnpm tsx scripts/v2-backfill-ghosted-leads.ts
 *   BACKFILL_TENANT=cedar-rapids BACKFILL_LIVE=true pnpm tsx scripts/v2-backfill-ghosted-leads.ts
 *   BACKFILL_SOURCES=meta,website,google_lsa pnpm tsx scripts/v2-backfill-ghosted-leads.ts
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const LIVE = process.env.BACKFILL_LIVE === 'true'
const TENANT_SLUG = process.env.BACKFILL_TENANT || 'spotless-scrubbers'
const LOOKBACK_DAYS = parseInt(process.env.BACKFILL_LOOKBACK_DAYS || '60', 10)
const MAX_ENROLLS = parseInt(process.env.MAX_ENROLLS_PER_RUN || '50', 10)
const JITTER_SECONDS = parseInt(process.env.JITTER_SECONDS || '60', 10)
const MODE = (process.env.BACKFILL_MODE || 'ghosted').toLowerCase() as 'ghosted' | 'broad'
const SOURCE_WHITELIST = (process.env.BACKFILL_SOURCES || 'meta,website')
  .split(',').map(s => s.trim()).filter(Boolean)
// Sources we trust for SMS consent in BROAD mode (excludes manual / bulk imports / inbound calls)
const CONSENT_SOURCES = (process.env.CONSENT_SOURCES || 'meta,website,google_lsa,sms,housecall_pro')
  .split(',').map(s => s.trim()).filter(Boolean)
const QUIET_DAYS = parseInt(process.env.QUIET_DAYS || '7', 10)
const ACTIVE_JOB_GRACE_DAYS = parseInt(process.env.ACTIVE_JOB_GRACE_DAYS || '14', 10)

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

interface BackfillCandidate {
  customer_id: number
  tenant_id: string
  first_name: string | null
  phone_number: string
  outbound_count: number
  inbound_count: number
  most_recent_outbound: string
  lead_source: string
}

async function findCandidates(tenantId: string): Promise<BackfillCandidate[]> {
  if (MODE === 'broad') {
    return findCandidatesBroad(tenantId)
  }
  return findCandidatesGhosted(tenantId)
}

async function findCandidatesGhosted(tenantId: string): Promise<BackfillCandidate[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // STEP 1: leads with whitelisted source within lookback
  const { data: leads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, customer_id, source, created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .in('source', SOURCE_WHITELIST)
    .not('customer_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000)

  if (leadsErr) throw leadsErr
  if (!leads || leads.length === 0) return []

  const customerToLead = new Map<number, { lead_source: string; created_at: string }>()
  for (const l of leads) {
    if (l.customer_id == null) continue
    if (!customerToLead.has(l.customer_id)) {
      customerToLead.set(l.customer_id, { lead_source: l.source, created_at: l.created_at })
    }
  }
  const customerIds = Array.from(customerToLead.keys())
  if (customerIds.length === 0) return []

  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, first_name, phone_number, retargeting_active, unsubscribed_at, sms_opt_out, auto_response_disabled')
    .eq('tenant_id', tenantId)
    .in('id', customerIds)
    .is('unsubscribed_at', null)
    .neq('sms_opt_out', true)
    .neq('retargeting_active', true)
    .neq('auto_response_disabled', true)
  if (error) throw error
  if (!customers) return []

  const candidates: BackfillCandidate[] = []
  for (const c of customers) {
    if (!c.phone_number) continue
    const { data: msgs } = await supabase
      .from('messages')
      .select('direction, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', c.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (!msgs) continue
    const outbound = msgs.filter(m => m.direction === 'outbound')
    const inbound = msgs.filter(m => m.direction === 'inbound')
    if (outbound.length === 0) continue
    if (inbound.length > 0) continue
    const mostRecentOutbound = outbound[0].created_at
    if (Date.now() - new Date(mostRecentOutbound).getTime() < 24 * 60 * 60 * 1000) continue
    if (await hasPendingV2Task(tenantId, c.id)) continue
    candidates.push({
      customer_id: c.id, tenant_id: tenantId,
      first_name: c.first_name, phone_number: c.phone_number,
      outbound_count: outbound.length, inbound_count: 0,
      most_recent_outbound: mostRecentOutbound,
      lead_source: customerToLead.get(c.id)!.lead_source,
    })
  }
  return candidates
}

async function findCandidatesBroad(tenantId: string): Promise<BackfillCandidate[]> {
  // BROAD: every customer who consented (paid-acquisition lead OR completed job),
  // is not currently active (no scheduled/in-service job, no recurring lifecycle),
  // and has gone quiet for QUIET_DAYS.

  // Step 1: customers who consented to SMS contact
  const { data: leadCustomers } = await supabase
    .from('leads').select('customer_id, source')
    .eq('tenant_id', tenantId)
    .in('source', CONSENT_SOURCES)
    .not('customer_id', 'is', null)
    .limit(20000)

  const { data: jobCustomers } = await supabase
    .from('jobs').select('customer_id, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'completed')
    .not('customer_id', 'is', null)
    .limit(20000)

  const customerSourceMap = new Map<number, string>()
  for (const l of leadCustomers || []) {
    if (l.customer_id != null && !customerSourceMap.has(l.customer_id)) {
      customerSourceMap.set(l.customer_id, l.source as string)
    }
  }
  for (const j of jobCustomers || []) {
    if (j.customer_id != null && !customerSourceMap.has(j.customer_id)) {
      customerSourceMap.set(j.customer_id, 'past_client')
    }
  }
  const consentingIds = Array.from(customerSourceMap.keys())
  if (consentingIds.length === 0) return []

  const candidates: BackfillCandidate[] = []
  // Process in chunks of 200 to avoid massive .in() filter
  const chunkSize = 200
  for (let i = 0; i < consentingIds.length; i += chunkSize) {
    const chunk = consentingIds.slice(i, i + chunkSize)
    const { data: customers } = await supabase
      .from('customers')
      .select('id, first_name, phone_number, retargeting_active, unsubscribed_at, sms_opt_out, auto_response_disabled, lifecycle_state')
      .eq('tenant_id', tenantId)
      .in('id', chunk)
      .is('unsubscribed_at', null)
      .neq('sms_opt_out', true)
      .neq('retargeting_active', true)
      .neq('auto_response_disabled', true)

    for (const c of customers || []) {
      if (!c.phone_number) continue
      // Exclude active lifecycle states
      if (c.lifecycle_state && ['recurring', 'scheduled', 'in_service', 'awaiting_payment'].includes(c.lifecycle_state)) continue

      // Recent active job grace period
      const { data: activeJobs } = await supabase
        .from('jobs')
        .select('id, created_at')
        .eq('tenant_id', tenantId)
        .eq('customer_id', c.id)
        .in('status', ['scheduled', 'in_progress'])
        .gte('created_at', new Date(Date.now() - ACTIVE_JOB_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString())
        .limit(1)
      if (activeJobs && activeJobs.length > 0) continue

      // Quiet period — no inbound or outbound in last QUIET_DAYS
      const { data: recentMsg } = await supabase
        .from('messages')
        .select('id, created_at, direction')
        .eq('tenant_id', tenantId)
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(1)

      const lastMsgAge = recentMsg && recentMsg.length > 0
        ? Date.now() - new Date(recentMsg[0].created_at).getTime()
        : Infinity
      if (lastMsgAge < QUIET_DAYS * 24 * 60 * 60 * 1000) continue

      if (await hasPendingV2Task(tenantId, c.id)) continue

      // Count msgs for sample/output
      const { data: allMsgs } = await supabase
        .from('messages')
        .select('direction')
        .eq('tenant_id', tenantId)
        .eq('customer_id', c.id)
        .limit(100)
      const outboundCount = (allMsgs || []).filter(m => m.direction === 'outbound').length
      const inboundCount = (allMsgs || []).filter(m => m.direction === 'inbound').length

      candidates.push({
        customer_id: c.id, tenant_id: tenantId,
        first_name: c.first_name, phone_number: c.phone_number,
        outbound_count: outboundCount, inbound_count: inboundCount,
        most_recent_outbound: recentMsg && recentMsg.length > 0 ? recentMsg[0].created_at : '',
        lead_source: customerSourceMap.get(c.id)!,
      })
    }
  }
  return candidates
}

async function hasPendingV2Task(tenantId: string, customerId: number): Promise<boolean> {
  const { data: pending } = await supabase
    .from('scheduled_tasks')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .in('task_type', ['followup.ghost_chase', 'retargeting.win_back'])
    .filter('payload->>customer_id', 'eq', String(customerId))
    .limit(1)
  return !!pending && pending.length > 0
}

async function enrollOne(candidate: BackfillCandidate, indexInRun: number): Promise<{ enrolled: boolean; reason: string }> {
  // Schedule at +24h + (index * jitter) so 200 enrolls dont fire same minute.
  // 60s jitter * 50 customers = ~50 minutes of spread.
  const scheduledFor = new Date(Date.now() + 24 * 60 * 60 * 1000 + indexInRun * JITTER_SECONDS * 1000)
  const taskKey = `rt:${candidate.customer_id}:backfill:${Date.now()}`

  const { error } = await supabase.from('scheduled_tasks').insert({
    tenant_id: candidate.tenant_id,
    task_type: 'retargeting.win_back',
    task_key: taskKey,
    scheduled_for: scheduledFor.toISOString(),
    status: 'pending',
    payload: {
      customer_id: candidate.customer_id,
      step_index: 1,
      phase: 'structured',
      template_key: 'recurring_seed_20',
      enrolled_at: new Date().toISOString(),
      phone: candidate.phone_number,
    },
    max_attempts: 2,
    attempts: 0,
  })

  if (error) {
    // Likely partial unique index violation — already enrolled. Treat as success.
    if (error.code === '23505') {
      return { enrolled: false, reason: 'already_enrolled' }
    }
    return { enrolled: false, reason: `db_error: ${error.message}` }
  }

  // Mark active on customer row
  await supabase
    .from('customers')
    .update({ retargeting_active: true })
    .eq('id', candidate.customer_id)
    .eq('tenant_id', candidate.tenant_id)

  return { enrolled: true, reason: 'enrolled' }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`v2 BACKFILL — ghosted leads / customers who never replied`)
  console.log(`${'='.repeat(60)}\n`)
  console.log(`Mode:          ${LIVE ? 'LIVE (will write)' : 'DRY-RUN (no writes)'}`)
  console.log(`Cohort:        ${MODE} ${MODE === 'broad' ? '(consenting customers, quiet for ' + QUIET_DAYS + 'd)' : '(ghosts, last ' + LOOKBACK_DAYS + 'd, sources: ' + SOURCE_WHITELIST.join(',') + ')'}`)
  console.log(`Tenant:        ${TENANT_SLUG}`)
  console.log(`Cap per run:   ${MAX_ENROLLS}`)
  console.log(`Jitter:        ${JITTER_SECONDS}s between enrolls\n`)

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, slug, workflow_config')
    .eq('slug', TENANT_SLUG)
    .maybeSingle()

  if (error || !tenant) {
    console.error(`Tenant ${TENANT_SLUG} not found.`)
    process.exit(1)
  }

  const v2Enabled = (tenant.workflow_config as any)?.followup_rebuild_v2_enabled === true
  if (!v2Enabled) {
    console.error(`Tenant ${TENANT_SLUG} does not have followup_rebuild_v2_enabled. Backfill aborted to prevent confusion.`)
    console.error(`Flip the v2 flag first via:`)
    console.error(`  UPDATE tenants SET workflow_config = workflow_config || '{"followup_rebuild_v2_enabled": true}'::jsonb WHERE slug = '${TENANT_SLUG}';`)
    process.exit(1)
  }

  console.log(`Scanning candidates for tenant ${tenant.slug}...`)
  const candidates = await findCandidates(tenant.id)
  console.log(`Found ${candidates.length} eligible candidates.\n`)

  if (candidates.length === 0) {
    console.log('Nothing to backfill. Done.')
    process.exit(0)
  }

  // Sample print
  console.log('Sample (first 10):')
  candidates.slice(0, 10).forEach((c, i) => {
    const ageDays = Math.round((Date.now() - new Date(c.most_recent_outbound).getTime()) / (24 * 60 * 60 * 1000))
    console.log(`  ${i + 1}. customer ${c.customer_id} (${c.first_name || '?'}) — last outbound ${ageDays}d ago, ${c.outbound_count} outbound, 0 inbound`)
  })
  console.log()

  if (!LIVE) {
    console.log(`DRY-RUN. To actually enroll, run with BACKFILL_LIVE=true.`)
    console.log(`Would enroll up to ${Math.min(MAX_ENROLLS, candidates.length)} customers.`)
    process.exit(0)
  }

  // LIVE mode: enroll up to MAX_ENROLLS, jittered scheduled_for
  const toEnroll = candidates.slice(0, MAX_ENROLLS)
  const totalSpreadMin = Math.round((toEnroll.length * JITTER_SECONDS) / 60)
  console.log(`Enrolling ${toEnroll.length} customers (first message in 24h, spread over ~${totalSpreadMin} min)...\n`)

  let enrolled = 0
  let skipped = 0
  let errored = 0

  for (let i = 0; i < toEnroll.length; i++) {
    const c = toEnroll[i]
    const res = await enrollOne(c, i)
    if (res.enrolled) enrolled++
    else if (res.reason === 'already_enrolled') skipped++
    else {
      errored++
      console.error(`  customer ${c.customer_id}: ${res.reason}`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Enrolled:   ${enrolled}`)
  console.log(`Skipped:    ${skipped}  (already enrolled)`)
  console.log(`Errored:    ${errored}`)
  console.log(`Remaining:  ${candidates.length - toEnroll.length}  (run again to continue)`)
  console.log(`${'='.repeat(60)}\n`)

  // Log a system event marking this run
  await supabase.from('system_events').insert({
    tenant_id: tenant.id,
    source: 'legacy-flush',
    event_type: 'RETARGETING_ENROLLED_FROM_JOB',
    message: `v2 backfill enrolled ${enrolled} ghosted customers (lookback=${LOOKBACK_DAYS}d, cap=${MAX_ENROLLS})`,
    metadata: { enrolled, skipped, errored, remaining: candidates.length - toEnroll.length, lookback_days: LOOKBACK_DAYS },
  })

  process.exit(0)
}

main().catch(err => {
  console.error('Backfill failed:', err)
  process.exit(1)
})
