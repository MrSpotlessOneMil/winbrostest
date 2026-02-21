/**
 * One-time backfill script to sync existing OSIRIS jobs to HouseCall Pro.
 * Run: npx tsx scripts/backfill-hcp-jobs.ts
 *
 * Finds all jobs with housecall_pro_job_id = NULL and status in ('scheduled', 'in_progress'),
 * then syncs each one to HCP with a 1-second delay between calls.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function main() {
  console.log('\n=== HCP Job Backfill ===\n')

  // Load tenant
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', 'winbros')
    .single()

  if (tenantErr || !tenant) {
    console.error('Failed to load tenant:', tenantErr?.message)
    return
  }

  if (!tenant.housecall_pro_api_key) {
    console.error('No HCP API key configured for winbros tenant')
    return
  }

  // Find jobs without HCP sync
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select(`
      id, phone_number, address, service_type, date, scheduled_at, price, hours, notes, status,
      customers (first_name, last_name, email, phone_number)
    `)
    .eq('tenant_id', tenant.id)
    .is('housecall_pro_job_id', null)
    .in('status', ['scheduled', 'in_progress'])
    .order('created_at', { ascending: true })

  if (jobsErr) {
    console.error('Failed to query jobs:', jobsErr.message)
    return
  }

  console.log(`Found ${jobs?.length || 0} jobs to backfill\n`)

  if (!jobs?.length) {
    console.log('Nothing to do!')
    return
  }

  // Dynamic import of the sync function
  const { syncNewJobToHCP } = await import('../lib/hcp-job-sync')

  let synced = 0
  let failed = 0

  for (const job of jobs) {
    const customer = (job as any).customers
    const phone = job.phone_number || customer?.phone_number || ''

    console.log(`[${synced + failed + 1}/${jobs.length}] Job ${job.id}: ${job.service_type || 'unknown'} at ${job.address || 'no address'}`)

    if (!phone) {
      console.log(`  SKIP: No phone number`)
      failed++
      continue
    }

    try {
      await syncNewJobToHCP({
        tenant: tenant as any,
        jobId: job.id,
        phone,
        firstName: customer?.first_name || undefined,
        lastName: customer?.last_name || undefined,
        email: customer?.email || undefined,
        address: job.address || undefined,
        serviceType: job.service_type || undefined,
        scheduledDate: job.date || undefined,
        scheduledTime: job.scheduled_at || undefined,
        durationHours: job.hours ? Number(job.hours) : undefined,
        price: job.price ? Number(job.price) : undefined,
        notes: job.notes || undefined,
        source: 'backfill',
      })
      synced++
      console.log(`  OK`)
    } catch (err) {
      failed++
      console.error(`  FAILED:`, err instanceof Error ? err.message : err)
    }

    // Rate limit: 1 second between calls
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log(`\n=== Backfill Complete ===`)
  console.log(`Synced: ${synced}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total:  ${jobs.length}`)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
