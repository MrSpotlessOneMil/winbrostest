#!/usr/bin/env tsx
/**
 * v2 backfill: enroll customers who got the initial AI message but never
 * received any follow-up (because the v2 wiring was missing).
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md
 *
 * Eligibility (all must be true):
 *   - tenant has followup_rebuild_v2_enabled = true (gate)
 *   - customer has at least one outbound message older than 24 hours
 *   - customer has ZERO inbound messages (truly never replied)
 *   - not unsubscribed
 *   - not currently retargeting_active
 *   - no pending followup.ghost_chase or retargeting.win_back rows
 *
 * Action: enroll each in retargeting (single retargeting.win_back at +24h,
 * structured phase). Idempotent — partial unique index on scheduled_tasks
 * prevents double-enrollment.
 *
 * Throttle: caps total enrolls at MAX_ENROLLS_PER_RUN. Run multiple times
 * across days if needed. Each enroll fires 24h later, so the practical
 * SMS load is spread by Twilio + the per-minute cron tick.
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
const SOURCE_WHITELIST = (process.env.BACKFILL_SOURCES || 'meta,website')
  .split(',').map(s => s.trim()).filter(Boolean)

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
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // STEP 1: pull leads with whitelisted source within lookback. This is the
  // primary filter — we only backfill paid-acquisition / form-fill leads,
  // never inbound calls / manual entries / sms-only contacts.
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

  // Dedup customers — keep most recent lead per customer
  const customerToLead = new Map<number, { lead_source: string; created_at: string }>()
  for (const l of leads) {
    if (l.customer_id == null) continue
    if (!customerToLead.has(l.customer_id)) {
      customerToLead.set(l.customer_id, { lead_source: l.source, created_at: l.created_at })
    }
  }

  const customerIds = Array.from(customerToLead.keys())
  if (customerIds.length === 0) return []

  // STEP 2: pull customer state for those ids and apply eligibility gates
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

    // Count messages
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

    // Skip if already has pending v2 task
    const { data: pending } = await supabase
      .from('scheduled_tasks')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .in('task_type', ['followup.ghost_chase', 'retargeting.win_back'])
      .filter('payload->>customer_id', 'eq', String(c.id))
      .limit(1)

    if (pending && pending.length > 0) continue

    candidates.push({
      customer_id: c.id,
      tenant_id: tenantId,
      first_name: c.first_name,
      phone_number: c.phone_number,
      outbound_count: outbound.length,
      inbound_count: 0,
      most_recent_outbound: mostRecentOutbound,
      lead_source: customerToLead.get(c.id)!.lead_source,
    })
  }

  return candidates
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
  console.log(`Tenant:        ${TENANT_SLUG}`)
  console.log(`Lookback:      ${LOOKBACK_DAYS} days`)
  console.log(`Sources:       ${SOURCE_WHITELIST.join(', ')}`)
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
