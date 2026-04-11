#!/usr/bin/env npx tsx
/**
 * Backfill Stale Leads
 *
 * One-time script to triage leads stuck on "new" status.
 * - Leads with phone + no job → schedule follow-up SMS
 * - Leads with no phone → mark as lost
 * - Leads with job in "quoted" → let the follow-up-quoted cron handle them
 *
 * Usage:
 *   npx tsx scripts/backfill-stale-leads.ts              # Dry run (default)
 *   npx tsx scripts/backfill-stale-leads.ts --execute     # Actually do it
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

async function main() {
  const execute = process.argv.includes('--execute')
  const tenantSlug = process.argv.includes('--tenant')
    ? process.argv[process.argv.indexOf('--tenant') + 1]
    : 'spotless-scrubbers'

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
    process.exit(1)
  }

  const client = createClient(SUPABASE_URL, SUPABASE_KEY)
  console.log(`\nBackfill Stale Leads — ${execute ? 'EXECUTE MODE' : 'DRY RUN'}`)
  console.log(`Tenant: ${tenantSlug}\n`)

  // Get tenant
  const { data: tenant } = await client
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) {
    console.error(`Tenant not found: ${tenantSlug}`)
    process.exit(1)
  }

  // Find stale leads (status = 'new', older than 3 days)
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { data: staleLeads, error } = await client
    .from('leads')
    .select('id, phone_number, first_name, source, created_at, converted_to_job_id')
    .eq('tenant_id', tenant.id)
    .eq('status', 'new')
    .lt('created_at', threeDaysAgo)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to query leads:', error.message)
    process.exit(1)
  }

  console.log(`Found ${staleLeads?.length || 0} stale leads\n`)

  let hasPhone = 0
  let noPhone = 0
  let hasJob = 0
  let wouldFollowUp = 0

  for (const lead of staleLeads || []) {
    const age = Math.round((Date.now() - new Date(lead.created_at).getTime()) / (1000 * 60 * 60 * 24))

    if (lead.converted_to_job_id) {
      hasJob++
      console.log(`  [HAS JOB] Lead ${lead.id} (${lead.first_name || 'unknown'}, ${lead.source}) → job ${lead.converted_to_job_id} — skipping, follow-up-quoted cron will handle`)
      continue
    }

    if (!lead.phone_number) {
      noPhone++
      console.log(`  [NO PHONE] Lead ${lead.id} (${lead.first_name || 'unknown'}, ${lead.source}, ${age}d old) → marking lost`)
      if (execute) {
        await client
          .from('leads')
          .update({ status: 'lost' })
          .eq('id', lead.id)
      }
      continue
    }

    hasPhone++
    wouldFollowUp++
    console.log(`  [FOLLOW UP] Lead ${lead.id} (${lead.first_name || 'unknown'}, ${lead.phone_number}, ${lead.source}, ${age}d old)`)

    if (execute) {
      // Move to "contacted" so they're in the pipeline
      await client
        .from('leads')
        .update({ status: 'contacted', last_contact_at: new Date().toISOString() })
        .eq('id', lead.id)
    }
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Summary:`)
  console.log(`  Total stale: ${staleLeads?.length || 0}`)
  console.log(`  Has job (cron handles): ${hasJob}`)
  console.log(`  No phone (mark lost): ${noPhone}`)
  console.log(`  Has phone (follow up): ${wouldFollowUp}`)
  console.log(`  ${execute ? 'EXECUTED' : 'DRY RUN — run with --execute to apply'}`)
}

main().catch(console.error)
