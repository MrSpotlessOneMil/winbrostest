#!/usr/bin/env tsx
/**
 * Legacy Follow-up / Retargeting Task Flush — DRY-RUN-FIRST.
 *
 * Plan: ~/.claude/plans/a-remeber-i-said-drifting-manatee.md (Build 2 — Pending-task triage)
 *
 * Goal: Cancel pending scheduled_tasks that belong to the LEGACY follow-up
 * + retargeting system, while leaving operational tasks (job_broadcast,
 * day_before_reminder, sms_retry, etc.) untouched.
 *
 * Whitelist of retired task_types (only these get cancelled):
 *   - retargeting (legacy retargeting cron)
 *   - lead_followup (legacy followup cron)
 *   - quote_followup_urgent
 *   - mid_convo_nudge
 *   - hot_lead_followup
 *   - monthly_reengagement
 *
 * Usage:
 *   # 1. Dry-run first (default — shows what WOULD be cancelled, makes no changes):
 *   npx tsx scripts/legacy-followup-flush.ts
 *
 *   # 2. After Dominic reviews counts, flip to live mode:
 *   FLUSH_LIVE=true npx tsx scripts/legacy-followup-flush.ts
 *
 *   # 3. Restrict to one tenant (recommended for staged rollout):
 *   TENANT_SLUG=spotless-scrubbers npx tsx scripts/legacy-followup-flush.ts
 *
 * Safety:
 *   - Operational task_types are never cancelled regardless of how the
 *     whitelist is configured.
 *   - Logs system_event LEGACY_FOLLOWUPS_FLUSHED with full count breakdown.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const RETIRED_TASK_TYPES = [
  'retargeting',
  'lead_followup',
  'quote_followup_urgent',
  'mid_convo_nudge',
  'hot_lead_followup',
  'monthly_reengagement',
] as const

const OPERATIONAL_TASK_TYPES_NEVER_TOUCH = [
  'job_broadcast',
  'day_before_reminder',
  'job_reminder',
  'post_cleaning_followup',
  'sms_retry',
  'post_job_satisfaction',
  'post_job_review',
  'post_job_tip',
  'post_job_recurring_push',
  'manual_call',
  'send_sms',
  'ranked_cascade',
  // v2 task types — must NEVER be flushed by this script
  'followup.ghost_chase',
  'retargeting.win_back',
] as const

const LIVE = process.env.FLUSH_LIVE === 'true'
const TENANT_SLUG = process.env.TENANT_SLUG || ''

async function resolveTenantId(slug: string): Promise<string | null> {
  if (!slug) return null
  const { data } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
  return data?.id || null
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(' Legacy Follow-up / Retargeting Task Flush')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`Mode: ${LIVE ? '🔴 LIVE (will cancel rows)' : '🟢 DRY RUN (no changes)'}`)
  console.log(`Tenant filter: ${TENANT_SLUG || '(all)'}`)
  console.log()

  // Sanity guard: any retired task type must NOT also be in the never-touch list
  const overlap = RETIRED_TASK_TYPES.filter(t => (OPERATIONAL_TASK_TYPES_NEVER_TOUCH as readonly string[]).includes(t))
  if (overlap.length > 0) {
    console.error(`FATAL: retired+operational overlap: ${overlap.join(', ')}. Refusing to run.`)
    process.exit(1)
  }

  let tenantFilter: string | null = null
  if (TENANT_SLUG) {
    tenantFilter = await resolveTenantId(TENANT_SLUG)
    if (!tenantFilter) {
      console.error(`Tenant not found: ${TENANT_SLUG}`)
      process.exit(1)
    }
    console.log(`Resolved tenant: ${TENANT_SLUG} → ${tenantFilter}`)
    console.log()
  }

  // ── Dry-run / live: count what we'd touch ────────────────────────────────
  let totalCancelled = 0
  const summary: Array<{ task_type: string; count: number; oldest: string | null; newest: string | null }> = []

  for (const taskType of RETIRED_TASK_TYPES) {
    let q = supabase
      .from('scheduled_tasks')
      .select('id, created_at, scheduled_for', { count: 'exact' })
      .eq('task_type', taskType)
      .eq('status', 'pending')
    if (tenantFilter) q = q.eq('tenant_id', tenantFilter)

    const { data, count, error } = await q.order('scheduled_for', { ascending: true }).limit(1)
    if (error) {
      console.error(`  ${taskType}: query failed: ${error.message}`)
      continue
    }
    const sample = data?.[0]
    let newest: string | null = null
    if ((count || 0) > 0) {
      const { data: newestRow } = await supabase
        .from('scheduled_tasks')
        .select('scheduled_for')
        .eq('task_type', taskType)
        .eq('status', 'pending')
        .order('scheduled_for', { ascending: false })
        .limit(1)
        .maybeSingle()
      newest = newestRow?.scheduled_for || null
    }
    summary.push({
      task_type: taskType,
      count: count || 0,
      oldest: sample?.scheduled_for || null,
      newest,
    })
  }

  console.log('Pending rows by retired task_type:')
  console.log('─────────────────────────────────────────────────────────────')
  for (const row of summary) {
    console.log(`  ${row.task_type.padEnd(28)} ${String(row.count).padStart(5)} pending` +
      (row.count > 0 ? `  (${row.oldest?.slice(0, 16)} → ${row.newest?.slice(0, 16)})` : ''))
    totalCancelled += row.count
  }
  console.log('─────────────────────────────────────────────────────────────')
  console.log(`  ${'TOTAL'.padEnd(28)} ${String(totalCancelled).padStart(5)}`)
  console.log()

  // Operational counts — informational only, NEVER touched
  console.log('Operational task_types (NEVER flushed, shown for sanity):')
  console.log('─────────────────────────────────────────────────────────────')
  for (const taskType of OPERATIONAL_TASK_TYPES_NEVER_TOUCH) {
    let q = supabase
      .from('scheduled_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('task_type', taskType)
      .eq('status', 'pending')
    if (tenantFilter) q = q.eq('tenant_id', tenantFilter)
    const { count } = await q
    console.log(`  ${taskType.padEnd(28)} ${String(count || 0).padStart(5)} pending (preserved)`)
  }
  console.log()

  if (!LIVE) {
    console.log('🟢 DRY RUN — no changes made.')
    console.log('   To flush for real: FLUSH_LIVE=true npx tsx scripts/legacy-followup-flush.ts')
    return
  }

  // ── LIVE FLUSH ───────────────────────────────────────────────────────────
  console.log('🔴 LIVE FLUSH — cancelling pending rows for retired task_types…')
  let flushedTotal = 0
  for (const taskType of RETIRED_TASK_TYPES) {
    let q = supabase
      .from('scheduled_tasks')
      .update({
        status: 'cancelled',
        last_error: 'cancelled: legacy_followups_flush_2026_04_28',
        updated_at: new Date().toISOString(),
      })
      .eq('task_type', taskType)
      .eq('status', 'pending')
    if (tenantFilter) q = q.eq('tenant_id', tenantFilter)

    const { data, error } = await q.select('id')
    if (error) {
      console.error(`  ${taskType}: flush failed: ${error.message}`)
      continue
    }
    const flushedCount = data?.length || 0
    flushedTotal += flushedCount
    console.log(`  ${taskType.padEnd(28)} ${String(flushedCount).padStart(5)} cancelled`)
  }

  console.log()
  console.log(`Flushed ${flushedTotal} rows total.`)

  // Log to system_events
  await supabase.from('system_events').insert({
    source: 'legacy-flush',
    event_type: 'LEGACY_FOLLOWUPS_FLUSHED',
    tenant_id: tenantFilter,
    message: `Flushed ${flushedTotal} legacy follow-up/retargeting tasks` + (TENANT_SLUG ? ` (tenant: ${TENANT_SLUG})` : ' (all tenants)'),
    metadata: { flushed_total: flushedTotal, tenant_slug: TENANT_SLUG || null, retired_types: RETIRED_TASK_TYPES },
  })
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
